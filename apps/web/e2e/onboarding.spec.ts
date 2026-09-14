import { test, expect, type BrowserContext } from '@playwright/test';
import { createDb, dispatchPushTests } from '@medcheckin/core';
import { abrirConfiguracao, loginAsDoctor } from './helpers';

/**
 * PROVA E9.3 — primeiro acesso guiado.
 *
 * O que o Chromium headless NÃO tem: push service de verdade e o modo "app da tela inicial" do
 * iPhone. Por isso: (a) `PushManager.subscribe` é trocado por um stub que devolve uma inscrição
 * falsa — o resto (permissão, POST /api/p/push, fila, scheduler, status, confirmação) é real;
 * (b) o modo app é aberto pela `start_url` do manifest (`?app=1`). A prova no aparelho de verdade
 * fica no roteiro do shadow run (PLANO E9.3).
 */
const UA = {
  android:
    'Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.6478.71 Mobile Safari/537.36',
  iosInstagram:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 339.0.3.12.91 (iPhone15,2; iOS 17_5; pt_BR; pt; scale=3.00; 1179x2556; 626245312)',
};

const dbUrl = () => process.env.DATABASE_URL_TEST || process.env.DATABASE_URL!;

async function stubPush(context: BrowserContext) {
  await context.grantPermissions(['notifications']);
  await context.addInitScript(() => {
    const fake = {
      endpoint: 'https://push.example.test/e2e-onboarding',
      keys: { p256dh: 'e2e-p256dh', auth: 'e2e-auth' },
    };
    let subscribed = false; // por aparelho (contexto), como no navegador de verdade
    const sub = { toJSON: () => fake } as unknown as PushSubscription;
    PushManager.prototype.subscribe = async function () {
      subscribed = true;
      return sub;
    };
    PushManager.prototype.getSubscription = async function () {
      return subscribed ? sub : null;
    };
  });
}

/** O scheduler, rodado pelo teste: envia os testes de aviso pendentes com um notifier que aceita. */
async function schedulerTick() {
  const db = createDb(dbUrl());
  try {
    return await dispatchPushTests(db, new Date(), {
      notifier: { send: async () => ({ ok: true }) },
    });
  } finally {
    await db.destroy();
  }
}

test.describe.serial('PROVA E9.3 — primeiro acesso guiado', () => {
  let ids: { p1: string; r1: string };

  test.beforeAll(async () => {
    const db = createDb(dbUrl());
    try {
      const p1 = await db('patients').where({ name: 'Paciente Sintético Um' }).first();
      const r1 = await db('respondents').where({ patient_id: p1.id, kind: 'patient' }).first();
      await db('push_subscriptions').where({ respondent_id: r1.id }).del();
      await db('notifications').where({ respondent_id: r1.id, kind: 'test' }).del();
      await db('respondents').where({ id: r1.id }).update({
        accepted_at: null,
        consent_version: null,
        consent_at: null,
        install_confirmed_at: null,
        push_test_confirmed_at: null,
        can_answer: true,
        receives_alarms: true,
      });
      ids = { p1: p1.id, r1: r1.id };
    } finally {
      await db.destroy();
    }
  });

  test('médica vê QR/WhatsApp → paciente (Android) faz o wizard inteiro → "não chegou" mostra o conserto → teste confirmado → médica vê ✓', async ({
    browser,
    baseURL,
  }) => {
    // 1. médica: convite com QR, WhatsApp e status zerado
    const medica = await browser.newContext();
    await loginAsDoctor(medica, baseURL!);
    const mp = await medica.newPage();
    await mp.goto(`/pacientes/${ids.p1}`);
    await expect(mp.getByTestId('setup-checklist')).toBeVisible();
    await expect(mp.getByTestId('checklist-phone')).toHaveAttribute('data-done', 'false');
    await abrirConfiguracao(mp);
    const card = mp.getByTestId('respondent-patient');
    await expect(card.getByTestId('setup-test_confirmed')).toHaveAttribute('data-done', 'false');
    const inviteUrl = await card.getByTestId('invite-qr').getAttribute('data-value');
    expect(inviteUrl).toMatch(/\/p\/convite\/seed-p1$/);
    await expect(card.getByTestId('invite-whatsapp')).toHaveAttribute(
      'href',
      /^https:\/\/wa\.me\/\d*\?text=.*p%2Fconvite%2Fseed-p1/,
    );

    // 2. paciente no Android, lendo o QR
    const cel = await browser.newContext({ userAgent: UA.android });
    await stubPush(cel);
    const p = await cel.newPage();
    await p.goto(new URL(inviteUrl!).pathname);
    // o manifest desta página é o do convite (o app instalado volta para cá)
    await expect(p.locator('link[rel="manifest"]')).toHaveAttribute(
      'href',
      '/p/convite/seed-p1/manifest.webmanifest',
    );
    await expect(p.getByTestId('setup-welcome')).toBeVisible();
    await expect(p.getByTestId('setup-progress')).toHaveText('Passo 1 de 5');
    await p.getByTestId('setup-start').click();
    await expect(p.getByTestId('accept')).toBeDisabled();
    await p.getByTestId('agree').click();
    await p.getByTestId('accept').click();

    await expect(p.getByTestId('setup-install-android')).toContainText('Instalar app');
    await expect(p.getByTestId('setup-progress')).toHaveText('Passo 3 de 5');
    await p.getByTestId('setup-install-done').click();

    await expect(p.getByTestId('setup-notify')).toContainText('Permitir');
    await p.getByTestId('setup-notify-go').click();

    // 3. teste de aviso: fica "enviando" até o scheduler rodar — nunca "chegou" antes
    await expect(p.getByTestId('setup-test')).toBeVisible();
    await p.getByTestId('setup-test-send').click();
    await expect(p.getByTestId('setup-test-waiting')).toBeVisible();
    await expect(p.getByTestId('setup-test-yes')).toHaveCount(0);
    expect(await schedulerTick()).toMatchObject({ sent: 1 });
    await expect(p.getByTestId('setup-test-yes')).toBeVisible();

    // 4. "não chegou" → conserto guiado; testar de novo → "sim"
    await p.getByTestId('setup-test-no').click();
    await expect(p.getByTestId('setup-not-arrived')).toContainText('Não Perturbe');
    await p.getByTestId('setup-test-send').click();
    await expect(p.getByTestId('setup-test-waiting')).toBeVisible();
    expect(await schedulerTick()).toMatchObject({ sent: 1 });
    await p.getByTestId('setup-test-yes').click();
    await expect(p.getByTestId('setup-done')).toContainText('Tudo pronto');
    await p.screenshot({ path: 'test-results/onboarding-pronto.png', fullPage: true });
    await p.getByTestId('setup-finish').click();
    await expect(p).toHaveURL(/\/p\/hoje$/);
    await expect(p.getByTestId('push-ok')).toContainText('Avisos funcionando');

    // 5. médica: cada ✓ com lastro no banco
    await mp.reload();
    await abrirConfiguracao(mp);
    await expect(card.getByTestId('setup-accepted')).toHaveAttribute('data-done', 'true');
    await expect(card.getByTestId('setup-push_active')).toHaveAttribute('data-done', 'true');
    await expect(card.getByTestId('setup-test_confirmed')).toHaveAttribute('data-done', 'true');
    // Android no navegador: o app não foi aberto em modo instalado → sem ✓ inventado
    await expect(card.getByTestId('setup-installed')).toHaveAttribute('data-done', 'false');
    await card.screenshot({ path: 'test-results/onboarding-card-medica.png' });

    const db = createDb(dbUrl());
    try {
      const tests = await db('notifications')
        .where({ respondent_id: ids.r1, kind: 'test' })
        .orderBy('created_at');
      expect(tests).toHaveLength(2);
      expect(tests.every((t) => t.sent_at)).toBe(true);
      const r = await db('respondents').where({ id: ids.r1 }).first();
      expect(r.push_test_confirmed_at).not.toBeNull();
    } finally {
      await db.destroy();
    }
    await medica.close();
    await cel.close();
  });

  test('iPhone: link aberto no Instagram → "abra no Safari" → instruções da Tela de Início → app aberto pela start_url entra sozinho', async ({
    browser,
  }) => {
    const cel = await browser.newContext({ userAgent: UA.iosInstagram });
    await stubPush(cel);
    const p = await cel.newPage();

    // convite já aceito no teste anterior → "continuar neste celular"
    await p.goto('/p/convite/seed-p1');
    await p.getByTestId('accept').click();
    await expect(p.getByTestId('setup-browser')).toContainText('Instagram');
    await expect(p.getByTestId('setup-browser')).toContainText('Safari');
    await p.getByTestId('setup-browser-skip').click();
    await expect(p.getByTestId('setup-install-ios')).toContainText('Adicionar à Tela de Início');
    // Bug do teste real (14/09): esta tela não tinha como seguir. Agora explica o próximo passo,
    // o que fazer se o ícone abrir o Safari de novo, e dá uma saída honesta.
    await expect(p.getByTestId('setup-diag')).toContainText('ios · navegador');
    await p.getByTestId('setup-install-ios-added').click();
    await expect(p.getByTestId('setup-install-ios-help')).toContainText('abriu o Safari de novo');
    await expect(p.getByTestId('setup-skip-push')).toContainText('sem os avisos');
    await expect(p.getByTestId('setup-progress')).toHaveText('Passo 3 de 5');
    await p.setViewportSize({ width: 390, height: 844 });
    await p.screenshot({ path: 'test-results/onboarding-iphone-instalar.png', fullPage: true });
    // no iPhone não há "continuar" no Safari: o passo seguinte acontece no app da tela inicial
    await expect(p.getByTestId('setup-install-done')).toHaveCount(0);

    // app da tela inicial: abre na start_url do manifest, sem cookie (contexto novo)
    const manifest = await (await p.request.get('/p/convite/seed-p1/manifest.webmanifest')).json();
    const app = await browser.newContext({ userAgent: UA.iosInstagram });
    await stubPush(app);
    const ap = await app.newPage();
    await ap.goto(manifest.start_url);
    // entrou sozinho, sem termo. O app da tela inicial é OUTRO aparelho para o navegador: a
    // inscrição do Android não vale aqui → pede os avisos deste aparelho, continuando a conta.
    await expect(ap.getByTestId('setup-notify')).toBeVisible();
    await expect(ap.getByTestId('setup-diag')).toContainText('ios · app');
    await expect(ap.getByTestId('setup-progress')).toHaveText('Passo 4 de 5');
    await expect(ap.getByTestId('setup-consent')).toHaveCount(0);
    await ap.getByTestId('setup-notify-go').click();
    await ap.getByTestId('setup-test-send').click();
    await expect(ap.getByTestId('setup-test-waiting')).toBeVisible();
    expect(await schedulerTick()).toMatchObject({ sent: 1 });
    await ap.getByTestId('setup-test-yes').click();
    await expect(ap.getByTestId('setup-done')).toContainText('Tudo pronto');
    await ap.screenshot({ path: 'test-results/onboarding-iphone-app.png', fullPage: true });

    const db = createDb(dbUrl());
    try {
      const r = await db('respondents').where({ id: ids.r1 }).first();
      expect(r.install_confirmed_at).not.toBeNull();
    } finally {
      await db.destroy();
    }
    await cel.close();
    await app.close();
  });

  test('sem sessão na ajuda: erro explica e "Tentar de novo" — nunca tela sem saída', async ({
    page,
  }) => {
    await page.goto('/p/ajuda');
    await expect(page.getByTestId('setup-error')).toContainText('QR code da clínica');
    await expect(page.getByTestId('setup-retry')).toBeVisible();
  });

  test('celular compartilhado: médica marca → card vira "usa o celular de outra pessoa" → desfaz', async ({
    browser,
    baseURL,
  }) => {
    const medica = await browser.newContext();
    await loginAsDoctor(medica, baseURL!);
    const mp = await medica.newPage();
    mp.on('dialog', (d) => d.accept());
    await mp.goto(`/pacientes/${ids.p1}`);
    await abrirConfiguracao(mp);
    const card = mp.getByTestId('respondent-patient');
    await card.getByTestId('device-shared').click();
    await expect(card).toHaveAttribute('data-device', 'shared');
    await expect(card.getByTestId('invite-qr')).toHaveCount(0);
    await card.getByTestId('device-own').click();
    await expect(card).toHaveAttribute('data-device', 'own');
    await medica.close();
  });

  test('guias imprimíveis: respondente (com QR) e médica', async ({ browser, baseURL }) => {
    const medica = await browser.newContext();
    await loginAsDoctor(medica, baseURL!);
    const mp = await medica.newPage();
    await mp.goto(`/pacientes/${ids.p1}/guia/${ids.r1}`);
    await expect(mp.getByTestId('guide-respondent')).toContainText('Como começar');
    await expect(mp.getByRole('img', { name: /QR code do convite/ })).toBeVisible();
    await mp.screenshot({ path: 'test-results/guia-respondente.png', fullPage: true });
    await mp.goto('/configuracoes');
    await mp.getByTestId('doctor-guide-link').click();
    await expect(mp.getByTestId('guide-doctor')).toContainText('Teste confirmado');
    await medica.close();
  });
});
