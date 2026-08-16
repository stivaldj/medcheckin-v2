import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  createDb,
  migrationConfig,
  runSeed,
  createSession,
  planCheckins,
  planMedicationIntakes,
} from '@medcheckin/core';
import type { Knex } from 'knex';

let db: Knex;
let fx: { cookie: string; p1: string; r1: string };
const H = (extra: Record<string, string> = {}) => ({
  cookie: fx.cookie,
  'content-type': 'application/json',
  origin: 'http://localhost:3000',
  ...extra,
});
const req = (path: string, init: RequestInit = {}) =>
  new Request(`http://localhost:3000${path}`, init);
const params = <P>(p: P) => ({ params: Promise.resolve(p) });

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
  await planCheckins(db, new Date());
  await planMedicationIntakes(db, new Date());
  fx = { cookie: `mc_resp=${sessionToken}`, p1: p1.id, r1: r1.id };
});
afterAll(async () => db.destroy());

describe('API do respondente', () => {
  it('GET /api/p/today: 401 sem cookie; 200 com check-in e alarmes', async () => {
    const { GET } = await import('../app/api/p/today/route');
    expect((await GET(req('/api/p/today'), params({}))).status).toBe(401);
    const res = await GET(req('/api/p/today', { headers: { cookie: fx.cookie } }), params({}));
    expect(res.status).toBe(200);
    const t = await res.json();
    expect(t.checkin).toBeTruthy();
    expect(t.checkin.next.key).toBe('dor');
    expect(t.alarms).toHaveLength(2);
  });

  it('POST /api/p/checkins/[id]/answers grava e devolve próxima; valor inválido → 400; Origin estranho → 403', async () => {
    const { GET } = await import('../app/api/p/today/route');
    const t = await (
      await GET(req('/api/p/today', { headers: { cookie: fx.cookie } }), params({}))
    ).json();
    const { POST } = await import('../app/api/p/checkins/[id]/answers/route');
    const bad = await POST(
      req(`/api/p/checkins/${t.checkin.id}/answers`, {
        method: 'POST',
        headers: H({ origin: 'https://evil' }),
        body: JSON.stringify({ questionKey: 'dor', value: 5 }),
      }),
      params({ id: t.checkin.id }),
    );
    expect(bad.status).toBe(403);
    const inv = await POST(
      req(`/api/p/checkins/${t.checkin.id}/answers`, {
        method: 'POST',
        headers: H(),
        body: JSON.stringify({ questionKey: 'dor', value: 55 }),
      }),
      params({ id: t.checkin.id }),
    );
    expect(inv.status).toBe(400);
    const ok = await POST(
      req(`/api/p/checkins/${t.checkin.id}/answers`, {
        method: 'POST',
        headers: H(),
        body: JSON.stringify({ questionKey: 'dor', value: 5 }),
      }),
      params({ id: t.checkin.id }),
    );
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.next.key).toBe('sono');
    expect(body.progress.answered).toBe(1);
    const a = await db('answers').where({ checkin_id: t.checkin.id });
    expect(a).toHaveLength(1);
    expect(a[0].respondent_id).toBe(fx.r1);
  });

  it('POST /api/p/intakes/[id]/confirm', async () => {
    const { GET } = await import('../app/api/p/today/route');
    const t = await (
      await GET(req('/api/p/today', { headers: { cookie: fx.cookie } }), params({}))
    ).json();
    const { POST } = await import('../app/api/p/intakes/[id]/confirm/route');
    const id = t.alarms[0].intake_id;
    const ok = await POST(
      req(`/api/p/intakes/${id}/confirm`, {
        method: 'POST',
        headers: H(),
        body: JSON.stringify({ status: 'taken' }),
      }),
      params({ id }),
    );
    expect(ok.status).toBe(200);
    expect(['taken', 'late']).toContain((await ok.json()).status);
  });

  it('GET /api/p/vapid; POST /api/p/push salva inscrição; DELETE remove; GET /api/p/history', async () => {
    const { GET: VAPID } = await import('../app/api/p/vapid/route');
    const v = await (await VAPID()).json();
    expect(v.publicKey).toMatch(/^[A-Za-z0-9_-]{60,}$/);
    const { POST, DELETE } = await import('../app/api/p/push/route');
    const sub = { endpoint: 'https://push.example.test/abc', keys: { p256dh: 'BPk', auth: 'aa' } };
    const s = await POST(
      req('/api/p/push', { method: 'POST', headers: H(), body: JSON.stringify(sub) }),
      params({}),
    );
    expect(s.status).toBe(201);
    expect(
      await db('push_subscriptions').where({ respondent_id: fx.r1 }).count().first(),
    ).toMatchObject({ count: 1 });
    const d = await DELETE(
      req('/api/p/push', {
        method: 'DELETE',
        headers: H(),
        body: JSON.stringify({ endpoint: sub.endpoint }),
      }),
      params({}),
    );
    expect(d.status).toBe(200);
    const { GET: HIST } = await import('../app/api/p/history/route');
    const h = await (
      await HIST(req('/api/p/history', { headers: { cookie: fx.cookie } }), params({}))
    ).json();
    expect(h.days.length).toBeGreaterThan(0);
  });
});
