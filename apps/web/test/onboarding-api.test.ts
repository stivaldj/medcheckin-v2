import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDb, migrationConfig, runSeed, createSession } from '@medcheckin/core';
import type { Knex } from 'knex';

/**
 * E9.3 — manifest por convite (o app instalado no iPhone abre JÁ no convite, que entra sozinho)
 * e rotas do teste de aviso.
 */
let db: Knex;
let fx: { cookie: string; r1: string; token: string };
const req = (path: string, init: RequestInit = {}) =>
  new Request(`http://localhost:3000${path}`, init);
const params = <P>(p: P) => ({ params: Promise.resolve(p) });
const H = () => ({
  cookie: fx.cookie,
  'content-type': 'application/json',
  origin: 'http://localhost:3000',
});

beforeAll(async () => {
  db = createDb(process.env.DATABASE_URL_TEST || process.env.DATABASE_URL!);
  await db.raw('drop schema public cascade; create schema public');
  await db.migrate.latest(migrationConfig);
  await runSeed(db, { reset: true });
  const p1 = await db('patients').where({ name: 'Paciente Sintético Um' }).first();
  const r1 = await db('respondents').where({ patient_id: p1.id, kind: 'patient' }).first();
  const clinic = await db('clinics').first();
  const { sessionToken } = await createSession(
    db,
    { respondentId: r1.id, clinicId: clinic.id },
    new Date(),
  );
  fx = { cookie: `mc_resp=${sessionToken}`, r1: r1.id, token: r1.invite_token };
});
afterAll(async () => db.destroy());

describe('manifest por convite', () => {
  it('token válido → start_url é o próprio convite em modo app; escopo /p/', async () => {
    const { GET } = await import('../app/p/convite/[token]/manifest.webmanifest/route');
    const res = await GET(
      req(`/p/convite/${fx.token}/manifest.webmanifest`),
      params({ token: fx.token }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/manifest\+json/);
    expect(res.headers.get('cache-control')).toMatch(/no-store/);
    const m = await res.json();
    expect(m.start_url).toBe(`/p/convite/${fx.token}?app=1`);
    expect(m.scope).toBe('/p/');
    expect(m.display).toBe('standalone');
  });

  it('token inexistente → 404 (não vaza nada)', async () => {
    const { GET } = await import('../app/p/convite/[token]/manifest.webmanifest/route');
    const res = await GET(
      req('/p/convite/nao-existe/manifest.webmanifest'),
      params({ token: 'nao-existe' }),
    );
    expect(res.status).toBe(404);
  });
});

describe('teste de aviso', () => {
  it('POST sem inscrição → 400 com motivo; com inscrição → 201; GET status waiting; confirmar antes do envio → 409', async () => {
    const { POST } = await import('../app/api/p/push-test/route');
    const semInscricao = await POST(
      req('/api/p/push-test', { method: 'POST', headers: H() }),
      params({}),
    );
    expect(semInscricao.status).toBe(400);
    expect((await semInscricao.json()).error).toBe('no_subscription');

    await db('push_subscriptions').insert({
      respondent_id: fx.r1,
      endpoint: 'https://push.example.test/r1',
      keys: JSON.stringify({ p256dh: 'x', auth: 'y' }),
    });
    const ok = await POST(req('/api/p/push-test', { method: 'POST', headers: H() }), params({}));
    expect(ok.status).toBe(201);
    const { notificationId } = await ok.json();

    const { GET } = await import('../app/api/p/push-test/[id]/route');
    const st = await GET(
      req(`/api/p/push-test/${notificationId}`, { headers: H() }),
      params({ id: notificationId }),
    );
    expect((await st.json()).status).toBe('waiting');

    const { POST: CONFIRM } = await import('../app/api/p/push-test/[id]/route');
    const cedo = await CONFIRM(
      req(`/api/p/push-test/${notificationId}`, {
        method: 'POST',
        headers: H(),
        body: JSON.stringify({ arrived: true }),
      }),
      params({ id: notificationId }),
    );
    expect(cedo.status).toBe(409);
  });

  it('POST /api/p/installed → 200 e grava a data', async () => {
    const { POST } = await import('../app/api/p/installed/route');
    const res = await POST(req('/api/p/installed', { method: 'POST', headers: H() }), params({}));
    expect(res.status).toBe(200);
    const r = await db('respondents').where({ id: fx.r1 }).first();
    expect(r.install_confirmed_at).not.toBeNull();
  });
});
