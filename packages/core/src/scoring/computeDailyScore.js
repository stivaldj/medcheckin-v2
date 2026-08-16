import { DateTime } from 'luxon';

/** Utilitários puros (portados do v1) ------------------------------------ */

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

export function normalizeToTen(value, min, max, direction = 'higher_is_better') {
  const span = Number(max) - Number(min);
  if (!Number.isFinite(Number(value)) || !Number.isFinite(span) || span <= 0) return null;
  const ratio = clamp((Number(value) - Number(min)) / span, 0, 1);
  const n = ratio * 10;
  return Number((direction === 'lower_is_better' ? 10 - n : n).toFixed(2));
}

export function computeTrend(todayScore, previousScores) {
  if (!Number.isFinite(Number(todayScore)) || !Array.isArray(previousScores)) return null;
  const valid = previousScores
    .filter((v) => v !== null && v !== undefined && Number.isFinite(Number(v)))
    .map(Number);
  if (!valid.length) return null;
  const avg = valid.reduce((a, v) => a + v, 0) / valid.length;
  return Number((Number(todayScore) - avg).toFixed(2));
}

/** items: [{value (0–10 já normalizado), weight}] → média ponderada; nada pontuável → null (L5). */
export function aggregateScore(items) {
  let sum = 0;
  let w = 0;
  for (const it of items || []) {
    if (!it || it.value === null || it.value === undefined || !Number.isFinite(Number(it.value)))
      continue;
    const weight = Number(it.weight ?? 1);
    if (!(weight > 0)) continue;
    sum += Number(it.value) * weight;
    w += weight;
  }
  return w > 0 ? Number((sum / w).toFixed(2)) : null;
}

/** low|medium|high; sem score → null. */
export function inferRiskLevel(score, trend) {
  if (score === null || score === undefined || !Number.isFinite(Number(score))) return null;
  const s = Number(score);
  const t = trend == null ? 0 : Number(trend);
  if (s <= 3 || t <= -2.5) return 'high';
  if (s <= 4 || t <= -1.5) return 'medium';
  return 'low';
}

/** Persistência --------------------------------------------------------- */

const KIND_RANGE = { scale_0_10: [0, 10], yes_no: [0, 1] };

/**
 * Score do dia a partir das respostas de um check-in.
 * Só perguntas com `score_direction` não nulo entram (migration 002). Sem resposta pontuável →
 * score null e risk_level null (nunca 0). Upsert em patient_scores_daily na data local do check-in.
 */
export async function computeDailyScore(db, checkinId) {
  const checkin = await db('checkins as c')
    .join('patients as p', 'p.id', 'c.patient_id')
    .select('c.id', 'c.patient_id', 'c.scheduled_for', 'p.timezone')
    .where('c.id', checkinId)
    .first();
  if (!checkin) return null;
  const date = DateTime.fromJSDate(new Date(checkin.scheduled_for))
    .setZone(checkin.timezone || 'UTC')
    .toISODate();

  const answers = await db('answers as a')
    .join('questions as q', 'q.id', 'a.question_id')
    .select('a.value_num', 'q.kind', 'q.score_direction', 'q.score_weight')
    .where('a.checkin_id', checkinId)
    .whereNotNull('q.score_direction');

  const items = answers
    .map((a) => {
      const [min, max] = KIND_RANGE[a.kind] || [null, null];
      if (min === null) return null;
      return {
        value: normalizeToTen(a.value_num, min, max, a.score_direction),
        weight: a.score_weight ?? 1,
      };
    })
    .filter(Boolean);
  const score = aggregateScore(items);

  const previous = await db('patient_scores_daily')
    .where({ patient_id: checkin.patient_id })
    .andWhere('date', '<', date)
    .whereNotNull('score')
    .orderBy('date', 'desc')
    .limit(3)
    .pluck('score');
  const trend = score === null ? null : computeTrend(score, previous);
  const riskLevel = inferRiskLevel(score, trend);

  const row = {
    patient_id: checkin.patient_id,
    date,
    score,
    risk_level: riskLevel,
    computed_at: db.fn.now(),
  };
  await db('patient_scores_daily').insert(row).onConflict(['patient_id', 'date']).merge();
  return {
    patient_id: checkin.patient_id,
    date,
    score,
    trend,
    risk_level: riskLevel,
    n: items.length,
  };
}
