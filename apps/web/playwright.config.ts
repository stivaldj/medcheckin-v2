import os from 'node:os';
import path from 'node:path';
import { defineConfig } from '@playwright/test';
import { loadEnvConfig } from '@next/env';

loadEnvConfig(path.resolve(__dirname, '../..'));

process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'warn'; // o próprio teste chama o core
const PORT = 3210;
const MAILPIT_SMTP = Number(process.env.MAILPIT_SMTP_PORT || 1025);
const dbUrl = process.env.DATABASE_URL_TEST || process.env.DATABASE_URL;
if (!dbUrl) throw new Error('DATABASE_URL_TEST (ou DATABASE_URL) obrigatória para o E2E.');
// D38: `next start` roda em produção, onde UPLOADS_DIR é obrigatório (config fail-closed). O
// processo de teste também chama o core direto (ex.: anexos.spec.ts), então precisa concordar
// com a mesma pasta — daí fixar em `process.env` aqui, não só em `webServer.env`.
const uploadsDir = path.join(os.tmpdir(), 'mc-e2e-uploads');
process.env.UPLOADS_DIR = uploadsDir;

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: 0,
  workers: 1, // specs compartilham o mesmo banco de teste (e o processo de teste chama o core direto)
  fullyParallel: false,
  expect: { timeout: 20_000 },
  reporter: [['list']],
  globalSetup: './e2e/global-setup.ts',
  build: { external: ['**/packages/core/**'] },
  use: { baseURL: `http://localhost:${PORT}`, trace: 'retain-on-failure' },
  webServer: {
    // Build de produção (não `next dev`): em dev a primeira compilação de cada rota dispara
    // "Fast Refresh had to perform a full reload", que aborta o fetch em voo e faz o teste ver
    // um clique que não fez nada. Aqui o E2E roda contra exatamente o que vai ao ar.
    command: `npx next build && npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 300_000,
    env: {
      DATABASE_URL: dbUrl,
      APP_BASE_URL: `http://localhost:${PORT}`,
      UPLOADS_DIR: uploadsDir,
      // P2-7: o login da médica passa por e-mail de verdade, contra o Mailpit do compose — com
      // `MAIL_TRANSPORT: 'fake'` o elo e-mail → /auth/verify → cookie nunca era exercitado.
      // Host e porta são FIXADOS aqui de propósito: herdar SMTP_* do .env de quem roda o teste
      // é como um dia mandar e-mail de verdade para um endereço de verdade a partir do CI.
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: String(MAILPIT_SMTP),
      EMAIL_FROM: 'e2e@medcheckin.test',
      LOG_LEVEL: 'warn',
      // Chave PÚBLICA VAPID só de teste (não é segredo): o wizard busca /api/p/vapid antes de
      // assinar o push. Fixada aqui para o E2E não depender do .env de quem roda — na CI não há.
      VAPID_PUBLIC_KEY:
        'BLUhM2hi2AZAnDIDP0OOQY48kOUGBDVqHehzDHXVWoHulP1SbAkZye0FdweR-cJb5cMQzr6JyDlkjWE3FSj2YLo',
    },
  },
});
