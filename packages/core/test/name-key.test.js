import { describe, it, expect } from 'vitest';
import { productNameKey } from '../src/medications/nameKey.js';

// D34: produto é identificado na clínica pela chave normalizada, não pelo texto digitado.
describe('productNameKey', () => {
  it('minúsculas, sem acento, espaços colapsados, sem bordas', () => {
    expect(productNameKey('  Óleo  CBD 50mg/ml ')).toBe('oleo cbd 50mg/ml');
  });
  it('variações de caixa e acento dão a mesma chave', () => {
    expect(productNameKey('ÓLEO CBD')).toBe(productNameKey('oleo cbd'));
    expect(productNameKey('Canabidiol Prati-Donaduzzi')).toBe('canabidiol prati-donaduzzi');
  });
  it('preserva pontuação que distingue produtos', () => {
    expect(productNameKey('CBD 50mg/ml')).not.toBe(productNameKey('CBD 5mg/ml'));
  });
  it('entrada vazia ou não-string vira string vazia', () => {
    expect(productNameKey('')).toBe('');
    expect(productNameKey(null)).toBe('');
    expect(productNameKey(undefined)).toBe('');
  });
  it('catalogNameKey é a mesma função, exportada do módulo genérico e pelo alias antigo', async () => {
    const { catalogNameKey, productNameKey: alias } = await import('../src/catalog/nameKey.js');
    expect(catalogNameKey('  Epilepsia  Refratária ')).toBe('epilepsia refrataria');
    expect(alias).toBe(catalogNameKey);
    expect(productNameKey).toBe(catalogNameKey);
  });
});
