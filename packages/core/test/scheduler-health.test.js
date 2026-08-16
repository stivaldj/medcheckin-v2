import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { freshDb } from './helpers/db.js';
import { setSystemState, STATE_KEYS } from '../src/scheduler/cycle.js';
import { startHealthServer } from '../src/scheduler/health.js';

describe('scheduler /health (fecha ACHADOS E5/E6)', () => {
  let db, srv;
  beforeAll(async () => {
    db = await freshDb();
    srv = await startHealthServer(db, { port: 0, staleMinutes: 5 });
  });
  afterAll(async () => {
    await srv.close();
    await db.destroy();
  });

  it('503 sem heartbeat; 200 com heartbeat recente; 503 com heartbeat velho; 404 fora de /health', async () => {
    const url = `http://127.0.0.1:${srv.port}`;
    let r = await fetch(`${url}/health`);
    expect(r.status).toBe(503);
    expect(await r.json()).toMatchObject({ ok: false, last_cycle_at: null });
    await setSystemState(db, STATE_KEYS.lastCycle, new Date().toISOString());
    r = await fetch(`${url}/health`);
    expect(r.status).toBe(200);
    expect((await r.json()).ok).toBe(true);
    await setSystemState(db, STATE_KEYS.lastCycle, new Date(Date.now() - 20 * 60000).toISOString());
    r = await fetch(`${url}/health`);
    expect(r.status).toBe(503);
    r = await fetch(`${url}/outra`);
    expect(r.status).toBe(404);
  });
});
