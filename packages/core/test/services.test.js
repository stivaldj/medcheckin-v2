import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DateTime } from 'luxon';
import { freshDb, seedFixture } from './helpers/db.js';
import {
  createPatient,
  updatePatient,
  listPatients,
  getPatientDetail,
  addRespondent,
  updateRespondent,
  patientGrid,
} from '../src/patients/index.js';
import {
  listProducts,
  createProduct,
  addMedication,
  adjustDose,
  setEpisode,
} from '../src/medications/index.js';
import {
  listQuestionSets,
  createQuestionSet,
  saveQuestions,
  slugify,
  validateQuestion,
} from '../src/questions/index.js';
import { recordAnswer } from '../src/checkin/engine.js';

// Data dinâmica: o seed cria doses/episódios relativos a hoje — data fixa aqui apodrece (falhou em 25/08).
const NOW = new Date();
const AT = (d, hm = '13:00') => new Date(`${d}T${hm}:00Z`);

describe('patients — cadastro, lista, detalhe, respondentes', () => {
  let db, fx, session, created;
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

  it('createPatient: dados + respondentes com invite_token gerado; audit create; nome obrigatório', async () => {
    await expect(createPatient(db, session, { name: ' ' }, NOW)).rejects.toThrow(/nome/i);
    created = await createPatient(
      db,
      session,
      {
        name: 'Paciente Novo',
        birth_date: '2015-03-10',
        condition_tags: ['epilepsia', 'tea'],
        checkin_time: '10:30',
        consent_version: 'v1',
        respondents: [
          { kind: 'patient', name: 'Paciente Novo', can_answer: false, receives_alarms: false },
          {
            kind: 'caregiver',
            name: 'Mãe Nova',
            relationship: 'mãe',
            email: 'mae@x.test',
            phone: '+556591000009',
          },
        ],
      },
      NOW,
    );
    expect(created.patient).toMatchObject({
      name: 'Paciente Novo',
      clinic_id: fx.clinic.id,
      status: 'active',
      consent_version: 'v1',
    });
    expect(created.respondents).toHaveLength(2);
    const cg = created.respondents.find((r) => r.kind === 'caregiver');
    expect(cg.invite_token).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(cg.can_answer).toBe(true);
    const audit = await db('access_audit').where({
      patient_id: created.patient.id,
      action: 'create',
    });
    expect(audit).toHaveLength(1);
  });

  it('createPatient exige pelo menos um respondente que pode responder', async () => {
    await expect(
      createPatient(
        db,
        session,
        {
          name: 'Sem Respondente',
          respondents: [{ kind: 'patient', name: 'Sem Resp', can_answer: false }],
        },
        NOW,
      ),
    ).rejects.toThrow(/responder/i);
  });

  it('listPatients: escopo de clínica + resumo (episódio, alertas abertos, dose vigente)', async () => {
    const rows = await listPatients(db, { clinicId: fx.clinic.id }, NOW);
    expect(rows.map((r) => r.name).sort()).toEqual([
      'Paciente Novo',
      'Paciente Sintético Dois',
      'Paciente Sintético Um',
    ]);
    const p1 = rows.find((r) => r.name === 'Paciente Sintético Um');
    expect(p1.episode).toMatchObject({ kind: 'titration', checkin_frequency: 'daily' });
    expect(p1.open_alerts).toBe(0);
    expect(p1.medications[0]).toMatchObject({
      product_name: 'Óleo Full Spectrum CBD 50mg/ml',
      current_dose: { dose_amount: 4, dose_unit: 'gotas' },
    });
    const novo = rows.find((r) => r.name === 'Paciente Novo');
    expect(novo.medications).toEqual([]);
    expect(novo.last_checkin_at).toBeNull();
    expect(
      await listPatients(db, { clinicId: '00000000-0000-0000-0000-000000000000' }, NOW),
    ).toEqual([]);
  });

  it('getPatientDetail: paciente, respondentes com link de convite, medicações + histórico de dose, episódio, alertas, grade', async () => {
    const d = await getPatientDetail(db, session, fx.p1.id, {
      baseUrl: 'https://app.test',
      now: NOW,
    });
    expect(d.patient.id).toBe(fx.p1.id);
    expect(d.respondents[0].invite_url).toBe('https://app.test/p/convite/seed-p1');
    expect(d.medications[0].current_dose.dose_amount).toBe(4);
    expect(d.medications[0].dose_history).toHaveLength(2);
    expect(d.episode.kind).toBe('titration');
    expect(d.grid.days).toHaveLength(14);
    expect(d.grid.questions.map((q) => q.key)).toContain('dor');
    await expect(
      getPatientDetail(db, session, created.patient.id, { baseUrl: 'x', now: NOW }),
    ).resolves.toBeTruthy();
    const other = { ...session, clinicId: '00000000-0000-0000-0000-000000000000' };
    await expect(
      getPatientDetail(db, other, fx.p1.id, { baseUrl: 'x', now: NOW }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('updatePatient: pausar/alta/voltar; campos; status inválido rejeitado', async () => {
    let p = await updatePatient(db, session, fx.p1.id, { status: 'paused' }, NOW);
    expect(p.status).toBe('paused');
    p = await updatePatient(
      db,
      session,
      fx.p1.id,
      { status: 'active', checkin_time: '08:15', condition_tags: ['dor'] },
      NOW,
    );
    expect(p.status).toBe('active');
    expect(String(p.checkin_time)).toMatch(/^08:15/);
    expect(p.condition_tags).toEqual(['dor']);
    await expect(updatePatient(db, session, fx.p1.id, { status: 'zumbi' }, NOW)).rejects.toThrow(
      /status/i,
    );
  });

  it('addRespondent/updateRespondent: novo cuidador com token; desligar can_answer; nunca do paciente de outra clínica', async () => {
    const r = await addRespondent(
      db,
      session,
      fx.p1.id,
      { kind: 'caregiver', name: 'Filha', relationship: 'filha' },
      NOW,
    );
    expect(r.invite_token).toBeTruthy();
    const u = await updateRespondent(
      db,
      session,
      r.id,
      { can_answer: false, receives_alarms: false },
      NOW,
    );
    expect(u.can_answer).toBe(false);
    const other = { ...session, clinicId: '00000000-0000-0000-0000-000000000000' };
    await expect(updateRespondent(db, other, r.id, { name: 'x' }, NOW)).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('patientGrid: 14 dias × perguntas com última resposta do dia, "—" (null) sem dado, score por dia', async () => {
    const day = DateTime.fromJSDate(NOW).setZone('America/Cuiaba').minus({ days: 1 }).toISODate();
    const [ck] = await db('checkins')
      .insert({
        patient_id: fx.p1.id,
        episode_id: fx.ep1.id,
        scheduled_for: AT(day),
        status: 'sent',
        sent_at: AT(day),
      })
      .returning('id');
    await recordAnswer(
      db,
      { checkinId: ck.id, respondentId: fx.r1.id, questionKey: 'dor', value: 6 },
      AT(day, '13:10'),
    );
    await recordAnswer(
      db,
      { checkinId: ck.id, respondentId: fx.r1.id, questionKey: 'sono', value: 7 },
      AT(day, '13:11'),
    );
    const g = await patientGrid(db, fx.p1.id, { days: 14, now: NOW });
    expect(g.days).toHaveLength(14);
    expect(g.days[13]).toBe(DateTime.fromJSDate(NOW).setZone('America/Cuiaba').toISODate());
    expect(g.cells[day].dor).toBe(6);
    expect(g.cells[day].sono).toBe(7);
    expect(g.cells[day].humor ?? null).toBeNull();
    expect(g.scores[day] ?? null).toBeNull(); // check-in não concluído → sem score
  });
});

describe('medications — produtos, medicação, ajuste de dose, episódios', () => {
  let db, fx, session;
  beforeAll(async () => {
    db = await freshDb();
    fx = await seedFixture(db);
    session = { kind: 'user', userId: fx.doctor.id, clinicId: fx.clinic.id, role: 'doctor' };
  });
  afterAll(async () => db.destroy());

  it('produtos por clínica; criação valida nome', async () => {
    expect((await listProducts(db, fx.clinic.id)).map((p) => p.name)).toContain(
      'Óleo Full Spectrum CBD 50mg/ml',
    );
    const p = await createProduct(db, session, {
      name: 'Óleo CBD 20',
      cbd_mg_ml: 20,
      thc_mg_ml: 0,
      form: 'oil',
    });
    expect(p.clinic_id).toBe(fx.clinic.id);
    await expect(createProduct(db, session, { name: '' })).rejects.toThrow(/nome/i);
    await expect(createProduct(db, session, { name: 'Produto X', form: 'gás' })).rejects.toThrow(
      /forma/i,
    );
  });

  it('adjustDose: valida, grava dose_event, opcionalmente abre titulação (fecha o episódio anterior)', async () => {
    const [prod] = await db('products').where({ clinic_id: fx.clinic.id }).limit(1);
    const med = await addMedication(db, session, fx.p1.id, { product_id: prod.id }, NOW);
    expect(med.patient_id).toBe(fx.p1.id);
    await expect(
      adjustDose(
        db,
        session,
        med.id,
        {
          effective_from: '2026-08-16',
          dose_amount: 0,
          dose_unit: 'gotas',
          times_per_day: 2,
          schedule_times: ['08:00', '20:00'],
        },
        NOW,
      ),
    ).rejects.toThrow(/dose/i);
    await expect(
      adjustDose(
        db,
        session,
        med.id,
        {
          effective_from: '2026-08-16',
          dose_amount: 3,
          dose_unit: 'gotas',
          times_per_day: 2,
          schedule_times: ['08:00'],
        },
        NOW,
      ),
    ).rejects.toThrow(/horários/i);
    const before = await db('episodes')
      .where({ patient_id: fx.p1.id })
      .whereNull('ended_at')
      .first();
    const de = await adjustDose(
      db,
      session,
      med.id,
      {
        effective_from: '2026-08-16',
        dose_amount: 3,
        dose_unit: 'gotas',
        times_per_day: 2,
        schedule_times: ['08:00', '20:00'],
        reason: 'início',
        open_titration: true,
      },
      NOW,
    );
    expect(de.dose_amount).toBe(3);
    const open = await db('episodes').where({ patient_id: fx.p1.id }).whereNull('ended_at');
    expect(open).toHaveLength(1);
    expect(open[0].id).not.toBe(before.id);
    expect(open[0]).toMatchObject({
      kind: 'titration',
      checkin_frequency: 'daily',
      dose_event_id: de.id,
    });
    const closed = await db('episodes').where({ id: before.id }).first();
    expect(closed.ended_at).not.toBeNull();
    // mesma data → conflito legível
    await expect(
      adjustDose(
        db,
        session,
        med.id,
        {
          effective_from: '2026-08-16',
          dose_amount: 4,
          dose_unit: 'gotas',
          times_per_day: 2,
          schedule_times: ['08:00', '20:00'],
        },
        NOW,
      ),
    ).rejects.toThrow(/mesma data/i);
  });

  it('setEpisode: troca para manutenção semanal; frequência inválida rejeitada', async () => {
    const qs = await db('question_sets').first();
    const ep = await setEpisode(
      db,
      session,
      fx.p1.id,
      { kind: 'maintenance', checkin_frequency: 'weekly', question_set_id: qs.id },
      NOW,
    );
    expect(ep).toMatchObject({ kind: 'maintenance', checkin_frequency: 'weekly' });
    expect(
      await db('episodes').where({ patient_id: fx.p1.id }).whereNull('ended_at').count().first(),
    ).toMatchObject({ count: 1 });
    await expect(
      setEpisode(
        db,
        session,
        fx.p1.id,
        { kind: 'maintenance', checkin_frequency: 'hourly', question_set_id: qs.id },
        NOW,
      ),
    ).rejects.toThrow(/frequência/i);
  });
});

describe('questions — conjuntos e editor (lógica portada do v1)', () => {
  let db, fx, session;
  beforeAll(async () => {
    db = await freshDb();
    fx = await seedFixture(db);
    session = { kind: 'user', userId: fx.doctor.id, clinicId: fx.clinic.id, role: 'doctor' };
  });
  afterAll(async () => db.destroy());

  it('slugify: acentos, espaços, limite; validateQuestion: regras do v1', () => {
    expect(slugify('Como está sua dor hoje?')).toBe('como_esta_sua_dor_hoje');
    expect(slugify('  Sono (0–10)! ')).toBe('sono_0_10');
    expect(slugify('123abc')).toBe('q_123abc');
    expect(validateQuestion({ label: 'Dor?', kind: 'scale_0_10' }).ok).toBe(false); // label < 6
    expect(validateQuestion({ label: 'Como está a dor?', kind: 'scale_0_10' })).toMatchObject({
      ok: true,
      data: { key: 'como_esta_a_dor', kind: 'scale_0_10' },
    });
    expect(validateQuestion({ label: 'Qual efeito?', kind: 'choice', options: ['a'] }).ok).toBe(
      false,
    ); // < 2 opções
    expect(
      validateQuestion({ label: 'Qual efeito?', kind: 'choice', options: ['a', 'b'] }).ok,
    ).toBe(true);
    expect(validateQuestion({ label: 'Pergunta ok', kind: 'zumbi' }).ok).toBe(false);
    expect(validateQuestion({ key: 'A-b', label: 'Pergunta ok', kind: 'text' }).data.key).toBe(
      'a_b',
    );
    expect(
      validateQuestion({
        label: 'Pergunta ok',
        kind: 'number',
        alert_threshold_json: { op: '>>', value: 1 },
      }).ok,
    ).toBe(false);
    expect(
      validateQuestion({ label: 'Pergunta ok', kind: 'text', score_direction: 'higher_is_better' })
        .ok,
    ).toBe(false); // texto não pontua
  });

  it('createQuestionSet + saveQuestions: upsert por key, ordem, condição válida; condição para pergunta posterior/inexistente é rejeitada; desativação em vez de apagar', async () => {
    const set = await createQuestionSet(db, session, { name: 'Manutenção' });
    expect((await listQuestionSets(db, fx.clinic.id)).map((s) => s.name)).toContain('Manutenção');
    const saved = await saveQuestions(db, session, set.id, [
      {
        label: 'Como está o humor?',
        kind: 'scale_0_10',
        score_direction: 'higher_is_better',
        alert_threshold_json: { op: '<=', value: 3 },
      },
      {
        label: 'Teve algum efeito indesejado?',
        kind: 'yes_no',
        is_side_effect: true,
        alert_threshold_json: { op: '==', value: 1 },
      },
      {
        label: 'Qual foi o efeito?',
        kind: 'choice',
        options: ['sonolência', 'tontura'],
        required: false,
        is_side_effect: true,
        condition_json: { when: 'teve_algum_efeito_indesejado', op: '==', value: 1 },
      },
    ]);
    expect(saved.map((q) => [q.key, q.sort_order])).toEqual([
      ['como_esta_o_humor', 1],
      ['teve_algum_efeito_indesejado', 2],
      ['qual_foi_o_efeito', 3],
    ]);
    // reordenar + editar label mantendo key
    const again = await saveQuestions(db, session, set.id, [
      {
        key: 'teve_algum_efeito_indesejado',
        label: 'Sentiu efeito indesejado?',
        kind: 'yes_no',
        is_side_effect: true,
      },
      {
        key: 'qual_foi_o_efeito',
        label: 'Qual foi o efeito?',
        kind: 'choice',
        options: ['sonolência', 'tontura', 'náusea'],
        required: false,
        condition_json: { when: 'teve_algum_efeito_indesejado', op: '==', value: 1 },
      },
      { key: 'como_esta_o_humor', label: 'Como está o humor?', kind: 'scale_0_10' },
    ]);
    expect(again.map((q) => q.key)).toEqual([
      'teve_algum_efeito_indesejado',
      'qual_foi_o_efeito',
      'como_esta_o_humor',
    ]);
    expect(again[0].label).toBe('Sentiu efeito indesejado?');
    expect(again[1].options).toEqual(['sonolência', 'tontura', 'náusea']);
    // condição apontando para pergunta que vem depois → erro
    await expect(
      saveQuestions(db, session, set.id, [
        {
          key: 'qual_foi_o_efeito',
          label: 'Qual foi o efeito?',
          kind: 'choice',
          options: ['a', 'b'],
          condition_json: { when: 'como_esta_o_humor', op: '<=', value: 3 },
        },
        { key: 'como_esta_o_humor', label: 'Como está o humor?', kind: 'scale_0_10' },
      ]),
    ).rejects.toThrow(/anterior|condição/i);
    // remover uma da lista → desativa (não apaga)
    const less = await saveQuestions(db, session, set.id, [
      { key: 'como_esta_o_humor', label: 'Como está o humor?', kind: 'scale_0_10' },
    ]);
    expect(less).toHaveLength(1);
    const all = await db('questions').where({ question_set_id: set.id });
    expect(all).toHaveLength(3);
    expect(
      all
        .filter((q) => !q.active)
        .map((q) => q.key)
        .sort(),
    ).toEqual(['qual_foi_o_efeito', 'teve_algum_efeito_indesejado']);
  });

  it('conjunto de outra clínica → not_found', async () => {
    const set = await db('question_sets').first();
    const other = { ...session, clinicId: '00000000-0000-0000-0000-000000000000' };
    await expect(saveQuestions(db, other, set.id, [])).rejects.toMatchObject({ code: 'not_found' });
  });
});
