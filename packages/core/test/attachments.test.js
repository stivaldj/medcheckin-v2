import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { freshDb, seedClinic, seedPatient } from './helpers/db.js';
import { catalogNameKey } from '../src/catalog/nameKey.js';
import {
  ATTACHMENT_MAX_BYTES,
  sniffKind,
  storeAttachment,
  listAttachments,
  openAttachment,
  hideAttachment,
  attachmentAbsolutePath,
} from '../src/attachments/index.js';
import { exportPatientData } from '../src/lgpd/export.js';
import { anonymizePatient } from '../src/lgpd/anonymize.js';

const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n');
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(32),
]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32)]);
const EXE = Buffer.from('MZ��isto nao e um pdf');

// D38: anexo = arquivo no volume + metadados no banco; tipo pelos bytes; ocultar sem apagar.
describe('anexos', () => {
  let db, ctx, session, patientId, dir;
  const NOW = new Date('2026-09-15T12:00:00Z');
  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'mc-uploads-'));
    process.env.UPLOADS_DIR = dir;
    db = await freshDb();
    ctx = await seedClinic(db, 'anexo');
    session = {
      kind: 'user',
      sessionId: 't',
      userId: ctx.userId,
      clinicId: ctx.clinicId,
      role: 'doctor',
      name: 'Dra.',
      email: 'dra-anexo@example.test',
    };
    patientId = await seedPatient(db, ctx);
  });
  afterAll(async () => {
    await db.destroy();
    await rm(dir, { recursive: true, force: true });
    delete process.env.UPLOADS_DIR;
  });

  it('sniffKind decide pelos bytes', () => {
    expect(sniffKind(PDF)).toBe('pdf');
    expect(sniffKind(PNG)).toBe('image');
    expect(sniffKind(JPG)).toBe('image');
    expect(sniffKind(EXE)).toBeNull();
    expect(sniffKind(Buffer.alloc(2))).toBeNull();
  });

  it('grava PDF no volume com nome opaco, metadados e auditoria; duplicata devolve o existente', async () => {
    const a = await storeAttachment(
      db,
      session,
      patientId,
      { buffer: PDF, originalName: 'Prontuário antigo.pdf', mime: 'application/pdf' },
      NOW,
    );
    expect(a.kind).toBe('pdf');
    expect(a.size_bytes).toBe(PDF.length);
    expect(a.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(a.stored_path).toMatch(new RegExp(`^${ctx.clinicId}/[0-9a-f-]{36}\\.pdf$`));
    expect(a.source).toBe('upload');
    expect(a.uploaded_by).toBe(ctx.userId);
    const abs = attachmentAbsolutePath(a);
    expect(abs.startsWith(dir)).toBe(true);
    expect((await readFile(abs)).equals(PDF)).toBe(true);
    const again = await storeAttachment(
      db,
      session,
      patientId,
      { buffer: PDF, originalName: 'copia.pdf', mime: 'application/pdf' },
      NOW,
    );
    expect(again.id).toBe(a.id);
    expect(await db('attachments').where({ patient_id: patientId }).count().first()).toMatchObject({
      count: 1,
    });
    const audit = await db('access_audit').where({
      patient_id: patientId,
      route: 'attachments.create',
    });
    expect(audit).toHaveLength(1);
  });

  it('recusa tipo pelos bytes (mesmo com extensão .pdf), tamanho acima do limite e não deixa lixo no disco', async () => {
    await expect(
      storeAttachment(
        db,
        session,
        patientId,
        { buffer: EXE, originalName: 'virus.pdf', mime: 'application/pdf' },
        NOW,
      ),
    ).rejects.toMatchObject({ code: 'validation', field: 'file' });
    const big = Buffer.concat([PDF, Buffer.alloc(ATTACHMENT_MAX_BYTES + 1 - PDF.length)]);
    await expect(
      storeAttachment(
        db,
        session,
        patientId,
        { buffer: big, originalName: 'grande.pdf', mime: 'application/pdf' },
        NOW,
      ),
    ).rejects.toMatchObject({ code: 'validation', field: 'file' });
    const files = await import('node:fs/promises').then((fs) =>
      fs.readdir(path.join(dir, ctx.clinicId)),
    );
    expect(files).toHaveLength(1); // só o PDF válido do teste anterior
  });

  it('insert falho apaga o arquivo recém-escrito', async () => {
    // patient_id inexistente passa pelo requirePatientInClinic? não — então força o erro no insert com um
    // uploaded_by inválido via sessão de outro usuário inexistente.
    const bad = { ...session, userId: '00000000-0000-0000-0000-000000000000' };
    await expect(
      storeAttachment(
        db,
        bad,
        patientId,
        { buffer: PNG, originalName: 'x.png', mime: 'image/png' },
        NOW,
      ),
    ).rejects.toBeTruthy();
    const files = await import('node:fs/promises').then((fs) =>
      fs.readdir(path.join(dir, ctx.clinicId)),
    );
    expect(files.filter((f) => f.endsWith('.png'))).toHaveLength(0);
  });

  it('lista visíveis, abre conferindo clínica, oculta sem apagar', async () => {
    const img = await storeAttachment(
      db,
      session,
      patientId,
      { buffer: JPG, originalName: 'exame.jpg', mime: 'image/jpeg' },
      NOW,
    );
    expect((await listAttachments(db, session, patientId)).map((x) => x.id).sort()).toHaveLength(2);
    const opened = await openAttachment(db, session, img.id, NOW);
    expect(opened.row.id).toBe(img.id);
    expect(existsSync(opened.path)).toBe(true);
    const outra = await seedClinic(db, 'outra-anexo');
    await expect(
      openAttachment(
        db,
        { ...session, clinicId: outra.clinicId, userId: outra.userId },
        img.id,
        NOW,
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
    const hidden = await hideAttachment(db, session, img.id, NOW);
    expect(hidden.deleted_at).not.toBeNull();
    expect((await listAttachments(db, session, patientId)).map((x) => x.id)).not.toContain(img.id);
    expect(existsSync(attachmentAbsolutePath(hidden))).toBe(true); // ocultar não apaga
    await expect(openAttachment(db, session, img.id, NOW)).rejects.toMatchObject({
      code: 'not_found',
    });
    const audit = await db('access_audit')
      .where({ patient_id: patientId })
      .whereIn('route', ['attachments.read', 'attachments.delete']);
    expect(audit.map((a) => a.route).sort()).toEqual(['attachments.delete', 'attachments.read']);
  });

  it('export traz metadados e bytes; anonimização apaga do disco, o nome original e recalcula name_key', async () => {
    const { files, manifest } = await exportPatientData(db, session, patientId, NOW);
    expect(files['attachments.json']).toHaveLength(2); // inclui a oculta
    expect(manifest.counts.attachments).toBe(2);
    expect(Object.keys(files).some((k) => k.startsWith('anexos/'))).toBe(true);
    const paths = (await db('attachments').where({ patient_id: patientId })).map(
      attachmentAbsolutePath,
    );
    await anonymizePatient(db, session, patientId, { reason: 'pedido do titular' }, NOW);
    for (const p of paths) expect(existsSync(p)).toBe(false);
    const rows = await db('attachments').where({ patient_id: patientId }).orderBy('created_at');
    expect(rows.map((r) => r.original_name)).toEqual(['anexo 1', 'anexo 2']);
    const patient = await db('patients').where({ id: patientId }).first();
    expect(patient.name_key).toBe(catalogNameKey(patient.name));
    expect(patient.name_key).not.toContain(catalogNameKey('Paciente Teste'));
  });

  // Fix round 1 — achado 1: nome de entrada do ZIP sem higienização (zip slip / header injection).
  it('higieniza o nome original: sem barra, sem "..", sem aspas nem caractere de controle', async () => {
    const outroPaciente = await seedPatient(db, ctx, 'Outro Paciente');
    const a = await storeAttachment(
      db,
      session,
      outroPaciente,
      { buffer: PDF, originalName: '../../x/"evil".pdf\r\n', mime: 'application/pdf' },
      NOW,
    );
    expect(a.original_name).not.toMatch(/[/\\]/);
    expect(a.original_name).not.toMatch(/\.\./);
    expect(a.original_name).not.toMatch(/["\r\n]/);
    const { files } = await exportPatientData(db, session, outroPaciente, NOW);
    const anexoKey = Object.keys(files).find((k) => k.startsWith('anexos/'));
    expect(anexoKey).toBeDefined();
    expect(anexoKey).not.toMatch(/\.\./);
  });

  // Fix round 1 — achado 3: reenvio do mesmo arquivo depois de ocultar reativa em vez de ficar
  // escondido silenciosamente.
  it('reenviar o mesmo arquivo depois de ocultar reativa o anexo (não cria outra linha)', async () => {
    const outroPaciente = await seedPatient(db, ctx, 'Paciente Reativação');
    const a = await storeAttachment(
      db,
      session,
      outroPaciente,
      { buffer: PNG, originalName: 'exame.png', mime: 'image/png' },
      NOW,
    );
    await hideAttachment(db, session, a.id, NOW);
    expect((await listAttachments(db, session, outroPaciente)).map((x) => x.id)).not.toContain(
      a.id,
    );
    const reenviado = await storeAttachment(
      db,
      session,
      outroPaciente,
      { buffer: PNG, originalName: 'exame de novo.png', mime: 'image/png' },
      NOW,
    );
    expect(reenviado.id).toBe(a.id);
    expect(reenviado.deleted_at).toBeNull();
    expect((await listAttachments(db, session, outroPaciente)).map((x) => x.id)).toContain(a.id);
    expect(
      await db('attachments').where({ patient_id: outroPaciente }).count().first(),
    ).toMatchObject({
      count: 1,
    });
    const audit = await db('access_audit').where({
      patient_id: outroPaciente,
      route: 'attachments.create',
    });
    expect(audit).toHaveLength(2); // upload original + reativação
  });

  // Fix round 1 — achado 2: anonimização não pode apagar bytes dentro da transação; e um arquivo
  // já ausente no disco não pode derrubar a anonimização inteira.
  it('anonimização conclui mesmo se um arquivo já não existe mais no disco', async () => {
    const outroPaciente = await seedPatient(db, ctx, 'Paciente Arquivo Sumido');
    const a = await storeAttachment(
      db,
      session,
      outroPaciente,
      { buffer: JPG, originalName: 'sumido.jpg', mime: 'image/jpeg' },
      NOW,
    );
    await rm(attachmentAbsolutePath(a), { force: true });
    expect(existsSync(attachmentAbsolutePath(a))).toBe(false);
    await expect(
      anonymizePatient(db, session, outroPaciente, { reason: 'pedido do titular' }, NOW),
    ).resolves.toBeTruthy();
    const rows = await db('attachments').where({ patient_id: outroPaciente });
    expect(rows.map((r) => r.original_name)).toEqual(['anexo 1']);
  });
});
