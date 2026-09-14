import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { freshDb, seedFixture, fakeNotifier } from './helpers/db.js';
import {
  requestPushTest,
  dispatchPushTests,
  pushTestStatus,
  confirmPushTest,
  markInstalled,
  setupStatus,
  PUSH_TEST_MAX_AGE_MIN,
} from '../src/onboarding/index.js';
import { getPatientDetail } from '../src/patients/index.js';
import { respondentToday } from '../src/respondent/index.js';
import { runCycle, resetCycleState } from '../src/scheduler/cycle.js';

/**
 * E9.3 — primeiro acesso guiado. O que o wizard mostra como ✓ precisa ter lastro no banco:
 * teste de aviso só "enviado" com envio real, só "confirmado" pela própria pessoa e só depois
 * de enviado. Nunca sucesso falso (regra 2).
 */
const NOW = new Date('2026-09-13T12:00:00Z');
const later = (min) => new Date(NOW.getTime() + min * 60_000);

describe('onboarding — teste de aviso e estado de configuração', () => {
  let db, fx, s1, s2c, doctor;

  beforeEach(async () => {
    if (db) await db.destroy();
    db = await freshDb();
    fx = await seedFixture(db);
    resetCycleState();
    s1 = {
      kind: 'respondent',
      respondentId: fx.r1.id,
      patientId: fx.p1.id,
      clinicId: fx.clinic.id,
    };
    s2c = {
      kind: 'respondent',
      respondentId: fx.r2c.id,
      patientId: fx.p2.id,
      clinicId: fx.clinic.id,
    };
    doctor = { kind: 'user', userId: fx.doctor.id, clinicId: fx.clinic.id, role: 'doctor' };
  });
  afterAll(async () => db?.destroy());

  async function subscribe(respondentId, endpoint = `https://push.example.test/${respondentId}`) {
    await db('push_subscriptions').insert({
      respondent_id: respondentId,
      endpoint,
      keys: JSON.stringify({ p256dh: 'x', auth: 'y' }),
    });
  }

  it('pedir teste sem inscrição ativa é recusado com motivo (não enfileira nada)', async () => {
    await expect(requestPushTest(db, s1, NOW)).rejects.toMatchObject({ code: 'no_subscription' });
    expect(await db('notifications').where({ kind: 'test' })).toHaveLength(0);
  });

  it('só a sessão do respondente pede teste', async () => {
    await expect(requestPushTest(db, doctor, NOW)).rejects.toMatchObject({
      code: 'unauthenticated',
    });
  });

  it('pedir teste enfileira UMA notificação "test" pendente; pedir de novo enquanto espera devolve a mesma', async () => {
    await subscribe(fx.r1.id);
    const a = await requestPushTest(db, s1, NOW);
    const b = await requestPushTest(db, s1, later(1));
    expect(b.notificationId).toBe(a.notificationId);
    const rows = await db('notifications').where({ kind: 'test' });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ respondent_id: fx.r1.id, patient_id: fx.p1.id, sent_at: null });
    expect(await pushTestStatus(db, s1, a.notificationId)).toMatchObject({ status: 'waiting' });
  });

  it('PROVA: envio falhou → status failed com motivo; confirmar é recusado; nada vira ✓', async () => {
    await subscribe(fx.r1.id);
    const { notificationId } = await requestPushTest(db, s1, NOW);
    const notifier = fakeNotifier();
    notifier.state.failNext = 1;
    const out = await dispatchPushTests(db, later(1), { notifier });
    expect(out).toMatchObject({ due: 1, sent: 0, failed: 1 });
    const st = await pushTestStatus(db, s1, notificationId);
    expect(st.status).toBe('failed');
    expect(st.error).toBeTruthy();
    await expect(
      confirmPushTest(db, s1, { notificationId, arrived: true }, later(2)),
    ).rejects.toMatchObject({ code: 'not_sent' });
    const r = await db('respondents').where({ id: fx.r1.id }).first();
    expect(r.push_test_confirmed_at).toBeNull();
  });

  it('falhou → pedir de novo cria um teste NOVO (não reaproveita o que falhou)', async () => {
    await subscribe(fx.r1.id);
    const a = await requestPushTest(db, s1, NOW);
    const notifier = fakeNotifier();
    notifier.state.failNext = 1;
    await dispatchPushTests(db, later(1), { notifier });
    const b = await requestPushTest(db, s1, later(2));
    expect(b.notificationId).not.toBe(a.notificationId);
    await dispatchPushTests(db, later(3), { notifier });
    expect(await pushTestStatus(db, s1, b.notificationId)).toMatchObject({ status: 'sent' });
  });

  it('enviado → "chegou: sim" grava a confirmação; "não" não grava; outro respondente não enxerga', async () => {
    await subscribe(fx.r1.id);
    await subscribe(fx.r2c.id);
    const { notificationId } = await requestPushTest(db, s1, NOW);
    const notifier = fakeNotifier();
    expect(await dispatchPushTests(db, later(1), { notifier })).toMatchObject({ sent: 1 });
    expect(notifier.sent[0].kind).toBe('test');
    const payload = notifier.sent[0].payload;
    expect((typeof payload === 'string' ? JSON.parse(payload) : payload).title).toMatch(/Teste/);
    expect(notifier.sent[0].attempts).toBe(1);
    expect(await pushTestStatus(db, s1, notificationId)).toMatchObject({ status: 'sent' });

    await expect(pushTestStatus(db, s2c, notificationId)).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(
      confirmPushTest(db, s2c, { notificationId, arrived: true }, later(2)),
    ).rejects.toMatchObject({ code: 'not_found' });

    expect(await confirmPushTest(db, s1, { notificationId, arrived: false }, later(2))).toEqual({
      confirmed: false,
    });
    expect((await db('respondents').where({ id: fx.r1.id }).first()).push_test_confirmed_at).toBe(
      null,
    );
    expect(await confirmPushTest(db, s1, { notificationId, arrived: true }, later(3))).toEqual({
      confirmed: true,
    });
    const r = await db('respondents').where({ id: fx.r1.id }).first();
    expect(new Date(r.push_test_confirmed_at).toISOString()).toBe(later(3).toISOString());
  });

  it(`teste parado há mais de ${PUSH_TEST_MAX_AGE_MIN} min não é enviado atrasado: vira failed "expirou"`, async () => {
    await subscribe(fx.r1.id);
    const { notificationId } = await requestPushTest(db, s1, NOW);
    const notifier = fakeNotifier();
    const out = await dispatchPushTests(db, later(PUSH_TEST_MAX_AGE_MIN + 1), { notifier });
    expect(out).toMatchObject({ sent: 0, expired: 1 });
    expect(notifier.sent).toHaveLength(0);
    expect(await pushTestStatus(db, s1, notificationId)).toMatchObject({
      status: 'failed',
      error: expect.stringMatching(/expirou/),
    });
  });

  it('runCycle envia os testes pendentes e conta no resumo', async () => {
    await subscribe(fx.r1.id);
    await requestPushTest(db, s1, NOW);
    const notifier = fakeNotifier();
    const summary = await runCycle(db, later(1), { notifier, force: true });
    expect(summary.push_tests).toMatchObject({ sent: 1 });
  });

  it('markInstalled grava a primeira data e não sobrescreve', async () => {
    await markInstalled(db, s1, NOW);
    await markInstalled(db, s1, later(10));
    const r = await db('respondents').where({ id: fx.r1.id }).first();
    expect(new Date(r.install_confirmed_at).toISOString()).toBe(NOW.toISOString());
  });

  it('setupStatus deriva cada passo do banco; sem celular próprio = não responde nem recebe alarme', () => {
    const base = {
      accepted_at: null,
      install_confirmed_at: null,
      push_test_confirmed_at: null,
      can_answer: true,
      receives_alarms: true,
    };
    expect(setupStatus(base, 0)).toEqual({
      device: 'own',
      accepted: false,
      installed: false,
      push_active: false,
      test_confirmed: false,
      complete: false,
    });
    expect(
      setupStatus(
        { ...base, accepted_at: NOW, install_confirmed_at: NOW, push_test_confirmed_at: NOW },
        1,
      ),
    ).toMatchObject({ complete: true, push_active: true });
    // confirmou um teste antigo, mas a inscrição foi revogada → não está completo hoje
    expect(
      setupStatus({ ...base, accepted_at: NOW, push_test_confirmed_at: NOW }, 0),
    ).toMatchObject({ push_active: false, complete: false });
    expect(setupStatus({ ...base, can_answer: false, receives_alarms: false }, 0)).toMatchObject({
      device: 'shared',
      complete: false,
    });
  });

  it('página do paciente traz setup por respondente; tela Hoje traz o que falta configurar', async () => {
    await subscribe(fx.r1.id);
    const { notificationId } = await requestPushTest(db, s1, NOW);
    await dispatchPushTests(db, later(1), { notifier: fakeNotifier() });
    await confirmPushTest(db, s1, { notificationId, arrived: true }, later(2));
    await markInstalled(db, s1, later(2));
    await db('respondents').where({ id: fx.r1.id }).update({ accepted_at: NOW });

    const detail = await getPatientDetail(db, doctor, fx.p1.id, { now: later(3) });
    const r1 = detail.respondents.find((r) => r.id === fx.r1.id);
    expect(r1.setup).toMatchObject({ accepted: true, installed: true, test_confirmed: true });

    const today = await respondentToday(db, s1, later(3));
    expect(today.setup).toMatchObject({ push_active: true, test_confirmed: true, complete: true });
    const today2 = await respondentToday(db, s2c, later(3));
    expect(today2.setup.test_confirmed).toBe(false);
  });
});
