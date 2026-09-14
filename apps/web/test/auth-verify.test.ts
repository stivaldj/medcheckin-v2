import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDb, migrationConfig, runSeed, requestMagicLink, fakeMailer } from '@medcheckin/core';
import type { Knex } from 'knex';

let db: Knex;

// Atrás do Caddy/Funnel o Next enxerga a requisição como vinda de 0.0.0.0:3000
// (endereço interno do container). O redirect tem que usar APP_BASE_URL, nunca essa origem.
const INTERNAL = 'http://0.0.0.0:3000';
const BASE = process.env.APP_BASE_URL!; // http://localhost:3000 no vitest.config

beforeAll(async () => {
  db = createDb(process.env.DATABASE_URL_TEST || process.env.DATABASE_URL!);
  await db.raw('drop schema public cascade; create schema public');
  await db.migrate.latest(migrationConfig);
  await runSeed(db, { reset: true });
});
afterAll(async () => db.destroy());

describe('GET /auth/verify atrás de proxy', () => {
  it('link inválido → 302 para APP_BASE_URL/auth/invalido, não para a origem interna', async () => {
    const { GET } = await import('../app/auth/verify/route');
    const res = await GET(new Request(`${INTERNAL}/auth/verify?token=nao-existe`));
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`${BASE}/auth/invalido`);
  });

  it('link válido → cookie de sessão + 302 para APP_BASE_URL/hoje', async () => {
    const user = await db('users').first();
    const mailer = fakeMailer();
    await requestMagicLink(db, { email: user.email, baseUrl: BASE, mailer }, new Date());
    const token = mailer.sent[0].text.match(/token=([A-Za-z0-9_-]+)/)![1];

    const { GET } = await import('../app/auth/verify/route');
    const res = await GET(new Request(`${INTERNAL}/auth/verify?token=${token}`));
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`${BASE}/hoje`);
    expect(res.headers.get('set-cookie')).toMatch(/^mc_user=/);
  });
});
