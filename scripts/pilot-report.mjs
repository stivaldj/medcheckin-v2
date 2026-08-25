// Relatório final do piloto (E10): node scripts/pilot-report.mjs --from 2026-09-01 --to 2026-09-30 [--clinic <id>] [--false-success N] [--series-min-days N]
// Rode de dentro de packages/core (resolve @medcheckin/core) ou com NODE_PATH.
// Só contagens: nenhum nome, e-mail ou telefone sai daqui (D7/LGPD).
import { createDb, loadConfig, pilotReport, renderPilotReportMarkdown } from '@medcheckin/core';

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .map((a, i, arr) => (a.startsWith('--') ? [a.slice(2), arr[i + 1]] : []))
    .filter((x) => x.length),
);
if (!args.from || !args.to) {
  console.error(
    'uso: --from YYYY-MM-DD --to YYYY-MM-DD [--clinic id] [--false-success N] [--series-min-days N]',
  );
  process.exit(2);
}
const db = createDb(loadConfig(process.env).databaseUrl);
try {
  const clinicId = args.clinic ?? (await db('clinics').first())?.id;
  if (!clinicId) throw new Error('nenhuma clínica no banco');
  const r = await pilotReport(db, {
    clinicId,
    from: args.from,
    to: args.to,
    now: new Date(),
    falseSuccess: Number(args['false-success'] ?? 0),
    seriesMinDays: Number(args['series-min-days'] ?? 10),
  });
  console.log(renderPilotReportMarkdown(r));
} finally {
  await db.destroy();
}
