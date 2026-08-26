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

const MAILPIT = process.env.MAILPIT_API || 'http://127.0.0.1:8025';

/** Apaga a caixa do Mailpit para o teste não pescar um e-mail de outra rodada. */
export async function limparCaixaDeEntrada() {
  const res = await fetch(`${MAILPIT}/api/v1/messages`, { method: 'DELETE' }).catch(() => null);
  if (!res?.ok) {
    throw new Error(
      `Mailpit não respondeu em ${MAILPIT}. O E2E do login manda e-mail de verdade — suba com ` +
        '`docker compose up -d mailpit`. (Falhar aqui é de propósito: sem Mailpit este teste ' +
        'viraria um verde que não prova nada.)',
    );
  }
}

/**
 * Espera o e-mail chegar e devolve o link de acesso. O `APP_BASE_URL` do servidor de teste já
 * aponta para a porta do Playwright, então o link vem pronto para navegar.
 */
export async function linkDeAcessoNoEmail(destinatario: string, timeoutMs = 15_000) {
  const ate = Date.now() + timeoutMs;
  while (Date.now() < ate) {
    const res = await fetch(`${MAILPIT}/api/v1/messages?limit=20`);
    const { messages = [] } = (await res.json()) as { messages?: Array<Record<string, unknown>> };
    for (const m of messages) {
      const to = JSON.stringify((m as { To?: unknown }).To ?? '');
      if (!to.includes(destinatario)) continue;
      const full = await (await fetch(`${MAILPIT}/api/v1/message/${m.ID}`)).json();
      const corpo = `${full.Text ?? ''}${full.HTML ?? ''}`;
      const achou = corpo.match(/https?:\/\/[^\s"<>]+auth\/verify[^\s"<>]*/);
      if (achou) return { link: achou[0], assunto: String(full.Subject ?? '') };
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Nenhum e-mail com link de acesso para ${destinatario} em ${timeoutMs} ms.`);
}
