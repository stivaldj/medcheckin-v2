import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { freshDb, seedClinic, seedPatient } from './helpers/db.js';

const TABLES = [
  'clinics',
  'users',
  'patients',
  'respondents',
  'push_subscriptions',
  'products',
  'medications',
  'dose_events',
  'medication_intakes',
  'episodes',
  'question_sets',
  'questions',
  'checkins',
  'answers',
  'notifications',
  'alerts',
  'alert_actions',
  'alert_silences',
  'patient_scores_daily',
  'access_audit',
];

describe('migration 001 — schema', () => {
  let db;
  beforeAll(async () => {
    db = await freshDb();
  });
  afterAll(async () => {
    await db.destroy();
  });

  it('cria todas as tabelas do modelo (DECISOES.md §3)', async () => {
    for (const t of TABLES) {
      expect(await db.schema.hasTable(t), `tabela ${t}`).toBe(true);
    }
  });

  it('toda tabela de paciente tem clinic_id direto ou chega nele por FK, e clinic_id é indexado', async () => {
    const direct = ['users', 'patients', 'products', 'question_sets', 'access_audit'];
    for (const t of direct) {
      expect(await db.schema.hasColumn(t, 'clinic_id'), `${t}.clinic_id`).toBe(true);
      const { rows } = await db.raw(
        `select 1 from pg_indexes where tablename = ? and indexdef ilike '%(clinic_id%'`,
        [t],
      );
      expect(rows.length, `índice clinic_id em ${t}`).toBeGreaterThan(0);
    }
  });

  it('patients.clinic_id é obrigatório e FK (escopo de clínica desde o dia 1)', async () => {
    const { userId } = await seedClinic(db, 'scope');
    await expect(
      db('patients').insert({
        clinic_id: '00000000-0000-0000-0000-000000000000',
        name: 'x',
        timezone: 'America/Cuiaba',
        created_by: userId,
      }),
    ).rejects.toMatchObject({ code: '23503' }); // foreign_key_violation
    await expect(
      db('patients').insert({ name: 'x', timezone: 'America/Cuiaba', created_by: userId }),
    ).rejects.toMatchObject({ code: '23502' }); // not_null_violation
  });

  it('answers é unique por (checkin_id, question_id)', async () => {
    const ctx = await seedClinic(db, 'ans');
    const patientId = await seedPatient(db, ctx);
    const [qs] = await db('question_sets')
      .insert({ clinic_id: ctx.clinicId, name: 'Padrão' })
      .returning('id');
    const [q] = await db('questions')
      .insert({
        question_set_id: qs.id,
        key: 'dor',
        label: 'Dor?',
        kind: 'scale_0_10',
        sort_order: 1,
      })
      .returning('id');
    const [ep] = await db('episodes')
      .insert({
        patient_id: patientId,
        kind: 'titration',
        started_at: db.fn.now(),
        checkin_frequency: 'daily',
        question_set_id: qs.id,
      })
      .returning('id');
    const [ck] = await db('checkins')
      .insert({ patient_id: patientId, episode_id: ep.id, scheduled_for: db.fn.now() })
      .returning('id');
    const [r] = await db('respondents')
      .insert({ patient_id: patientId, kind: 'patient', name: 'P', invite_token: 'tok-ans' })
      .returning('id');
    const row = { checkin_id: ck.id, question_id: q.id, respondent_id: r.id, value_num: 5 };
    await db('answers').insert(row);
    await expect(db('answers').insert(row)).rejects.toMatchObject({ code: '23505' }); // unique_violation
  });

  it('notifications.dedup_key é unique (única barreira de idempotência — L8)', async () => {
    const ctx = await seedClinic(db, 'ntf');
    const patientId = await seedPatient(db, ctx);
    const [r] = await db('respondents')
      .insert({ patient_id: patientId, kind: 'caregiver', name: 'C', invite_token: 'tok-ntf' })
      .returning('id');
    const row = {
      patient_id: patientId,
      respondent_id: r.id,
      kind: 'checkin',
      payload: {},
      scheduled_at: db.fn.now(),
      dedup_key: 'checkin:x:2026-08-16',
    };
    await db('notifications').insert(row);
    await expect(db('notifications').insert(row)).rejects.toMatchObject({ code: '23505' });
  });

  it('respondents.invite_token é unique e email é opcional (D12)', async () => {
    const ctx = await seedClinic(db, 'resp');
    const patientId = await seedPatient(db, ctx);
    await db('respondents').insert({
      patient_id: patientId,
      kind: 'patient',
      name: 'Sem e-mail',
      invite_token: 'tok-dup',
    });
    await expect(
      db('respondents').insert({
        patient_id: patientId,
        kind: 'caregiver',
        name: 'Outro',
        invite_token: 'tok-dup',
      }),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('enums são validados por CHECK (status inválido é rejeitado)', async () => {
    const ctx = await seedClinic(db, 'chk');
    await expect(
      db('patients').insert({
        clinic_id: ctx.clinicId,
        name: 'x',
        timezone: 'America/Cuiaba',
        created_by: ctx.userId,
        status: 'zumbi',
      }),
    ).rejects.toMatchObject({ code: '23514' }); // check_violation
  });

  it('só um alerta open por (patient_id, code) — evita 776 duplicatas do v1', async () => {
    const ctx = await seedClinic(db, 'alr');
    const patientId = await seedPatient(db, ctx);
    const row = {
      patient_id: patientId,
      code: 'no_response',
      severity: 'medium',
      title: 't',
      context: {},
    };
    await db('alerts').insert(row);
    await expect(db('alerts').insert(row)).rejects.toMatchObject({ code: '23505' });
    await db('alerts')
      .where({ patient_id: patientId })
      .update({ status: 'resolved', resolved_reason: 'x' });
    await expect(db('alerts').insert(row)).resolves.toBeDefined(); // depois de resolvido pode reabrir
  });
});
