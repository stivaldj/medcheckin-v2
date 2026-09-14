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
  if (has('max_late_min')) {
    const v = input.max_late_min;
    if (v === null || v === '' || v === undefined) patch.max_late_min = null;
    else {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0 || n > 1440)
        throw new ValidationError(
          'O atraso máximo do lembrete deve ser um número de minutos entre 0 e 1440.',
          'max_late_min',
        );
      patch.max_late_min = n;
    }
  }
  return patch;
}

const OVERLAP = 'routine_periods_no_overlap';

const br = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : null);

/**
 * Sobreposição vira mensagem que resolve: diz COM QUAL período bateu e o caminho. Antes, "encerre
 * ou ajuste o anterior" levava a médica a encerrar hoje e bater de novo (fim = hoje ainda cobre hoje).
 */
async function mapDbError(err, db, { patientId, startsOn, endsOn, excludeId = null } = {}) {
  if (String(err?.constraint) !== OVERLAP) return err;
  let quem = '';
  if (db && patientId && startsOn) {
    const q = db('routine_periods')
      .where({ patient_id: patientId })
      .andWhere((w) => w.whereNull('ends_on').orWhere('ends_on', '>=', startsOn));
    if (endsOn) q.andWhere('starts_on', '<=', endsOn);
    if (excludeId) q.whereNot('id', excludeId);
    const other = await q.orderBy('starts_on').first();
    if (other)
      quem = ` (${br(isoDate(other.starts_on))} → ${br(isoDate(other.ends_on)) ?? 'sem fim'})`;
  }
  return new ValidationError(
    `Já existe um período de rotina cobrindo essas datas${quem}. Para mudar a rotina de hoje, use ` +
      '“Editar” no período vigente. Para trocar a rotina, encerre o atual hoje e comece o novo amanhã.',
    'starts_on',
  );
}

function todayFor(patient, now) {
  return toDT(now)
    .setZone(patient.timezone || 'UTC')
    .toISODate();
}

/** Algum lembrete deste período já saiu? (prova durável do envio = notifications, D18) */
async function periodHasSentAlarms(db, periodId) {
  const row = await db('notifications')
    .where({ kind: 'alarm' })
    .whereNotNull('sent_at')
    .whereRaw("payload->>'period_id' = ?", [periodId])
    .first('id');
  return !!row;
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

/**
 * Grava a lista de alarmes PRESERVANDO o id de cada horário que continua. O dedup do lembrete é
 * `routine:<alarm_id>:<dia>:<respondente>` (D18): recriar a linha trocaria o id e o lembrete que já
 * saiu hoje sairia de novo — num lembrete de medicação, isso é convite a dose dobrada.
 */
async function writeAlarms(trx, periodId, alarms) {
  const existing = await trx('routine_alarms').where({ period_id: periodId });
  const byTime = new Map(existing.map((a) => [toHm(a.time), a]));
  const keep = new Set();
  for (const a of alarms) {
    const old = byTime.get(toHm(a.time));
    if (old) {
      keep.add(old.id);
      if (old.description !== a.description)
        await trx('routine_alarms').where({ id: old.id }).update({ description: a.description });
    } else {
      await trx('routine_alarms').insert({ ...a, period_id: periodId });
    }
  }
  const gone = existing.filter((a) => !keep.has(a.id)).map((a) => a.id);
  if (gone.length) await trx('routine_alarms').whereIn('id', gone).del();
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
    throw await mapDbError(err, db, {
      patientId,
      startsOn: patch.starts_on,
      endsOn: patch.ends_on ?? null,
    });
  }
}

/** Edita datas, nota e a lista completa de alarmes (a lista substitui a anterior). */
export async function updateRoutinePeriod(db, session, periodId, input, now) {
  requireDoctor(session);
  const current = await loadPeriod(db, periodId);
  const patient = await requirePatientInClinic(db, session, current.patient_id);
  const patch = periodPatch(input, { partial: true });
  const startsOn = patch.starts_on ?? isoDate(current.starts_on);
  const endsOn = Object.hasOwn(patch, 'ends_on') ? patch.ends_on : isoDate(current.ends_on);
  if (endsOn && endsOn < startsOn)
    throw new ValidationError('O fim do período não pode ser antes do início.', 'ends_on');
  // D33: período que já começou se edita (horários, textos, fim), mas o passado não se reescreve.
  const today = todayFor(patient, now);
  if (isoDate(current.starts_on) <= today) {
    if (startsOn !== isoDate(current.starts_on))
      throw new ValidationError(
        'O início de um período que já começou não muda: ele registra a rotina que valeu nos dias ' +
          'passados. Para trocar a partir de amanhã, encerre hoje e crie um novo período.',
        'starts_on',
      );
    if (endsOn && endsOn < today)
      throw new ValidationError(
        'O fim não pode ficar antes de hoje. Para parar os alarmes, use “Encerrar hoje”.',
        'ends_on',
      );
  }
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
    throw await mapDbError(err, db, {
      patientId: current.patient_id,
      startsOn,
      endsOn,
      excludeId: periodId,
    });
  }
}

/**
 * Apaga um período que não deixou rastro (D33): futuro, ou que começou hoje sem nenhum lembrete
 * enviado — o caso "criei errado agora há pouco". Quem já valeu em algum dia fica: é o registro do
 * que o paciente recebeu; para esse, "Encerrar hoje".
 */
export async function deleteRoutinePeriod(db, session, periodId, now) {
  requireDoctor(session);
  const current = await loadPeriod(db, periodId);
  const patient = await requirePatientInClinic(db, session, current.patient_id);
  const today = todayFor(patient, now);
  const starts = isoDate(current.starts_on);
  if (starts < today)
    throw new ValidationError(
      'Este período já valeu em dias passados e fica no histórico. Para parar os alarmes, use “Encerrar hoje”.',
    );
  if (starts === today && (await periodHasSentAlarms(db, periodId)))
    throw new ValidationError(
      'Este período já mandou lembrete hoje e fica no histórico. Use “Editar” para corrigir os ' +
        'horários ou “Encerrar hoje” para parar.',
    );
  await db('routine_periods').where({ id: periodId }).del();
  await logAccess(
    db,
    { session, patientId: current.patient_id, route: 'routine.delete', action: 'delete' },
    now,
  );
  return { deleted: true };
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
  // O que a tela pode oferecer em cada período — a regra mora aqui, não na UI (D33).
  for (const p of periods) {
    const started = p.starts_on <= today;
    const isPast = !!p.ends_on && p.ends_on < today;
    p.actions = {
      edit: !isPast,
      delete: !started || (p.starts_on === today && !(await periodHasSentAlarms(db, p.id))),
      end_today: started && !isPast && (!p.ends_on || p.ends_on > today),
    };
  }

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
