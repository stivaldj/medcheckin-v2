// Gera o relatório do shadow run: node scripts/shadow-report.mjs --from 2026-09-01 --to 2026-09-07 [--clinic <id>]
// Rode de dentro de packages/core (resolve @medcheckin/core) ou com NODE_PATH.
import { createDb, loadConfig, shadowReport, renderShadowReportMarkdown } from '@medcheckin/core';
const args = Object.fromEntries(
  process.argv
    .slice(2)
    .map((a, i, arr) => (a.startsWith('--') ? [a.slice(2), arr[i + 1]] : []))
    .filter((x) => x.length),
);
if (!args.from || !args.to) {
  console.error('uso: --from YYYY-MM-DD --to YYYY-MM-DD [--clinic id]');
  process.exit(2);
}
const db = createDb(loadConfig(process.env).databaseUrl);
try {
  const clinicId = args.clinic ?? (await db('clinics').first())?.id;
  const r = await shadowReport(db, { clinicId, from: args.from, to: args.to, now: new Date() });
  console.log(renderShadowReportMarkdown(r));
} finally {
  await db.destroy();
}
