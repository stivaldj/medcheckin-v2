import { test, expect } from '@playwright/test';
import { createDb, createPatient, catalogNameKey, type Session } from '@medcheckin/core';
import { escolher, loginAsDoctor } from './helpers';

/** E12.2 / D37 — Cadastrado só em "Cadastrados"; busca sem acento; paginação de 50. */
test.describe('lista de pacientes', () => {
  test('status, busca e paginação', async ({ page, context, baseURL }) => {
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
      for (let i = 1; i <= 55; i += 1) {
        await createPatient(
          db,
          doctor,
          {
            name: `Lote E2E ${String(i).padStart(2, '0')}`,
            respondents: [{ kind: 'caregiver', name: 'C', email: `lote${i}@x.test` }],
            consent_version: 'v1',
          },
          new Date(),
        );
      }
      await db('patients').insert({
        clinic_id: user.clinic_id,
        name: 'Zélia Importada E2E',
        name_key: catalogNameKey('Zélia Importada E2E'),
        timezone: 'America/Cuiaba',
        created_by: user.id,
        status: 'registered',
        external_source: 'versatilis',
        external_ref: 'E2E-1',
        imported_at: new Date(),
      });

      await page.goto('/pacientes');
      await expect(page.getByRole('row', { name: /Zélia Importada/ })).toHaveCount(0);
      // seed já traz 2 pacientes em acompanhamento; 55 do lote + 2 do seed = 57 no total.
      await expect(page.getByTestId('patients-pager')).toContainText('1–50 de');
      await page.getByTestId('patients-next').click();
      await expect(page).toHaveURL(/page=2/);
      await expect(page.getByTestId('patients-pager')).toContainText('51–');

      await escolher(page, 'patients-status', 'Cadastrados');
      await expect(page).toHaveURL(/status=registered/);
      const zelia = page.getByRole('row', { name: /Zélia Importada/ });
      await expect(zelia).toBeVisible();
      await expect(zelia).toContainText('Cadastrado');
      await expect(zelia).toContainText('importado do Versatilis');

      await escolher(page, 'patients-status', 'Todos');
      // A troca de status navega via router.push (sem reload) — esperar a URL antes de digitar,
      // senão o handler de busca ainda lê o `status` antigo do fechamento (closure) do componente.
      await expect(page).toHaveURL(/status=all/);
      await page.getByTestId('patients-search').fill('zelia imp');
      await page.getByTestId('patients-search').press('Enter');
      await expect(page).toHaveURL(/q=zelia/);
      await expect(page.getByRole('row', { name: /Zélia Importada/ })).toBeVisible();
      await expect(page.getByRole('row', { name: /Lote E2E/ })).toHaveCount(0);

      // página do paciente Cadastrado mostra a faixa
      await page.getByRole('link', { name: 'Zélia Importada E2E' }).click();
      await expect(page.getByTestId('registered-banner')).toContainText('Cadastrado');
      await expect(page.getByTestId('setup-checklist')).toHaveCount(0);
    } finally {
      // Os 55 "Lote E2E" + a Zélia só existem para forçar a paginação; sem limpar, ficam no banco
      // (compartilhado por toda a suíte, workers=1, um único global-setup) e empurram pacientes de
      // outros specs (ex. medica.spec.ts) para além da página 1 do filtro padrão "Em acompanhamento".
      await db('patients').where('name', 'like', 'Lote E2E %').del();
      await db('patients').where({ name: 'Zélia Importada E2E' }).del();
      await db.destroy();
    }
  });
});
