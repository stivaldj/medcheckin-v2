import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { freshDb, seedClinic, seedPatient } from './helpers/db.js';
import { createNote } from '../src/notes/index.js';
import { patientTimeline } from '../src/patients/timeline.js';
import { catalogNameKey } from '../src/catalog/nameKey.js';

// Linha do tempo agrupa nota, ajuste de dose e conduta pelo DIA CIVIL do paciente.
describe('patientTimeline', () => {
  let db, ctx, session, patientId, medicationId, alertId;
  const NOW = new Date('2026-09-15T12:00:00Z');
  beforeAll(async () => {
    db = await freshDb();
    ctx = await seedClinic(db, 'tl');
    session = {
      kind: 'user',
      sessionId: 't',
      userId: ctx.userId,
      clinicId: ctx.clinicId,
      role: 'doctor',
      name: 'Dra.',
      email: 'dra-tl@example.test',
    };
    patientId = await seedPatient(db, ctx); // America/Cuiaba (UTC-4)
    const [prod] = await db('products')
      .insert({
        clinic_id: ctx.clinicId,
        name: 'Óleo CBD 50',
        name_key: catalogNameKey('Óleo CBD 50'),
        form: 'oil',
      })
      .returning('id');
    const [med] = await db('medications')
      .insert({ patient_id: patientId, product_id: prod.id })
      .returning('id');
    medicationId = med.id;
    const [al] = await db('alerts')
      .insert({
        patient_id: patientId,
        code: 'side_effect',
        severity: 'high',
        title: 'Efeito adverso relatado',
        context: JSON.stringify({}),
        status: 'resolved',
        first_seen_at: NOW,
        last_seen_at: NOW,
      })
      .returning('id');
    alertId = al.id;
  });
  afterAll(async () => db.destroy());

  it('agrupa por dia, converte conduta para o fuso do paciente, ordena decrescente', async () => {
    await createNote(
      db,
      session,
      patientId,
      { body: 'Consulta do dia 10', occurred_at: '2026-09-10' },
      NOW,
    );
    await createNote(
      db,
      session,
      patientId,
      { body: 'Contato do dia 10', kind: 'contato', occurred_at: '2026-09-10' },
      NOW,
    );
    await db('dose_events').insert({
      medication_id: medicationId,
      effective_from: '2026-09-10',
      dose_amount: 4,
      dose_unit: 'gotas',
      times_per_day: 2,
      schedule_times: ['08:00', '20:00'],
      reason: 'titulação',
      created_by: ctx.userId,
    });
    // 2026-09-11 02:30Z = 2026-09-10 22:30 em Cuiabá → conduta cai no dia 10
    await db('alert_actions').insert({
      alert_id: alertId,
      user_id: ctx.userId,
      action: 'resolve',
      note: 'Orientei tomar após o jantar',
      at: new Date('2026-09-11T02:30:00Z'),
    });
    // dia sem nota: só o evento
    await db('dose_events').insert({
      medication_id: medicationId,
      effective_from: '2026-09-12',
      dose_amount: 6,
      dose_unit: 'gotas',
      times_per_day: 2,
      schedule_times: ['08:00', '20:00'],
      created_by: ctx.userId,
    });

    const { days } = await patientTimeline(db, session, patientId, { now: NOW });
    expect(days.map((d) => d.day)).toEqual(['2026-09-12', '2026-09-10']);
    const d12 = days[0];
    expect(d12.notes).toEqual([]);
    expect(d12.events).toHaveLength(1);
    expect(d12.events[0]).toMatchObject({ kind: 'dose' });
    expect(d12.events[0].summary).toBe('Óleo CBD 50: 6 gotas · 2×/dia (08:00, 20:00)');
    const d10 = days[1];
    expect(d10.notes.map((n) => n.body)).toEqual(['Contato do dia 10', 'Consulta do dia 10']);
    expect(d10.events.map((e) => e.kind).sort()).toEqual(['conduct', 'dose']);
    const conduta = d10.events.find((e) => e.kind === 'conduct');
    expect(conduta.summary).toBe('Efeito adverso relatado: Orientei tomar após o jantar');
    expect(conduta.by).toBe('Dra. Teste');
    const dose = d10.events.find((e) => e.kind === 'dose');
    expect(dose.summary).toBe('Óleo CBD 50: 4 gotas · 2×/dia (08:00, 20:00) — titulação');
    const audit = await db('access_audit').where({ patient_id: patientId, route: 'notes.read' });
    expect(audit).toHaveLength(1);
    expect(audit[0].action).toBe('view');
  });

  it('nota oculta não aparece; paciente de outra clínica é not_found', async () => {
    const n = await createNote(
      db,
      session,
      patientId,
      { body: 'some', occurred_at: '2026-09-01' },
      NOW,
    );
    await db('clinical_notes').where({ id: n.id }).update({ deleted_at: NOW });
    const { days } = await patientTimeline(db, session, patientId, { now: NOW });
    expect(days.some((d) => d.day === '2026-09-01')).toBe(false);
    const outra = await seedClinic(db, 'outra-tl');
    await expect(
      patientTimeline(db, { ...session, clinicId: outra.clinicId }, patientId, { now: NOW }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('janela de 60 dias com hasMore/nextBefore e before paginando para trás', async () => {
    await createNote(db, session, patientId, { body: 'velha', occurred_at: '2026-01-05' }, NOW);
    await createNote(db, session, patientId, { body: 'recente', occurred_at: '2026-09-01' }, NOW);
    const p1 = await patientTimeline(db, session, patientId, { now: NOW });
    // 2026-09-15 - 59 dias = 2026-07-18 (janela de 60 dias civis inclusive)
    expect(p1.days.every((d) => d.day >= '2026-07-18')).toBe(true);
    expect(p1.days.some((d) => d.notes.some((n) => n.body === 'velha'))).toBe(false);
    expect(p1.hasMore).toBe(true);
    expect(p1.nextBefore).toBe('2026-07-17');
    const p2 = await patientTimeline(db, session, patientId, {
      now: NOW,
      before: p1.nextBefore,
      limitDays: 400,
    });
    expect(p2.days.some((d) => d.notes.some((n) => n.body === 'velha'))).toBe(true);
    expect(p2.hasMore).toBe(false);
    expect(p2.nextBefore).toBeNull();
  });

  it('before com data-calendário inválida ou limitDays fora do intervalo → validation', async () => {
    await expect(
      patientTimeline(db, session, patientId, { now: NOW, before: '2026-02-30' }),
    ).rejects.toMatchObject({ code: 'validation', field: 'before' });
    await expect(
      patientTimeline(db, session, patientId, { now: NOW, limitDays: 0 }),
    ).rejects.toMatchObject({ code: 'validation', field: 'limitDays' });
  });
});
