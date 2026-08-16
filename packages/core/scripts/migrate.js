import { loadConfig } from '../src/config.js';
import { createDb } from '../src/db.js';
import { migrateLatest } from '../src/migrate.js';

const db = createDb(loadConfig(process.env).databaseUrl);
try {
  const { batch, files } = await migrateLatest(db);
  if (files.length === 0) console.log('migrate: já atualizado (nada a aplicar).');
  else console.log(`migrate: batch ${batch} aplicado → ${files.join(', ')}`);
} finally {
  await db.destroy();
}
