import { test, expect } from '@playwright/test';
import { createDb } from '@medcheckin/core';

/**
 * PROVA E5: cuidador aceita → recebe check-in → responde → answers gravadas → próxima pergunta/encerramento.
 * (Push real não roda em Chromium headless — sem push service; provado em core/test/push.test.js.)
 */
test.describe('PWA do respondente', () => {
  let ids: { r2c: string; p2: string; ep2: string; checkinId: string };

  test.beforeAll(async () => {
    const db = createDb(process.env.DATABASE_URL_TEST || process.env.DATABASE_URL!);
    try {
      const p2 = await db('patients').where({ name: 'Paciente Sintético Dois' }).first();
      const r2c = await db('respondents').where({ patient_id: p2.id, kind: 'caregiver' }).first();
      const ep2 = await db('episodes').where({ patient_id: p2.id }).first();
      // cuidadora ainda não aceitou; há um check-in de hoje já enviado
      await db('respondents')
        .where({ id: r2c.id })
        .update({ accepted_at: null, consent_version: null, consent_at: null });
      await db('checkins').where({ patient_id: p2.id }).del();
      const [ck] = await db('checkins')
        .insert({
          patient_id: p2.id,
          episode_id: ep2.id,
          scheduled_for: new Date(),
          status: 'sent',
          attempt_count: 1,
          sent_at: new Date(),
        })
        .returning('id');
      ids = { r2c: r2c.id, p2: p2.id, ep2: ep2.id, checkinId: ck.id };
    } finally {
      await db.destroy();
    }
  });

  test('sem sessão → mensagem para abrir o convite', async ({ page }) => {
    await page.goto('/p/hoje');
    await expect(page.getByTestId('no-session')).toBeVisible();
  });

  test('aceite → hoje → lembretes SEM botões de confirmação → responde check-in inteiro (com adesão) → concluído → histórico; SW registrado', async ({
    page,
  }) => {
    // 1. convite + consentimento
    await page.goto('/p/convite/seed-c2');
    await expect(page.getByRole('heading', { name: /Olá, Cuidadora Sintética/ })).toBeVisible();
    await expect(page.getByTestId('consent-text')).toContainText('Termo de consentimento (v1)');
    await expect(page.getByTestId('accept')).toBeDisabled();
    await page.getByTestId('agree').click();
    await page.getByTestId('accept').click();

    // 2. hoje: cuidadora vê alarmes de P2 e o check-in
    await expect(page).toHaveURL(/\/p\/hoje$/);
    await expect(page.getByRole('heading', { name: /Olá, Cuidadora Sintética/ })).toBeVisible();
    await expect(page.getByText('Acompanhando Paciente Sintético Dois')).toBeVisible();
    await expect(page.getByTestId('alarm')).toHaveCount(3);
    // E9.1: lembrete puro — horário + texto livre; NENHUM botão de confirmação
    await expect(page.getByTestId('alarm').first()).toContainText('07:00');
    await expect(page.getByTestId('alarm').first()).toContainText('0,5 ml óleo + vitamina D');
    await expect(page.getByTestId('taken')).toHaveCount(0);
    await expect(page.getByTestId('skipped')).toHaveCount(0);
    await expect(page.getByTestId('effect')).toHaveCount(0);
    await expect(page.getByTestId('alarm-status')).toHaveCount(0);
    await expect(page.getByTestId('progress')).toHaveText('1 de 7');

    // 3. responder: adesão não → dor 4 → sono 6 → humor 6 → crises 0 → efeito sim → tontura → obs
    await page.getByTestId('question-adesao').getByTestId('no').click();
    await page.getByTestId('question-dor').getByTestId('scale-4').click();
    await expect(page.getByTestId('question-sono')).toBeVisible();
    await expect(page.getByTestId('progress')).toHaveText('3 de 7');
    await page.getByTestId('question-sono').getByTestId('scale-6').click();
    await page.getByTestId('question-humor').getByTestId('scale-6').click();
    await page.getByTestId('question-crises').getByTestId('input').fill('0');
    await page.getByTestId('question-crises').getByTestId('send').click();
    await page.getByTestId('question-efeito_adverso').getByTestId('yes').click();
    await expect(page.getByTestId('question-efeito_qual')).toBeVisible(); // condicional apareceu
    await expect(page.getByTestId('progress')).toHaveText('7 de 8'); // total cresceu com a condicional
    await page.getByTestId('question-efeito_qual').getByTestId('choice-tontura').click();
    await page.getByTestId('question-obs').getByTestId('input').fill('tudo bem');
    await page.getByTestId('question-obs').getByTestId('send').click();
    await expect(page.getByTestId('checkin-done')).toContainText('Check-in concluído');

    // 4. answers gravadas pela cuidadora
    const db = createDb(process.env.DATABASE_URL_TEST || process.env.DATABASE_URL!);
    try {
      const rows = await db('answers as a')
        .join('questions as q', 'q.id', 'a.question_id')
        .where('a.checkin_id', ids.checkinId)
        .select('q.key', 'a.value_num', 'a.value_choice', 'a.value_text', 'a.respondent_id');
      const by = Object.fromEntries(
        rows.map((r) => [r.key, r.value_num ?? r.value_choice ?? r.value_text]),
      );
      expect(by).toMatchObject({
        adesao: 0,
        dor: 4,
        sono: 6,
        humor: 6,
        crises: 0,
        efeito_adverso: 1,
        efeito_qual: 'tontura',
        obs: 'tudo bem',
      });
      expect(rows.every((r) => r.respondent_id === ids.r2c)).toBe(true);
      const ck = await db('checkins').where({ id: ids.checkinId }).first();
      expect(ck.status).toBe('completed');
      // efeito adverso → alerta no dia
      const alerts = await db('alerts').where({ patient_id: ids.p2, status: 'open' });
      expect(alerts.map((a) => a.code)).toContain('side_effect');
      // adesão "não" vira alerta medium (D15)
      expect(alerts.find((a) => a.code === 'threshold:adesao')?.severity).toBe('medium');
    } finally {
      await db.destroy();
    }

    // 5. SW registrado (push real não é possível em headless)
    const swScope = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration('/p/');
      return reg?.scope ?? null;
    });
    expect(swScope).toMatch(/\/p\/$/);
    // headless: permissão de notificação costuma vir "denied"; qualquer estado do toggle é aceitável aqui
    await expect(page.locator('[data-testid^="push-"]').first()).toBeVisible();

    // 6. histórico
    await page.goto('/p/historico');
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Cuiaba' });
    const day = page.getByTestId(`day-${today}`);
    await expect(day).toContainText('dor: 4');
    await expect(day).toContainText('tontura');
    await expect(day).toContainText('07:00 — 0,5 ml óleo + vitamina D');
    await page.screenshot({ path: 'test-results/respondente-hoje-e2e.png', fullPage: true });
  });
});
