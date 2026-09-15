import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { freshDb, seedClinic } from './helpers/db.js';
import { parseCsv } from '../src/import/csv.js';
import { planImport, executeImport } from '../src/import/versatilis.js';
import { createPatient } from '../src/patients/index.js';

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/versatilis');
const PDF = Buffer.from('%PDF-1.4\n%%EOF\n');

describe('parseCsv', () => {
  it('RFC 4180 com ; e aspas', () => {
    const { header, rows } = parseCsv('a;b\n1;"x;y"\n2;"diz ""oi"""\n', { delimiter: ';' });
    expect(header).toEqual(['a', 'b']);
    expect(rows).toEqual([
      { a: '1', b: 'x;y' },
      { a: '2', b: 'diz "oi"' },
    ]);
  });
});

// D39: ensaio primeiro; casamento conservador; idempotente.
describe('importação Versatilis', () => {
  let db, ctx, session, mapa, rows, dir;
  const NOW = new Date('2026-09-15T12:00:00Z');
  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'mc-import-'));
    process.env.UPLOADS_DIR = dir;
    db = await freshDb();
    ctx = await seedClinic(db, 'imp');
    session = {
      kind: 'user',
      sessionId: 't',
      userId: ctx.userId,
      clinicId: ctx.clinicId,
      role: 'doctor',
      name: 'Dra.',
      email: 'dra-imp@example.test',
    };
    mapa = JSON.parse(await readFile(path.join(FIX, 'mapa.json'), 'utf8'));
    rows = parseCsv(await readFile(path.join(FIX, 'cadastro.csv'), 'utf8'), {
      delimiter: mapa.delimitador,
    }).rows;
    // paciente já existente com mesmo nome+nascimento do 101 → casa; e um homônimo com nascimento diferente
    await createPatient(
      db,
      session,
      { name: 'Jose da Silva', birth_date: '1970-03-05', consent_version: 'v1' },
      NOW,
    );
    await createPatient(
      db,
      session,
      { name: 'Carlos Existente', birth_date: '1999-09-09', consent_version: 'v1' },
      NOW,
    );
  });
  afterAll(async () => {
    await db.destroy();
    await rm(dir, { recursive: true, force: true });
    delete process.env.UPLOADS_DIR;
  });

  it('planImport classifica criar, casar, colidir, pdf órfão e paciente sem pdf', async () => {
    const existing = await db('patients')
      .where({ clinic_id: ctx.clinicId })
      .select('id', 'name_key', 'birth_date', 'external_ref');
    const plan = planImport({ rows, mapa, pdfFiles: ['101.pdf', '102.pdf', '999.pdf'], existing });
    expect(plan.casar.map((i) => i.ref)).toEqual(['101']);
    expect(plan.criar.map((i) => i.ref).sort()).toEqual(['102', '103']);
    expect(plan.colidir.map((c) => c.ref).sort()).toEqual(['104', '105']); // homônimos com nascimento diferente do existente (e entre si)
    expect(plan.pdfSemPaciente).toEqual(['999.pdf']);
    expect(plan.pacienteSemPdf.sort()).toEqual(['103', '104', '105']);
    const jose = plan.casar[0];
    expect(jose.name_key).toBe('jose da silva');
    expect(jose.birth_date).toBe('1970-03-05');
    expect(jose.conditions).toEqual(['Epilepsia', 'Dor crônica']);
    expect(jose.consultas).toEqual(['2024-02-10', '2025-08-15']);
    expect(jose.pdf).toBe('101.pdf');
    expect(jose.existingId).toBeTruthy();
    expect(plan.criar.find((i) => i.ref === '102').name).toBe('Maria "Mary" Souza');
    expect(plan.criar.find((i) => i.ref === '103').birth_date).toBeNull();
  });

  it('executeImport recusa gravar quando o plano tem colisões pendentes', async () => {
    const existing = await db('patients')
      .where({ clinic_id: ctx.clinicId })
      .select('id', 'name_key', 'birth_date', 'external_ref');
    const planComColisao = planImport({
      rows,
      mapa,
      pdfFiles: ['101.pdf', '102.pdf'],
      existing,
    });
    expect(planComColisao.colidir.length).toBeGreaterThan(0);
    await expect(
      executeImport(db, session, planComColisao, { readPdf: async () => null }, NOW),
    ).rejects.toMatchObject({ code: 'validation', field: 'colidir' });
  });

  it('executeImport grava registered + condições + notas + anexo; casa sem duplicar; é idempotente', async () => {
    // 104/105 colidem entre si (mesmo nome no CSV) — fora do escopo desta prova; o plano de
    // execução aqui só cobre linhas sem colisão pendente (a recusa é coberta no teste acima).
    const rowsSemColisao = rows.filter((r) => !['104', '105'].includes(r.id));
    const existing = await db('patients')
      .where({ clinic_id: ctx.clinicId })
      .select('id', 'name_key', 'birth_date', 'external_ref');
    const plan = planImport({
      rows: rowsSemColisao,
      mapa,
      pdfFiles: ['101.pdf', '102.pdf'],
      existing,
    });
    const readPdf = async (name) => (name === '101.pdf' || name === '102.pdf' ? PDF : null);
    const r1 = await executeImport(db, session, plan, { readPdf }, NOW);
    expect(r1).toMatchObject({ created: 2, matched: 1, attached: 2, notes: 3 });
    const maria = await db('patients')
      .where({ clinic_id: ctx.clinicId, external_ref: '102' })
      .first();
    expect(maria.status).toBe('registered');
    expect(maria.external_source).toBe('versatilis');
    expect(maria.imported_at).not.toBeNull();
    expect(maria.name).toBe('Maria "Mary" Souza');
    const conds = await db('patient_conditions as pc')
      .join('conditions as c', 'c.id', 'pc.condition_id')
      .where('pc.patient_id', maria.id)
      .select('c.name');
    expect(conds.map((c) => c.name)).toEqual(['TEA']);
    const jose = await db('patients')
      .where({ clinic_id: ctx.clinicId, external_ref: '101' })
      .first();
    expect(jose.status).toBe('active'); // já existia como ativo: casar não rebaixa
    const notas = await db('clinical_notes').where({ patient_id: jose.id }).orderBy('occurred_at');
    expect(notas.map((n) => String(n.occurred_at).slice(0, 10).length)).toEqual([10, 10]);
    expect(notas[0].kind).toBe('importada');
    expect(notas[0].source).toMatchObject({ system: 'versatilis' });
    expect(
      await db('attachments').where({ patient_id: jose.id, source: 'import' }).count().first(),
    ).toMatchObject({ count: 1 });
    const audit = await db('access_audit').where({ route: 'patients.import' });
    expect(audit).toHaveLength(3);

    const r2 = await executeImport(
      db,
      session,
      planImport({
        rows: rowsSemColisao,
        mapa,
        pdfFiles: ['101.pdf', '102.pdf'],
        existing: await db('patients')
          .where({ clinic_id: ctx.clinicId })
          .select('id', 'name_key', 'birth_date', 'external_ref'),
      }),
      { readPdf },
      NOW,
    );
    expect(r2).toMatchObject({ created: 0, attached: 0, notes: 0 });
    expect(
      Number((await db('patients').where({ clinic_id: ctx.clinicId }).count().first()).count),
    ).toBe(4);
  });
});
