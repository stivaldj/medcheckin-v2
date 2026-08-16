import { test, expect } from '@playwright/test';
import { DateTime } from 'luxon';
import {
  createDb,
  runCycle,
  answerFromRespondent,
  resetCycleState,
  type Session,
} from '@medcheckin/core';
import type { Knex } from 'knex';
import { loginAsDoctor } from './helpers';

/**
 * PROVA E6 — loop fechado com CLOCK FALSO (48 h): o teste chama o core com `now` explícito
 * (T-1d e T0), o notifier é fake (Web Push real não roda em headless), e a UI da médica fecha o loop:
 * ajuste de dose → 2º check-in → efeito adverso → alerta em /hoje → conduta → gráfico com marcador.
 */
const TZ = 'America/Cuiaba';
const TODAY = DateTime.now().setZone(TZ).startOf('day');
const AT = (dayOffset: number, hm: string) => {
  const [h, m] = hm.split(':').map(Number);
  return TODAY.plus({ days: dayOffset }).set({ hour: h, minute: m }).toJSDate();
};
const fakeNotifier = {
  async send() {
    return { ok: true };
  },
};

test.describe('loop fechado (48 h simuladas)', () => {
  let db: Knex;
  let ids: { p1: string; r1: string; p2: string; clinicId: string; ep1: string };

  test.beforeAll(async () => {
    db = createDb(process.env.DATABASE_URL_TEST || process.env.DATABASE_URL!);
    resetCycleState();
    const p1 = await db('patients').where({ name: 'Paciente Sintético Um' }).first();
    const p2 = await db('patients').where({ name: 'Paciente Sintético Dois' }).first();
    const r1 = await db('respondents').where({ patient_id: p1.id, kind: 'patient' }).first();
    const ep1 = await db('episodes').where({ patient_id: p1.id }).whereNull('ended_at').first();
    ids = { p1: p1.id, r1: r1.id, p2: p2.id, clinicId: p1.clinic_id, ep1: ep1.id };
    // limpar estado de testes anteriores neste banco
    await db('alert_actions').del();
    await db('alerts').del();
    await db('answers').del();
    await db('notifications').del();
    await db('checkins').del();
    await db('patient_scores_daily').del();
    await db('system_state').del();
    // P2: check-in de hoje que ninguém responderá ("Não respondeu")
    const ep2 = await db('episodes').where({ patient_id: p2.id }).first();
    await db('checkins').insert({
      patient_id: p2.id,
      episode_id: ep2.id,
      scheduled_for: AT(0, '09:00'),
      next_attempt_at: AT(0, '09:00'),
    });
  });
  test.afterAll(async () => db.destroy());

  test('T-1d: ciclo → check-in enviado → dor 8 → alerta threshold', async () => {
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
    // clock falso = ontem 09:05: o planner cria o check-in de "hoje local" (= ontem) e o dispatcher envia
    const c = await runCycle(db, AT(-1, '09:05'), { notifier: fakeNotifier });
    expect(c.checkins.created).toBeGreaterThanOrEqual(1);
    expect(c.dispatch.sent).toBeGreaterThanOrEqual(1);
    const ck = await db('checkins')
      .where({ patient_id: ids.p1 })
      .orderBy('scheduled_for', 'desc')
      .first();
    expect(ck.status).toBe('sent');
    for (const [k, v] of [
      ['dor', 8],
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
        AT(-1, '09:20'),
      );
    }
    const alerts = await db('alerts').where({ patient_id: ids.p1, status: 'open' });
    expect(alerts.map((a) => a.code)).toContain('threshold:dor');
  });

  test('médica ajusta a dose pela UI (vigente hoje) e abre titulação', async ({
    page,
    context,
    baseURL,
  }) => {
    await loginAsDoctor(context, baseURL!);
    await page.goto(`/pacientes/${ids.p1}`);
    await expect(page.getByTestId('alerts-card')).toContainText('dor');
    const med = page.getByTestId('medication').first();
    await med.getByRole('button', { name: 'Ajustar dose' }).click();
    await page.getByLabel('Vigente a partir de').fill(TODAY.toISODate()!);
    await page.getByLabel('Dose', { exact: true }).fill('6');
    await page.getByLabel('Motivo').fill('dor 8 ontem: aumento');
    await page.getByRole('button', { name: 'Registrar ajuste' }).click();
    await expect(med.getByTestId('current-dose')).toContainText('Dose vigente: 6 gotas');
    await expect(page.getByTestId('episode-card')).toContainText('Titulação');
  });

  test('T0: ciclo → 2º check-in → efeito adverso → alerta → /hoje → conduta → paciente mostra conduta e gráfico com marcador', async ({
    page,
    context,
    baseURL,
  }) => {
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
    const cyc = await runCycle(db, AT(0, '09:05'), { notifier: fakeNotifier, force: true });
    expect(cyc.dispatch.sent).toBeGreaterThanOrEqual(1); // P1 (hoje) e P2
    const ck = await db('checkins')
      .where({ patient_id: ids.p1 })
      .andWhere('scheduled_for', '>=', AT(0, '00:00'))
      .first();
    expect(ck.status).toBe('sent');
    for (const [k, v] of [
      ['dor', 5],
      ['sono', 6],
      ['humor', 6],
      ['crises', 0],
      ['efeito_adverso', 1],
      ['efeito_qual', 'sonolência'],
      ['obs', null],
    ] as const) {
      await answerFromRespondent(
        db,
        s1,
        { checkinId: ck.id, questionKey: k, value: v },
        AT(0, '09:30'),
      );
    }
    const open = await db('alerts').where({ patient_id: ids.p1, status: 'open' });
    expect(open.map((a) => a.code)).toContain('side_effect');

    await loginAsDoctor(context, baseURL!);
    await page.goto('/hoje');
    // Não respondeu: P2 (enviado, sem resposta)
    await expect(page.getByTestId('awaiting-card')).toContainText('Paciente Sintético Dois');
    await expect(page.getByTestId('awaiting-card')).not.toContainText('Paciente Sintético Um');
    // Alerta de efeito adverso → conduta
    const alert = page.getByTestId('alert-side_effect');
    await expect(alert).toContainText('Efeito adverso relatado');
    await alert.getByTestId('resolve-open').click();
    await alert.getByTestId('resolve-submit').click(); // sem nota: o browser bloqueia (required); nada muda
    await expect(alert).toBeVisible();
    await alert
      .getByTestId('conduct-note')
      .fill('Reduzi para 4 gotas e orientei observar sonolência por 3 dias.');
    await alert.getByTestId('resolve-submit').click();
    await expect(page.getByTestId('alert-side_effect')).toHaveCount(0);
    const resolved = await db('alerts').where({ patient_id: ids.p1, code: 'side_effect' }).first();
    expect(resolved.status).toBe('resolved');
    expect(resolved.resolved_reason).toBe('doctor');
    const acts = await db('alert_actions').where({ alert_id: resolved.id });
    expect(acts.map((a) => a.action)).toEqual(['resolve']);
    // scheduler heartbeat visível
    await expect(page.getByTestId('scheduler-status')).toContainText(/Scheduler/);

    // Página do paciente: conduta listada; gráfico com pontos e marcador do ajuste
    await page.goto(`/pacientes/${ids.p1}`);
    await expect(page.getByTestId('conducts')).toContainText('Reduzi para 4 gotas');
    const chart = page.getByTestId('chart');
    await expect(chart).toBeVisible();
    expect(Number(await chart.getAttribute('data-points'))).toBeGreaterThanOrEqual(2); // dor ontem (8) e hoje (5)
    expect(Number(await chart.getAttribute('data-markers'))).toBeGreaterThanOrEqual(1); // ajuste de hoje
    await expect(page.getByTestId('before-after')).toContainText('6 gotas');
    await page.screenshot({ path: 'test-results/loop-paciente.png', fullPage: true });
  });
});
