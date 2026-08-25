import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { freshDb, seedClinic, seedPatient } from './helpers/db.js';
import { currentDose } from '../src/doses/currentDose.js';

// D3: dose vigente = último dose_event com effective_from <= momento consultado.
describe('dose vigente (dose_events)', () => {
  let db, medicationId, ctx;
  beforeAll(async () => {
    db = await freshDb();
    ctx = await seedClinic(db, 'dose');
    const patientId = await seedPatient(db, ctx);
    const [prod] = await db('products')
      .insert({
        clinic_id: ctx.clinicId,
        name: 'Óleo CBD 50',
        cbd_mg_ml: 50,
        thc_mg_ml: 0.5,
        form: 'oil',
      })
      .returning('id');
    const [med] = await db('medications')
      .insert({ patient_id: patientId, product_id: prod.id })
      .returning('id');
    medicationId = med.id;
    const base = {
      medication_id: medicationId,
      dose_unit: 'gotas',
      times_per_day: 2,
      schedule_times: ['08:00', '20:00'],
      created_by: ctx.userId,
    };
    await db('dose_events').insert([
      { ...base, effective_from: '2026-08-01', dose_amount: 2, reason: 'início' },
      { ...base, effective_from: '2026-08-10', dose_amount: 4, reason: 'titulação' },
      { ...base, effective_from: '2026-09-01', dose_amount: 6, reason: 'futuro (agendado)' },
    ]);
  });
  afterAll(async () => {
    await db.destroy();
  });

  it('devolve o ajuste mais recente com effective_from <= data', async () => {
    const d = await currentDose(db, medicationId, new Date('2026-08-16T12:00:00Z'));
    expect(d.dose_amount).toBe(4);
    expect(d.reason).toBe('titulação');
  });

  it('ignora ajustes futuros', async () => {
    const d = await currentDose(db, medicationId, new Date('2026-08-05T12:00:00Z'));
    expect(d.dose_amount).toBe(2);
  });

  it('sem ajuste vigente → null (nunca 0 — L5)', async () => {
    const d = await currentDose(db, medicationId, new Date('2026-07-01T00:00:00Z'));
    expect(d).toBeNull();
  });

  // Auditoria 2026-08-25, P0-1: o corte do dia é o DIA LOCAL do paciente, não o dia UTC.
  it('P0-1: com o fuso do paciente, a dose de amanhã NÃO vale às 21:00 locais', async () => {
    // 2026-09-01T01:00Z = 31/08 21:00 em Cuiabá (UTC-4): o dia local ainda é 31/08
    const d = await currentDose(
      db,
      medicationId,
      new Date('2026-09-01T01:00:00Z'),
      'America/Cuiaba',
    );
    expect(d.dose_amount).toBe(4);
  });

  it('P0-1: fuso à frente do UTC — a dose de hoje local já vale de manhã cedo', async () => {
    // 2026-08-31T20:00Z = 01/09 05:00 em Tóquio (UTC+9): o dia local já é 01/09
    const d = await currentDose(db, medicationId, new Date('2026-08-31T20:00:00Z'), 'Asia/Tokyo');
    expect(d.dose_amount).toBe(6);
  });

  it('não permite dois ajustes na mesma data para a mesma medicação', async () => {
    await expect(
      db('dose_events').insert({
        medication_id: medicationId,
        effective_from: '2026-08-10',
        dose_amount: 9,
        dose_unit: 'gotas',
        times_per_day: 1,
        schedule_times: ['08:00'],
        created_by: ctx.userId,
      }),
    ).rejects.toMatchObject({ code: '23505' });
  });
});
