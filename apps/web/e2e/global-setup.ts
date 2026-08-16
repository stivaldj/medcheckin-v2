import { createDb, migrationConfig, runSeed } from '@medcheckin/core';

/** Banco de teste limpo + seed sintético antes de subir o servidor. */
export default async function globalSetup() {
  const db = createDb(process.env.DATABASE_URL_TEST || process.env.DATABASE_URL!);
  await db.migrate.rollback(migrationConfig, true);
  await db.migrate.latest(migrationConfig);
  await runSeed(db, { reset: true });
  await db.destroy();
}
