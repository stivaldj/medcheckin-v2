import knex from 'knex';
import pg from 'pg';

// numeric (1700) e int8 (20) chegam como string por padrão no driver pg.
// Convertê-los aqui evita "4.00"/"12" virarem strings na API e na UI (L5/L7: uma fonte de verdade).
pg.types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v)));
pg.types.setTypeParser(20, (v) => (v === null ? null : parseInt(v, 10)));

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
