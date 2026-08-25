import { DateTime } from 'luxon';
import { toDT } from '../time.js';
import { toHm } from '../scheduler/next-run.js';
import { AuthError } from '../auth/tokens.js';
import { requirePatientInClinic, logAccess } from '../auth/access.js';
import { ValidationError } from '../errors.js';

/** Chave da pergunta de adesão no check-in (D15: adesão deixou de ser confirmada no alarme). */
export const ADHERENCE_QUESTION_KEY = 'adesao';

const MAX_ALARMS = 12;
const MAX_DESCRIPTION = 400;

function requireDoctor(session) {
  if (!session || session.kind !== 'user')
    throw new AuthError('unauthenticated', 'Sessão da clínica necessária.');
}

/** `date` do PG chega como Date (meia-noite local do processo) ou string — normaliza para YYYY-MM-DD. */
export function isoDate(value) {
  if (value == null) return null;
  if (value instanceof Date) return DateTime.fromJSDate(value).toISODate();
  return String(value).slice(0, 10);
}

function parseDate(value, field) {
  const s = String(value ?? '').slice(0, 10);
  if (!DateTime.fromISO(s).isValid) throw new ValidationError(`Data inválida em ${field}.`, field);
  return s;
}

function normalizeAlarms(raw) {
  const list = Array.isArray(raw) ? raw : [];
  if (!list.length) throw new ValidationError('Informe ao menos um alarme.', 'alarms');
  if (list.length > MAX_ALARMS)
    throw new ValidationError(`No máximo ${MAX_ALARMS} alarmes por período.`, 'alarms');
  const seen = new Set();
  const out = [];
  for (const a of list) {
    const time = toHm(a?.time);
    if (!time) throw new ValidationError('Horário inválido no alarme.', 'time');
    if (seen.has(time)) throw new ValidationError(`Horário repetido: ${time}.`, 'time');
    seen.add(time);
    const description = String(a?.description ?? '').trim();
    if (!description) throw new ValidationError(`Descreva o que tomar às ${time}.`, 'description');
    out.push({ time, description: description.slice(0, MAX_DESCRIPTION) });
  }
  return out.sort((x, y) => x.time.localeCompare(y.time));
}

function periodPatch(input, { partial }) {
  const patch = {};
  const has = (k) => Object.hasOwn(input ?? {}, k);
  if (!partial || has('starts_on')) patch.starts_on = parseDate(input?.starts_on, 'starts_on');
  if (!partial || has('ends_on'))
    patch.ends_on = input?.ends_on ? parseDate(input.ends_on, 'ends_on') : null;
  if (has('note')) patch.note = input.note ? String(input.note).trim().slice(0, 1000) : null;
  return patch;
}

const OVERLAP = 'routine_periods_no_overlap';

function mapDbError(err) {
  if (String(err?.constraint) === OVERLAP)
    return new ValidationError(
      'Já existe um período de rotina cobrindo essas datas. Encerre ou ajuste o período anterior.',
      'starts_on',
    );
  return err;
}

async function loadPeriod(db, id) {
  const row = await db('routine_periods').where({ id }).first();
  if (!row) throw new AuthError('not_found', 'Período de rotina não encontrado.');
  return row;
}

async function withAlarms(db, period) {
  const alarms = await db('routine_alarms').where({ period_id: period.id }).orderBy('time');
  return {
    id: period.id,
    patient_id: period.patient_id,
    starts_on: isoDate(period.starts_on),
    ends_on: isoDate(period.ends_on),
    note: period.note,
    replicated_from: period.replicated_from,
    created_at: period.created_at,
    alarms: alarms.map((a) => ({
      id: a.id,
      time: toHm(a.time),
      description: a.description,
    })),
  };
}

async function writeAlarms(trx, periodId, alarms) {
  await trx('routine_alarms').where({ period_id: periodId }).del();
  await trx('routine_alarms').insert(alarms.map((a) => ({ ...a, period_id: periodId })));
}

/** Cria um período com seus alarmes. `replicated_from` só registra a origem — os textos vêm do input. */
export async function createRoutinePeriod(db, session, patientId, input, now) {
  requireDoctor(session);
  await requirePatientInClinic(db, session, patientId);
  const patch = periodPatch(input, { partial: false });
  if (patch.ends_on && patch.ends_on < patch.starts_on)
    throw new ValidationError('O fim do período não pode ser antes do início.', 'ends_on');
  const alarms = normalizeAlarms(input?.alarms);
  let replicatedFrom = null;
  if (input?.replicated_from) {
    const src = await db('routine_periods')
      .where({ id: input.replicated_from, patient_id: patientId })
      .first();
    if (!src) throw new ValidationError('Período de origem inválido.', 'replicated_from');
    replicatedFrom = src.id;
  }
  try {
    const period = await db.transaction(async (trx) => {
      const [row] = await trx('routine_periods')
        .insert({
          patient_id: patientId,
          ...patch,
          replicated_from: replicatedFrom,
          created_by: session.userId,
        })
        .returning('*');
      await writeAlarms(trx, row.id, alarms);
      return row;
    });
    await logAccess(db, { session, patientId, route: 'routine.create', action: 'create' }, now);
    return withAlarms(db, period);
  } catch (err) {
    throw mapDbError(err);
  }
}

/** Edita datas, nota e a lista completa de alarmes (a lista substitui a anterior). */
export async function updateRoutinePeriod(db, session, periodId, input, now) {
  requireDoctor(session);
  const current = await loadPeriod(db, periodId);
  await requirePatientInClinic(db, session, current.patient_id);
  const patch = periodPatch(input, { partial: true });
  const startsOn = patch.starts_on ?? isoDate(current.starts_on);
  const endsOn = Object.hasOwn(patch, 'ends_on') ? patch.ends_on : isoDate(current.ends_on);
  if (endsOn && endsOn < startsOn)
    throw new ValidationError('O fim do período não pode ser antes do início.', 'ends_on');
  const alarms = Object.hasOwn(input ?? {}, 'alarms') ? normalizeAlarms(input.alarms) : null;
  if (!Object.keys(patch).length && !alarms) throw new ValidationError('Nada para atualizar.');
  try {
    const period = await db.transaction(async (trx) => {
      const [row] = await trx('routine_periods')
        .where({ id: periodId })
        .update({ ...patch, updated_at: trx.fn.now() })
        .returning('*');
      if (alarms) await writeAlarms(trx, periodId, alarms);
      return row;
    });
    await logAccess(
      db,
      { session, patientId: current.patient_id, route: 'routine.update', action: 'update' },
      now,
    );
    return withAlarms(db, period);
  } catch (err) {
    throw mapDbError(err);
  }
}

/** Encerra o período hoje (fuso do paciente). Alarmes param sozinhos a partir de amanhã. */
export async function endRoutinePeriodToday(db, session, periodId, now) {
  requireDoctor(session);
  const current = await loadPeriod(db, periodId);
  const patient = await requirePatientInClinic(db, session, current.patient_id);
  const today = toDT(now)
    .setZone(patient.timezone || 'UTC')
    .toISODate();
  if (isoDate(current.starts_on) > today)
    throw new ValidationError('Este período ainda não começou — edite ou remova as datas.');
  const [row] = await db('routine_periods')
    .where({ id: periodId })
    .update({ ends_on: today, updated_at: db.fn.now() })
    .returning('*');
  await logAccess(
    db,
    { session, patientId: current.patient_id, route: 'routine.end', action: 'update' },
    now,
  );
  return withAlarms(db, row);
}

/** Alarmes de um dia local (YYYY-MM-DD): os do período que cobre o dia. Fora de período → []. */
export async function routineAlarmsForDay(db, patientId, date) {
  const day = String(date).slice(0, 10);
  const period = await db('routine_periods')
    .where({ patient_id: patientId })
    .andWhere('starts_on', '<=', day)
    .andWhere((q) => q.whereNull('ends_on').orWhere('ends_on', '>=', day))
    .first();
  if (!period) return [];
  const alarms = await db('routine_alarms').where({ period_id: period.id }).orderBy('time');
  return alarms.map((a) => ({
    id: a.id,
    period_id: period.id,
    time: toHm(a.time),
    description: a.description,
  }));
}

/** Card "Rotina de alarmes" da página do paciente. */
export async function listRoutine(db, session, patientId, { now } = {}) {
  requireDoctor(session);
  const patient = await requirePatientInClinic(db, session, patientId);
  const today = toDT(now)
    .setZone(patient.timezone || 'UTC')
    .toISODate();
  const rows = await db('routine_periods')
    .where({ patient_id: patientId })
    .orderBy('starts_on', 'desc');
  const periods = [];
  for (const r of rows) periods.push(await withAlarms(db, r));
  const current =
    periods.find((p) => p.starts_on <= today && (!p.ends_on || p.ends_on >= today)) ?? null;
  const upcoming = periods
    .filter((p) => p.starts_on > today)
    .sort((a, b) => (a.starts_on < b.starts_on ? -1 : 1));
  const past = periods.filter((p) => p.ends_on && p.ends_on < today);

  const respondents = await db('respondents')
    .where({ patient_id: patientId, receives_alarms: true })
    .orderBy('created_at')
    .select('id', 'name', 'kind', 'accepted_at');
  const subs = respondents.length
    ? await db('push_subscriptions')
        .whereIn(
          'respondent_id',
          respondents.map((r) => r.id),
        )
        .whereNull('revoked_at')
        .select('respondent_id')
        .count('* as n')
        .groupBy('respondent_id')
    : [];
  const byResp = Object.fromEntries(subs.map((s) => [s.respondent_id, Number(s.n)]));
  const recipients = respondents.map((r) => ({
    id: r.id,
    name: r.name,
    kind: r.kind,
    accepted: !!r.accepted_at,
    push_subscriptions: byResp[r.id] ?? 0,
  }));
  return { today, timezone: patient.timezone, current, upcoming, past, recipients };
}
