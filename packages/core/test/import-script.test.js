import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { freshDb, seedClinic } from './helpers/db.js';

const run = promisify(execFile);
const HERE =
  typeof import.meta.dirname === 'string'
    ? import.meta.dirname
    : path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const FIX = path.join(HERE, 'fixtures/versatilis');

describe('scripts/import-versatilis.mjs', () => {
  let db, dir, uploads;
  beforeAll(async () => {
    db = await freshDb();
    await seedClinic(db, 'script'); // dra-script@example.test
    dir = await mkdtemp(path.join(tmpdir(), 'mc-imp-script-'));
    uploads = await mkdtemp(path.join(tmpdir(), 'mc-imp-up-'));
    await writeFile(path.join(dir, '101.pdf'), '%PDF-1.4\n%%EOF\n');
    await writeFile(path.join(dir, '102.pdf'), '%PDF-1.4\n%%EOF\n');
    // 999.pdf não corresponde a nenhum id do cadastro: é o PDF órfão que o relatório precisa listar.
    await writeFile(path.join(dir, '999.pdf'), '%PDF-1.4\n%%EOF\n');
  });
  afterAll(async () => {
    await db.destroy();
    await rm(dir, { recursive: true, force: true });
    await rm(uploads, { recursive: true, force: true });
  });

  const env = () => ({
    ...process.env,
    DATABASE_URL: process.env.DATABASE_URL_TEST || process.env.DATABASE_URL,
    UPLOADS_DIR: uploads,
  });
  const args = (extra = []) => [
    path.join(ROOT, 'scripts/import-versatilis.mjs'),
    '--cadastro',
    path.join(FIX, 'cadastro.csv'),
    '--pdfs',
    dir,
    '--mapa',
    path.join(FIX, 'mapa.json'),
    '--clinica',
    'dra-script@example.test',
    '--saida',
    dir,
    ...extra,
  ];

  it('ensaio: escreve relatório, não grava, sai com 2 por causa das colisões', async () => {
    const r = await run('node', args(), { env: env(), cwd: ROOT }).catch((e) => e);
    expect(r.code).toBe(2);
    const files = await readdir(dir);
    const rel = files.find((f) => f.startsWith('import-ensaio-'));
    expect(rel).toBeTruthy();
    const md = await readFile(path.join(dir, rel), 'utf8');
    expect(md).toMatch(/Criar.*3/);
    expect(md).toMatch(/Colis/);
    expect(md).toMatch(/999\.pdf/); // o PDF órfão consta no relatório
    expect(md).toMatch(/Linhas ignoradas: 1/);
    expect(Number((await db('patients').count().first()).count)).toBe(0);
  });

  it('--gravar recusa com colisão; sem as linhas colidentes, grava e relata', async () => {
    const r = await run('node', args(['--gravar']), { env: env(), cwd: ROOT }).catch((e) => e);
    expect(r.code).toBe(2);
    const csv = (await readFile(path.join(FIX, 'cadastro.csv'), 'utf8'))
      .split('\n')
      .filter((l) => !l.startsWith('104;') && !l.startsWith('105;'))
      .join('\n');
    const limpo = path.join(dir, 'cadastro-limpo.csv');
    await writeFile(limpo, csv);
    const ok = await run(
      'node',
      [...args(['--gravar']).map((a) => (a.endsWith('cadastro.csv') ? limpo : a))],
      { env: env(), cwd: ROOT },
    );
    expect(ok.stdout).toMatch(/gravado|criados/i);
    // Sem 104/105 (colisão entre si), 101/102/103 ficam: nenhum tem correspondente já
    // cadastrado nesta clínica (o seed só cria a clínica, sem pacientes), então os três são
    // criados — não apenas 102/103.
    expect(
      Number((await db('patients').where({ status: 'registered' }).count().first()).count),
    ).toBe(3);
    const files = await readdir(dir);
    expect(files.some((f) => f.startsWith('import-resultado-'))).toBe(true);
  });
});
