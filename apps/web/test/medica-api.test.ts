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
    const created = await c.json();
    const again = await POST(
      req('/api/products', {
        method: 'POST',
        headers: H(),
        body: JSON.stringify({ name: 'Óleo API 30', cbd_mg_ml: 30, thc_mg_ml: 0.3, form: 'oil' }),
      }),
      params({}),
    );
    expect(again.status).toBe(200);
    expect((await again.json()).id).toBe(created.id);
  });
});

describe('perguntas', () => {
  it('GET/POST /api/question-sets; PUT questions valida e salva na ordem', async () => {
    const { GET, POST } = await import('../app/api/question-sets/route');
    const list = await (
      await GET(req('/api/question-sets', { headers: { cookie: fx.cookie } }), params({}))
    ).json();
    expect(list[0].questions.length).toBe(8); // +adesao (E9.1)
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

describe('rotina de alarmes (E9.1)', () => {
  // "Hoje" é o dia no fuso do PACIENTE — é o que o core usa (endRoutinePeriodToday, alarmes).
  // Calcular em UTC fazia este describe falhar toda noite a partir das 20h em Cuiabá, quando o UTC
  // já virou o dia: o app gravava 13/09 (certo) e o teste esperava 14/09.
  let tz = 'UTC';
  beforeAll(async () => {
    tz = (await db('patients').where({ id: fx.p1 }).first()).timezone;
  });
  const day = (n: number) => {
    const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date()); // YYYY-MM-DD
    const d = new Date(`${hoje}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  let created: { id: string };

  it('POST /api/patients/[id]/routine-periods cria; sobreposição → 400 validation; sem alarme → 400', async () => {
    const { POST } = await import('../app/api/patients/[id]/routine-periods/route');
    // o seed já dá a P1 um período vigente: pedir as mesmas datas tem de bater na constraint
    const overlap = await POST(
      req(`/api/patients/${fx.p1}/routine-periods`, {
        method: 'POST',
        headers: H(),
        body: JSON.stringify({
          starts_on: day(0),
          ends_on: day(1),
          alarms: [{ time: '08:00', description: 'x' }],
        }),
      }),
      params({ id: fx.p1 }),
    );
    expect(overlap.status).toBe(400);
    expect((await overlap.json()).error).toBe('validation');

    const empty = await POST(
      req(`/api/patients/${fx.p1}/routine-periods`, {
        method: 'POST',
        headers: H(),
        body: JSON.stringify({ starts_on: day(30), alarms: [] }),
      }),
      params({ id: fx.p1 }),
    );
    expect(empty.status).toBe(400);

    const ok = await POST(
      req(`/api/patients/${fx.p1}/routine-periods`, {
        method: 'POST',
        headers: H(),
        body: JSON.stringify({
          starts_on: day(30),
          ends_on: day(34),
          alarms: [
            { time: '20:00', description: '4 gts óleo' },
            { time: '08:00', description: 'ômega 3 1cp' },
          ],
        }),
      }),
      params({ id: fx.p1 }),
    );
    expect(ok.status).toBe(201);
    created = await ok.json();
    expect(created).toMatchObject({ starts_on: day(30), ends_on: day(34) });
    expect(
      (created as unknown as { alarms: { time: string }[] }).alarms.map((a) => a.time),
    ).toEqual(['08:00', '20:00']);
  });

  it('PATCH /api/routine-periods/[id] edita horários e textos; POST end-today encerra o vigente', async () => {
    const { PATCH } = await import('../app/api/routine-periods/[id]/route');
    const res = await PATCH(
      req(`/api/routine-periods/${created.id}`, {
        method: 'PATCH',
        headers: H(),
        body: JSON.stringify({
          starts_on: day(31),
          ends_on: day(34),
          alarms: [{ time: '09:00', description: 'texto editado' }],
        }),
      }),
      params({ id: created.id }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.starts_on).toBe(day(31));
    expect(body.alarms).toMatchObject([{ time: '09:00', description: 'texto editado' }]);

    const current = await db('routine_periods')
      .where({ patient_id: fx.p1 })
      .andWhere('starts_on', '<=', day(0))
      .first();
    const { POST } = await import('../app/api/routine-periods/[id]/end-today/route');
    const ended = await POST(
      req(`/api/routine-periods/${current.id}/end-today`, { method: 'POST', headers: H() }),
      params({ id: current.id }),
    );
    expect(ended.status).toBe(200);
    expect((await ended.json()).ends_on).toBe(day(0));
  });
});

describe('questionário por paciente (E9.2)', () => {
  let extraId: string;

  it('POST /api/patients/[id]/questions cria a extra; label curto → 400; chave repetida → 400', async () => {
    const { POST, GET } = await import('../app/api/patients/[id]/questions/route');
    const short = await POST(
      req(`/api/patients/${fx.p1}/questions`, {
        method: 'POST',
        headers: H(),
        body: JSON.stringify({ label: 'curta' }),
      }),
      params({ id: fx.p1 }),
    );
    expect(short.status).toBe(400);

    const ok = await POST(
      req(`/api/patients/${fx.p1}/questions`, {
        method: 'POST',
        headers: H(),
        body: JSON.stringify({ label: 'Teve espasmos hoje?', kind: 'yes_no' }),
      }),
      params({ id: fx.p1 }),
    );
    expect(ok.status).toBe(201);
    const created = await ok.json();
    expect(created).toMatchObject({ key: 'teve_espasmos_hoje', kind: 'yes_no', active: true });
    extraId = created.id;

    const dup = await POST(
      req(`/api/patients/${fx.p1}/questions`, {
        method: 'POST',
        headers: H(),
        body: JSON.stringify({ label: 'Teve espasmos hoje?' }),
      }),
      params({ id: fx.p1 }),
    );
    expect(dup.status).toBe(400);
    expect((await dup.json()).error).toBe('validation');

    const list = await GET(
      req(`/api/patients/${fx.p1}/questions`, { headers: { cookie: fx.cookie } }),
      params({ id: fx.p1 }),
    );
    expect((await list.json()).map((q: { key: string }) => q.key)).toEqual(['teve_espasmos_hoje']);
  });

  it('PATCH /api/questions/[id] renomeia mantendo a chave e desativa; pergunta do pack → 404', async () => {
    const { PATCH } = await import('../app/api/questions/[id]/route');
    const renamed = await PATCH(
      req(`/api/questions/${extraId}`, {
        method: 'PATCH',
        headers: H(),
        body: JSON.stringify({ label: 'Teve espasmos ou tremores hoje?' }),
      }),
      params({ id: extraId }),
    );
    expect(renamed.status).toBe(200);
    expect(await renamed.json()).toMatchObject({
      key: 'teve_espasmos_hoje',
      label: 'Teve espasmos ou tremores hoje?',
    });

    const off = await PATCH(
      req(`/api/questions/${extraId}`, {
        method: 'PATCH',
        headers: H(),
        body: JSON.stringify({ active: false }),
      }),
      params({ id: extraId }),
    );
    expect((await off.json()).active).toBe(false);

    const packQuestion = await db('questions').where({ question_set_id: fx.setId }).first();
    const nope = await PATCH(
      req(`/api/questions/${packQuestion.id}`, {
        method: 'PATCH',
        headers: H(),
        body: JSON.stringify({ active: false }),
      }),
      params({ id: packQuestion.id }),
    );
    expect(nope.status).toBe(404);
  });

  it('PATCH /api/patients/[id] recusa horário de check-in dentro do silêncio', async () => {
    const { PATCH } = await import('../app/api/patients/[id]/route');
    const bad = await PATCH(
      req(`/api/patients/${fx.p1}`, {
        method: 'PATCH',
        headers: H(),
        body: JSON.stringify({ checkin_time: '23:00' }),
      }),
      params({ id: fx.p1 }),
    );
    expect(bad.status).toBe(400);
    expect((await bad.json()).field).toBe('checkin_time');
    const ok = await PATCH(
      req(`/api/patients/${fx.p1}`, {
        method: 'PATCH',
        headers: H(),
        body: JSON.stringify({ checkin_time: '20:00' }),
      }),
      params({ id: fx.p1 }),
    );
    expect(ok.status).toBe(200);
    expect(String((await ok.json()).checkin_time).slice(0, 5)).toBe('20:00');
  });
});

describe('notas clínicas e linha do tempo (D35)', () => {
  it('POST cria nota; GET timeline traz hoje; DELETE oculta e some da timeline', async () => {
    const { POST } = await import('../app/api/patients/[id]/notes/route');
    const created = await POST(
      req(`/api/patients/${fx.p1}/notes`, {
        method: 'POST',
        headers: H(),
        body: JSON.stringify({ body: 'Paciente relata melhora do sono.' }),
      }),
      params({ id: fx.p1 }),
    );
    expect(created.status).toBe(201);
    const note = await created.json();
    expect(note.kind).toBe('consulta');

    const { GET: TIMELINE } = await import('../app/api/patients/[id]/timeline/route');
    const tl = await TIMELINE(
      req(`/api/patients/${fx.p1}/timeline`, { headers: { cookie: fx.cookie } }),
      params({ id: fx.p1 }),
    );
    expect(tl.status).toBe(200);
    const timeline = await tl.json();
    const today = timeline.find((d: { day: string }) => d.day === note.occurred_at.slice(0, 10));
    expect(today.notes.map((n: { id: string }) => n.id)).toContain(note.id);

    const { DELETE } = await import('../app/api/patients/[id]/notes/[noteId]/route');
    const del = await DELETE(
      req(`/api/patients/${fx.p1}/notes/${note.id}`, { method: 'DELETE', headers: H() }),
      params({ id: fx.p1, noteId: note.id }),
    );
    expect(del.status).toBe(204);

    const tl2 = await TIMELINE(
      req(`/api/patients/${fx.p1}/timeline`, { headers: { cookie: fx.cookie } }),
      params({ id: fx.p1 }),
    );
    const timeline2 = await tl2.json();
    const today2 = timeline2.find((d: { day: string }) => d.day === note.occurred_at.slice(0, 10));
    const ids2 = today2 ? today2.notes.map((n: { id: string }) => n.id) : [];
    expect(ids2).not.toContain(note.id);
  });
});

describe('condições em catálogo (D36)', () => {
  it('POST vincula condição; GET /api/conditions conta paciente; filtro da lista; merge funde', async () => {
    const { POST } = await import('../app/api/patients/[id]/conditions/route');
    const added = await POST(
      req(`/api/patients/${fx.p1}/conditions`, {
        method: 'POST',
        headers: H(),
        body: JSON.stringify({ name: 'Enxaqueca Crônica Teste' }),
      }),
      params({ id: fx.p1 }),
    );
    expect(added.status).toBe(201);
    const condition = await added.json();

    const { GET: LISTCOND } = await import('../app/api/conditions/route');
    const list = await LISTCOND(
      req('/api/conditions', { headers: { cookie: fx.cookie } }),
      params({}),
    );
    expect(list.status).toBe(200);
    const catalog = await list.json();
    expect(catalog.find((c: { id: string }) => c.id === condition.id).patients).toBe(1);

    const { GET: LISTPATIENTS } = await import('../app/api/patients/route');
    const filtered = await LISTPATIENTS(
      req(`/api/patients?condition=${condition.id}`, { headers: { cookie: fx.cookie } }),
      params({}),
    );
    expect(filtered.status).toBe(200);
    const filteredRows = await filtered.json();
    expect(filteredRows).toHaveLength(1);
    expect(filteredRows[0].id).toBe(fx.p1);

    const secondAdded = await POST(
      req(`/api/patients/${fx.p1}/conditions`, {
        method: 'POST',
        headers: H(),
        body: JSON.stringify({ name: 'Convulsão Focal Teste' }),
      }),
      params({ id: fx.p1 }),
    );
    const second = await secondAdded.json();

    const { POST: MERGE } = await import('../app/api/conditions/merge/route');
    const merged = await MERGE(
      req('/api/conditions/merge', {
        method: 'POST',
        headers: H(),
        body: JSON.stringify({ from_id: second.id, into_id: condition.id }),
      }),
      params({}),
    );
    expect(merged.status).toBe(200);

    const listAfter = await LISTCOND(
      req('/api/conditions', { headers: { cookie: fx.cookie } }),
      params({}),
    );
    const catalogAfter = await listAfter.json();
    expect(catalogAfter.find((c: { id: string }) => c.id === second.id)).toBeUndefined();
    expect(catalogAfter.find((c: { id: string }) => c.id === condition.id).patients).toBe(1);
  });
});
