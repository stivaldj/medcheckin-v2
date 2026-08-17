import { defineConfig } from 'vitest/config';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Carrega o .env da raiz (sem depender de dotenv): só chaves ainda não definidas.
const envPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

export default defineConfig({
  test: {
    include: ['test/**/*.test.js'],
    fileParallelism: false,
    testTimeout: 15000,
    env: { LOG_LEVEL: 'error' },
  },
});
