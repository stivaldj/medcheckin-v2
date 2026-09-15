import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { freshDb, seedClinic } from './helpers/db.js';
import { createPatient, listPatients } from '../src/patients/index.js';
import { acceptInvite } from '../src/auth/invite.js';
import { catalogNameKey } from '../src/catalog/nameKey.js';

// D37: lista abre em "Em acompanhamento", busca sem acento, pagina; Cadastrado só aparece pedindo.
describe('listPatients paginada + registered', () => {
  let db, ctx, session;
  const NOW = new Date('2026-09-15T12:00:00Z');
  beforeAll(async () => {
    db = await freshDb();
    ctx = await seedClinic(db, 'lista');
    session = {
      kind: 'user',
      sessionId: 't',
      userId: ctx.userId,
      clinicId: ctx.clinicId,
      role: 'doctor',
      name: 'Dra.',
      email: 'dra-lista@example.test',
    };
    for (let i = 1; i <= 60; i += 1) {
      await createPatient(
        db,
        session,
        { name: `Paciente ${String(i).padStart(2, '0')}`, consent_version: 'v1' },
        NOW,
      );
    }
    const { patient: jose } = await createPatient(
      db,
      session,
      { name: 'José Antônio', consent_version: 'v1' },
      NOW,
    );
    await db('patients').where({ id: jose.id }).update({ status: 'paused' });
    await db('patients').insert({
      clinic_id: ctx.clinicId,
      name: 'Maria Cadastrada',
      name_key: catalogNameKey('Maria Cadastrada'),
      timezone: 'America/Cuiaba',
      created_by: ctx.userId,
      status: 'registered',
      external_source: 'versatilis',
      external_ref: 'V-1',
      imported_at: NOW,
    });
  });
  afterAll(async () => db.destroy());

  it('padrão following: ativos + pausados, 50 por página, total certo', async () => {
    const p1 = await listPatients(db, { clinicId: ctx.clinicId }, NOW);
    expect(p1.total).toBe(61);
    expect(p1.rows).toHaveLength(50);
    expect(p1.page).toBe(1);
    expect(p1.pageSize).toBe(50);
    const p2 = await listPatients(db, { clinicId: ctx.clinicId, page: 2 }, NOW);
    expect(p2.rows).toHaveLength(11);
    expect(p1.rows.map((r) => r.name).concat(p2.rows.map((r) => r.name))).toContain('José Antônio');
    expect(p1.rows.some((r) => r.name === 'Maria Cadastrada')).toBe(false);
  });

  it('status registered / all / paused; q sem acento; q curto ignorado; pageSize máximo 200', async () => {
    const reg = await listPatients(db, { clinicId: ctx.clinicId, status: 'registered' }, NOW);
    expect(reg.rows.map((r) => r.name)).toEqual(['Maria Cadastrada']);
    expect(reg.rows[0].external_source).toBe('versatilis');
    expect(
      (await listPatients(db, { clinicId: ctx.clinicId, status: 'all', pageSize: 500 }, NOW)).rows,
    ).toHaveLength(62);
    expect(
      (await listPatients(db, { clinicId: ctx.clinicId, status: 'paused' }, NOW)).rows.map(
        (r) => r.name,
      ),
    ).toEqual(['José Antônio']);
    const q = await listPatients(db, { clinicId: ctx.clinicId, q: 'jose ant' }, NOW);
    expect(q.rows.map((r) => r.name)).toEqual(['José Antônio']);
    expect((await listPatients(db, { clinicId: ctx.clinicId, q: 'j' }, NOW)).total).toBe(61);
    await expect(
      listPatients(db, { clinicId: ctx.clinicId, status: 'zumbi' }, NOW),
    ).rejects.toMatchObject({ code: 'validation' });
  });

  it('acceptInvite promove registered → active e grava consentimento no paciente', async () => {
    const maria = await db('patients').where({ name: 'Maria Cadastrada' }).first();
    const [r] = await db('respondents')
      .insert({
        patient_id: maria.id,
        kind: 'patient',
        name: 'Maria',
        invite_token: 'tok-maria',
        can_answer: true,
        receives_alarms: true,
      })
      .returning('*');
    await acceptInvite(db, { inviteToken: r.invite_token, consentVersion: 'v2' }, NOW);
    const depois = await db('patients').where({ id: maria.id }).first();
    expect(depois.status).toBe('active');
    expect(depois.consent_version).toBe('v2');
    expect(depois.consent_at).not.toBeNull();
  });

  it('acceptInvite grava o aceite do respondente e a promoção do paciente em uma única transação', async () => {
    // D37 fix round 1: as duas escritas (respondents.accepted_at/consent_* e patients.status/consent_*)
    // não podem ser commits independentes — se a segunda falhasse depois da primeira, o respondente
    // ficaria aceito com o paciente ainda "registered", uma inconsistência permanente. Provamos que
    // ambas passam pela mesma `db.transaction` (spy chamado exatamente uma vez) e que as duas linhas
    // mudam juntas.
    const patient2 = await db('patients')
      .insert({
        clinic_id: ctx.clinicId,
        name: 'Joana Cadastrada',
        name_key: catalogNameKey('Joana Cadastrada'),
        timezone: 'America/Cuiaba',
        created_by: ctx.userId,
        status: 'registered',
        external_source: 'versatilis',
        external_ref: 'V-2',
        imported_at: NOW,
      })
      .returning('*');
    const joana = patient2[0];
    const [r2] = await db('respondents')
      .insert({
        patient_id: joana.id,
        kind: 'patient',
        name: 'Joana',
        invite_token: 'tok-joana',
        can_answer: true,
        receives_alarms: true,
      })
      .returning('*');
    const txSpy = vi.spyOn(db, 'transaction');
    await acceptInvite(db, { inviteToken: r2.invite_token, consentVersion: 'v2' }, NOW);
    expect(txSpy).toHaveBeenCalledTimes(1);
    txSpy.mockRestore();
    const respondentDepois = await db('respondents').where({ id: r2.id }).first();
    const patientDepois = await db('patients').where({ id: joana.id }).first();
    expect(respondentDepois.accepted_at).not.toBeNull();
    expect(patientDepois.status).toBe('active');
    expect(patientDepois.consent_version).toBe('v2');
  });
});
