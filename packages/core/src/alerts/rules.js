/**
 * Regras puras de alerta (sem banco). Portado de v1 evaluateAlerts.detectPatientClinicalRules,
 * com severidades no vocabulário do v2 (low|medium|high|critical) e ignorando score null (L5).
 */

function ordered(rows) {
  return [...(rows || [])]
    .filter(
      (r) =>
        r &&
        r.date &&
        r.score !== null &&
        r.score !== undefined &&
        Number.isFinite(Number(r.score)),
    )
    .map((r) => ({
      date: String(r.date),
      score: Number(r.score),
      trend: r.trend == null ? null : Number(r.trend),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function tailCount(rows, pred) {
  let n = 0;
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    if (pred(rows[i])) n += 1;
    else break;
  }
  return n;
}

/** rows: [{date, score, trend}] → [{code, severity, title, context}] */
export function detectScoreRules(rows) {
  const r = ordered(rows);
  if (!r.length) return [];
  const latest = r[r.length - 1];
  const out = [];

  const low3 = tailCount(r, (x) => x.score <= 3);
  if (low3 >= 3) {
    out.push({
      code: 'low_score_streak',
      severity: 'critical',
      title: 'Score crítico por 3 dias',
      context: { days: low3, latestScore: latest.score },
    });
  }
  const last3 = r.slice(-3);
  if (last3.length >= 2) {
    const from = last3[0].score;
    const to = last3[last3.length - 1].score;
    if (from - to >= 3) {
      out.push({
        code: 'drop_fast',
        severity: 'critical',
        title: 'Queda abrupta de score',
        context: { from, to, delta: Number((to - from).toFixed(2)) },
      });
    }
  }
  const low2 = tailCount(r, (x) => x.score <= 4);
  if (low2 >= 2 && low3 < 3) {
    out.push({
      code: 'score_low_2d',
      severity: 'medium',
      title: 'Score baixo recorrente',
      context: { days: low2, latestScore: latest.score },
    });
  }
  if (latest.trend != null && latest.trend <= -1.5) {
    out.push({
      code: 'trend_negative',
      severity: 'medium',
      title: 'Tendência de piora',
      context: { trend: latest.trend },
    });
  }
  return out;
}

/** Limiar por pergunta (questions.alert_threshold_json = {op, value}). Nada hardcoded (L3). */
export function evaluateThreshold(threshold, value) {
  if (!threshold || typeof threshold !== 'object' || !threshold.op) return false;
  if (value === null || value === undefined || value === '') return false;
  const { op } = threshold;
  const t = threshold.value;
  if (op === 'in') return Array.isArray(t) && t.map(String).includes(String(value));
  if (op === '==') return String(value) === String(t) || Number(value) === Number(t);
  if (op === '!=') return String(value) !== String(t) && Number(value) !== Number(t);
  const a = Number(value);
  const b = Number(t);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  switch (op) {
    case '>=':
      return a >= b;
    case '>':
      return a > b;
    case '<=':
      return a <= b;
    case '<':
      return a < b;
    default:
      return false;
  }
}
