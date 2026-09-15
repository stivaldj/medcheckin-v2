import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { freshDb, seedClinic, seedPatient } from './helpers/db.js';
import { createNote, updateNote, deleteNote, listNotes, noteDay } from '../src/notes/index.js';
import { exportPatientData } from '../src/lgpd/export.js';
import { anonymizePatient } from '../src/lgpd/anonymize.js';

// D35: nota livre datada, nunca apagada; ocultar preserva no export; anonimizar apaga o corpo.
describe('notas clínicas', () => {
  let db, ctx, session, patientId;
  // 2026-09-15 02:30Z = 2026-09-14 22:30 em America/Cuiaba → "hoje" no fuso do paciente é 14/09
  const NOW = new Date('2026-09-15T02:30:00Z');
  beforeAll(async () => {
    db = await freshDb();
    ctx = await seedClinic(db, 'notas');
    session = {
      kind: 'user',
      sessionId: 't',
      userId: ctx.userId,
      clinicId: ctx.clinicId,
      role: 'doctor',
      name: 'Dra.',
      email: 'dra-notas@example.test',
    };
    patientId = await seedPatient(db, ctx);
  });
  afterAll(async () => db.destroy());

  it('cria com padrões (consulta, hoje no fuso do paciente) e valida corpo/tipo/data', async () => {
    const n = await createNote(db, session, patientId, { body: '  Primeira consulta. ' }, NOW);
    expect(n.kind).toBe('consulta');
    expect(noteDay(n.occurred_at)).toBe('2026-09-14');
    expect(n.body).toBe('Primeira consulta.');
    expect(n.created_by).toBe(ctx.userId);
    await expect(createNote(db, session, patientId, { body: '   ' }, NOW)).rejects.toMatchObject({
      code: 'validation',
      field: 'body',
    });
    await expect(
      createNote(db, session, patientId, { body: 'a'.repeat(20001) }, NOW),
    ).rejects.toMatchObject({ code: 'validation', field: 'body' });
    await expect(
      createNote(db, session, patientId, { body: 'x', kind: 'soap' }, NOW),
    ).rejects.toMatchObject({ code: 'validation', field: 'kind' });
    // 15/09 ainda é futuro no fuso do paciente às 02:30Z
    await expect(
      createNote(db, session, patientId, { body: 'x', occurred_at: '2026-09-15' }, NOW),
    ).rejects.toMatchObject({ code: 'validation', field: 'occurred_at' });
    await expect(
      createNote(db, session, patientId, { body: 'x', occurred_at: '15/09/2026' }, NOW),
    ).rejects.toMatchObject({ code: 'validation', field: 'occurred_at' });
  });

  it('edita, oculta (segue no banco e no export), e não edita nota importada', async () => {
    const n = await createNote(
      db,
      session,
      patientId,
      { body: 'Evolução', kind: 'evolucao', occurred_at: '2026-09-01' },
      NOW,
    );
    const up = await updateNote(db, session, n.id, { body: 'Evolução corrigida' }, NOW);
    expect(up.body).toBe('Evolução corrigida');
    const del = await deleteNote(db, session, n.id, NOW);
    expect(del.deleted_at).not.toBeNull();
    expect((await listNotes(db, session, patientId)).map((x) => x.id)).not.toContain(n.id);
    expect(
      (await listNotes(db, session, patientId, { includeDeleted: true })).map((x) => x.id),
    ).toContain(n.id);
    await expect(updateNote(db, session, n.id, { body: 'de novo' }, NOW)).rejects.toMatchObject({
      code: 'not_found',
    });
    const { files, manifest } = await exportPatientData(db, session, patientId, NOW);
    expect(files['clinical_notes.json'].map((x) => x.id)).toContain(n.id);
    expect(manifest.counts.clinical_notes).toBeGreaterThanOrEqual(2);

    const [imp] = await db('clinical_notes')
      .insert({
        patient_id: patientId,
        kind: 'importada',
        occurred_at: '2020-01-01',
        body: 'Do PDF',
        source: JSON.stringify({ file: 'x.pdf', page: 2 }),
        created_by: ctx.userId,
      })
      .returning('*');
    await expect(updateNote(db, session, imp.id, { body: 'y' }, NOW)).rejects.toMatchObject({
      code: 'validation',
    });
    const audit = await db('access_audit')
      .where({ patient_id: patientId })
      .whereIn('route', ['notes.create', 'notes.update', 'notes.delete']);
    expect(audit.map((a) => a.route).sort()).toEqual([
      'notes.create',
      'notes.create',
      'notes.delete',
      'notes.update',
    ]);
  });

  it('nota de outra clínica é not_found', async () => {
    const outra = await seedClinic(db, 'outra-notas');
    const pOutra = await seedPatient(db, outra, 'Fora');
    const n = await createNote(
      db,
      { ...session, clinicId: outra.clinicId, userId: outra.userId },
      pOutra,
      { body: 'segredo' },
      NOW,
    );
    await expect(updateNote(db, session, n.id, { body: 'x' }, NOW)).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(listNotes(db, session, pOutra)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('anonimizar apaga o corpo das notas e mantém tipo e data', async () => {
    await createNote(db, session, patientId, { body: 'Nome do vizinho aqui' }, NOW);
    await anonymizePatient(db, session, patientId, { reason: 'pedido do titular' }, NOW);
    const rows = await db('clinical_notes').where({ patient_id: patientId });
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.body).toBe('[removido]');
      expect(r.kind).toBeTruthy();
      expect(r.occurred_at).toBeTruthy();
    }
  });
});
