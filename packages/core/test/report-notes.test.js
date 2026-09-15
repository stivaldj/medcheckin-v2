import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { freshDb, seedClinic, seedPatient } from './helpers/db.js';
import { createNote, deleteNote } from '../src/notes/index.js';
import { patientReport } from '../src/report/patientReport.js';

// F1 (spec §5): o relatório do período lista as notas clínicas da janela — dentro, aparece;
// fora ou oculta, não aparece.
describe('patientReport — notas clínicas do período', () => {
  let db, ctx, session, patientId;
  const NOW = new Date('2026-09-15T12:00:00Z');
  beforeAll(async () => {
    db = await freshDb();
    ctx = await seedClinic(db, 'report-notes');
    session = {
      kind: 'user',
      sessionId: 't',
      userId: ctx.userId,
      clinicId: ctx.clinicId,
      role: 'doctor',
      name: 'Dra.',
      email: 'dra-report-notes@example.test',
    };
    patientId = await seedPatient(db, ctx);
  });
  afterAll(async () => db.destroy());

  it('inclui nota dentro da janela, exclui nota fora e nota oculta', async () => {
    const dentro = await createNote(
      db,
      session,
      patientId,
      { body: 'Nota dentro do período', occurred_at: '2026-09-10' },
      NOW,
    );
    await createNote(
      db,
      session,
      patientId,
      { body: 'Nota fora do período', occurred_at: '2026-08-01' },
      NOW,
    );
    const oculta = await createNote(
      db,
      session,
      patientId,
      { body: 'Nota oculta', occurred_at: '2026-09-05' },
      NOW,
    );
    await deleteNote(db, session, oculta.id, NOW);

    const report = await patientReport(db, session, patientId, { days: 30, now: NOW });
    const bodies = report.notes.map((n) => n.body);
    expect(bodies).toContain('Nota dentro do período');
    expect(bodies).not.toContain('Nota fora do período');
    expect(bodies).not.toContain('Nota oculta');
    const found = report.notes.find((n) => n.id === dentro.id);
    expect(found.occurred_at).toBe('2026-09-10');
    expect(found.kind).toBe('consulta');
  });
});
