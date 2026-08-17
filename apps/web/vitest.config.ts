import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { loadEnvConfig } from '@next/env';

loadEnvConfig(path.resolve(__dirname, '../..'));

export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname) } },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 15000,
    fileParallelism: false,
    env: {
      LOG_LEVEL: 'error',
      MAIL_TRANSPORT: 'fake',
      VAPID_PUBLIC_KEY:
        'BOnly_for_tests_not_a_real_key_0000000000000000000000000000000000000000000000000000000000',
      APP_BASE_URL: 'http://localhost:3000',
    },
  },
});
