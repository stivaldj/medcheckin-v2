import { describe, it, expect, afterAll } from 'vitest';

// D6 (DECISOES.md): Postgres real desde o primeiro commit. Sem SQLite.
describe('db smoke (Postgres real)', () => {
  let db;

  afterAll(async () => {
    if (db) await db.destroy();
  });

  it('conecta via DATABASE_URL e responde select 1', async () => {
    const { createDb } = await import('../src/db.js');
    db = createDb(process.env.DATABASE_URL);
    const rows = await db.raw('select 1 as one');
    expect(rows.rows[0].one).toBe(1);
  });

  it('o dialeto é pg (não sqlite)', async () => {
    expect(db.client.config.client).toBe('pg');
  });
});
