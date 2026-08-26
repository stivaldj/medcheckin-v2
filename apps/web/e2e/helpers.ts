import type { BrowserContext, Page } from '@playwright/test';
import { createDb, createSession } from '@medcheckin/core';

/** Sessão da médica criada direto no core (sem backdoor de dev) e injetada como cookie. */
export async function loginAsDoctor(context: BrowserContext, baseURL: string) {
  const db = createDb(process.env.DATABASE_URL_TEST || process.env.DATABASE_URL!);
  try {
    const user = await db('users').where({ email: 'medica@medcheckin.test' }).first();
    const { sessionToken } = await createSession(
      db,
      { userId: user.id, clinicId: user.clinic_id },
      new Date(),
    );
    const url = new URL(baseURL);
    await context.addCookies([
      {
        name: 'mc_user',
        value: sessionToken,
        domain: url.hostname,
        path: '/',
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);
  } finally {
    await db.destroy();
  }
}

/**
 * A página do paciente separa "O caso" (aba padrão: gráfico, grade, alertas e condutas) de
 * "A configuração" (rotina, medicações, episódio, perguntas, respondentes, LGPD). Quem precisa
 * mexer no plano abre a segunda aba primeiro.
 */
export async function abrirConfiguracao(page: Page) {
  await page.getByTestId('tab-configuracao').click();
}

export async function abrirCaso(page: Page) {
  await page.getByTestId('tab-caso').click();
}

/**
 * Escolhe uma opção num SimpleSelect. Não é `<select>` nativo (é o Select do base-ui), então
 * `selectOption` do Playwright não serve: abre-se o gatilho e clica-se na opção pelo rótulo.
 */
export async function escolher(page: Page, testId: string, rotulo: string) {
  await page.getByTestId(testId).click();
  await page.getByRole('option', { name: rotulo, exact: true }).click();
}
