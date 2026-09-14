import { test, expect } from '@playwright/test';
import {
  abrirCaso,
  abrirConfiguracao,
  limparCaixaDeEntrada,
  linkDeAcessoNoEmail,
  loginAsDoctor,
} from './helpers';

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
    await abrirConfiguracao(page);
    const caregiverCard = page.getByTestId('respondent-caregiver');
    await expect(caregiverCard).toContainText('Cuidadora E2E');
    await expect(caregiverCard.getByTestId('invite-url')).toContainText('/p/convite/');
    // E9.3: status da configuração do celular + QR e WhatsApp do convite
    await expect(caregiverCard).toContainText('configuração pendente');
    await expect(caregiverCard.getByTestId('setup-accepted')).toHaveAttribute('data-done', 'false');
    await expect(caregiverCard.getByTestId('invite-qr')).toHaveAttribute(
      'data-value',
      /\/p\/convite\//,
    );

    // 4. convidar mais um cuidador pela tela do paciente
    await page.getByRole('button', { name: 'Convidar cuidador' }).click();
    await page.getByLabel('Nome').fill('Avó E2E');
    await page.getByLabel('Relação').fill('avó');
    await page.getByRole('button', { name: 'Criar convite' }).click();
    await expect(page.getByTestId('respondents-card')).toContainText('Avó E2E');

    // 5. medicação: sem dose vigente → ajustar dose → dose vigente (D34: digita o nome do
    // produto já cadastrado no seed e confirma)
    await expect(page.getByTestId('medications-card')).toContainText('Nenhuma medicação.');
    await page.getByTestId('product-input').fill('Óleo Full Spectrum CBD 50mg/ml');
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
    await abrirCaso(page);
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

  /**
   * P2-7 — o caminho por onde a médica entra todo dia não tinha trava nenhuma: os outros specs
   * injetam a sessão pelo core, e o teste de SMTP virava no-op verde sem Mailpit. Aqui o e-mail
   * sai de verdade, é lido de verdade, e o link é clicado de verdade.
   */
  test('login real: /login → e-mail no Mailpit → /auth/verify → sessão; link é de uso único', async ({
    browser,
  }) => {
    await limparCaixaDeEntrada();
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    await page.goto('/login');
    await page.getByLabel('E-mail').fill('medica@medcheckin.test');
    await page.getByRole('button', { name: 'Receber link por e-mail' }).click();
    // a tela nunca confirma se a conta existe — a mensagem é a mesma nos dois casos
    await expect(page.getByText(/Se este e-mail estiver cadastrado/)).toBeVisible();

    const { link, assunto } = await linkDeAcessoNoEmail('medica@medcheckin.test');
    expect(assunto).toContain('MedCheck-in');

    await page.goto(link);
    await expect(page).toHaveURL(/\/hoje$/);
    await expect(page.getByRole('heading', { name: /Hoje/ })).toBeVisible();

    // uso único: o mesmo link numa sessão limpa não entra
    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await page2.goto(link);
    await expect(page2).not.toHaveURL(/\/hoje$/);
    await ctx2.close();

    // e-mail não cadastrado: mesma resposta, e NENHUM e-mail enviado
    await limparCaixaDeEntrada();
    await page.goto('/login');
    await page.getByLabel('E-mail').fill('ninguem@medcheckin.test');
    await page.getByRole('button', { name: 'Receber link por e-mail' }).click();
    await expect(page.getByText(/Se este e-mail estiver cadastrado/)).toBeVisible();
    await expect(linkDeAcessoNoEmail('ninguem@medcheckin.test', 2500)).rejects.toThrow();

    await ctx.close();
  });
});
