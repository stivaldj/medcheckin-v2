import { NextResponse } from 'next/server';
import { createDb, loadConfig, getSystemState, STATE_KEYS } from '@medcheckin/core';

export const dynamic = 'force-dynamic';
const STALE_MINUTES = 10;

/**
 * Health honesto: ok:true só se o Postgres respondeu (e, com HEALTH_REQUIRE_SCHEDULER=1, se o
 * scheduler bateu o coração há < 10 min). Sem DATABASE_URL ou sem conexão → 503 — nunca sucesso falso.
 */
export async function GET() {
  let db: ReturnType<typeof createDb> | undefined;
  try {
    const url =
      process.env.VITEST && process.env.DATABASE_URL_TEST
        ? process.env.DATABASE_URL_TEST
        : loadConfig(process.env).databaseUrl;
    db = createDb(url);
    await db.raw('select 1');
    let scheduler: { last_cycle_at: Date | null; stale: boolean } = {
      last_cycle_at: null,
      stale: true,
    };
    try {
      const st = await getSystemState(db);
      const last = st[STATE_KEYS.lastCycle] ? new Date(String(st[STATE_KEYS.lastCycle])) : null;
      scheduler = {
        last_cycle_at: last,
        stale: !last || Date.now() - last.getTime() > STALE_MINUTES * 60000,
      };
    } catch {
      // tabela system_state ainda não migrada: reporta como stale (honesto), sem derrubar o health do banco
      scheduler = { last_cycle_at: null, stale: true };
    }
    const requireScheduler = process.env.HEALTH_REQUIRE_SCHEDULER === '1';
    const ok = !(requireScheduler && scheduler.stale);
    return NextResponse.json(
      { ok, db: 'up', scheduler, version: process.env.APP_VERSION ?? 'dev' },
      { status: ok ? 200 : 503 },
    );
  } catch (err) {
    console.error('[health] db down', { name: (err as Error).name });
    return NextResponse.json({ ok: false, db: 'down' }, { status: 503 });
  } finally {
    if (db) await db.destroy();
  }
}
