import { test, expect } from '@playwright/test';
import { loginAsDoctor } from './helpers';

test.describe('PROVA E4 — médica: cadastrar paciente → convidar cuidador → criar dose → ver dose vigente', () => {
  test.beforeEach(async ({ context, baseURL }) => {
    await loginAsDoctor(context, baseURL!);
  });

  test('fluxo completo', async ({ page }) => {
    // 1. lista
    await page.goto('/pacientes');
    await expect(page.getByRole('heading', { name: 'Pacientes' })).toBeVisible();
    await expect(page.getByText('Paciente Sintético Um')).toBeVisible();

    // 2. cadastrar paciente com cuidadora
    await page.getByText('Novo paciente', { exact: true }).click();
    await page.getByLabel('Nome', { exact: true }).first().fill('Paciente E2E');
    await page.getByLabel('Data de nascimento').fill('2016-05-20');
    await page.getByLabel('Condições (separadas por vírgula)').fill('epilepsia');
    await page.getByRole('button', { name: 'Adicionar cuidador' }).click();
    const cg = page.getByTestId('respondent-1');
    await cg.getByLabel('Nome').fill('Cuidadora E2E');
    await cg.getByLabel('Relação').fill('mãe');
    await page.getByTestId('consent').click();
    await page.getByRole('button', { name: 'Cadastrar paciente' }).click();

    // 3. detalhe: respondentes com link de convite
    await expect(page.getByTestId('patient-name')).toHaveText('Paciente E2E');
    const caregiverCard = page.getByTestId('respondent-caregiver');
    await expect(caregiverCard).toContainText('Cuidadora E2E');
    await expect(caregiverCard.getByTestId('invite-url')).toContainText('/p/convite/');
    await expect(caregiverCard).toContainText('convite pendente');

    // 4. convidar mais um cuidador pela tela do paciente
    await page.getByRole('button', { name: 'Convidar cuidador' }).click();
    await page.getByLabel('Nome').fill('Avó E2E');
    await page.getByLabel('Relação').fill('avó');
    await page.getByRole('button', { name: 'Criar convite' }).click();
    await expect(page.getByText('Avó E2E')).toBeVisible();

    // 5. medicação: sem dose vigente → ajustar dose → dose vigente
    await expect(page.getByTestId('medications-card')).toContainText('Nenhuma medicação.');
    await page.getByTestId('add-medication').click();
    const med = page.getByTestId('medication').first();
    await expect(med.getByTestId('current-dose')).toContainText('Sem dose vigente');
    await med.getByRole('button', { name: 'Ajustar dose' }).click();
    await page.getByLabel('Dose', { exact: true }).fill('3');
    await page.getByLabel('Vezes por dia').fill('2');
    await page.getByTestId('dose-time-0').fill('08:00');
    await page.getByTestId('dose-time-1').fill('20:00');
    await page.getByLabel('Motivo').fill('início do tratamento');
    await page.getByRole('button', { name: 'Registrar ajuste' }).click();
    await expect(med.getByTestId('current-dose')).toContainText(
      'Dose vigente: 3 gotas · 2×/dia (08:00, 20:00)',
    );

    // 6. episódio de titulação aberto pelo ajuste; grade com marcador de dose
    await expect(page.getByTestId('episode-card')).toContainText('Titulação');
    await expect(page.getByTestId('episode-card')).toContainText('check-in diário');
    await expect(page.getByTestId('grid-card')).toContainText('dor');

    await page.screenshot({ path: 'test-results/paciente-e2e.png', fullPage: true });

    // 7. lista mostra dose vigente
    await page.goto('/pacientes');
    const row = page.getByRole('row', { name: /Paciente E2E/ });
    await expect(row).toContainText('3 gotas · 2×/dia');
    await expect(row).toContainText('Titulação · diário');
  });

  test('perguntas: criar conjunto, adicionar pergunta com slug automático e salvar', async ({
    page,
  }) => {
    await page.goto('/perguntas');
    await page.getByLabel('Novo conjunto').fill('Conjunto E2E');
    await page.getByRole('button', { name: 'Criar' }).click();
    const set = page.locator('[data-testid^="set-"]', { hasText: 'Conjunto E2E' });
    await expect(set).toBeVisible();
    await set.getByRole('button', { name: 'Adicionar pergunta' }).click();
    await set.getByPlaceholder('Como está sua dor hoje?').fill('Como está a ansiedade hoje?');
    await expect(set.getByText('chave: como_esta_a_ansiedade_hoje')).toBeVisible();
    await set.getByRole('button', { name: 'Salvar conjunto' }).click();
    await expect(set.getByText('Salvo.')).toBeVisible();
  });

  test('sem sessão → /login', async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto('/pacientes');
    await expect(page).toHaveURL(/\/login$/);
    await ctx.close();
  });
});
