import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  createDb,
  migrationConfig,
  runSeed,
  createSession,
  catalogNameKey,
} from '@medcheckin/core';
import type { Knex } from 'knex';

let db: Knex;
let fx: { cookie: string; p1: string; alertId: string; otherAlertId: string };
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
  const [a] = await db('alerts')
    .insert({
      patient_id: p1.id,
      code: 'side_effect',
      severity: 'high',
      title: 'Efeito adverso relatado',
      context: {},
    })
    .returning('id');
  const [c] = await db('clinics').insert({ name: 'Outra' }).returning('id');
  const [u] = await db('users')
    .insert({ clinic_id: c.id, role: 'doctor', email: 'o@x.test', name: 'O' })
    .returning('id');
  const [op] = await db('patients')
    .insert({
      clinic_id: c.id,
      name: 'Outro',
      name_key: catalogNameKey('Outro'),
      timezone: 'America/Cuiaba',
      created_by: u.id,
    })
    .returning('id');
  const [oa] = await db('alerts')
    .insert({ patient_id: op.id, code: 'x', severity: 'low', title: 'x', context: {} })
    .returning('id');
  const { sessionToken } = await createSession(
    db,
    { userId: user.id, clinicId: clinic.id },
    new Date(),
  );
  fx = { cookie: `mc_user=${sessionToken}`, p1: p1.id, alertId: a.id, otherAlertId: oa.id };
});
afterAll(async () => db.destroy());

describe('Hoje + alertas + séries', () => {
  it('GET /api/today: 401 sem cookie; 200 com blocos e alertas da clínica', async () => {
    const { GET } = await import('../app/api/today/route');
    expect((await GET(req('/api/today'), params({}))).status).toBe(401);
    const d = await (
      await GET(req('/api/today', { headers: { cookie: fx.cookie } }), params({}))
    ).json();
    expect(d).toHaveProperty('awaiting');
    expect(d.open_alerts.map((a: { id: string }) => a.id)).toContain(fx.alertId);
    expect(d.open_alerts.map((a: { id: string }) => a.id)).not.toContain(fx.otherAlertId);
    expect(d.scheduler).toHaveProperty('stale');
  });

  it('alertas: ack → resolve sem nota 400 → resolve com nota 200 + actions; alerta de outra clínica → 404', async () => {
    const { POST: ACK } = await import('../app/api/alerts/[id]/ack/route');
    const { POST: RESOLVE } = await import('../app/api/alerts/[id]/resolve/route');
    const { GET: ACTIONS } = await import('../app/api/alerts/[id]/actions/route');
    const a = await ACK(
      req(`/api/alerts/${fx.alertId}/ack`, { method: 'POST', headers: H() }),
      params({ id: fx.alertId }),
    );
    expect(a.status).toBe(200);
    expect((await a.json()).status).toBe('acknowledged');
    const bad = await RESOLVE(
      req(`/api/alerts/${fx.alertId}/resolve`, {
        method: 'POST',
        headers: H(),
        body: JSON.stringify({ note: ' ' }),
      }),
      params({ id: fx.alertId }),
    );
    expect(bad.status).toBe(400);
    const ok = await RESOLVE(
      req(`/api/alerts/${fx.alertId}/resolve`, {
        method: 'POST',
        headers: H(),
        body: JSON.stringify({ note: 'Reduzi a dose e orientei.' }),
      }),
      params({ id: fx.alertId }),
    );
    expect(ok.status).toBe(200);
    expect((await ok.json()).status).toBe('resolved');
    const acts = await (
      await ACTIONS(
        req(`/api/alerts/${fx.alertId}/actions`, { headers: { cookie: fx.cookie } }),
        params({ id: fx.alertId }),
      )
    ).json();
    expect(acts.map((x: { action: string }) => x.action)).toEqual(['acknowledge', 'resolve']);
    expect(acts[1].user_name).toBe('Dra. Sintética');
    // Auditoria P1-4: duplo-clique em Resolver é erro do cliente (400), não 500
    const again = await RESOLVE(
      req(`/api/alerts/${fx.alertId}/resolve`, {
        method: 'POST',
        headers: H(),
        body: JSON.stringify({ note: 'de novo' }),
      }),
      params({ id: fx.alertId }),
    );
    expect(again.status).toBe(400);
    const other = await ACK(
      req(`/api/alerts/${fx.otherAlertId}/ack`, { method: 'POST', headers: H() }),
      params({ id: fx.otherAlertId }),
    );
    expect(other.status).toBe(404);
  });

  it('GET /api/patients/[id]/series?question=dor', async () => {
    const { GET } = await import('../app/api/patients/[id]/series/route');
    const r = await GET(
      req(`/api/patients/${fx.p1}/series?question=dor&days=14`, { headers: { cookie: fx.cookie } }),
      params({ id: fx.p1 }),
    );
    expect(r.status).toBe(200);
    const s = await r.json();
    expect(s.points).toHaveLength(14);
    expect(s.doseMarkers.length).toBeGreaterThan(0);
    const bad = await GET(
      req(`/api/patients/${fx.p1}/series?question=zzz`, { headers: { cookie: fx.cookie } }),
      params({ id: fx.p1 }),
    );
    expect(bad.status).toBe(400);
  });
});
