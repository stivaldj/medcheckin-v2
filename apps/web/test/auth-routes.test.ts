import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  createDb,
  migrationConfig,
  runSeed,
  requestMagicLink,
  verifyMagicLink,
  acceptInvite,
  fakeMailer,
} from '@medcheckin/core';
import type { Knex } from 'knex';

// Rotas do Next são funções puras: testáveis sem servidor (como health.test.ts).
// Relógio real: a rota lê o cookie com `new Date()` (apps/web/lib/auth.ts:46),
// então a sessão precisa ser criada "agora" para não expirar por data fixa.
const NOW = new Date();
let db: Knex;
let fx: {
  clinicId: string;
  p1: string;
  p2: string;
  otherPatient: string;
  doctorCookie: string;
  caregiverCookie: string;
};

async function sessionCookies() {
  const mailer = fakeMailer();
  await requestMagicLink(db, { email: 'medica@medcheckin.test', baseUrl: 'http://x', mailer }, NOW);
  const token = mailer.sent[0].text.match(/token=([A-Za-z0-9_-]+)/)![1];
  const doc = await verifyMagicLink(db, { token }, NOW);
  const cg = await acceptInvite(db, { inviteToken: 'seed-c2', consentVersion: 'v1' }, NOW);
  return {
    doctorCookie: `mc_user=${doc.sessionToken}`,
    caregiverCookie: `mc_resp=${cg.sessionToken}`,
  };
}

beforeAll(async () => {
  db = createDb(process.env.DATABASE_URL_TEST || process.env.DATABASE_URL!);
  await db.migrate.rollback(migrationConfig, true);
  await db.migrate.latest(migrationConfig);
  await runSeed(db, { reset: true });
  const clinic = await db('clinics').first();
  const p1 = await db('patients').where({ name: 'Paciente Sintético Um' }).first();
  const p2 = await db('patients').where({ name: 'Paciente Sintético Dois' }).first();
  const [c] = await db('clinics').insert({ name: 'Outra' }).returning('id');
  const [u] = await db('users')
    .insert({ clinic_id: c.id, role: 'doctor', email: 'outra@x.test', name: 'Outra' })
    .returning('id');
  const [op] = await db('patients')
    .insert({ clinic_id: c.id, name: 'De Outra', timezone: 'America/Cuiaba', created_by: u.id })
    .returning('id');
  const cookies = await sessionCookies();
  fx = { clinicId: clinic.id, p1: p1.id, p2: p2.id, otherPatient: op.id, ...cookies };
});
afterAll(async () => db.destroy());

const get = (path: string, cookie?: string) =>
  new Request(`http://localhost${path}`, { headers: cookie ? { cookie } : {} });

describe('GET /api/patients/[id] — tenancy + audit (PROVA E3)', () => {
  it('sem cookie → 401', async () => {
    const { GET } = await import('../app/api/patients/[id]/route');
    const res = await GET(get(`/api/patients/${fx.p1}`), {
      params: Promise.resolve({ id: fx.p1 }),
    });
    expect(res.status).toBe(401);
  });

  it('cookie da clínica A + paciente da clínica B → 404 (nunca 403)', async () => {
    const { GET } = await import('../app/api/patients/[id]/route');
    const res = await GET(get(`/api/patients/${fx.otherPatient}`, fx.doctorCookie), {
      params: Promise.resolve({ id: fx.otherPatient }),
    });
    expect(res.status).toBe(404);
  });

  it('próprio paciente → 200 com nome/status E linha em access_audit', async () => {
    const { GET } = await import('../app/api/patients/[id]/route');
    const res = await GET(get(`/api/patients/${fx.p1}`, fx.doctorCookie), {
      params: Promise.resolve({ id: fx.p1 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.patient).toMatchObject({
      id: fx.p1,
      name: 'Paciente Sintético Um',
      status: 'active',
    });
    const audit = await db('access_audit').where({ patient_id: fx.p1 });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      clinic_id: fx.clinicId,
      route: 'patients.detail',
      action: 'view',
    });
    expect(audit[0].user_id).not.toBeNull();
  });

  it('cookie de respondente não serve para rota da médica → 401', async () => {
    const { GET } = await import('../app/api/patients/[id]/route');
    const res = await GET(get(`/api/patients/${fx.p2}`, fx.caregiverCookie), {
      params: Promise.resolve({ id: fx.p2 }),
    });
    expect(res.status).toBe(401);
  });
});

describe('POST /api/auth/magic-link', () => {
  it('202 sempre; e-mail conhecido gera token', async () => {
    const before = Number((await db('auth_tokens').count().first())!.count);
    const { POST } = await import('../app/api/auth/magic-link/route');
    const res = await POST(
      new Request('http://localhost/api/auth/magic-link', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'medica@medcheckin.test' }),
      }),
    );
    expect(res.status).toBe(202);
    const after = Number((await db('auth_tokens').count().first())!.count);
    expect(after).toBe(before + 1);
    const res2 = await POST(
      new Request('http://localhost/api/auth/magic-link', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'nao-existe@medcheckin.test' }),
      }),
    );
    expect(res2.status).toBe(202);
  });
});

describe('GET /auth/verify → cookie de sessão', () => {
  it('token válido → 302 para /hoje com Set-Cookie HttpOnly SameSite=Lax; inválido → 302 /auth/invalido', async () => {
    const mailer = fakeMailer();
    await requestMagicLink(
      db,
      { email: 'medica@medcheckin.test', baseUrl: 'http://x', mailer },
      new Date(),
    );
    const token = mailer.sent[0].text.match(/token=([A-Za-z0-9_-]+)/)![1];
    const { GET } = await import('../app/auth/verify/route');
    const res = await GET(new Request(`http://localhost/auth/verify?token=${token}`));
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toMatch(/\/hoje$/);
    const cookie = res.headers.get('set-cookie')!;
    expect(cookie).toMatch(/^mc_user=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\//);
    const bad = await GET(new Request('http://localhost/auth/verify?token=nope'));
    expect(bad.status).toBe(302);
    expect(bad.headers.get('location')).toMatch(/\/auth\/invalido$/);
    expect(bad.headers.get('set-cookie')).toBeNull();
  });
});

describe('POST /api/p/accept → cookie do respondente', () => {
  it('token + consentimento → 200 e mc_resp; sem consentimento → 400; token inválido → 404', async () => {
    const { POST } = await import('../app/api/p/accept/route');
    const call = (body: unknown) =>
      POST(
        new Request('http://localhost/api/p/accept', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }),
      );
    const ok = await call({ token: 'seed-p1', consentVersion: 'v1' });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('set-cookie')).toMatch(/^mc_resp=.*HttpOnly/i);
    expect((await ok.json()).respondent).toMatchObject({ kind: 'respondent' });
    // seed-p2 (criança) nunca aceitou → exige consentimento
    await db('respondents')
      .where({ invite_token: 'seed-p2' })
      .update({ accepted_at: null, consent_version: null });
    expect((await call({ token: 'seed-p2' })).status).toBe(400);
    expect((await call({ token: 'nope', consentVersion: 'v1' })).status).toBe(404);
  });
});

describe('POST /api/auth/logout', () => {
  it('revoga a sessão e limpa o cookie', async () => {
    const { POST } = await import('../app/api/auth/logout/route');
    const { GET } = await import('../app/api/patients/[id]/route');
    const res = await POST(
      new Request('http://localhost/api/auth/logout', {
        method: 'POST',
        headers: { cookie: fx.doctorCookie },
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toMatch(/mc_user=;.*Max-Age=0/i);
    const after = await GET(get(`/api/patients/${fx.p1}`, fx.doctorCookie), {
      params: Promise.resolve({ id: fx.p1 }),
    });
    expect(after.status).toBe(401);
  });
});
