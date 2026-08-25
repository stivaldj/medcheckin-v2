import { DateTime } from 'luxon';
import { toDT } from '../time.js';
import { AuthError } from '../auth/tokens.js';
import { logAccess } from '../auth/access.js';
import { recordAnswer, getNextQuestion } from '../checkin/engine.js';
import { confirmIntake } from '../scheduler/reminders.js';
import { conditionSatisfied } from '../checkin/engine.js';
import { routineAlarmsForDay } from '../routine/index.js';
import { questionsForPatient } from '../questions/patientQuestions.js';

function requireRespondent(session) {
  if (!session || session.kind !== 'respondent')
    throw new AuthError('unauthenticated', 'Sessão do respondente necessária.');
}

async function loadRespondent(db, session) {
  const r = await db('respondents as r')
    .join('patients as p', 'p.id', 'r.patient_id')
    .join('clinics as c', 'c.id', 'p.clinic_id')
    .where('r.id', session.respondentId)
    .select(
      'r.id',
      'r.kind',
      'r.name',
      'r.can_answer',
      'r.receives_alarms',
      'r.consent_version',
      'p.id as patient_id',
      'p.name as patient_name',
      'p.timezone',
      'p.status as patient_status',
      'c.name as clinic_name',
    )
    .first();
  if (!r) throw new AuthError('unauthenticated', 'Respondente não encontrado.');
  return r;
}

async function checkinProgress(db, checkin) {
  const ep = await db('episodes').where({ id: checkin.episode_id }).first();
  const questions = await questionsForPatient(db, {
    patientId: checkin.patient_id,
    questionSetId: ep.question_set_id,
    at: checkin.scheduled_for,
  });
  const answers = await db('answers as a')
    .join('questions as q', 'q.id', 'a.question_id')
    .where('a.checkin_id', checkin.id)
    .select('q.key', 'a.skipped', 'a.value_num', 'a.value_choice', 'a.value_text');
  const map = new Map(
    answers.map((a) => [
      a.key,
      {
        value: a.skipped ? null : (a.value_num ?? a.value_choice ?? a.value_text),
        skipped: a.skipped,
      },
    ]),
  );
  // total = perguntas cuja condição está satisfeita ou ainda não é decidível... simplificação honesta:
  // total = perguntas sem condição + condicionais já satisfeitas.
  const applicable = questions.filter(
    (q) => !q.condition_json || conditionSatisfied(q.condition_json, map),
  );
  const next =
    checkin.status === 'completed' || checkin.status === 'missed'
      ? null
      : await getNextQuestion(db, checkin.id);
  return {
    id: checkin.id,
    status: checkin.status,
    scheduled_for: checkin.scheduled_for,
    total: applicable.length,
    answered: applicable.filter((q) => map.has(q.key)).length,
    next: next
      ? {
          id: next.id,
          key: next.key,
          label: next.label,
          kind: next.kind,
          options: next.options,
          unit: next.unit,
          required: next.required,
        }
      : null,
    completed: checkin.status === 'completed',
  };
}

/** Tela "Hoje" do respondente. */
export async function respondentToday(db, session, now) {
  requireRespondent(session);
  const nowDT = toDT(now);
  const r = await loadRespondent(db, session);
  const tz = r.timezone || 'UTC';
  const dayStart = nowDT.setZone(tz).startOf('day');
  const dayEnd = dayStart.plus({ days: 1 });

  let checkin = null;
  if (r.can_answer) {
    const row =
      (await db('checkins')
        .where({ patient_id: r.patient_id })
        .andWhere('scheduled_for', '>=', dayStart.toUTC().toJSDate())
        .andWhere('scheduled_for', '<', dayEnd.toUTC().toJSDate())
        .orderBy('scheduled_for', 'desc')
        .first()) ||
      (await db('checkins')
        .where({ patient_id: r.patient_id })
        .whereIn('status', ['sent', 'in_progress'])
        .andWhere('scheduled_for', '>=', nowDT.minus({ hours: 24 }).toJSDate())
        .orderBy('scheduled_for', 'desc')
        .first());
    if (row) checkin = await checkinProgress(db, row);
  }

  // D15: o alarme é LEMBRETE PURO — horário + texto livre da rotina vigente. Nada a confirmar aqui;
  // a adesão vem da pergunta do check-in.
  let alarms = [];
  if (r.receives_alarms) {
    alarms = (await routineAlarmsForDay(db, r.patient_id, dayStart.toISODate())).map((a) => ({
      time: a.time,
      description: a.description,
    }));
  }
  const [{ count }] = await db('push_subscriptions')
    .where({ respondent_id: r.id })
    .whereNull('revoked_at')
    .count();
  await logAccess(db, { session, patientId: r.patient_id, route: 'p.today', action: 'view' }, now);
  return {
    respondent: {
      id: r.id,
      name: r.name,
      kind: r.kind,
      can_answer: r.can_answer,
      receives_alarms: r.receives_alarms,
    },
    patient: {
      id: r.patient_id,
      name: r.patient_name,
      status: r.patient_status,
      timezone: tz,
      clinic_name: r.clinic_name,
    },
    checkin,
    alarms,
    push: { subscriptions: Number(count) },
    now: nowDT.toISO(),
  };
}

async function checkinOfPatient(db, session, checkinId) {
  const ck = await db('checkins').where({ id: checkinId, patient_id: session.patientId }).first();
  if (!ck) throw new AuthError('not_found', 'Check-in não encontrado.');
  return ck;
}

export async function answerFromRespondent(db, session, { checkinId, questionKey, value }, now) {
  requireRespondent(session);
  await checkinOfPatient(db, session, checkinId);
  const out = await recordAnswer(
    db,
    { checkinId, respondentId: session.respondentId, questionKey, value },
    now,
  );
  await logAccess(
    db,
    { session, patientId: session.patientId, route: 'p.answer', action: 'create' },
    now,
  );
  const ck = await db('checkins').where({ id: checkinId }).first();
  const progress = await checkinProgress(db, ck);
  return { ...out, progress };
}

/** @deprecated D17 — fora da UI desde E9.1; mantido só para histórico de `medication_intakes`. */
export async function confirmFromRespondent(
  db,
  session,
  { intakeId, status, sideEffect = false, note = null },
  now,
) {
  requireRespondent(session);
  const i = await db('medication_intakes as i')
    .join('medications as m', 'm.id', 'i.medication_id')
    .where('i.id', intakeId)
    .andWhere('m.patient_id', session.patientId)
    .select('i.id')
    .first();
  if (!i) throw new AuthError('not_found', 'Intake não encontrado.');
  const row = await confirmIntake(
    db,
    { intakeId, respondentId: session.respondentId, status, sideEffect, note },
    now,
  );
  await logAccess(
    db,
    { session, patientId: session.patientId, route: 'p.confirm', action: 'create' },
    now,
  );
  return row;
}

/** Histórico por dia (fuso do paciente): respostas e alarmes da rotina. Dias sem nada não aparecem. */
export async function respondentHistory(db, session, { days = 30, now } = {}) {
  requireRespondent(session);
  const nowDT = toDT(now);
  const r = await loadRespondent(db, session);
  const tz = r.timezone || 'UTC';
  const from = nowDT
    .setZone(tz)
    .startOf('day')
    .minus({ days: days - 1 });
  const byDay = new Map();
  const day = (d) => {
    const key = DateTime.fromJSDate(new Date(d)).setZone(tz).toISODate();
    if (!byDay.has(key)) byDay.set(key, { date: key, answers: null, alarms: [] });
    return byDay.get(key);
  };
  const answers = await db('answers as a')
    .join('checkins as c', 'c.id', 'a.checkin_id')
    .join('questions as q', 'q.id', 'a.question_id')
    .where('c.patient_id', r.patient_id)
    .andWhere('c.scheduled_for', '>=', from.toUTC().toJSDate())
    .andWhere('a.skipped', false)
    .orderBy('a.answered_at')
    .select('c.scheduled_for', 'q.key', 'q.label', 'a.value_num', 'a.value_choice', 'a.value_text');
  for (const a of answers) {
    const d = day(a.scheduled_for);
    if (!d.answers) d.answers = {};
    d.answers[a.key] = a.value_num ?? a.value_choice ?? a.value_text;
  }
  // Rotina que valia em cada dia (o que o respondente viu no alarme).
  for (let i = 0; i < days; i += 1) {
    const date = from.plus({ days: i }).toISODate();
    if (date > nowDT.setZone(tz).toISODate()) break;
    const alarms = await routineAlarmsForDay(db, r.patient_id, date);
    if (!alarms.length) continue;
    const entry = byDay.get(date) ?? { date, answers: null, alarms: [] };
    entry.alarms = alarms.map((a) => ({ time: a.time, description: a.description }));
    byDay.set(date, entry);
  }
  await logAccess(
    db,
    { session, patientId: r.patient_id, route: 'p.history', action: 'view' },
    now,
  );
  return { days: [...byDay.values()].sort((a, b) => b.date.localeCompare(a.date)), timezone: tz };
}
