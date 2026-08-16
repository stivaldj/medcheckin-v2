import { loadConfig } from '../src/config.js';
import { createDb } from '../src/db.js';
import { runSeed } from '../src/seed/index.js';

if (process.env.NODE_ENV === 'production') {
  console.error('seed: recusado em produção (D7).');
  process.exit(2);
}
const reset = process.argv.includes('--reset');
const db = createDb(loadConfig(process.env).databaseUrl);
try {
  const c = await runSeed(db, { reset });
  console.log('seed: contagens', JSON.stringify(c));
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  await db.destroy();
}
