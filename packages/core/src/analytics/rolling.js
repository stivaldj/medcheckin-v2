/** Média de valores numéricos; vazio → null (nunca 0 — L5). */
export function mean(values) {
  const nums = (Array.isArray(values) ? values : [])
    .filter((v) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v)))
    .map(Number);
  if (!nums.length) return null;
  return nums.reduce((a, n) => a + n, 0) / nums.length;
}

/**
 * Média móvel por data (rows: [{date:'YYYY-MM-DD', value}]) → [{date, n, value}].
 * windowDays conta linhas anteriores (inclusive a atual), como no v1.
 */
export function rollingWindow(
  rows,
  { valueField = 'value', dateField = 'date', windowDays = 7 } = {},
) {
  const sorted = [...(Array.isArray(rows) ? rows : [])]
    .filter((r) => r && r[dateField])
    .sort((a, b) => String(a[dateField]).localeCompare(String(b[dateField])));
  const out = [];
  for (let i = 0; i < sorted.length; i += 1) {
    const bucket = [];
    for (let j = Math.max(0, i - windowDays + 1); j <= i; j += 1) {
      const n = Number(sorted[j]?.[valueField]);
      if (Number.isFinite(n)) bucket.push(n);
    }
    out.push({ date: String(sorted[i][dateField]), n: bucket.length, value: mean(bucket) });
  }
  return out;
}
