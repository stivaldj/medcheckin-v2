import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDb, migrationConfig, setSystemState, STATE_KEYS } from '@medcheckin/core';
import type { Knex } from 'knex';

// Route handler do Next é uma função pura: testável sem servidor.
describe('GET /api/health', () => {
  let db: Knex;
  beforeAll(async () => {
    db = createDb(process.env.DATABASE_URL_TEST || process.env.DATABASE_URL!);
    await db.raw('drop schema public cascade; create schema public');
    await db.migrate.latest(migrationConfig);
  });
  afterAll(async () => db.destroy());

  it('200 com ok:true, db:"up" e bloco scheduler (stale=true sem heartbeat) quando não se exige scheduler', async () => {
    delete process.env.HEALTH_REQUIRE_SCHEDULER;
    const { GET } = await import('../app/api/health/route');
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      ok: true,
      db: 'up',
      scheduler: { stale: true, last_cycle_at: null },
    });
  });

  it('HEALTH_REQUIRE_SCHEDULER=1: 503 com scheduler parado; 200 com heartbeat recente', async () => {
    process.env.HEALTH_REQUIRE_SCHEDULER = '1';
    const { GET } = await import('../app/api/health/route');
    const down = await GET();
    expect(down.status).toBe(503);
    expect(await down.json()).toMatchObject({ ok: false, db: 'up', scheduler: { stale: true } });
    await setSystemState(db, STATE_KEYS.lastCycle, new Date().toISOString());
    const up = await GET();
    expect(up.status).toBe(200);
    expect((await up.json()).scheduler.stale).toBe(false);
    delete process.env.HEALTH_REQUIRE_SCHEDULER;
  });

  it('503 com db:"down" quando a conexão falha (sem sucesso falso)', async () => {
    const saved = process.env.DATABASE_URL_TEST;
    const savedUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL_TEST = 'postgres://x:x@127.0.0.1:1/nope';
    process.env.DATABASE_URL = 'postgres://x:x@127.0.0.1:1/nope';
    try {
      const { GET } = await import('../app/api/health/route');
      const res = await GET();
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.ok).toBe(false);
      expect(body.db).toBe('down');
    } finally {
      process.env.DATABASE_URL_TEST = saved;
      process.env.DATABASE_URL = savedUrl;
    }
  });
});
