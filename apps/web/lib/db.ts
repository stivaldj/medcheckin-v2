import { createDb, loadConfig } from '@medcheckin/core';
import type { Knex } from 'knex';

// Uma conexão por processo (em dev o HMR recarrega módulos: guardamos em globalThis).
const g = globalThis as unknown as { __medcheckinDb?: Knex };

export function getDb(): Knex {
  if (!g.__medcheckinDb) {
    const url =
      process.env.DATABASE_URL_TEST && process.env.VITEST
        ? process.env.DATABASE_URL_TEST
        : loadConfig(process.env).databaseUrl;
    g.__medcheckinDb = createDb(url);
  }
  return g.__medcheckinDb;
}
