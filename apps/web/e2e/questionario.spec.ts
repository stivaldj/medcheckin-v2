import { test, expect } from '@playwright/test';
import { DateTime } from 'luxon';
import {
  createDb,
  planCheckins,
  dispatchDueCheckins,
  answerFromRespondent,
} from '@medcheckin/core';
import type { Session } from '@medcheckin/core';
import type { Knex } from 'knex';
import { abrirCaso, abrirConfiguracao, escolher, loginAsDoctor } from './helpers';

/**
 * PROVA E9.2 — questionário configurável na página do paciente:
 * horário do disparo por paciente (recusando a janela de silêncio) + pergunta extra em texto livre
 * que entra no PRÓXIMO check-in, é respondida e aparece na grade.
 */
const TZ = 'America/Cuiaba';
const TODAY = DateTime.now().setZone(TZ).startOf('day');
const AT = (hm: string) => {
  const [h, m] = hm.split(':').map(Number);
  return TODAY.set({ hour: h, minute: m }).toJSDate();
};
const fakeNotifier = {
  async send() {
    return { ok: true };
  },
};

test.describe('questionário por paciente', () => {
  let db: Knex;
  let ids: { p1: string; r1: string; clinicId: string };

  test.beforeAll(async () => {
    db = createDb(process.env.DATABASE_URL_TEST || process.env.DATABASE_URL!);
    const p1 = await db('patients').where({ name: 'Paciente Sintético Um' }).first();
    const r1 = await db('respondents').where({ patient_id: p1.id, kind: 'patient' }).first();
    ids = { p1: p1.id, r1: r1.id, clinicId: p1.clinic_id };
    await db('answers').del();
    await db('checkins').del();
  });
  test.afterAll(async () => db.destroy());

  test('horário por paciente + pergunta extra → próximo check-in a inclui → resposta na grade', async ({
    page,
    context,
    baseURL,
  }) => {
    await loginAsDoctor(context, baseURL!);
    await page.goto(`/pacientes/${ids.p1}`);
    await abrirConfiguracao(page);
    const card = page.getByTestId('questionnaire-card');

    // 1. horário do disparo: dentro do silêncio (21:00–08:00) é recusado com motivo
    await card.getByTestId('checkin-time').getByRole('textbox').fill('23:00');
    await card.getByTestId('checkin-time').getByRole('textbox').blur();
    await expect(card.getByTestId('checkin-time-error')).toContainText('silêncio');

    // 2. preset da noite (20:00) vale
    await card.getByTestId('checkin-time-20:00').click();
    await expect(page.getByTestId('patient-name')).toBeVisible();
    await expect(page.locator('body')).toContainText('check-in às 20:00');

    // 3. pergunta extra em texto livre
    await expect(card).toContainText('Nenhuma. O paciente responde só o pack do episódio.');
    await card.getByTestId('patient-question-label').fill('Teve espasmos hoje?');
    await escolher(page, 'patient-question-kind', 'sim / não');
    await card.getByTestId('add-patient-question').click();
    await expect(card.getByTestId('patient-question-teve_espasmos_hoje')).toContainText(
      'Teve espasmos hoje?',
    );

    // 4. o PRÓXIMO check-in (hoje, 20:00 — depois da pergunta ter sido criada) inclui a extra
    await planCheckins(db, AT('06:00'));
    await dispatchDueCheckins(db, AT('20:01'), { notifier: fakeNotifier });
    const ck = await db('checkins')
      .where({ patient_id: ids.p1 })
      .orderBy('scheduled_for', 'desc')
      .first();
    expect(DateTime.fromJSDate(new Date(ck.scheduled_for)).setZone(TZ).toFormat('HH:mm')).toBe(
      '20:00',
    );
    const s1 = {
      kind: 'respondent',
      sessionId: 'e2e',
      respondentId: ids.r1,
      respondentKind: 'patient',
      patientId: ids.p1,
      clinicId: ids.clinicId,
      name: 'P1',
      canAnswer: true,
      receivesAlarms: true,
    } as Session;
    for (const [k, v] of [
      ['adesao', 1],
      ['dor', 4],
      ['sono', 6],
      ['humor', 6],
      ['crises', 0],
      ['efeito_adverso', 0],
      ['obs', null],
    ] as const) {
      await answerFromRespondent(
        db,
        s1,
        { checkinId: ck.id, questionKey: k, value: v },
        AT('20:10'),
      );
    }
    const done = await answerFromRespondent(
      db,
      s1,
      { checkinId: ck.id, questionKey: 'teve_espasmos_hoje', value: 1 },
      AT('20:12'),
    );
    expect(done.completed).toBe(true); // o pack sozinho não fechava: a extra faltava

    // 5. a resposta aparece na grade da médica (a grade mostra o RÓTULO, não a chave)
    await page.reload();
    const grid = page.getByTestId('grid-card');
    await expect(grid).toContainText('Teve espasmos hoje?');
    await expect(grid.locator('tr', { hasText: 'Teve espasmos hoje?' })).toContainText('sim');

    // 6. desativar tira a pergunta dos próximos check-ins, sem apagar o que já foi respondido
    //    (o reload acima voltou para a aba padrão "O caso")
    await abrirConfiguracao(page);
    await card.getByTestId('toggle-teve_espasmos_hoje').click();
    await expect(card.getByTestId('patient-question-teve_espasmos_hoje')).toContainText(
      'desativada',
    );
    await abrirCaso(page);
    await expect(grid).toContainText('Teve espasmos hoje?'); // a série continua na grade
    await page.screenshot({ path: 'test-results/questionario-paciente.png', fullPage: true });
  });
});
