import { DateTime } from 'luxon';
import { toDT } from '../time.js';
import { AuthError } from '../auth/tokens.js';
import { requirePatientInClinic, logAccess } from '../auth/access.js';
import { mean } from '../analytics/rolling.js';
import { ADHERENCE_QUESTION_KEY } from '../routine/index.js';
import { questionsForPatient } from '../questions/patientQuestions.js';

function requireDoctor(session) {
  if (!session || session.kind !== 'user')
    throw new AuthError('unauthenticated', 'Sessão da clínica necessária.');
}
const isoDate = (v) =>
  v instanceof Date ? DateTime.fromJSDate(v).toISODate() : String(v).slice(0, 10);
const round = (v, d = 2) => (v === null || v === undefined ? null : Number(Number(v).toFixed(d)));

/**
 * Relatório do período (default 30 d) para consulta/impressão. Cada número tem a consulta-fonte;
 * sem dado → null (nunca 0/"estável"). Adesão conta SÓ confirmações do respondente (L4).
 */
export async function patientReport(db, session, patientId, { days = 30, now } = {}) {
  requireDoctor(session);
  const patient = await requirePatientInClinic(db, session, patientId);
  const nowDT = toDT(now);
  const tz = patient.timezone || 'UTC';
  const end = nowDT.setZone(tz).endOf('day');
  const start = end.startOf('day').minus({ days: days - 1 });
  const fromJs = start.toUTC().toJSDate();
  const toJs = end.toUTC().toJSDate();

  const checkins = await db('checkins')
    .where({ patient_id: patientId })
    .andWhere('scheduled_for', '>=', fromJs)
    .andWhere('scheduled_for', '<=', toJs)
    .orderBy('scheduled_for');
  const sent = checkins.filter((c) => c.sent_at).length;
  const completed = checkins.filter((c) => c.status === 'completed').length;
  const missed = checkins.filter((c) => c.status === 'missed').length;

  // Adesão (D15): pela pergunta do check-in, não mais por confirmação de tomada.
  const adherenceRows = await db('answers as a')
    .join('checkins as c', 'c.id', 'a.checkin_id')
    .join('questions as q', 'q.id', 'a.question_id')
    .where('c.patient_id', patientId)
    .andWhere('q.key', ADHERENCE_QUESTION_KEY)
    .andWhere('a.skipped', false)
    .andWhere('c.scheduled_for', '>=', fromJs)
    .andWhere('c.scheduled_for', '<=', toJs)
    .orderBy('c.scheduled_for')
    .select('c.scheduled_for', 'a.value_num');
  const adherenceYes = adherenceRows.filter((r) => Number(r.value_num) === 1).length;
  const adherenceNo = adherenceRows.filter((r) => Number(r.value_num) === 0).length;

  const ep = await db('episodes')
    .where({ patient_id: patientId })
    .orderBy('started_at', 'desc')
    .first();
  const questions = (
    await questionsForPatient(db, {
      patientId,
      questionSetId: ep?.question_set_id ?? null,
      includeInactive: true, // a série de uma pergunta desativada continua no relatório do período
    })
  ).filter(
    (q) => ['scale_0_10', 'number', 'yes_no'].includes(q.kind) && q.key !== ADHERENCE_QUESTION_KEY, // D20: adesão tem bloco próprio, não é sintoma
  );
  const answers = await db('answers as a')
    .join('checkins as c', 'c.id', 'a.checkin_id')
    .join('questions as q', 'q.id', 'a.question_id')
    .where('c.patient_id', patientId)
    .andWhere('c.scheduled_for', '>=', fromJs)
    .andWhere('c.scheduled_for', '<=', toJs)
    .andWhere('a.skipped', false)
    .whereNotNull('a.value_num')
    .orderBy('c.scheduled_for')
    .select('q.key', 'a.value_num', 'c.scheduled_for');
  const symptoms = questions
    .map((q) => {
      const vals = answers.filter((a) => a.key === q.key).map((a) => Number(a.value_num));
      return {
        key: q.key,
        label: q.label,
        kind: q.kind,
        unit: q.unit,
        n: vals.length,
        mean: round(mean(vals)),
        min: vals.length ? Math.min(...vals) : null,
        max: vals.length ? Math.max(...vals) : null,
        last: vals.length ? vals[vals.length - 1] : null,
      };
    })
    // desativada e sem resposta no período não vira linha vazia no relatório
    .filter((sy) => questions.find((q) => q.key === sy.key)?.active || sy.n > 0);

  const scoreRows = await db('patient_scores_daily')
    .where({ patient_id: patientId })
    .andWhere('date', '>=', start.toISODate())
    .andWhere('date', '<=', end.toISODate())
    .whereNotNull('score')
    .orderBy('date');
  const scores = {
    n: scoreRows.length,
    mean: round(mean(scoreRows.map((s) => s.score))),
    last: scoreRows.length ? scoreRows[scoreRows.length - 1].score : null,
    risk_last: scoreRows.length ? scoreRows[scoreRows.length - 1].risk_level : null,
    series: scoreRows.map((s) => ({
      date: isoDate(s.date),
      score: s.score,
      risk_level: s.risk_level,
    })),
  };

  const doses = await db('dose_events as de')
    .join('medications as m', 'm.id', 'de.medication_id')
    .join('products as pr', 'pr.id', 'm.product_id')
    .where('m.patient_id', patientId)
    .orderBy('de.effective_from')
    .select(
      'de.effective_from',
      'de.dose_amount',
      'de.dose_unit',
      'de.times_per_day',
      'de.schedule_times',
      'de.reason',
      'pr.name as product_name',
    );

  const alertRows = await db('alerts')
    .where({ patient_id: patientId })
    .andWhere('created_at', '>=', fromJs)
    .orderBy('created_at');
  const actions = alertRows.length
    ? await db('alert_actions as x')
        .leftJoin('users as u', 'u.id', 'x.user_id')
        .whereIn(
          'x.alert_id',
          alertRows.map((a) => a.id),
        )
        .orderBy('x.at')
        .select('x.*', 'u.name as user_name')
    : [];
  const alerts = alertRows.map((a) => ({
    ...a,
    actions: actions.filter((x) => x.alert_id === a.id),
  }));

  const sideEffects = await db('answers as a')
    .join('checkins as c', 'c.id', 'a.checkin_id')
    .join('questions as q', 'q.id', 'a.question_id')
    .where('c.patient_id', patientId)
    .andWhere('q.is_side_effect', true)
    .andWhere('c.scheduled_for', '>=', fromJs)
    .andWhere('a.skipped', false)
    .whereNotNull('a.value_choice')
    .orderBy('c.scheduled_for')
    .select('c.scheduled_for', 'a.value_choice');

  await logAccess(db, { session, patientId, route: 'patients.report', action: 'view' }, now);
  return {
    patient: {
      id: patient.id,
      name: patient.name,
      birth_date: patient.birth_date,
      condition_tags: patient.condition_tags,
      status: patient.status,
    },
    period: {
      from: start.toISODate(),
      to: end.toISODate(),
      days,
      timezone: tz,
      generated_at: nowDT.toISO(),
    },
    checkins: {
      total: checkins.length,
      sent,
      completed,
      missed,
      completion_rate: sent > 0 ? round(completed / sent, 3) : null,
    },
    adherence: {
      answered: adherenceRows.length,
      yes: adherenceYes,
      no: adherenceNo,
      rate: adherenceRows.length > 0 ? round(adherenceYes / adherenceRows.length, 3) : null,
      days: adherenceRows.map((r) => ({
        date: DateTime.fromJSDate(new Date(r.scheduled_for)).setZone(tz).toISODate(),
        took: Number(r.value_num) === 1,
      })),
    },
    symptoms,
    scores,
    doses: doses.map((d) => ({ ...d, effective_from: isoDate(d.effective_from) })),
    alerts,
    side_effects: [
      ...sideEffects.map((s) => ({
        date: DateTime.fromJSDate(new Date(s.scheduled_for)).setZone(tz).toISODate(),
        source: 'checkin',
        detail: s.value_choice,
      })),
    ].sort((a, b) => a.date.localeCompare(b.date)),
  };
}
