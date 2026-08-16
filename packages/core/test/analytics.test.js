import { describe, expect, it } from 'vitest';
import { mean, rollingWindow } from '../src/analytics/rolling.js';
import { compareBeforeAfterByDose } from '../src/analytics/beforeAfter.js';

describe('analytics/rolling', () => {
  it('mean ignora não-numéricos; vazio → null', () => {
    expect(mean([1, 2, '3', null, 'x'])).toBe(2);
    expect(mean([])).toBeNull();
  });

  it('rollingWindow calcula média móvel por data ordenada', () => {
    const rows = [
      { date: '2026-02-03', value: 6 },
      { date: '2026-02-01', value: 2 },
      { date: '2026-02-02', value: 4 },
    ];
    const out = rollingWindow(rows, { windowDays: 2 });
    expect(out.map((r) => r.date)).toEqual(['2026-02-01', '2026-02-02', '2026-02-03']);
    expect(out.map((r) => r.value)).toEqual([2, 3, 5]);
    expect(out[2].n).toBe(2);
  });
});

describe('analytics/beforeAfter — sintoma × ajuste de dose (D3)', () => {
  const series = [];
  for (let d = 1; d <= 20; d += 1) {
    // dor cai de ~8 para ~4 depois do ajuste no dia 11
    series.push({ date: `2026-02-${String(d).padStart(2, '0')}`, value: d <= 10 ? 8 : 4 });
  }
  const doseEvents = [
    { id: 'd1', effective_from: '2026-02-01', dose_amount: 2, dose_unit: 'gotas' },
    { id: 'd2', effective_from: '2026-02-11', dose_amount: 4, dose_unit: 'gotas' },
  ];

  it('para cada ajuste calcula média antes/depois na janela e o delta', () => {
    const out = compareBeforeAfterByDose({ doseEvents, series, windowDays: 7 });
    expect(out).toHaveLength(2);
    const d2 = out.find((o) => o.dose_event_id === 'd2');
    expect(d2).toMatchObject({
      anchor_date: '2026-02-11',
      before_avg: 8,
      after_avg: 4,
      delta: -4,
      n_before: 7,
      n_after: 7,
    });
  });

  it('sem dados antes → before_avg null e delta null (nunca 0)', () => {
    const out = compareBeforeAfterByDose({ doseEvents, series, windowDays: 7 });
    const d1 = out.find((o) => o.dose_event_id === 'd1');
    expect(d1.before_avg).toBeNull();
    expect(d1.delta).toBeNull();
    expect(d1.n_before).toBe(0);
    expect(d1.after_avg).toBe(8);
  });

  it('aceita Date em effective_from e devolve anchor_date ISO', () => {
    const out = compareBeforeAfterByDose({
      doseEvents: [{ id: 'x', effective_from: new Date('2026-02-11T00:00:00Z') }],
      series,
      windowDays: 3,
    });
    expect(out[0].anchor_date).toBe('2026-02-11');
  });
});
