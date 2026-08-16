import { DateTime } from 'luxon';
import { mean } from './rolling.js';

function toIsoDate(value) {
  if (value == null) return null;
  if (value instanceof Date) return DateTime.fromJSDate(value, { zone: 'utc' }).toISODate();
  const dt = DateTime.fromISO(String(value), { zone: 'utc' });
  return dt.isValid ? dt.toISODate() : null;
}

/**
 * D3: para cada ajuste de dose, média da série (ex.: dor por dia, score diário)
 * nos N dias antes e nos N dias a partir do ajuste. Sem dado → null.
 * series: [{date:'YYYY-MM-DD', value:number}]
 */
export function compareBeforeAfterByDose({ doseEvents = [], series = [], windowDays = 14 } = {}) {
  const rows = (Array.isArray(series) ? series : [])
    .filter((s) => s?.date && Number.isFinite(Number(s.value)))
    .map((s) => ({ date: String(s.date), value: Number(s.value) }));

  return (Array.isArray(doseEvents) ? doseEvents : []).map((de) => {
    const anchorDate = toIsoDate(de?.effective_from);
    const base = {
      dose_event_id: de?.id ?? null,
      dose_amount: de?.dose_amount ?? null,
      dose_unit: de?.dose_unit ?? null,
      anchor_date: anchorDate,
      before_avg: null,
      after_avg: null,
      delta: null,
      n_before: 0,
      n_after: 0,
    };
    if (!anchorDate) return base;
    const anchor = DateTime.fromISO(anchorDate, { zone: 'utc' });
    const beforeFrom = anchor.minus({ days: windowDays }).toISODate();
    const beforeTo = anchor.minus({ days: 1 }).toISODate();
    const afterTo = anchor.plus({ days: windowDays - 1 }).toISODate();
    const before = rows
      .filter((r) => r.date >= beforeFrom && r.date <= beforeTo)
      .map((r) => r.value);
    const after = rows.filter((r) => r.date >= anchorDate && r.date <= afterTo).map((r) => r.value);
    const beforeAvg = mean(before);
    const afterAvg = mean(after);
    return {
      ...base,
      before_avg: beforeAvg,
      after_avg: afterAvg,
      delta: beforeAvg != null && afterAvg != null ? afterAvg - beforeAvg : null,
      n_before: before.length,
      n_after: after.length,
    };
  });
}
