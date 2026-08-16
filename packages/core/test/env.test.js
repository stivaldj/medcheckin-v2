import { describe, it, expect } from 'vitest';

// L9 (DECISOES.md): segredo/config ausente = processo não sobe (fail-closed).
describe('config (fail-closed)', () => {
  it('lança se DATABASE_URL não está definida', async () => {
    const saved = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      const { loadConfig } = await import('../src/config.js');
      expect(() => loadConfig(process.env)).toThrow(/DATABASE_URL/);
    } finally {
      if (saved !== undefined) process.env.DATABASE_URL = saved;
    }
  });

  it('devolve databaseUrl quando definida', async () => {
    const { loadConfig } = await import('../src/config.js');
    const cfg = loadConfig({ DATABASE_URL: 'postgres://u:p@localhost:5432/x' });
    expect(cfg.databaseUrl).toBe('postgres://u:p@localhost:5432/x');
  });
});
