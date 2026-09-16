import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { freshDb, seedClinic, seedPatient } from './helpers/db.js';
import {
  findOrCreateCondition,
  listConditions,
  updateCondition,
  mergeConditions,
  addPatientCondition,
  removePatientCondition,
  listPatientConditions,
} from '../src/conditions/index.js';
import { createPatient, listPatients, getPatientDetail } from '../src/patients/index.js';

// D36: condições em catálogo da clínica pelo padrão D34; CID-10 opcional; fusão como correção.
describe('condições (catálogo da clínica)', () => {
  let db, ctx, session, p1, p2;
  const NOW = new Date('2026-09-15T12:00:00Z');
  beforeAll(async () => {
    db = await freshDb();
    ctx = await seedClinic(db, 'cond');
    session = {
      kind: 'user',
      sessionId: 't',
      userId: ctx.userId,
      clinicId: ctx.clinicId,
      role: 'doctor',
      name: 'Dra.',
      email: 'dra-cond@example.test',
    };
    p1 = await seedPatient(db, ctx, 'Um');
    p2 = await seedPatient(db, ctx, 'Dois');
  });
  afterAll(async () => db.destroy());

  it('nome novo cria; caixa/acento diferentes reaproveitam; cid10 opcional e validado', async () => {
    const a = await findOrCreateCondition(db, session, { name: '  Epilepsia  Refratária ' });
    expect(a.created).toBe(true);
    expect(a.condition.name).toBe('Epilepsia Refratária');
    expect(a.condition.name_key).toBe('epilepsia refrataria');
    expect(a.condition.cid10).toBeNull();
    const b = await findOrCreateCondition(db, session, {
      name: 'EPILEPSIA REFRATARIA',
      cid10: 'g40.9',
    });
    expect(b.created).toBe(false);
    expect(b.condition.id).toBe(a.condition.id);
    await expect(findOrCreateCondition(db, session, { name: 'x' })).rejects.toMatchObject({
      code: 'validation',
      field: 'name',
    });
    await expect(
      findOrCreateCondition(db, session, { name: 'Asma', cid10: 'banana' }),
    ).rejects.toMatchObject({ code: 'validation', field: 'cid10' });
    const c = await findOrCreateCondition(db, session, { name: 'Asma', cid10: ' j45 ' });
    expect(c.condition.cid10).toBe('J45');
  });

  it('corrida: duas criações em paralelo do mesmo nome geram uma condição', async () => {
    const [x, y] = await Promise.all([
      findOrCreateCondition(db, session, { name: 'Ansiedade generalizada' }),
      findOrCreateCondition(db, session, { name: 'ansiedade GENERALIZADA' }),
    ]);
    expect(x.condition.id).toBe(y.condition.id);
    const n = await db('conditions')
      .where({ clinic_id: ctx.clinicId, name_key: 'ansiedade generalizada' })
      .count()
      .first();
    expect(Number(n.count)).toBe(1);
  });

  it('vincula ao paciente por nome ou id, idempotente; remove; lista', async () => {
    const c1 = await addPatientCondition(
      db,
      session,
      p1,
      { name: 'Autismo', noted_at: '2026-01-10' },
      NOW,
    );
    const again = await addPatientCondition(db, session, p1, { condition_id: c1.id }, NOW);
    expect(again.id).toBe(c1.id);
    const list = await listPatientConditions(db, p1);
    expect(list.map((c) => c.name)).toEqual(['Autismo']);
    expect(String(list[0].noted_at).slice(0, 10)).toBe('2026-01-10');
    await removePatientCondition(db, session, p1, c1.id, NOW);
    expect(await listPatientConditions(db, p1)).toEqual([]);
    const audit = await db('access_audit')
      .where({ patient_id: p1 })
      .whereIn('route', ['conditions.add', 'conditions.remove']);
    expect(audit).toHaveLength(3);
  });

  it('condição de outra clínica é not_found; id inexistente também', async () => {
    const outra = await seedClinic(db, 'outra-cond');
    const { condition } = await findOrCreateCondition(
      db,
      { ...session, clinicId: outra.clinicId, userId: outra.userId },
      { name: 'Da outra' },
    );
    await expect(
      addPatientCondition(db, session, p1, { condition_id: condition.id }, NOW),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      updateCondition(db, session, condition.id, { cid10: 'F41' }, NOW),
    ).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('updateCondition muda nome/cid10 e recusa colisão de chave', async () => {
    const { condition: tea } = await findOrCreateCondition(db, session, { name: 'TEA' });
    const { condition: aut } = await findOrCreateCondition(db, session, { name: 'Autismo' });
    const up = await updateCondition(db, session, tea.id, { cid10: 'f84.0' }, NOW);
    expect(up.cid10).toBe('F84.0');
    await expect(
      updateCondition(db, session, tea.id, { name: 'autismo' }, NOW),
    ).rejects.toMatchObject({
      code: 'validation',
      field: 'name',
    });
    expect(aut.id).not.toBe(tea.id);
  });

  it('mergeConditions move vínculos sem duplicar, apaga a origem e conta pacientes', async () => {
    const { condition: tea } = await findOrCreateCondition(db, session, { name: 'TEA' });
    const { condition: aut } = await findOrCreateCondition(db, session, { name: 'Autismo' });
    await addPatientCondition(db, session, p1, { condition_id: tea.id }, NOW);
    await addPatientCondition(db, session, p1, { condition_id: aut.id }, NOW); // já tem o destino
    await addPatientCondition(db, session, p2, { condition_id: tea.id }, NOW);
    const out = await mergeConditions(db, session, { from_id: tea.id, into_id: aut.id }, NOW);
    expect(out.moved).toBe(1); // p2; p1 já tinha Autismo
    // TEA tinha cid10 F84.0 (setado antes) e Autismo não: a fusão preserva o CID-10 da origem.
    expect(out.into.cid10).toBe('F84.0');
    expect(await db('conditions').where({ id: tea.id }).first()).toBeUndefined();
    const all = await listConditions(db, ctx.clinicId);
    const autRow = all.find((c) => c.id === aut.id);
    expect(autRow.patients).toBe(2);
    await expect(
      mergeConditions(db, session, { from_id: aut.id, into_id: aut.id }, NOW),
    ).rejects.toMatchObject({
      code: 'validation',
    });
    const audit = await db('access_audit').where({ route: 'conditions.merge' });
    expect(audit).toHaveLength(1);
    expect(audit[0].patient_id).toBeNull();
  });

  it('createPatient aceita conditions (nomes); detail e lista trazem conditions; lista filtra', async () => {
    const { patient } = await createPatient(
      db,
      session,
      {
        name: 'Paciente Cond',
        conditions: ['Dor crônica', ' dor CRÔNICA ', 'Insônia'],
        consent_version: 'v1',
      },
      NOW,
    );
    const detail = await getPatientDetail(db, session, patient.id, { now: NOW });
    expect(detail.conditions.map((c) => c.name)).toEqual(['Dor crônica', 'Insônia']);
    expect(detail.patient.condition_tags).toBeUndefined();
    const dor = detail.conditions[0];
    const filtrada = (await listPatients(db, { clinicId: ctx.clinicId, condition: dor.id }, NOW))
      .rows;
    expect(filtrada.map((p) => p.id)).toEqual([patient.id]);
    const todas = (await listPatients(db, { clinicId: ctx.clinicId }, NOW)).rows;
    const row = todas.find((p) => p.id === patient.id);
    expect(row.conditions.map((c) => c.name)).toEqual(['Dor crônica', 'Insônia']);
  });
});
