import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Config Knex de migrations (ESM, PG-only). Compartilhada por scripts e testes. */
export const migrationConfig = Object.freeze({
  directory: path.join(here, 'migrations'),
  tableName: 'knex_migrations',
  loadExtensions: ['.js'],
});

export async function migrateLatest(db) {
  const [batch, files] = await db.migrate.latest(migrationConfig);
  return { batch, files };
}

export async function migrateRollbackAll(db) {
  return db.migrate.rollback(migrationConfig, true);
}
