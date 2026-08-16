import { NextResponse } from 'next/server';
import { createDb, loadConfig } from '@medcheckin/core';

export const dynamic = 'force-dynamic';

/**
 * Health honesto: só devolve ok:true se o Postgres respondeu de fato.
 * Sem DATABASE_URL ou sem conexão → 503 (nunca sucesso falso — DECISOES.md L14).
 */
export async function GET() {
  let db: ReturnType<typeof createDb> | undefined;
  try {
    const cfg = loadConfig(process.env);
    db = createDb(cfg.databaseUrl);
    await db.raw('select 1');
    return NextResponse.json({ ok: true, db: 'up' }, { status: 200 });
  } catch (err) {
    console.error('[health] db down', { name: (err as Error).name });
    return NextResponse.json({ ok: false, db: 'down' }, { status: 503 });
  } finally {
    if (db) await db.destroy();
  }
}
