#!/usr/bin/env node
// Importa o cadastro do Versatilis (D39): ENSAIO por padrão (relatório, nada gravado); --gravar executa.
// Uso: node --env-file=.env scripts/import-versatilis.mjs --cadastro arquivo.csv --pdfs pasta/ --mapa mapa.json --clinica medica@clinica.com [--gravar] [--saida pasta/]
// Sai com 0 (ok), 2 (colisões pendentes) ou 3 (erro de uso).
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createDb, loadConfig, parseCsv, planImport, executeImport } from '@medcheckin/core';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
for (const k of ['cadastro', 'pdfs', 'mapa', 'clinica']) {
  if (!args[k] || args[k] === true) {
    console.error(
      'uso: --cadastro <csv> --pdfs <pasta> --mapa <json> --clinica <email da médica> [--gravar] [--saida <pasta>]',
    );
    process.exit(3);
  }
}
const gravar = args.gravar === true;
const saida = typeof args.saida === 'string' ? args.saida : process.cwd();
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

const cfg = loadConfig(process.env);
const db = createDb(cfg.databaseUrl);
let exitCode = 0;
try {
  const user = await db('users')
    .where({ email: String(args.clinica).trim().toLowerCase() })
    .first();
  if (!user) throw new Error(`médica não encontrada: ${args.clinica}`);
  const session = {
    kind: 'user',
    sessionId: 'import',
    userId: user.id,
    clinicId: user.clinic_id,
    role: user.role,
    name: user.name,
    email: user.email,
  };

  const mapa = JSON.parse(await readFile(args.mapa, 'utf8'));
  const { rows } = parseCsv(await readFile(args.cadastro, 'utf8'), {
    delimiter: mapa.delimitador || ';',
  });
  const pdfFiles = (await readdir(args.pdfs)).filter((f) => f.toLowerCase().endsWith('.pdf'));
  const existing = await db('patients')
    .where({ clinic_id: session.clinicId })
    .select('id', 'name_key', 'birth_date', 'external_ref');
  const plan = planImport({ rows, mapa, pdfFiles, existing });

  const linhas = [
    `# Importação Versatilis — ${gravar ? 'RESULTADO' : 'ENSAIO'} ${stamp}`,
    '',
    `- Linhas no CSV: ${rows.length}`,
    `- PDFs na pasta: ${pdfFiles.length}`,
    `- Criar: ${plan.criar.length}`,
    `- Casar com paciente existente: ${plan.casar.length}`,
    `- Colisões (não gravadas): ${plan.colidir.length}`,
    `- PDFs sem paciente: ${plan.pdfSemPaciente.length}`,
    `- Pacientes sem PDF: ${plan.pacienteSemPdf.length}`,
    `- Linhas ignoradas: ${plan.ignoradas.length}`,
    '',
    '## Colisões',
    ...(plan.colidir.length
      ? plan.colidir.map(
          (c) => `- ref ${c.ref} · ${c.name} · nasc. ${c.birth_date ?? '—'} — ${c.motivo}`,
        )
      : ['- nenhuma']),
    '',
    '## PDFs sem paciente',
    ...(plan.pdfSemPaciente.length ? plan.pdfSemPaciente.map((f) => `- ${f}`) : ['- nenhum']),
    '',
    '## Pacientes sem PDF (refs)',
    ...(plan.pacienteSemPdf.length ? [plan.pacienteSemPdf.join(', ')] : ['- nenhum']),
    '',
    '## Ignoradas',
    ...(plan.ignoradas.length
      ? plan.ignoradas.map((i) => `- linha ${i.linha} — ${i.motivo}`)
      : ['- nenhuma']),
  ];

  if (gravar && plan.colidir.length) {
    console.error(
      `Há ${plan.colidir.length} colisão(ões). Resolva no CSV/mapa e rode o ensaio de novo.`,
    );
    await writeFile(path.join(saida, `import-ensaio-${stamp}.md`), linhas.join('\n') + '\n');
    exitCode = 2;
  } else if (gravar) {
    const t0 = Date.now();
    const readPdf = async (f) => readFile(path.join(args.pdfs, f)).catch(() => null);
    const r = await executeImport(db, session, plan, { readPdf }, new Date());
    linhas.push(
      '',
      '## Gravado',
      `- criados: ${r.created}`,
      `- casados: ${r.matched}`,
      `- anexos: ${r.attached}`,
      `- notas de consulta: ${r.notes}`,
      `- tempo: ${Math.round((Date.now() - t0) / 1000)} s`,
    );
    await writeFile(path.join(saida, `import-resultado-${stamp}.md`), linhas.join('\n') + '\n');
    console.log(
      `gravado: ${r.created} criados, ${r.matched} casados, ${r.attached} anexos, ${r.notes} notas.`,
    );
  } else {
    await writeFile(path.join(saida, `import-ensaio-${stamp}.md`), linhas.join('\n') + '\n');
    console.log(linhas.slice(0, 10).join('\n'));
    if (plan.colidir.length) exitCode = 2;
  }
} finally {
  await db.destroy();
}
process.exit(exitCode);
