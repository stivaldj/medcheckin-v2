import { DateTime } from 'luxon';
import { catalogNameKey } from '../catalog/nameKey.js';
import { setupStatus, activeSubscriptionCounts } from '../onboarding/index.js';
import { toDT } from '../time.js';
import { newToken, AuthError } from '../auth/tokens.js';
import { requirePatientInClinic, logAccess } from '../auth/access.js';
import { currentDose } from '../doses/currentDose.js';
import { toHm, inQuietHours } from '../scheduler/next-run.js';
import { ValidationError } from '../errors.js';
import { listRoutine } from '../routine/index.js';
import {
  questionsForPatient,
  listPatientQuestions,
  packHasAdherence,
} from '../questions/patientQuestions.js';
import {
  findOrCreateCondition,
  listPatientConditions,
  conditionsByPatient,
} from '../conditions/index.js';

export { ValidationError };

const PATIENT_STATUS = new Set(['active', 'paused', 'discharged', 'registered']);
const RESP_KIND = new Set(['patient', 'caregiver']);

function requireDoctor(session) {
  if (!session || session.kind !== 'user')
    throw new AuthError('unauthenticated', 'Sessão da clínica necessária.');
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
    patch.name_key = catalogNameKey(name);
  }
  if (has('birth_date'))
    patch.birth_date = input.birth_date ? String(input.birth_date).slice(0, 10) : null;
  if (has('timezone')) patch.timezone = String(input.timezone || 'America/Cuiaba');
  for (const k of ['checkin_time', 'quiet_start', 'quiet_end']) {
    if (has(k)) {
      const hm = toHm(input[k]);
      if (!hm) throw new ValidationError(`Horário inválido em ${k}.`, k);
      patch[k] = hm;
    }
  }
  if (has('status')) {
    if (input.status === 'registered')
      throw new ValidationError('Cadastrado só nasce pela importação.', 'status');
    if (!PATIENT_STATUS.has(input.status)) throw new ValidationError('Status inválido.', 'status');
    patch.status = input.status;
  }
  if (has('consent_version'))
    patch.consent_version = input.consent_version ? String(input.consent_version) : null;
  return patch;
}

/**
 * O horário do check-in não pode cair na janela de silêncio: o disparo seria empurrado para depois
 * e o paciente nunca receberia no horário escolhido — "sucesso falso" que a regra 2 proíbe.
 */
function assertCheckinTimeAwake(patch, current = {}) {
  const time = toHm(patch.checkin_time ?? current.checkin_time);
  const start = toHm(patch.quiet_start ?? current.quiet_start) ?? '21:00';
  const end = toHm(patch.quiet_end ?? current.quiet_end) ?? '08:00';
  if (!time) return;
  const dt = DateTime.fromISO(`2000-01-01T${time}`, { zone: 'utc' });
  if (inQuietHours(dt, start, end)) {
    throw new ValidationError(
      `${time} está dentro do silêncio (${start}–${end}): o envio seria adiado. Escolha um horário fora dessa janela ou ajuste o silêncio.`,
      'checkin_time',
    );
  }
}

/** Cadastro: paciente + respondentes (cada um com invite_token). Audit `create`. */
export async function createPatient(db, session, input, now) {
  requireDoctor(session);
  const nowJs = toDT(now).toJSDate();
  const patch = patientPatch(input, { partial: false });
  assertCheckinTimeAwake(patch);
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
  const conditionNames = Array.isArray(input?.conditions)
    ? input.conditions
    : String(input?.conditions ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
  const conditionIds = [];
  for (const name of conditionNames) {
    const { condition } = await findOrCreateCondition(db, session, { name });
    if (!conditionIds.includes(condition.id)) conditionIds.push(condition.id);
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
    if (conditionIds.length)
      await trx('patient_conditions').insert(
        conditionIds.map((condition_id) => ({ patient_id: patient.id, condition_id })),
      );
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
  const current = await db('patients').where({ id: patientId }).first();
  assertCheckinTimeAwake(patch, current);
  const [row] = await db('patients')
    .where({ id: patientId })
    .update({ ...patch, updated_at: db.fn.now() })
    .returning('*');
  await logAccess(db, { session, patientId, route: 'patients.update', action: 'update' }, now);
  return row;
}

async function medicationsWithDose(db, patientIds, now) {
  if (!patientIds.length) return new Map();
  // P0-1: a dose vigente é cortada no dia LOCAL de cada paciente, não no dia UTC.
  const tzRows = await db('patients').whereIn('id', patientIds).select('id', 'timezone');
  const tzById = Object.fromEntries(tzRows.map((p) => [p.id, p.timezone]));
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
    const dose = await currentDose(db, m.id, toDT(now).toJSDate(), tzById[m.patient_id] ?? null);
    const item = { ...m, current_dose: dose };
    if (!byPatient.has(m.patient_id)) byPatient.set(m.patient_id, []);
    byPatient.get(m.patient_id).push(item);
  }
  return byPatient;
}

const LIST_STATUS = new Set(['following', 'active', 'paused', 'discharged', 'registered', 'all']);
const PAGE_SIZE_MAX = 200;

/**
 * Lista paginada com resumo por paciente. D37: o padrão é "em acompanhamento" (ativos + pausados);
 * `registered` (Cadastrado) só aparece quando pedido. `q` busca sem acento pela `name_key`.
 * Obs.: `%`/`_` são removidos da chave de busca em vez de escapados — o `like` do knex/pg não usa
 * cláusula ESCAPE por padrão, então `\$&` não teria efeito nenhum.
 */
export async function listPatients(
  db,
  { clinicId, condition = null, q = '', status = 'following', page = 1, pageSize = 50 },
  now,
) {
  if (!LIST_STATUS.has(status)) throw new ValidationError('Status de filtro inválido.', 'status');
  const size = Math.min(Math.max(Number(pageSize) || 50, 1), PAGE_SIZE_MAX);
  const pg = Math.max(Number(page) || 1, 1);
  const key = catalogNameKey(String(q ?? '')).replace(/[%_]/g, '');

  let base = db('patients as p').where('p.clinic_id', clinicId);
  if (status === 'following') base = base.whereIn('p.status', ['active', 'paused']);
  else if (status !== 'all') base = base.where('p.status', status);
  if (key.length >= 2) base = base.where('p.name_key', 'like', `%${key}%`);
  if (condition)
    base = base.whereExists(
      db('patient_conditions as pc')
        .whereRaw('pc.patient_id = p.id')
        .andWhere('pc.condition_id', condition),
    );

  const [{ count }] = await base.clone().count('* as count');
  const total = Number(count);
  const patients = await base
    .clone()
    .orderBy('p.name')
    .orderBy('p.id')
    .limit(size)
    .offset((pg - 1) * size)
    .select('p.*');
  const ids = patients.map((p) => p.id);
  if (!ids.length) return { rows: [], total, page: pg, pageSize: size };
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
  const conds = await conditionsByPatient(db, ids);
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
  const rows = patients.map((p) => ({
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
    conditions: conds.get(p.id) ?? [],
  }));
  return { rows, total, page: pg, pageSize: size };
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
  const allQuestions = await questionsForPatient(db, {
    patientId,
    questionSetId: ep?.question_set_id ?? null,
    includeInactive: true,
  });

  const answers = await db('answers as a')
    .join('checkins as c', 'c.id', 'a.checkin_id')
    .join('questions as q', 'q.id', 'a.question_id')
    .where('c.patient_id', patientId)
    .andWhere('c.scheduled_for', '>=', from)
    .andWhere('a.skipped', false)
    .orderBy('a.answered_at')
    .select(
      'c.scheduled_for',
      'q.key',
      'q.label',
      'q.kind',
      'q.unit',
      'q.is_side_effect',
      'a.value_num',
      'a.value_choice',
      'a.value_text',
    );
  const cells = {};
  const answered = new Set();
  for (const a of answers) {
    const d = DateTime.fromJSDate(new Date(a.scheduled_for)).setZone(tz).toISODate();
    if (!cells[d]) cells[d] = {};
    cells[d][a.key] = a.value_num ?? a.value_choice ?? a.value_text;
    answered.add(a.key);
  }
  // Perguntas desativadas somem dos próximos check-ins, mas a série já respondida continua visível.
  // Auditoria/design pass: o mesmo vale para perguntas de conjuntos ANTERIORES — trocar o
  // questionário do episódio não pode sumir com a série que gerou alerta (ela vem das answers).
  const known = new Set(allQuestions.map((q) => q.key));
  const legacy = [];
  const legacySeen = new Set();
  for (const a of answers) {
    if (known.has(a.key) || legacySeen.has(a.key)) continue;
    legacySeen.add(a.key);
    legacy.push({
      key: a.key,
      label: a.label,
      kind: a.kind,
      unit: a.unit,
      is_side_effect: a.is_side_effect,
    });
  }
  const questions = [...allQuestions.filter((q) => q.active || answered.has(q.key)), ...legacy].map(
    (q) => ({
      key: q.key,
      label: q.label,
      kind: q.kind,
      unit: q.unit,
      is_side_effect: q.is_side_effect,
    }),
  );
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
  const respondentRows = await db('respondents')
    .where({ patient_id: patientId })
    .orderBy('created_at');
  const subs = await activeSubscriptionCounts(
    db,
    respondentRows.map((r) => r.id),
  );
  const respondents = respondentRows.map((r) => ({
    ...r,
    invite_url: `${String(baseUrl).replace(/\/$/, '')}/p/convite/${r.invite_token}`,
    // E9.3: cada ✓ da configuração do celular vem de uma data gravada por evento real.
    setup: setupStatus(r, subs.get(r.id) ?? 0),
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
  const routine = await listRoutine(db, session, patientId, { now });
  const patientQuestions = await listPatientQuestions(db, session, patientId);
  const packAdherence = await packHasAdherence(db, patientId);
  const conditions = await listPatientConditions(db, patientId);
  await logAccess(db, { session, patientId, route: 'patients.detail', action: 'view' }, now);
  return {
    patient,
    routine,
    patient_questions: patientQuestions,
    pack_has_adherence: packAdherence,
    respondents,
    medications: meds,
    episode: episode ? { ...episode, question_set_name: questionSet?.name ?? null } : null,
    alerts,
    grid,
    conditions,
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
