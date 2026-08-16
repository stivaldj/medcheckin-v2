import { describe, expect, it } from 'vitest';
import {
  normalizeToTen,
  computeTrend,
  inferRiskLevel,
  aggregateScore,
} from '../src/scoring/computeDailyScore.js';

describe('scoring — utilitários puros (portado do v1)', () => {
  it('normaliza escalas higher_is_better', () => {
    expect(normalizeToTen(5, 0, 10, 'higher_is_better')).toBe(5);
    expect(normalizeToTen(10, 0, 10, 'higher_is_better')).toBe(10);
  });

  it('normaliza lower_is_better invertido', () => {
    expect(normalizeToTen(2, 0, 10, 'lower_is_better')).toBe(8);
    expect(normalizeToTen(9, 0, 10, 'lower_is_better')).toBe(1);
  });

  it('trend determinístico a partir da janela anterior; sem janela → null', () => {
    expect(computeTrend(6, [4, 5, 5])).toBe(1.33);
    expect(computeTrend(4, [])).toBeNull();
    expect(computeTrend(4, [null, undefined])).toBeNull();
  });

  it('agregado: média ponderada; sem itens pontuáveis → null (nunca 0 — L5)', () => {
    expect(
      aggregateScore([
        { value: 8, weight: 2 },
        { value: 2, weight: 1 },
      ]),
    ).toBe(6);
    expect(aggregateScore([])).toBeNull();
    expect(aggregateScore([{ value: null, weight: 1 }])).toBeNull();
  });

  it('risco: high/medium/low; sem score → null', () => {
    expect(inferRiskLevel(2, 0)).toBe('high');
    expect(inferRiskLevel(6, -2.6)).toBe('high');
    expect(inferRiskLevel(4, 0)).toBe('medium');
    expect(inferRiskLevel(7, -1.5)).toBe('medium');
    expect(inferRiskLevel(7, 0)).toBe('low');
    expect(inferRiskLevel(null, null)).toBeNull();
  });
});
