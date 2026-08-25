import { DateTime } from 'luxon';
import { toDT } from '../time.js';
import { compareBeforeAfterByDose } from './beforeAfter.js';

/**
 * Série diária de um sintoma (última resposta do dia) + score, com marcadores de ajuste de dose e
 * comparação antes/depois por ajuste. Sem resposta no dia → value null (nunca 0).
 */
export async function symptomDoseSeries(
  db,
  patientId,
  { questionKey, days = 30, now, windowDays = 7 } = {},
) {
  const patient = await db('patients').where({ id: patientId }).first();
  if (!patient) throw new Error('Paciente não encontrado.');
  const tz = patient.timezone || 'UTC';
  const today = toDT(now).setZone(tz).startOf('day');
  const dayList = [];
  for (let i = days - 1; i >= 0; i -= 1) dayList.push(today.minus({ days: i }).toISODate());
  const from = today
    .minus({ days: days - 1 })
    .toUTC()
    .toJSDate();

  const question = await db('questions as q')
    .leftJoin('question_sets as s', 's.id', 'q.question_set_id')
    .where('q.key', questionKey)
    .andWhere((w) => w.where('s.clinic_id', patient.clinic_id).orWhere('q.patient_id', patientId))
    .select('q.key', 'q.label', 'q.kind', 'q.unit')
    .first();
  if (!question) throw new Error(`Pergunta desconhecida: ${questionKey}`);

  const answers = await db('answers as a')
    .join('checkins as c', 'c.id', 'a.checkin_id')
    .join('questions as q', 'q.id', 'a.question_id')
    .where('c.patient_id', patientId)
    .andWhere('q.key', questionKey)
    .andWhere('c.scheduled_for', '>=', from)
    .andWhere('a.skipped', false)
    .orderBy('a.answered_at')
    .select('c.scheduled_for', 'a.value_num', 'a.value_choice', 'a.value_text');
  const byDay = {};
  for (const a of answers)
    byDay[DateTime.fromJSDate(new Date(a.scheduled_for)).setZone(tz).toISODate()] =
      a.value_num ?? a.value_choice ?? a.value_text;

  const scores = await db('patient_scores_daily')
    .where({ patient_id: patientId })
    .andWhere('date', '>=', dayList[0])
    .select('date', 'score');
  const scoreBy = {};
  for (const s of scores)
    scoreBy[s.date instanceof Date ? DateTime.fromJSDate(s.date).toISODate() : String(s.date)] =
      s.score;

  const doseRows = await db('dose_events as de')
    .join('medications as m', 'm.id', 'de.medication_id')
    .join('products as pr', 'pr.id', 'm.product_id')
    .where('m.patient_id', patientId)
    .orderBy('de.effective_from')
    .select(
      'de.id',
      'de.effective_from',
      'de.dose_amount',
      'de.dose_unit',
      'de.times_per_day',
      'de.reason',
      'pr.name as product_name',
    );
  const doseMarkers = doseRows.map((r) => ({
    id: r.id,
    date:
      r.effective_from instanceof Date
        ? DateTime.fromJSDate(r.effective_from).toISODate()
        : String(r.effective_from),
    dose_amount: r.dose_amount,
    dose_unit: r.dose_unit,
    times_per_day: r.times_per_day,
    reason: r.reason,
    product_name: r.product_name,
  }));

  const points = dayList.map((date) => ({
    date,
    value: byDay[date] ?? null,
    score: scoreBy[date] ?? null,
  }));
  const numericSeries = points
    .filter((p) => Number.isFinite(Number(p.value)) && p.value !== null)
    .map((p) => ({ date: p.date, value: Number(p.value) }));
  const beforeAfter = compareBeforeAfterByDose({
    doseEvents: doseMarkers.map((m) => ({
      id: m.id,
      effective_from: m.date,
      dose_amount: m.dose_amount,
      dose_unit: m.dose_unit,
    })),
    series: numericSeries,
    windowDays,
  });
  return {
    question,
    timezone: tz,
    points,
    doseMarkers: doseMarkers.filter((m) => m.date >= dayList[0]),
    allDoseMarkers: doseMarkers,
    beforeAfter,
  };
}
