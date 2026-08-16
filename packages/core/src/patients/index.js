import { DateTime } from 'luxon';
import { toDT } from '../time.js';
import { newToken, AuthError } from '../auth/tokens.js';
import { requirePatientInClinic, logAccess } from '../auth/access.js';
import { currentDose } from '../doses/currentDose.js';
import { toHm } from '../scheduler/next-run.js';

const PATIENT_STATUS = new Set(['active', 'paused', 'discharged']);
const RESP_KIND = new Set(['patient', 'caregiver']);

export class ValidationError extends Error {
  constructor(message, field = null) {
    super(message);
    this.code = 'validation';
    this.field = field;
  }
}

function requireDoctor(session) {
  if (!session || session.kind !== 'user')
    throw new AuthError('unauthenticated', 'Sessão da clínica necessária.');
}

function cleanTags(tags) {
  if (tags == null) return [];
  const arr = Array.isArray(tags) ? tags : String(tags).split(',');
  return [...new Set(arr.map((t) => String(t).trim().toLowerCase()).filter(Boolean))].slice(0, 20);
}

function normalizeRespondentInput(r) {
  const kind = String(r?.kind ?? 'patient');
  if (!RESP_KIND.has(kind)) throw new ValidationError('Tipo de respondente inválido.', 'kind');
  const name = String(r?.name ?? '').trim();
  if (!name) throw new ValidationError('Nome do respondente é obrigatório.', 'name');
  const email = r?.email ? String(r.email).trim().toLowerCase() : null;
  if (email && !email.includes('@'))
    throw new ValidationError('E-mail do respondente inválido.', 'email');
  return {
    kind,
    name,
    email,
    phone: r?.phone ? String(r.phone).trim() : null,
    relationship: r?.relationship ? String(r.relationship).trim() : null,
    can_answer: r?.can_answer === undefined ? true : !!r.can_answer,
    receives_alarms: r?.receives_alarms === undefined ? true : !!r.receives_alarms,
  };
}

function patientPatch(input, { partial }) {
  const patch = {};
  const has = (k) => Object.hasOwn(input ?? {}, k);
  if (!partial || has('name')) {
    const name = String(input?.name ?? '').trim();
    if (name.length < 2)
      throw new ValidationError('Nome do paciente é obrigatório (mín. 2 caracteres).', 'name');
    patch.name = name;
  }
  if (has('birth_date'))
    patch.birth_date = input.birth_date ? String(input.birth_date).slice(0, 10) : null;
  if (has('condition_tags')) patch.condition_tags = cleanTags(input.condition_tags);
  if (has('timezone')) patch.timezone = String(input.timezone || 'America/Cuiaba');
  for (const k of ['checkin_time', 'quiet_start', 'quiet_end']) {
    if (has(k)) {
      const hm = toHm(input[k]);
      if (!hm) throw new ValidationError(`Horário inválido em ${k}.`, k);
      patch[k] = hm;
    }
  }
  if (has('status')) {
    if (!PATIENT_STATUS.has(input.status)) throw new ValidationError('Status inválido.', 'status');
    patch.status = input.status;
  }
  if (has('consent_version'))
    patch.consent_version = input.consent_version ? String(input.consent_version) : null;
  return patch;
}

/** Cadastro: paciente + respondentes (cada um com invite_token). Audit `create`. */
export async function createPatient(db, session, input, now) {
  requireDoctor(session);
  const nowJs = toDT(now).toJSDate();
  const patch = patientPatch(input, { partial: false });
  const respondents = (input?.respondents ?? []).map(normalizeRespondentInput);
  if (!respondents.length) {
    respondents.push({
      kind: 'patient',
      name: patch.name,
      email: null,
      phone: null,
      relationship: null,
      can_answer: true,
      receives_alarms: true,
    });
  }
  if (!respondents.some((r) => r.can_answer)) {
    throw new ValidationError('Pelo menos um respondente precisa poder responder.', 'respondents');
  }
  return db.transaction(async (trx) => {
    const [patient] = await trx('patients')
      .insert({
        clinic_id: session.clinicId,
        ...patch,
        consent_at: patch.consent_version ? nowJs : null,
        created_by: session.userId,
      })
      .returning('*');
    const rows = await trx('respondents')
      .insert(respondents.map((r) => ({ ...r, patient_id: patient.id, invite_token: newToken() })))
      .returning('*');
    await logAccess(
      trx,
      { session, patientId: patient.id, route: 'patients.create', action: 'create' },
      now,
    );
    return { patient, respondents: rows };
  });
}

export async function updatePatient(db, session, patientId, input, now) {
  requireDoctor(session);
  await requirePatientInClinic(db, session, patientId);
  const patch = patientPatch(input, { partial: true });
  if (!Object.keys(patch).length) throw new ValidationError('Nada para atualizar.');
  const [row] = await db('patients')
    .where({ id: patientId })
    .update({ ...patch, updated_at: db.fn.now() })
    .returning('*');
  await logAccess(db, { session, patientId, route: 'patients.update', action: 'update' }, now);
  return row;
}

async function medicationsWithDose(db, patientIds, now) {
  if (!patientIds.length) return new Map();
  const meds = await db('medications as m')
    .join('products as pr', 'pr.id', 'm.product_id')
    .whereIn('m.patient_id', patientIds)
    .andWhere('m.active', true)
    .select(
      'm.id',
      'm.patient_id',
      'm.product_id',
      'pr.name as product_name',
      'pr.form',
      'pr.cbd_mg_ml',
      'pr.thc_mg_ml',
    );
  const byPatient = new Map();
  for (const m of meds) {
    const dose = await currentDose(db, m.id, toDT(now).toJSDate());
    const item = { ...m, current_dose: dose };
    if (!byPatient.has(m.patient_id)) byPatient.set(m.patient_id, []);
    byPatient.get(m.patient_id).push(item);
  }
  return byPatient;
}

/** Lista com resumo por paciente (fonte de cada número: consultas abaixo). */
export async function listPatients(db, { clinicId }, now) {
  const patients = await db('patients').where({ clinic_id: clinicId }).orderBy('name');
  const ids = patients.map((p) => p.id);
  if (!ids.length) return [];
  const episodes = await db('episodes').whereIn('patient_id', ids).whereNull('ended_at');
  const alerts = await db('alerts')
    .whereIn('patient_id', ids)
    .whereNot('status', 'resolved')
    .select('patient_id')
    .count('* as n')
    .groupBy('patient_id');
  const lastCheckins = await db('checkins')
    .whereIn('patient_id', ids)
    .where('status', 'completed')
    .select('patient_id')
    .max('completed_at as at')
    .groupBy('patient_id');
  const meds = await medicationsWithDose(db, ids, now);
  const respCounts = await db('respondents')
    .whereIn('patient_id', ids)
    .select('patient_id')
    .count('* as n')
    .groupBy('patient_id');
  const byId = (rows, key = 'patient_id') => Object.fromEntries(rows.map((r) => [r[key], r]));
  const ep = byId(episodes);
  const al = byId(alerts);
  const lc = byId(lastCheckins);
  const rc = byId(respCounts);
  return patients.map((p) => ({
    ...p,
    episode: ep[p.id]
      ? {
          id: ep[p.id].id,
          kind: ep[p.id].kind,
          checkin_frequency: ep[p.id].checkin_frequency,
          started_at: ep[p.id].started_at,
        }
      : null,
    open_alerts: al[p.id] ? Number(al[p.id].n) : 0,
    last_checkin_at: lc[p.id]?.at ?? null,
    respondents_count: rc[p.id] ? Number(rc[p.id].n) : 0,
    medications: meds.get(p.id) ?? [],
  }));
}

/** Grade: últimos N dias (fuso do paciente) × perguntas do episódio; célula = última resposta do dia. */
export async function patientGrid(db, patientId, { days = 14, now } = {}) {
  const patient = await db('patients').where({ id: patientId }).first();
  if (!patient) throw new AuthError('not_found', 'Paciente não encontrado.');
  const tz = patient.timezone || 'UTC';
  const today = toDT(now).setZone(tz).startOf('day');
  const dayList = [];
  for (let i = days - 1; i >= 0; i -= 1) dayList.push(today.minus({ days: i }).toISODate());
  const from = today
    .minus({ days: days - 1 })
    .toUTC()
    .toJSDate();

  const ep = await db('episodes')
    .where({ patient_id: patientId })
    .orderBy('started_at', 'desc')
    .first();
  const questions = ep
    ? await db('questions')
        .where({ question_set_id: ep.question_set_id, active: true })
        .orderBy('sort_order')
        .select('key', 'label', 'kind', 'unit', 'is_side_effect')
    : [];

  const answers = await db('answers as a')
    .join('checkins as c', 'c.id', 'a.checkin_id')
    .join('questions as q', 'q.id', 'a.question_id')
    .where('c.patient_id', patientId)
    .andWhere('c.scheduled_for', '>=', from)
    .andWhere('a.skipped', false)
    .orderBy('a.answered_at')
    .select('c.scheduled_for', 'q.key', 'a.value_num', 'a.value_choice', 'a.value_text');
  const cells = {};
  for (const a of answers) {
    const d = DateTime.fromJSDate(new Date(a.scheduled_for)).setZone(tz).toISODate();
    if (!cells[d]) cells[d] = {};
    cells[d][a.key] = a.value_num ?? a.value_choice ?? a.value_text;
  }
  const scoreRows = await db('patient_scores_daily')
    .where({ patient_id: patientId })
    .andWhere('date', '>=', dayList[0])
    .select('date', 'score', 'risk_level');
  const scores = {};
  const risk = {};
  for (const r of scoreRows) {
    const d = r.date instanceof Date ? DateTime.fromJSDate(r.date).toISODate() : String(r.date);
    scores[d] = r.score;
    risk[d] = r.risk_level;
  }
  const doseRows = await db('dose_events as de')
    .join('medications as m', 'm.id', 'de.medication_id')
    .where('m.patient_id', patientId)
    .andWhere('de.effective_from', '>=', dayList[0])
    .select('de.effective_from', 'de.dose_amount', 'de.dose_unit', 'de.reason');
  const doseMarkers = doseRows.map((r) => ({
    date:
      r.effective_from instanceof Date
        ? DateTime.fromJSDate(r.effective_from).toISODate()
        : String(r.effective_from),
    dose_amount: r.dose_amount,
    dose_unit: r.dose_unit,
    reason: r.reason,
  }));
  return { days: dayList, questions, cells, scores, risk, doseMarkers, timezone: tz };
}

/** Detalhe completo para a tela do paciente. Audit `view`. */
export async function getPatientDetail(db, session, patientId, { baseUrl = '', now } = {}) {
  requireDoctor(session);
  const patient = await requirePatientInClinic(db, session, patientId);
  const respondents = (
    await db('respondents').where({ patient_id: patientId }).orderBy('created_at')
  ).map((r) => ({
    ...r,
    invite_url: `${String(baseUrl).replace(/\/$/, '')}/p/convite/${r.invite_token}`,
  }));
  const meds = (await medicationsWithDose(db, [patientId], now)).get(patientId) ?? [];
  for (const m of meds) {
    m.dose_history = await db('dose_events')
      .where({ medication_id: m.id })
      .orderBy('effective_from', 'desc');
  }
  const episode = await db('episodes')
    .where({ patient_id: patientId })
    .whereNull('ended_at')
    .first();
  const questionSet = episode
    ? await db('question_sets').where({ id: episode.question_set_id }).first()
    : null;
  const alerts = await db('alerts')
    .where({ patient_id: patientId })
    .whereNot('status', 'resolved')
    .orderBy('last_seen_at', 'desc');
  const grid = await patientGrid(db, patientId, { days: 14, now });
  await logAccess(db, { session, patientId, route: 'patients.detail', action: 'view' }, now);
  return {
    patient,
    respondents,
    medications: meds,
    episode: episode ? { ...episode, question_set_name: questionSet?.name ?? null } : null,
    alerts,
    grid,
  };
}

export async function addRespondent(db, session, patientId, input, now) {
  requireDoctor(session);
  await requirePatientInClinic(db, session, patientId);
  const r = normalizeRespondentInput(input);
  const [row] = await db('respondents')
    .insert({ ...r, patient_id: patientId, invite_token: newToken() })
    .returning('*');
  await logAccess(db, { session, patientId, route: 'respondents.create', action: 'update' }, now);
  return row;
}

export async function updateRespondent(db, session, respondentId, input, now) {
  requireDoctor(session);
  const r = await db('respondents as r')
    .join('patients as p', 'p.id', 'r.patient_id')
    .where('r.id', respondentId)
    .andWhere('p.clinic_id', session.clinicId)
    .select('r.*')
    .first();
  if (!r) throw new AuthError('not_found', 'Respondente não encontrado.');
  const patch = {};
  const has = (k) => Object.hasOwn(input ?? {}, k);
  if (has('name')) {
    const name = String(input.name ?? '').trim();
    if (!name) throw new ValidationError('Nome obrigatório.', 'name');
    patch.name = name;
  }
  if (has('email')) patch.email = input.email ? String(input.email).trim().toLowerCase() : null;
  if (has('phone')) patch.phone = input.phone ? String(input.phone).trim() : null;
  if (has('relationship'))
    patch.relationship = input.relationship ? String(input.relationship).trim() : null;
  if (has('can_answer')) patch.can_answer = !!input.can_answer;
  if (has('receives_alarms')) patch.receives_alarms = !!input.receives_alarms;
  if (!Object.keys(patch).length) throw new ValidationError('Nada para atualizar.');
  const [row] = await db('respondents')
    .where({ id: respondentId })
    .update({ ...patch, updated_at: db.fn.now() })
    .returning('*');
  await logAccess(
    db,
    { session, patientId: r.patient_id, route: 'respondents.update', action: 'update' },
    now,
  );
  return row;
}
