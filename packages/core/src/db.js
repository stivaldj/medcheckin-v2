import knex from 'knex';

/**
 * Cria conexão Knex com Postgres. Sem dialeto alternativo (D6: PG-only).
 */
export function createDb(databaseUrl) {
  if (!databaseUrl) throw new Error('createDb: databaseUrl obrigatório');
  return knex({
    client: 'pg',
    connection: databaseUrl,
    pool: { min: 0, max: 5 },
  });
}
