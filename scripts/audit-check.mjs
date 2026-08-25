// Porta de segurança de dependências: `npm audit` high/critical com exceções DATADAS.
// Falha quando: aparece vulnerabilidade high+ fora de docs/audit-excecoes.json, ou uma exceção
// passou da data de reavaliação. Decisão de E0, exigível desde E8.
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BAD = new Set(['high', 'critical']);

const raw = await promisify(execFile)('npm', ['audit', '--json'], {
  cwd: root,
  maxBuffer: 32 * 1024 * 1024,
})
  .then((r) => r.stdout)
  // `npm audit` sai com código != 0 quando encontra algo: o relatório vem no stdout mesmo assim
  .catch((err) => {
    if (!err.stdout) throw err;
    return err.stdout;
  });

const report = JSON.parse(raw);
const { excecoes } = JSON.parse(readFileSync(path.join(root, 'docs/audit-excecoes.json'), 'utf8'));
const byPkg = new Map(excecoes.map((e) => [e.pacote, e]));
const today = new Date().toISOString().slice(0, 10);

const found = Object.entries(report.vulnerabilities ?? {}).filter(([, v]) => BAD.has(v.severity));
const naoPrevistas = found.filter(([name]) => !byPkg.has(name));
const vencidas = excecoes.filter((e) => e.reavaliar_em < today);

for (const [name, v] of found) {
  const e = byPkg.get(name);
  const marca = !e
    ? '❌ NÃO PREVISTA'
    : e.reavaliar_em < today
      ? '❌ EXCEÇÃO VENCIDA'
      : '⚠️  aceita';
  console.log(`${marca}  ${name} (${v.severity}) — fix: ${v.fixAvailable?.version ?? 'nenhum'}`);
  if (e) console.log(`     ${e.motivo} · reavaliar em ${e.reavaliar_em}`);
}
if (!found.length) console.log('✅ nenhuma vulnerabilidade high/critical');

if (naoPrevistas.length || vencidas.length) {
  console.error(
    `\n${naoPrevistas.length} vulnerabilidade(s) high+ fora de docs/audit-excecoes.json e ` +
      `${vencidas.length} exceção(ões) vencida(s). Corrija a dependência ou atualize o arquivo com motivo e nova data.`,
  );
  process.exit(1);
}
console.log('\n✅ porta de dependências: nada fora do previsto');
