import type { Knex } from 'knex';

export interface CoreConfig {
  readonly databaseUrl: string;
}

/** Fail-closed: lança se DATABASE_URL ausente. */
export function loadConfig(env?: Record<string, string | undefined>): CoreConfig;

/** Conexão Knex com Postgres (PG-only). */
export function createDb(databaseUrl: string): Knex;
