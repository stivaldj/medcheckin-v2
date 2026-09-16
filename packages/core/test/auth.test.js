import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { DateTime } from 'luxon';
import { freshDb, seedFixture } from './helpers/db.js';
import { newToken, hashToken } from '../src/auth/tokens.js';
import { requestMagicLink, verifyMagicLink } from '../src/auth/magic-link.js';
import { acceptInvite, rotateInviteToken } from '../src/auth/invite.js';
import { getSession, revokeSession } from '../src/auth/session.js';
import { requirePatientInClinic, logAccess } from '../src/auth/access.js';
import { fakeMailer } from '../src/auth/mailer.js';
import { catalogNameKey } from '../src/catalog/nameKey.js';

// P2-6 — data dinâmica: o seed cria respostas e doses relativas a HOJE. Com data fixa, a
// distância entre as duas cresce a cada dia e regras que olham "os últimos N dias" passam a
// varrer o vazio — o teste segue verde sem exercitar nada. Já mordeu este repo em 25/08.
const NOW = new Date();
const plus = (min) => DateTime.fromJSDate(NOW).plus({ minutes: min }).toJSDate();
const BASE = 'https://app.example.test';
const tokenFromMail = (mail) => mail.text.match(/token=([A-Za-z0-9_-]+)/)[1];

describe('auth/tokens', () => {
  it('newToken é aleatório e URL-safe; hashToken é determinístico e não reversível', () => {
    const a = newToken();
    const b = newToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(hashToken(a)).toBe(hashToken(a));
    expect(hashToken(a)).not.toBe(a);
    expect(hashToken(a)).toHaveLength(64);
  });
});

describe('auth — link mágico (médica)', () => {
  let db, fx, mailer;
  beforeAll(async () => {
    db = await freshDb();
    fx = await seedFixture(db);
  });
  afterAll(async () => db.destroy());
  beforeEach(async () => {
    await db('sessions').del();
    await db('auth_tokens').del();
    mailer = fakeMailer();
  });

  it('e-mail existente → cria token (só hash no banco) e envia link; resposta é neutra', async () => {
    const r = await requestMagicLink(
      db,
      { email: 'medica@medcheckin.test', baseUrl: BASE, mailer },
      NOW,
    );
    expect(r).toEqual({ ok: true });
    expect(mailer.sent).toHaveLength(1);
    const mail = mailer.sent[0];
    expect(mail.to).toBe('medica@medcheckin.test');
    const token = tokenFromMail(mail);
    const row = await db('auth_tokens').first();
    expect(row.token_hash).toBe(hashToken(token));
    expect(mail.text).not.toContain(row.token_hash);
    expect(row.user_id).toBe(fx.doctor.id);
  });

  it('e-mail inexistente → mesma resposta, nenhum e-mail, nenhum token (sem enumeração)', async () => {
    const r = await requestMagicLink(
      db,
      { email: 'ninguem@medcheckin.test', baseUrl: BASE, mailer },
      NOW,
    );
    expect(r).toEqual({ ok: true });
    expect(mailer.sent).toHaveLength(0);
    expect(await db('auth_tokens').count().first()).toMatchObject({ count: 0 });
  });

  it('e-mail é normalizado (case/espaços)', async () => {
    await requestMagicLink(db, { email: '  Medica@MedCheckin.test ', baseUrl: BASE, mailer }, NOW);
    expect(mailer.sent).toHaveLength(1);
  });

  it('throttle: mais de 3 pedidos em 15 min não envia', async () => {
    for (let i = 0; i < 4; i += 1) {
      await requestMagicLink(
        db,
        { email: 'medica@medcheckin.test', baseUrl: BASE, mailer },
        plus(i),
      );
    }
    expect(mailer.sent).toHaveLength(3);
  });

  it('verify: token válido → sessão (30 d), token marcado usado; reuso falha; token inválido/expirado falha', async () => {
    await requestMagicLink(db, { email: 'medica@medcheckin.test', baseUrl: BASE, mailer }, NOW);
    const token = tokenFromMail(mailer.sent[0]);
    const { sessionToken, session } = await verifyMagicLink(db, { token, ua: 'vitest' }, plus(1));
    expect(sessionToken).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(session).toMatchObject({
      kind: 'user',
      userId: fx.doctor.id,
      clinicId: fx.clinic.id,
      role: 'doctor',
    });
    const s = await db('sessions').first();
    expect(s.token_hash).toBe(hashToken(sessionToken));
    expect(
      DateTime.fromJSDate(s.expires_at).diff(DateTime.fromJSDate(plus(1)), 'days').days,
    ).toBeCloseTo(30, 0);
    await expect(verifyMagicLink(db, { token }, plus(2))).rejects.toMatchObject({
      code: 'invalid_token',
    });
    await expect(verifyMagicLink(db, { token: 'nope' }, plus(2))).rejects.toMatchObject({
      code: 'invalid_token',
    });
    // expirado (16 min)
    mailer.sent.length = 0;
    await requestMagicLink(
      db,
      { email: 'medica@medcheckin.test', baseUrl: BASE, mailer },
      plus(30),
    );
    const t2 = tokenFromMail(mailer.sent[0]);
    await expect(verifyMagicLink(db, { token: t2 }, plus(30 + 16))).rejects.toMatchObject({
      code: 'invalid_token',
    });
  });
});

describe('auth — convite do respondente (D12) e sessões', () => {
  let db, fx;
  beforeAll(async () => {
    db = await freshDb();
    fx = await seedFixture(db);
    await db('respondents')
      .where({ id: fx.r2c.id })
      .update({ accepted_at: null, consent_version: null, consent_at: null });
  });
  afterAll(async () => db.destroy());

  it('aceite sem consentimento falha; com consentimento grava accepted_at/consent e cria sessão (180 d)', async () => {
    await expect(acceptInvite(db, { inviteToken: 'seed-c2', ua: 'x' }, NOW)).rejects.toMatchObject({
      code: 'consent_required',
    });
    const { sessionToken, session } = await acceptInvite(
      db,
      { inviteToken: 'seed-c2', consentVersion: 'v1', ua: 'x' },
      NOW,
    );
    expect(session).toMatchObject({
      kind: 'respondent',
      respondentId: fx.r2c.id,
      patientId: fx.p2.id,
      clinicId: fx.clinic.id,
    });
    const r = await db('respondents').where({ id: fx.r2c.id }).first();
    expect(r.accepted_at).not.toBeNull();
    expect(r.consent_version).toBe('v1');
    const s = await getSession(db, sessionToken, plus(1));
    expect(s.kind).toBe('respondent');
    const row = await db('sessions').where({ respondent_id: fx.r2c.id }).first();
    expect(
      DateTime.fromJSDate(row.expires_at).diff(DateTime.fromJSDate(NOW), 'days').days,
    ).toBeCloseTo(180, 0);
  });

  it('reuso do link cria nova sessão sem sobrescrever o consentimento; token desconhecido falha', async () => {
    const before = await db('respondents').where({ id: fx.r2c.id }).first();
    const again = await acceptInvite(
      db,
      { inviteToken: 'seed-c2', consentVersion: 'v2', ua: 'y' },
      plus(5),
    );
    expect(again.session.respondentId).toBe(fx.r2c.id);
    const after = await db('respondents').where({ id: fx.r2c.id }).first();
    expect(after.consent_version).toBe(before.consent_version);
    expect(new Date(after.accepted_at).getTime()).toBe(new Date(before.accepted_at).getTime());
    expect(await db('sessions').where({ respondent_id: fx.r2c.id }).count().first()).toMatchObject({
      count: 2,
    });
    await expect(
      acceptInvite(db, { inviteToken: 'nope', consentVersion: 'v1' }, NOW),
    ).rejects.toMatchObject({ code: 'invalid_token' });
  });

  it('rotateInviteToken invalida o link antigo', async () => {
    const t = await rotateInviteToken(db, fx.r2c.id);
    expect(t).not.toBe('seed-c2');
    await expect(
      acceptInvite(db, { inviteToken: 'seed-c2', consentVersion: 'v1' }, NOW),
    ).rejects.toMatchObject({ code: 'invalid_token' });
    const ok = await acceptInvite(db, { inviteToken: t, consentVersion: 'v1' }, NOW);
    expect(ok.session.respondentId).toBe(fx.r2c.id);
  });

  it('getSession: inexistente/expirada/revogada → null; last_seen_at atualizado', async () => {
    expect(await getSession(db, 'nope', NOW)).toBeNull();
    const { sessionToken } = await acceptInvite(
      db,
      { inviteToken: await rotateInviteToken(db, fx.r2c.id), consentVersion: 'v1' },
      NOW,
    );
    expect(await getSession(db, sessionToken, plus(10))).not.toBeNull();
    const row = await db('sessions')
      .where({ token_hash: hashToken(sessionToken) })
      .first();
    expect(new Date(row.last_seen_at).getTime()).toBe(plus(10).getTime());
    expect(
      await getSession(db, sessionToken, DateTime.fromJSDate(NOW).plus({ days: 181 }).toJSDate()),
    ).toBeNull();
    await revokeSession(db, sessionToken, plus(11));
    expect(await getSession(db, sessionToken, plus(12))).toBeNull();
  });
});

describe('auth — tenancy e audit', () => {
  let db, fx, other, doctorSession, caregiverSession;
  beforeAll(async () => {
    db = await freshDb();
    fx = await seedFixture(db);
    const [c] = await db('clinics').insert({ name: 'Outra Clínica' }).returning('id');
    const [u] = await db('users')
      .insert({
        clinic_id: c.id,
        role: 'doctor',
        email: 'outra@medcheckin.test',
        name: 'Dra. Outra',
      })
      .returning('id');
    const [p] = await db('patients')
      .insert({
        clinic_id: c.id,
        name: 'Paciente de Outra Clínica',
        name_key: catalogNameKey('Paciente de Outra Clínica'),
        timezone: 'America/Cuiaba',
        created_by: u.id,
      })
      .returning('id');
    other = { clinicId: c.id, userId: u.id, patientId: p.id };
    const mailer = fakeMailer();
    await requestMagicLink(db, { email: 'medica@medcheckin.test', baseUrl: BASE, mailer }, NOW);
    doctorSession = (await verifyMagicLink(db, { token: tokenFromMail(mailer.sent[0]) }, NOW))
      .session;
    caregiverSession = (
      await acceptInvite(db, { inviteToken: 'seed-c2', consentVersion: 'v1' }, NOW)
    ).session;
  });
  afterAll(async () => db.destroy());

  it('médica acessa paciente da própria clínica; paciente de outra clínica → not_found (nunca forbidden)', async () => {
    const p = await requirePatientInClinic(db, doctorSession, fx.p1.id);
    expect(p.id).toBe(fx.p1.id);
    await expect(requirePatientInClinic(db, doctorSession, other.patientId)).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(
      requirePatientInClinic(db, doctorSession, '00000000-0000-0000-0000-000000000000'),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('respondente só acessa o próprio paciente', async () => {
    const p = await requirePatientInClinic(db, caregiverSession, fx.p2.id);
    expect(p.id).toBe(fx.p2.id);
    await expect(requirePatientInClinic(db, caregiverSession, fx.p1.id)).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('sem sessão → unauthenticated', async () => {
    await expect(requirePatientInClinic(db, null, fx.p1.id)).rejects.toMatchObject({
      code: 'unauthenticated',
    });
  });

  it('logAccess grava linha em access_audit com clinic/user/respondent/patient/route/action', async () => {
    await logAccess(
      db,
      { session: doctorSession, patientId: fx.p1.id, route: '/api/patients/:id', action: 'view' },
      NOW,
    );
    await logAccess(
      db,
      { session: caregiverSession, patientId: fx.p2.id, route: '/api/p/today', action: 'view' },
      NOW,
    );
    const rows = await db('access_audit').orderBy('at');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      clinic_id: fx.clinic.id,
      user_id: fx.doctor.id,
      respondent_id: null,
      patient_id: fx.p1.id,
      route: '/api/patients/:id',
      action: 'view',
    });
    expect(rows[1]).toMatchObject({
      clinic_id: fx.clinic.id,
      user_id: null,
      respondent_id: fx.r2c.id,
      patient_id: fx.p2.id,
    });
  });
});
