import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import JSZip from 'jszip';
import { createDb, migrationConfig, runSeed, createSession } from '@medcheckin/core';
import type { Knex } from 'knex';

let db: Knex;
let fx: { cookie: string; p1: string; p1Name: string };
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
  const clinic = await db('clinics').first();
  const user = await db('users').first();
  const p1 = await db('patients').where({ name: 'Paciente Sintético Um' }).first();
  const { sessionToken } = await createSession(
    db,
    { userId: user.id, clinicId: clinic.id },
    new Date(),
  );
  fx = { cookie: `mc_user=${sessionToken}`, p1: p1.id, p1Name: p1.name };
});
afterAll(async () => db.destroy());

describe('relatório, export, anonimização, settings', () => {
  it('GET /api/patients/[id]/report → 200 com blocos; sem dado → null', async () => {
    const { GET } = await import('../app/api/patients/[id]/report/route');
    const r = await (
      await GET(
        req(`/api/patients/${fx.p1}/report`, { headers: { cookie: fx.cookie } }),
        params({ id: fx.p1 }),
      )
    ).json();
    expect(r.checkins.completion_rate).toBeNull();
    expect(r.doses.length).toBe(2);
  });

  it('GET /api/patients/[id]/export → zip (Content-Disposition) com manifest', async () => {
    const { GET } = await import('../app/api/patients/[id]/export/route');
    const res = await GET(
      req(`/api/patients/${fx.p1}/export`, { headers: { cookie: fx.cookie } }),
      params({ id: fx.p1 }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/zip');
    expect(res.headers.get('content-disposition')).toMatch(
      /attachment; filename="medcheckin-export-/,
    );
    const zip = await JSZip.loadAsync(Buffer.from(await res.arrayBuffer()));
    const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'));
    expect(manifest.counts.dose_events).toBe(2);
    expect(Object.keys(zip.files).length).toBeGreaterThan(5);
  });

  it('POST /api/patients/[id]/anonymize: nome errado → 400; sem motivo → 400; ok → 200 e nome anonimizado', async () => {
    const { POST } = await import('../app/api/patients/[id]/anonymize/route');
    const call = (body: unknown) =>
      POST(
        req(`/api/patients/${fx.p1}/anonymize`, {
          method: 'POST',
          headers: H(),
          body: JSON.stringify(body),
        }),
        params({ id: fx.p1 }),
      );
    expect((await call({ reason: 'x', confirmName: 'errado' })).status).toBe(400);
    expect((await call({ reason: '', confirmName: fx.p1Name })).status).toBe(400);
    const ok = await call({ reason: 'pedido do titular', confirmName: fx.p1Name });
    expect(ok.status).toBe(200);
    expect((await ok.json()).patient.name).toMatch(/^Paciente anonimizado/);
  });

  it('GET /api/settings → perfil, respondentes convidados, sistema', async () => {
    const { GET } = await import('../app/api/settings/route');
    const s = await (
      await GET(req('/api/settings', { headers: { cookie: fx.cookie } }), params({}))
    ).json();
    expect(s.user.email).toBe('medica@medcheckin.test');
    expect(s.clinic.name).toBe('Clínica Sintética');
    expect(s.respondents.length).toBeGreaterThan(0);
    expect(s.system).toHaveProperty('push_configured');
    expect(s.system.retention).toHaveProperty('notificationsDays');
  });
});
