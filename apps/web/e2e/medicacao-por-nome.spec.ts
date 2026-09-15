import { test, expect } from '@playwright/test';
import { createDb, createPatient, type Session } from '@medcheckin/core';
import { abrirConfiguracao, loginAsDoctor } from './helpers';

/**
 * D34 — a médica digita o nome do produto e confirma; o produto nasce na clínica na primeira
 * vez e é reaproveitado (com sugestão) na segunda, sem tela de cadastro de produto.
 */
test.describe('medicação por nome', () => {
  test('digitar cria o produto; no 2º paciente ele vem como sugestão e não duplica', async ({
    page,
    context,
    baseURL,
  }) => {
    await loginAsDoctor(context, baseURL!);
    const db = createDb(process.env.DATABASE_URL_TEST || process.env.DATABASE_URL!);
    try {
      const user = await db('users').where({ email: 'medica@medcheckin.test' }).first();
      const doctor = {
        kind: 'user',
        sessionId: 'e2e',
        userId: user.id,
        clinicId: user.clinic_id,
        role: 'doctor',
        name: 'Dra.',
        email: user.email,
      } as Session;
      const novo = async (name: string) =>
        (
          await createPatient(
            db,
            doctor,
            { name, respondents: [{ kind: 'patient', name }], consent_version: 'v1' },
            new Date(),
          )
        ).patient;
      const p1 = await novo('Paciente Nome Um E2E');
      const p2 = await novo('Paciente Nome Dois E2E');
      const NOME = 'Óleo CBD Isolado 100 mg/ml';
      const antes = Number(
        (await db('products').where({ clinic_id: user.clinic_id }).count().first())!.count,
      );

      // 1º paciente: nome novo, Enter
      await page.goto(`/pacientes/${p1.id}`);
      await abrirConfiguracao(page);
      const card = page.getByTestId('medications-card');
      await expect(card.getByTestId('product-suggestion')).toHaveCount(0);
      await card.getByTestId('product-input').fill(NOME);
      await card.getByTestId('product-input').press('Enter');
      await expect(card.getByTestId('medication')).toContainText(NOME);
      await expect(card.getByTestId('current-dose').first()).toContainText('Sem dose vigente');

      // 2º paciente: digita parte do nome, escolhe a sugestão, clica em Adicionar
      await page.goto(`/pacientes/${p2.id}`);
      await abrirConfiguracao(page);
      await card.getByTestId('product-input').fill('isolado');
      const sugestao = card.getByTestId('product-suggestion').filter({ hasText: NOME });
      await expect(sugestao).toBeVisible();
      await sugestao.click();
      await expect(card.getByTestId('product-input')).toHaveValue(NOME);
      await card.getByTestId('add-medication').click();
      await expect(card.getByTestId('medication')).toContainText(NOME);

      // um produto só nasceu; as duas medicações apontam para ele
      const depois = Number(
        (await db('products').where({ clinic_id: user.clinic_id }).count().first())!.count,
      );
      expect(depois).toBe(antes + 1);
      const prod = await db('products').where({ clinic_id: user.clinic_id, name: NOME }).first();
      const meds = await db('medications').whereIn('patient_id', [p1.id, p2.id]);
      expect(meds).toHaveLength(2);
      expect(meds.every((m) => m.product_id === prod.id)).toBe(true);
    } finally {
      await db.destroy();
    }
  });

  test('nome curto não habilita o botão e Enter não envia', async ({ page, context, baseURL }) => {
    await loginAsDoctor(context, baseURL!);
    const db = createDb(process.env.DATABASE_URL_TEST || process.env.DATABASE_URL!);
    try {
      const p = await db('patients').where({ name: 'Paciente Sintético Um' }).first();
      const antes = Number(
        (await db('medications').where({ patient_id: p.id }).count().first())!.count,
      );
      await page.goto(`/pacientes/${p.id}`);
      await abrirConfiguracao(page);
      const card = page.getByTestId('medications-card');
      await card.getByTestId('product-input').fill('x');
      await expect(card.getByTestId('add-medication')).toBeDisabled();
      await card.getByTestId('product-input').press('Enter');
      await page.waitForTimeout(500);
      const depois = Number(
        (await db('medications').where({ patient_id: p.id }).count().first())!.count,
      );
      expect(depois).toBe(antes);
    } finally {
      await db.destroy();
    }
  });
});
