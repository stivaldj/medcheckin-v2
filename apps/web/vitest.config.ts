import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname) } },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 15000,
    fileParallelism: false,
    env: { LOG_LEVEL: 'error', MAIL_TRANSPORT: 'fake', APP_BASE_URL: 'http://localhost:3000' },
  },
});
