import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { DateTime } from 'luxon';
import { freshDb, seedFixture } from './helpers/db.js';
import {
  listPatientQuestions,
  addPatientQuestion,
  updatePatientQuestion,
  questionsForPatient,
} from '../src/questions/patientQuestions.js';
import { recordAnswer, getNextQuestion } from '../src/checkin/engine.js';
import { updatePatient, patientGrid } from '../src/patients/index.js';
import { planCheckins } from '../src/scheduler/planner.js';
import { patientReport } from '../src/report/patientReport.js';

const TZ = 'America/Cuiaba';
const TODAY = DateTime.utc().setZone(TZ).startOf('day');
const AT = (hm, d = 0) => {
  const [h, m] = hm.split(':').map(Number);
  return TODAY.plus({ days: d }).set({ hour: h, minute: m }).toUTC().toJSDate();
};

describe('E9.2 — perguntas extras por paciente', () => {
  let db, fx, session;
  beforeAll(async () => {
    db = await freshDb();
    fx = await seedFixture(db);
    session = {
      kind: 'user',
      userId: fx.doctor.id,
      clinicId: fx.clinic.id,
      role: 'doctor',
      name: 'Dra.',
    };
  });
  afterAll(async () => db.destroy());
  beforeEach(async () => {
    await db('answers').del();
    await db('checkins').del();
    await db('questions').whereNotNull('patient_id').del();
  });

  const newCheckin = async (scheduledFor) => {
    const [ck] = await db('checkins')
      .insert({
        patient_id: fx.p1.id,
        episode_id: fx.ep1.id,
        scheduled_for: scheduledFor,
        status: 'sent',
        sent_at: scheduledFor,
      })
      .returning('id');
    return ck.id;
  };

  it('adiciona pergunta em texto livre com chave derivada do label; valida e recusa chave repetida', async () => {
    const q = await addPatientQuestion(
      db,
      session,
      fx.p1.id,
      { label: 'Teve espasmos hoje?' },
      AT('10:00', -1),
    );
    expect(q).toMatchObject({
      key: 'teve_espasmos_hoje',
      kind: 'yes_no', // default do formulário livre
      patient_id: fx.p1.id,
      active: true,
    });
    await expect(
      addPatientQuestion(db, session, fx.p1.id, { label: 'curta' }, AT('10:00', -1)),
    ).rejects.toThrow(/6 e 280/);
    await expect(
      addPatientQuestion(db, session, fx.p1.id, { label: 'Teve espasmos hoje?' }, AT('10:00', -1)),
    ).rejects.toThrow(/já existe/i);
    // não pode colidir com uma pergunta do pack do episódio
    await expect(
      addPatientQuestion(
        db,
        session,
        fx.p1.id,
        { key: 'dor', label: 'Qual a dor agora?' },
        AT('10:00', -1),
      ),
    ).rejects.toThrow(/já existe.*conjunto/i);
    // paciente de outra clínica → not_found
    await expect(
      addPatientQuestion(
        db,
        { ...session, clinicId: '00000000-0000-0000-0000-000000000000' },
        fx.p1.id,
        { label: 'Pergunta de outra clínica?' },
        AT('10:00', -1),
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('merge: pack na ordem + extras depois; só ativas; extras são por paciente', async () => {
    await addPatientQuestion(
      db,
      session,
      fx.p1.id,
      { label: 'Teve espasmos hoje?' },
      AT('10:00', -1),
    );
    await addPatientQuestion(
      db,
      session,
      fx.p1.id,
      { label: 'Quantas horas dormiu?', kind: 'number', unit: 'h' },
      AT('10:05', -1),
    );
    const merged = await questionsForPatient(db, {
      patientId: fx.p1.id,
      questionSetId: fx.qs.id,
      at: AT('09:00'),
    });
    expect(merged.map((q) => q.key)).toEqual([
      'adesao',
      'dor',
      'sono',
      'humor',
      'crises',
      'efeito_adverso',
      'efeito_qual',
      'obs',
      'teve_espasmos_hoje',
      'quantas_horas_dormiu',
    ]);
    // P2 não vê as extras de P1
    const forP2 = await questionsForPatient(db, {
      patientId: fx.p2.id,
      questionSetId: fx.qs.id,
      at: AT('09:00'),
    });
    expect(forP2.map((q) => q.key)).not.toContain('teve_espasmos_hoje');
  });

  it('vale só a partir do PRÓXIMO check-in: o que já estava agendado não muda', async () => {
    const hoje = await newCheckin(AT('09:00'));
    await addPatientQuestion(
      db,
      session,
      fx.p1.id,
      { label: 'Teve espasmos hoje?' },
      AT('10:00'), // depois do check-in de hoje
    );
    const doDia = await questionsForPatient(db, {
      patientId: fx.p1.id,
      questionSetId: fx.qs.id,
      at: AT('09:00'),
    });
    expect(doDia.map((q) => q.key)).not.toContain('teve_espasmos_hoje');
    const amanha = await questionsForPatient(db, {
      patientId: fx.p1.id,
      questionSetId: fx.qs.id,
      at: AT('09:00', 1),
    });
    expect(amanha.map((q) => q.key)).toContain('teve_espasmos_hoje');
    expect(hoje).toBeTruthy();
  });

  it('engine: a extra entra no fim do check-in seguinte, é respondida e aparece na grade e no relatório', async () => {
    await addPatientQuestion(
      db,
      session,
      fx.p1.id,
      { label: 'Teve espasmos hoje?' },
      AT('10:00', -1),
    );
    const ck = await newCheckin(AT('09:00'));
    const answer = (key, value) =>
      recordAnswer(
        db,
        { checkinId: ck, respondentId: fx.r1.id, questionKey: key, value },
        AT('09:10'),
      );
    for (const [k, v] of [
      ['adesao', 1],
      ['dor', 3],
      ['sono', 6],
      ['humor', 6],
      ['crises', 0],
      ['efeito_adverso', 0],
      ['obs', null],
    ]) {
      await answer(k, v);
    }
    // o pack acabou, mas o check-in ainda não: falta a extra
    const next = await getNextQuestion(db, ck);
    expect(next.key).toBe('teve_espasmos_hoje');
    const r = await answer('teve_espasmos_hoje', 1);
    expect(r.completed).toBe(true);

    const grid = await patientGrid(db, fx.p1.id, { days: 3, now: AT('12:00') });
    expect(grid.questions.map((q) => q.key)).toContain('teve_espasmos_hoje');
    expect(grid.cells[TODAY.toISODate()].teve_espasmos_hoje).toBe(1);

    const rep = await patientReport(db, session, fx.p1.id, { days: 30, now: AT('12:00') });
    expect(rep.symptoms.find((s) => s.key === 'teve_espasmos_hoje')).toMatchObject({ n: 1 });
  });

  it('editar e desativar: some dos próximos check-ins, respostas antigas continuam', async () => {
    const q = await addPatientQuestion(
      db,
      session,
      fx.p1.id,
      { label: 'Teve espasmos hoje?' },
      AT('10:00', -1),
    );
    const ck = await newCheckin(AT('09:00'));
    await recordAnswer(
      db,
      { checkinId: ck, respondentId: fx.r1.id, questionKey: 'teve_espasmos_hoje', value: 1 },
      AT('09:10'),
    );
    const renamed = await updatePatientQuestion(
      db,
      session,
      q.id,
      { label: 'Teve espasmos ou tremores hoje?' },
      AT('11:00'),
    );
    expect(renamed.label).toBe('Teve espasmos ou tremores hoje?');
    expect(renamed.key).toBe('teve_espasmos_hoje'); // chave é estável: respostas já apontam para ela

    await updatePatientQuestion(db, session, q.id, { active: false }, AT('11:05'));
    const listed = await listPatientQuestions(db, session, fx.p1.id);
    expect(listed.map((x) => [x.key, x.active])).toEqual([['teve_espasmos_hoje', false]]);
    const merged = await questionsForPatient(db, {
      patientId: fx.p1.id,
      questionSetId: fx.qs.id,
      at: AT('09:00', 1),
    });
    expect(merged.map((x) => x.key)).not.toContain('teve_espasmos_hoje');
    // a resposta continua no banco E visível na grade/relatório (só some dos próximos check-ins)
    expect(await db('answers').where({ checkin_id: ck }).count().first()).toMatchObject({
      count: 1,
    });
    const grid = await patientGrid(db, fx.p1.id, { days: 3, now: AT('12:00') });
    expect(grid.questions.map((x) => x.key)).toContain('teve_espasmos_hoje');
    expect(grid.cells[TODAY.toISODate()].teve_espasmos_hoje).toBe(1);
    const rep = await patientReport(db, session, fx.p1.id, { days: 30, now: AT('12:00') });
    expect(rep.symptoms.find((x) => x.key === 'teve_espasmos_hoje')).toMatchObject({ n: 1 });
  });

  it('horário do check-in é por paciente; horário dentro do silêncio é recusado (nada de envio adiado em silêncio)', async () => {
    // silêncio padrão 21:00–08:00: 21:00 nunca sairia no horário escolhido
    await expect(
      updatePatient(db, session, fx.p1.id, { checkin_time: '21:00' }, AT('06:00')),
    ).rejects.toThrow(/silêncio/i);

    await updatePatient(db, session, fx.p1.id, { checkin_time: '20:00' }, AT('06:00'));
    const p = await db('patients').where({ id: fx.p1.id }).first();
    expect(String(p.checkin_time).slice(0, 5)).toBe('20:00');
    await planCheckins(db, AT('06:00'));
    const ck = await db('checkins')
      .where({ patient_id: fx.p1.id })
      .orderBy('scheduled_for', 'desc')
      .first();
    expect(DateTime.fromJSDate(new Date(ck.next_attempt_at)).setZone(TZ).toFormat('HH:mm')).toBe(
      '20:00',
    );
    // 21:00 passa a valer se a médica também abrir o silêncio
    await updatePatient(
      db,
      session,
      fx.p1.id,
      { checkin_time: '21:00', quiet_start: '22:00' },
      AT('06:00'),
    );
    expect(
      String((await db('patients').where({ id: fx.p1.id }).first()).checkin_time).slice(0, 5),
    ).toBe('21:00');
    await updatePatient(
      db,
      session,
      fx.p1.id,
      { checkin_time: '09:00', quiet_start: '21:00' },
      AT('06:00'),
    );
  });
});
