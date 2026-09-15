// apps/web/e2e/condicoes.spec.ts
import { test, expect } from '@playwright/test';
import { createDb, createPatient, addPatientCondition, type Session } from '@medcheckin/core';
import { escolher, loginAsDoctor } from './helpers';

/** E12.1 / D36 — condição pelo cabeçalho, filtro na lista, CID-10 e fusão em Configurações. */
test.describe('condições', () => {
  test('adicionar no cabeçalho → filtrar lista → CID-10 → fundir', async ({
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
            {
              name,
              respondents: [
                { kind: 'caregiver', name: 'C', email: `${name.replace(/\W/g, '')}@x.test` },
              ],
              consent_version: 'v1',
            },
            new Date(),
          )
        ).patient;
      const pa = await novo('Paciente Cond A E2E');
      const pb = await novo('Paciente Cond B E2E');
      // B já tem "Autismo"; A vai ganhar "TEA" pela tela e depois TEA será fundida em Autismo
      await addPatientCondition(db, doctor, pb.id, { name: 'Autismo' }, new Date());

      // 1. cabeçalho: adicionar "TEA"
      await page.goto(`/pacientes/${pa.id}`);
      await page.getByTestId('condition-edit').click();
      await page.getByTestId('condition-input').fill('TEA');
      await page.getByTestId('condition-input').press('Enter');
      await expect(page.getByTestId('condition-badge')).toContainText('TEA');

      // 2. lista filtra por TEA: só A
      const tea = await db('conditions')
        .where({ clinic_id: user.clinic_id, name_key: 'tea' })
        .first();
      await page.goto('/pacientes');
      await escolher(page, 'conditions-filter', 'TEA (1)');
      await expect(page).toHaveURL(new RegExp(`condition=${tea.id}`));
      await expect(page.getByRole('row', { name: /Paciente Cond A E2E/ })).toBeVisible();
      await expect(page.getByRole('row', { name: /Paciente Cond B E2E/ })).toHaveCount(0);

      // 3. Configurações → Condições: CID-10 e fundir TEA em Autismo
      await page.goto('/configuracoes/condicoes');
      const linhaTea = page.getByTestId('condition-row').filter({ hasText: 'TEA' });
      await linhaTea.getByTestId('condition-cid10').fill('f84.0');
      await linhaTea.getByTestId('condition-cid10').press('Enter');
      await expect(linhaTea.getByTestId('condition-cid10')).toHaveValue('F84.0');
      await linhaTea.getByTestId('condition-merge').click();
      await escolher(page, 'condition-merge-target', 'Autismo');
      await linhaTea.getByTestId('condition-merge-confirm').click();
      await expect(page.getByTestId('condition-row').filter({ hasText: 'TEA' })).toHaveCount(0);
      const linhaAut = page.getByTestId('condition-row').filter({ hasText: 'Autismo' });
      await expect(linhaAut).toContainText('2');

      // 4. A agora tem Autismo
      await page.goto(`/pacientes/${pa.id}`);
      await expect(page.getByTestId('condition-badge')).toContainText('Autismo');
      expect(await db('conditions').where({ id: tea.id }).first()).toBeUndefined();
    } finally {
      await db.destroy();
    }
  });
});
