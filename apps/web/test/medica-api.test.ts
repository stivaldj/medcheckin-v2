import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDb, migrationConfig, runSeed, createSession } from '@medcheckin/core';
import type { Knex } from 'knex';

let db: Knex;
let fx: {
  clinicId: string;
  userId: string;
  p1: string;
  productId: string;
  setId: string;
  cookie: string;
};
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
  await db.migrate.rollback(migrationConfig, true);
  await db.migrate.latest(migrationConfig);
  await runSeed(db, { reset: true });
  const clinic = await db('clinics').first();
  const user = await db('users').first();
  const p1 = await db('patients').where({ name: 'Paciente Sintético Um' }).first();
  const product = await db('products').first();
  const set = await db('question_sets').first();
  const { sessionToken } = await createSession(
    db,
    { userId: user.id, clinicId: clinic.id },
    new Date(),
  );
  fx = {
    clinicId: clinic.id,
    userId: user.id,
    p1: p1.id,
    productId: product.id,
    setId: set.id,
    cookie: `mc_user=${sessionToken}`,
  };
});
afterAll(async () => db.destroy());

describe('CSRF: rotas mutáveis exigem Origin da própria app', () => {
  it('POST /api/patients com Origin estranho → 403; sem Origin (curl) → passa; Origin correto → passa', async () => {
    const { POST } = await import('../app/api/patients/route');
    const body = JSON.stringify({
      name: 'Paciente Origin',
      respondents: [{ kind: 'patient', name: 'Paciente Origin' }],
    });
    const bad = await POST(
      req('/api/patients', {
        method: 'POST',
        headers: H({ origin: 'https://evil.example' }),
        body,
      }),
      params({}),
    );
    expect(bad.status).toBe(403);
    const ok = await POST(req('/api/patients', { method: 'POST', headers: H(), body }), params({}));
    expect(ok.status).toBe(201);
    const { origin: _o, ...noOrigin } = H();
    const ok2 = await POST(
      req('/api/patients', {
        method: 'POST',
        headers: noOrigin,
        body: JSON.stringify({
          name: 'Paciente Curl',
          respondents: [{ kind: 'patient', name: 'Curl' }],
        }),
      }),
      params({}),
    );
    expect(ok2.status).toBe(201);
  });
});

describe('pacientes', () => {
  it('GET /api/patients lista com resumo; POST cria (201) com respondentes e valida (400)', async () => {
    const { GET, POST } = await import('../app/api/patients/route');
    const list = await GET(req('/api/patients', { headers: { cookie: fx.cookie } }), params({}));
    expect(list.status).toBe(200);
    const rows = await list.json();
    expect(
      rows.find((r: { name: string }) => r.name === 'Paciente Sintético Um').medications[0]
        .current_dose.dose_amount,
    ).toBe(4);
    const bad = await POST(
      req('/api/patients', { method: 'POST', headers: H(), body: JSON.stringify({ name: 'x' }) }),
      params({}),
    );
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toBe('validation');
    const created = await POST(
      req('/api/patients', {
        method: 'POST',
        headers: H(),
        body: JSON.stringify({
          name: 'Paciente API',
          birth_date: '2010-01-01',
          respondents: [
            { kind: 'caregiver', name: 'Cuidadora API', relationship: 'mãe', email: 'c@x.test' },
          ],
          consent_version: 'v1',
        }),
      }),
      params({}),
    );
    expect(created.status).toBe(201);
    const body = await created.json();
    expect(body.patient.name).toBe('Paciente API');
    expect(body.respondents[0].invite_url).toMatch(/\/p\/convite\/[A-Za-z0-9_-]{40,}$/);
    expect(await GET(req('/api/patients'), params({}))).toHaveProperty('status', 401);
  });

  it('GET /api/patients/[id] devolve detalhe completo (grade 14d) e audita; PATCH pausa', async () => {
    const { GET, PATCH } = await import('../app/api/patients/[id]/route');
    const res = await GET(
      req(`/api/patients/${fx.p1}`, { headers: { cookie: fx.cookie } }),
      params({ id: fx.p1 }),
    );
    expect(res.status).toBe(200);
    const d = await res.json();
    expect(d.grid.days).toHaveLength(14);
    expect(d.respondents[0].invite_url).toContain('/p/convite/');
    expect(d.medications[0].dose_history).toHaveLength(2);
    const audit = await db('access_audit').where({ patient_id: fx.p1, route: 'patients.detail' });
    expect(audit.length).toBeGreaterThan(0);
    const patched = await PATCH(
      req(`/api/patients/${fx.p1}`, {
        method: 'PATCH',
        headers: H(),
        body: JSON.stringify({ status: 'paused' }),
      }),
      params({ id: fx.p1 }),
    );
    expect(patched.status).toBe(200);
    expect((await patched.json()).status).toBe('paused');
    await PATCH(
      req(`/api/patients/${fx.p1}`, {
        method: 'PATCH',
        headers: H(),
        body: JSON.stringify({ status: 'active' }),
      }),
      params({ id: fx.p1 }),
    );
  });

  it('respondentes: POST cria com invite_url; PATCH altera; POST rotate troca o token', async () => {
    const { POST } = await import('../app/api/patients/[id]/respondents/route');
    const res = await POST(
      req(`/api/patients/${fx.p1}/respondents`, {
        method: 'POST',
        headers: H(),
        body: JSON.stringify({ kind: 'caregiver', name: 'Filho', relationship: 'filho' }),
      }),
      params({ id: fx.p1 }),
    );
    expect(res.status).toBe(201);
    const r = await res.json();
    expect(r.invite_url).toContain('/p/convite/');
    const { PATCH } = await import('../app/api/respondents/[id]/route');
    const up = await PATCH(
      req(`/api/respondents/${r.id}`, {
        method: 'PATCH',
        headers: H(),
        body: JSON.stringify({ receives_alarms: false }),
      }),
      params({ id: r.id }),
    );
    expect((await up.json()).receives_alarms).toBe(false);
    const { POST: ROTATE } = await import('../app/api/respondents/[id]/rotate/route');
    const rot = await ROTATE(
      req(`/api/respondents/${r.id}/rotate`, { method: 'POST', headers: H() }),
      params({ id: r.id }),
    );
    expect(rot.status).toBe(200);
    expect((await rot.json()).invite_url).not.toBe(r.invite_url);
  });
});

describe('medicações, doses, episódios, produtos', () => {
  it('POST medications + POST doses (com open_titration) → dose vigente na lista; validação 400', async () => {
    const { POST: ADDMED } = await import('../app/api/patients/[id]/medications/route');
    const created = await POST_helper();
    async function POST_helper() {
      const { POST } = await import('../app/api/patients/route');
      const r = await POST(
        req('/api/patients', {
          method: 'POST',
          headers: H(),
          body: JSON.stringify({
            name: 'Paciente Dose',
            respondents: [{ kind: 'patient', name: 'Paciente Dose' }],
          }),
        }),
        params({}),
      );
      return (await r.json()).patient as { id: string };
    }
    const med = await ADDMED(
      req(`/api/patients/${created.id}/medications`, {
        method: 'POST',
        headers: H(),
        body: JSON.stringify({ product_id: fx.productId }),
      }),
      params({ id: created.id }),
    );
    expect(med.status).toBe(201);
    const m = await med.json();
    const { POST: DOSE } = await import('../app/api/medications/[id]/doses/route');
    const bad = await DOSE(
      req(`/api/medications/${m.id}/doses`, {
        method: 'POST',
        headers: H(),
        body: JSON.stringify({ effective_from: '2026-08-16', dose_amount: -1 }),
      }),
      params({ id: m.id }),
    );
    expect(bad.status).toBe(400);
    const ok = await DOSE(
      req(`/api/medications/${m.id}/doses`, {
        method: 'POST',
        headers: H(),
        body: JSON.stringify({
          effective_from: '2026-08-01',
          dose_amount: 2,
          dose_unit: 'gotas',
          times_per_day: 2,
          schedule_times: ['08:00', '20:00'],
          reason: 'início',
          open_titration: true,
        }),
      }),
      params({ id: m.id }),
    );
    expect(ok.status).toBe(201);
    const { GET } = await import('../app/api/patients/[id]/route');
    const d = await (
      await GET(
        req(`/api/patients/${created.id}`, { headers: { cookie: fx.cookie } }),
        params({ id: created.id }),
      )
    ).json();
    expect(d.medications[0].current_dose).toMatchObject({ dose_amount: 2, dose_unit: 'gotas' });
    expect(d.episode).toMatchObject({ kind: 'titration', checkin_frequency: 'daily' });
    const { POST: EP } = await import('../app/api/patients/[id]/episodes/route');
    const ep = await EP(
      req(`/api/patients/${created.id}/episodes`, {
        method: 'POST',
        headers: H(),
        body: JSON.stringify({
          kind: 'maintenance',
          checkin_frequency: 'weekly',
          question_set_id: fx.setId,
        }),
      }),
      params({ id: created.id }),
    );
    expect(ep.status).toBe(201);
  });

  it('GET/POST /api/products', async () => {
    const { GET, POST } = await import('../app/api/products/route');
    expect(
      (
        await (
          await GET(req('/api/products', { headers: { cookie: fx.cookie } }), params({}))
        ).json()
      ).length,
    ).toBeGreaterThan(0);
    const c = await POST(
      req('/api/products', {
        method: 'POST',
        headers: H(),
        body: JSON.stringify({ name: 'Óleo API 30', cbd_mg_ml: 30, thc_mg_ml: 0.3, form: 'oil' }),
      }),
      params({}),
    );
    expect(c.status).toBe(201);
  });
});

describe('perguntas', () => {
  it('GET/POST /api/question-sets; PUT questions valida e salva na ordem', async () => {
    const { GET, POST } = await import('../app/api/question-sets/route');
    const list = await (
      await GET(req('/api/question-sets', { headers: { cookie: fx.cookie } }), params({}))
    ).json();
    expect(list[0].questions.length).toBe(7);
    const created = await POST(
      req('/api/question-sets', {
        method: 'POST',
        headers: H(),
        body: JSON.stringify({ name: 'Conjunto API' }),
      }),
      params({}),
    );
    expect(created.status).toBe(201);
    const set = await created.json();
    const { PUT } = await import('../app/api/question-sets/[id]/questions/route');
    const bad = await PUT(
      req(`/api/question-sets/${set.id}/questions`, {
        method: 'PUT',
        headers: H(),
        body: JSON.stringify([{ label: 'Curta', kind: 'text' }]),
      }),
      params({ id: set.id }),
    );
    expect(bad.status).toBe(400);
    const ok = await PUT(
      req(`/api/question-sets/${set.id}/questions`, {
        method: 'PUT',
        headers: H(),
        body: JSON.stringify([
          {
            label: 'Como está a dor hoje?',
            kind: 'scale_0_10',
            score_direction: 'lower_is_better',
          },
          { label: 'Observações livres', kind: 'text', required: false },
        ]),
      }),
      params({ id: set.id }),
    );
    expect(ok.status).toBe(200);
    expect((await ok.json()).map((q: { key: string }) => q.key)).toEqual([
      'como_esta_a_dor_hoje',
      'observacoes_livres',
    ]);
  });
});
