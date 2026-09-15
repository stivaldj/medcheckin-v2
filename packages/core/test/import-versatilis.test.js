import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { freshDb, seedClinic } from './helpers/db.js';
import { parseCsv } from '../src/import/csv.js';
import { planImport, executeImport } from '../src/import/versatilis.js';
import { createPatient } from '../src/patients/index.js';
import { noteDay } from '../src/notes/index.js';

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

  it('remove o BOM inicial do cabeçalho', () => {
    const { header, rows } = parseCsv('﻿a;b\n1;2\n', { delimiter: ';' });
    expect(header).toEqual(['a', 'b']);
    expect(rows).toEqual([{ a: '1', b: '2' }]);
  });

  it('quebra de linha dentro de campo citado permanece um único campo', () => {
    const { header, rows } = parseCsv('a;b\n1;"linha um\nlinha dois"\n', { delimiter: ';' });
    expect(header).toEqual(['a', 'b']);
    expect(rows).toEqual([{ a: '1', b: 'linha um\nlinha dois' }]);
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

  it('planImport classifica criar, casar, colidir, ignoradas, pdf órfão e paciente sem pdf', async () => {
    const existing = await db('patients')
      .where({ clinic_id: ctx.clinicId })
      .select('id', 'name_key', 'birth_date', 'external_ref');
    const plan = planImport({ rows, mapa, pdfFiles: ['101.pdf', '102.pdf', '999.pdf'], existing });
    expect(plan.casar.map((i) => i.ref)).toEqual(['101']);
    expect(plan.criar.map((i) => i.ref).sort()).toEqual(['102', '103']);
    expect(plan.colidir.map((c) => c.ref).sort()).toEqual(['104', '105']); // homônimos com nascimento diferente do existente (e entre si)
    expect(plan.pdfSemPaciente).toEqual(['999.pdf']);
    expect(plan.pacienteSemPdf.sort()).toEqual(['103', '104', '105']);
    // a linha 6 do CSV (sem id) não vira paciente, mas também não some silenciosamente
    expect(plan.ignoradas).toEqual([{ linha: 6, motivo: 'sem id' }]);
    expect(
      plan.criar.length + plan.casar.length + plan.colidir.length + plan.ignoradas.length,
    ).toBe(rows.length);
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

  it('planImport: dois cadastros já exatamente iguais (nome+nascimento) → colisão, não criação', async () => {
    // Clínica isolada de propósito: não deve interferir na contagem final de pacientes de `ctx`.
    const c2 = await seedClinic(db, 'imp-dup');
    const session2 = { ...session, clinicId: c2.clinicId, userId: c2.userId };
    await createPatient(
      db,
      session2,
      { name: 'Duplicado Exato', birth_date: '2000-01-01', consent_version: 'v1' },
      NOW,
    );
    await createPatient(
      db,
      session2,
      { name: 'Duplicado Exato', birth_date: '2000-01-01', consent_version: 'v1' },
      NOW,
    );
    const existing = await db('patients')
      .where({ clinic_id: c2.clinicId })
      .select('id', 'name_key', 'birth_date', 'external_ref');
    const plan = planImport({
      rows: [
        {
          id: '900',
          'Nome do Paciente': 'Duplicado Exato',
          Nascimento: '01/01/2000',
          Telefone: '',
          Diagnósticos: '',
          Consultas: '',
        },
      ],
      mapa,
      pdfFiles: [],
      existing,
    });
    expect(plan.criar).toEqual([]);
    expect(plan.casar).toEqual([]);
    expect(plan.colidir).toHaveLength(1);
    expect(plan.colidir[0]).toMatchObject({
      ref: '900',
      motivo: 'mais de um paciente já cadastrado com este nome e nascimento',
    });
  });

  it('planImport: id (ref) repetido no CSV vira colisão para as duas linhas', () => {
    const plan = planImport({
      rows: [
        {
          id: '950',
          'Nome do Paciente': 'Fulano A',
          Nascimento: '',
          Telefone: '',
          Diagnósticos: '',
          Consultas: '',
        },
        {
          id: '950',
          'Nome do Paciente': 'Fulano B',
          Nascimento: '',
          Telefone: '',
          Diagnósticos: '',
          Consultas: '',
        },
      ],
      mapa,
      pdfFiles: [],
      existing: [],
    });
    expect(plan.criar).toEqual([]);
    expect(plan.casar).toEqual([]);
    expect(plan.colidir.map((c) => c.ref)).toEqual(['950', '950']);
    expect(plan.colidir.every((c) => c.motivo === 'id repetido no CSV')).toBe(true);
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

  it('executeImport recusa "casar" com paciente de outra clínica; nada é gravado', async () => {
    const other = await seedClinic(db, 'imp-outra');
    const [outroPaciente] = await db('patients')
      .insert({
        clinic_id: other.clinicId,
        name: 'Paciente de Outra Clínica',
        name_key: 'paciente de outra clinica',
        timezone: 'America/Cuiaba',
        status: 'active',
        created_by: other.userId,
      })
      .returning('id');
    const plan = {
      criar: [],
      casar: [
        {
          ref: 'x1',
          name: 'Paciente de Outra Clínica',
          name_key: 'paciente de outra clinica',
          birth_date: null,
          phone: null,
          conditions: [],
          consultas: [],
          pdf: null,
          existingId: outroPaciente.id,
        },
      ],
      colidir: [],
      pdfSemPaciente: [],
      pacienteSemPdf: [],
      ignoradas: [],
    };
    const patientsBefore = await db('patients').count().first();
    const auditBefore = await db('access_audit')
      .where({ route: 'patients.import' })
      .count()
      .first();
    await expect(
      executeImport(db, session, plan, { readPdf: async () => null }, NOW),
    ).rejects.toMatchObject({ code: 'not_found' });
    const patientsAfter = await db('patients').count().first();
    const auditAfter = await db('access_audit').where({ route: 'patients.import' }).count().first();
    expect(Number(patientsAfter.count)).toBe(Number(patientsBefore.count));
    expect(Number(auditAfter.count)).toBe(Number(auditBefore.count));
    // a sessão da própria clínica também não altera o registro alheio
    const naoTocado = await db('patients').where({ id: outroPaciente.id }).first();
    expect(naoTocado.external_ref).toBeNull();
  });

  it('executeImport grava registered + condições + notas + anexo + respondente; casa sem duplicar; é idempotente', async () => {
    // 104/105 colidem entre si (mesmo nome no CSV) — fora do escopo desta prova; o plano de
    // execução aqui só cobre linhas sem colisão pendente (a recusa é coberta em teste dedicado).
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
    expect(notas.map((n) => noteDay(n.occurred_at))).toEqual(['2024-02-10', '2025-08-15']);
    expect(notas[0].kind).toBe('importada');
    expect(notas[0].source).toMatchObject({ system: 'versatilis' });
    expect(
      await db('attachments').where({ patient_id: jose.id, source: 'import' }).count().first(),
    ).toMatchObject({ count: 1 });
    const audit = await db('access_audit').where({ route: 'patients.import' });
    expect(audit).toHaveLength(3);

    // 103 (Ana Paula Lima) tem telefone e foi criada agora: vira respondente "paciente".
    const ana = await db('patients')
      .where({ clinic_id: ctx.clinicId, external_ref: '103' })
      .first();
    const anaResp = await db('respondents').where({ patient_id: ana.id });
    expect(anaResp).toHaveLength(1);
    expect(anaResp[0]).toMatchObject({ kind: 'patient', phone: '65999990003', can_answer: true });
    expect(anaResp[0].invite_token).toBeTruthy();
    // Maria não tem telefone na fixture: nenhum respondente criado para ela.
    expect(await db('respondents').where({ patient_id: maria.id })).toHaveLength(0);
    // José casou (já existia, criado por createPatient no beforeAll com seu respondente próprio):
    // a importação não mexe em respondentes de quem já era acompanhado, então continua com só 1.
    expect(await db('respondents').where({ patient_id: jose.id })).toHaveLength(1);

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
    // idempotente também para respondentes: não duplica no rerun
    expect(await db('respondents').where({ patient_id: ana.id })).toHaveLength(1);
  });
});
