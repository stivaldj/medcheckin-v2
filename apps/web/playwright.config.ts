import { defineConfig } from '@playwright/test';

const PORT = 3210;
const dbUrl = process.env.DATABASE_URL_TEST || process.env.DATABASE_URL;
if (!dbUrl) throw new Error('DATABASE_URL_TEST (ou DATABASE_URL) obrigatória para o E2E.');

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: 0,
  reporter: [['list']],
  globalSetup: './e2e/global-setup.ts',
  build: { external: ['**/packages/core/**'] },
  use: { baseURL: `http://localhost:${PORT}`, trace: 'retain-on-failure' },
  webServer: {
    command: `npx next dev -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      DATABASE_URL: dbUrl,
      APP_BASE_URL: `http://localhost:${PORT}`,
      MAIL_TRANSPORT: 'fake',
      LOG_LEVEL: 'warn',
    },
  },
});
