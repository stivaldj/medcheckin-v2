import { describe, expect, it } from 'vitest';
import { detectScoreRules, evaluateThreshold } from '../src/alerts/rules.js';

describe('alerts/rules — regras puras sobre scores', () => {
  it('detecta sequência de score baixo (3 dias ≤ 3)', () => {
    const rows = [
      { date: '2026-02-12', score: 3, trend: -0.2 },
      { date: '2026-02-13', score: 2.9, trend: -0.8 },
      { date: '2026-02-14', score: 2.8, trend: -1.2 },
      { date: '2026-02-15', score: 2.5, trend: -1.6 },
    ];
    const codes = detectScoreRules(rows).map((t) => t.code);
    expect(codes).toContain('low_score_streak');
    expect(codes).toContain('trend_negative');
  });

  it('detecta queda abrupta em 48h', () => {
    const rows = [
      { date: '2026-02-13', score: 6.5, trend: -0.2 },
      { date: '2026-02-14', score: 6, trend: -0.7 },
      { date: '2026-02-15', score: 2.5, trend: -1.2 },
    ];
    expect(detectScoreRules(rows).map((t) => t.code)).toContain('drop_fast');
  });

  it('ignora dias sem score (null) — sem dado não é score baixo (L5)', () => {
    const rows = [
      { date: '2026-02-13', score: null, trend: null },
      { date: '2026-02-14', score: null, trend: null },
      { date: '2026-02-15', score: null, trend: null },
    ];
    expect(detectScoreRules(rows)).toEqual([]);
  });
});

describe('alerts/rules — limiar por pergunta (nada hardcoded — L3)', () => {
  it('avalia op/value do alert_threshold_json', () => {
    expect(evaluateThreshold({ op: '>=', value: 7 }, 8)).toBe(true);
    expect(evaluateThreshold({ op: '>=', value: 7 }, 6)).toBe(false);
    expect(evaluateThreshold({ op: '<=', value: 3 }, 3)).toBe(true);
    expect(evaluateThreshold({ op: '==', value: 1 }, 1)).toBe(true);
    expect(evaluateThreshold({ op: 'in', value: ['tontura', 'náusea'] }, 'tontura')).toBe(true);
  });

  it('sem limiar ou sem valor → false', () => {
    expect(evaluateThreshold(null, 8)).toBe(false);
    expect(evaluateThreshold({ op: '>=', value: 7 }, null)).toBe(false);
  });
});
