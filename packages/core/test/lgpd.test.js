import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DateTime } from 'luxon';
import JSZip from 'jszip';
import { freshDb, seedFixture, fakeNotifier } from './helpers/db.js';
import { runCycle, resetCycleState, getSystemState } from '../src/scheduler/cycle.js';
import { answerFromRespondent } from '../src/respondent/index.js';
import { adjustDose } from '../src/medications/index.js';
import { resolveAlert } from '../src/alerts/actions.js';
import { addPatientQuestion } from '../src/questions/patientQuestions.js';
import { acceptInvite } from '../src/auth/invite.js';
import { savePushSubscription } from '../src/push/index.js';
import { symptomDoseSeries } from '../src/analytics/series.js';
import { patientReport } from '../src/report/patientReport.js';
import { exportPatientData, buildExportZip } from '../src/lgpd/export.js';
import { anonymizePatient } from '../src/lgpd/anonymize.js';
import { updatePatient } from '../src/patients/index.js';
import { applyRetention } from '../src/lgpd/retention.js';

const TODAY = DateTime.utc().setZone('America/Cuiaba').startOf('day');
const AT = (hm, d = 0) => {
  const [h, m] = hm.split(':').map(Number);
  return TODAY.plus({ days: d }).set({ hour: h, minute: m }).toUTC().toJSDate();
};

/** Cenário: 3 dias de check-ins respondidos (com adesão), 1 ajuste de dose, 1 alerta resolvido. */
async function scenario(db, fx) {
  const doctor = { kind: 'user', userId: fx.doctor.id, clinicId: fx.clinic.id, role: 'doctor' };
  const s1 = {
    kind: 'respondent',
    respondentId: fx.r1.id,
    patientId: fx.p1.id,
    clinicId: fx.clinic.id,
  };
  const notifier = fakeNotifier();
  resetCycleState();
  for (const d of [-2, -1, 0]) {
    await runCycle(db, AT('09:05', d), { notifier, force: true });
    const ck = await db('checkins')
      .where({ patient_id: fx.p1.id })
      .orderBy('scheduled_for', 'desc')
      .first();
    const dor = d === -2 ? 8 : d === -1 ? 6 : 3;
    for (const [k, v] of [
      ['adesao', d === -1 ? 0 : 1],
      ['dor', dor],
      ['sono', 6],
      ['humor', 6],
      ['crises', 0],
      ['efeito_adverso', d === -1 ? 1 : 0],
      ...(d === -1 ? [['efeito_qual', 'tontura']] : []),
      ['obs', 'texto livre com nome Fulano'],
    ]) {
      await answerFromRespondent(
        db,
        s1,
        { checkinId: ck.id, questionKey: k, value: v },
        AT('09:20', d),
      );
    }
  }
  await adjustDose(
    db,
    doctor,
    fx.m1.id,
    {
      effective_from: TODAY.minus({ days: 1 }).toISODate(),
      dose_amount: 5,
      dose_unit: 'gotas',
      times_per_day: 2,
      schedule_times: ['08:00', '20:00'],
      reason: 'ajuste',
      note: 'nota clínica',
    },
    AT('10:00'),
  );
  const side = await db('alerts').where({ patient_id: fx.p1.id, code: 'side_effect' }).first();
  await resolveAlert(
    db,
    { alertId: side.id, userId: fx.doctor.id, note: 'Orientei tomar após refeição.' },
    AT('11:00'),
  );
  await acceptInvite(db, { inviteToken: 'seed-p1', consentVersion: 'v1' }, AT('11:30'));
  await savePushSubscription(db, s1, {
    endpoint: 'https://push.test/x',
    keys: { p256dh: 'a', auth: 'b' },
  });
  return { doctor, s1 };
}

describe('relatório 30 d', () => {
  let db, fx, doctor;
  beforeAll(async () => {
    db = await freshDb();
    fx = await seedFixture(db);
    ({ doctor } = await scenario(db, fx));
  });
  afterAll(async () => db.destroy());

  it('resume check-ins, adesão (pela pergunta do check-in), sintomas com n, scores, doses, alertas+condutas, efeitos', async () => {
    const r = await patientReport(db, doctor, fx.p1.id, { days: 30, now: AT('12:00') });
    expect(r.patient.name).toBe('Paciente Sintético Um');
    expect(r.checkins).toMatchObject({ sent: 3, completed: 3, missed: 0, completion_rate: 1 });
    // E9.1: adesão vem da pergunta 'adesao' — 3 dias respondidos, 1 "não" (d-1)
    expect(r.adherence).toMatchObject({ answered: 3, yes: 2, no: 1 });
    expect(r.adherence.rate).toBeCloseTo(2 / 3, 2);
    expect(r.adherence.days.filter((d) => !d.took)).toHaveLength(1);
    const dor = r.symptoms.find((s) => s.key === 'dor');
    expect(dor).toMatchObject({ n: 3, min: 3, max: 8, last: 3 });
    expect(dor.mean).toBeCloseTo(17 / 3, 2);
    expect(r.scores.n).toBe(3);
    expect(r.doses.map((d) => d.dose_amount)).toContain(5);
    const side = r.alerts.find((a) => a.code === 'side_effect');
    expect(side.status).toBe('resolved');
    expect(side.actions.map((a) => a.action)).toContain('resolve');
    expect(r.side_effects.length).toBeGreaterThan(0);
    const audit = await db('access_audit').where({
      patient_id: fx.p1.id,
      route: 'patients.report',
    });
    expect(audit).toHaveLength(1);
  });

  it('paciente sem dados → nulls (nunca 0/“estável”)', async () => {
    const r = await patientReport(db, doctor, fx.p2.id, { days: 30, now: AT('12:00') });
    expect(r.checkins.completion_rate).toBeNull();
    expect(r.adherence.rate).toBeNull();
    expect(r.symptoms.every((s) => s.n === 0 && s.mean === null)).toBe(true);
    expect(r.scores.mean).toBeNull();
  });
});

describe('LGPD — export, anonimização, retenção', () => {
  let db, fx, doctor;
  beforeAll(async () => {
    db = await freshDb();
    fx = await seedFixture(db);
    ({ doctor } = await scenario(db, fx));
  });
  afterAll(async () => db.destroy());

  it('PROVA E7: export → manifest com contagens e zip legível com os arquivos', async () => {
    const data = await exportPatientData(db, doctor, fx.p1.id, AT('12:00'));
    expect(data.manifest.counts).toMatchObject({
      respondents: 1,
      medications: 1,
      dose_events: 3,
      episodes: 1,
      checkins: 3,
      answers: 22, // +3: a pergunta de adesão em cada dia
      alerts: expect.any(Number),
    });
    expect(data.manifest.counts.medication_intakes).toBe(0); // D17: nada novo é criado
    expect(data.manifest.counts).toMatchObject({ routine_periods: 1, routine_alarms: 2 });
    expect(Object.keys(data.files).sort()).toEqual([
      'access_audit.json',
      'alerts.json',
      'checkins.json',
      'episodes.json',
      'medication_intakes.json',
      'medications.json',
      'notifications.json',
      'patient.json',
      'questions.json',
      'respondents.json',
      'routine_periods.json',
      'scores.json',
    ]);
    const buf = await buildExportZip(data);
    const zip = await JSZip.loadAsync(buf);
    const names = Object.keys(zip.files).sort();
    expect(names).toContain('manifest.json');
    expect(names).toContain('checkins.json');
    const manifest = JSON.parse(await zip.file('manifest.json').async('string'));
    expect(manifest.counts.checkins).toBe(3);
    const checkins = JSON.parse(await zip.file('checkins.json').async('string'));
    expect(checkins[0].answers.length).toBeGreaterThan(0);
    const notif = JSON.parse(await zip.file('notifications.json').async('string'));
    expect(notif[0]).not.toHaveProperty('payload'); // só metadados de entrega
    const audit = await db('access_audit').where({ patient_id: fx.p1.id, action: 'export' });
    expect(audit).toHaveLength(1);
    // outra clínica → not_found
    await expect(
      exportPatientData(
        db,
        { ...doctor, clinicId: '00000000-0000-0000-0000-000000000000' },
        fx.p1.id,
        AT('12:00'),
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('PROVA E7: anonimizar remove PII e texto livre, revoga acessos, e MANTÉM as séries (sintoma × dose, scores, condutas)', async () => {
    const before = await symptomDoseSeries(db, fx.p1.id, {
      questionKey: 'dor',
      days: 14,
      now: AT('12:00'),
    });
    const scoresBefore = await db('patient_scores_daily')
      .where({ patient_id: fx.p1.id })
      .orderBy('date');
    await expect(
      anonymizePatient(db, doctor, fx.p1.id, { reason: '' }, AT('13:00')),
    ).rejects.toThrow(/motivo/i);
    const out = await anonymizePatient(
      db,
      doctor,
      fx.p1.id,
      { reason: 'Solicitação do titular (LGPD art. 18)' },
      AT('13:00'),
    );
    expect(out.patient.name).toMatch(/^Paciente anonimizado [0-9a-f]{8}$/);
    const p = await db('patients').where({ id: fx.p1.id }).first();
    expect(p).toMatchObject({ birth_date: null, status: 'discharged' });
    const r = await db('respondents').where({ patient_id: fx.p1.id }).first();
    expect(r.name).toMatch(/^Respondente \d+$/);
    expect(r.email).toBeNull();
    expect(r.phone).toBeNull();
    expect(r.invite_token).not.toBe('seed-p1');
    expect(
      await db('sessions').where({ respondent_id: r.id }).whereNull('revoked_at').count().first(),
    ).toMatchObject({ count: 0 });
    expect(
      await db('push_subscriptions').where({ respondent_id: r.id }).count().first(),
    ).toMatchObject({ count: 0 });
    const texts = await db('answers as a')
      .join('checkins as c', 'c.id', 'a.checkin_id')
      .where('c.patient_id', fx.p1.id)
      .whereNotNull('a.value_text')
      .pluck('a.value_text');
    expect(texts.length).toBeGreaterThan(0);
    expect(texts.every((t) => t === '[removido]')).toBe(true);
    const notes = await db('dose_events').where({ medication_id: fx.m1.id }).pluck('note');
    expect(notes.every((n) => n === null)).toBe(true);
    const payloads = await db('notifications').where({ patient_id: fx.p1.id }).pluck('payload');
    expect(payloads.every((x) => JSON.stringify(x) === '{}')).toBe(true);
    // séries mantidas
    const after = await symptomDoseSeries(db, fx.p1.id, {
      questionKey: 'dor',
      days: 14,
      now: AT('12:00'),
    });
    expect(after.points).toEqual(before.points);
    expect(after.doseMarkers.map((m) => m.dose_amount)).toEqual(
      before.doseMarkers.map((m) => m.dose_amount),
    );
    const scoresAfter = await db('patient_scores_daily')
      .where({ patient_id: fx.p1.id })
      .orderBy('date');
    expect(scoresAfter.map((s) => s.score)).toEqual(scoresBefore.map((s) => s.score));
    const conduct = await db('alert_actions as x')
      .join('alerts as a', 'a.id', 'x.alert_id')
      .where('a.patient_id', fx.p1.id)
      .andWhere('x.action', 'resolve')
      .first();
    expect(conduct.note).toMatch(/Orientei/);
    const audit = await db('access_audit').where({ patient_id: fx.p1.id, action: 'anonymize' });
    expect(audit).toHaveLength(1);
    // idempotente: segunda vez não quebra e não muda o nome
    const again = await anonymizePatient(db, doctor, fx.p1.id, { reason: 'repetido' }, AT('14:00'));
    expect(again.patient.name).toBe(out.patient.name);
  });

  it('retenção: apaga notificações antigas, sessões expiradas, tokens usados e audit velho; runCycle aplica 1×/dia', async () => {
    const old = (days) => DateTime.fromJSDate(AT('12:00')).minus({ days }).toJSDate();
    await db('notifications').insert({
      patient_id: fx.p2.id,
      respondent_id: fx.r2c.id,
      kind: 'checkin',
      payload: {},
      scheduled_at: old(100),
      sent_at: old(100),
      dedup_key: 'old:1',
      created_at: old(100),
    });
    await db('notifications').insert({
      patient_id: fx.p2.id,
      respondent_id: fx.r2c.id,
      kind: 'checkin',
      payload: {},
      scheduled_at: old(10),
      sent_at: old(10),
      dedup_key: 'new:1',
      created_at: old(10),
    });
    await db('sessions').insert({
      token_hash: 'x'.repeat(64),
      respondent_id: fx.r2c.id,
      clinic_id: fx.clinic.id,
      expires_at: old(40),
      created_at: old(200),
    });
    await db('auth_tokens').insert({
      email: 'medica@medcheckin.test',
      user_id: fx.doctor.id,
      token_hash: 'y'.repeat(64),
      expires_at: old(30),
      used_at: old(30),
      created_at: old(30),
    });
    await db('access_audit').insert({
      clinic_id: fx.clinic.id,
      user_id: fx.doctor.id,
      route: 'x',
      action: 'view',
      at: old(800),
    });
    const r = await applyRetention(db, AT('12:00'));
    expect(r).toMatchObject({ notifications: 1, sessions: 1, auth_tokens: 1, access_audit: 1 });
    expect(await db('notifications').where({ dedup_key: 'new:1' }).first()).toBeTruthy();
    // via runCycle: 1×/dia (carimbo) — o cenário já rodou com force hoje, então limpo o carimbo
    await db('system_state').where({ key: 'retention.last_run_at' }).del();
    resetCycleState();
    const c1 = await runCycle(db, AT('12:10'), { notifier: fakeNotifier() });
    const c2 = await runCycle(db, AT('12:20'), { notifier: fakeNotifier() });
    expect(c1.retention).not.toBeNull();
    expect(c2.retention).toBeNull();
    const st = await getSystemState(db);
    expect(st['retention.last_run_at']).toBeTruthy();
  });

  it('P2-1: pergunta criada para o paciente e NUNCA respondida sai no export (art. 18)', async () => {
    await addPatientQuestion(
      db,
      doctor,
      fx.p1.id,
      { label: 'Dormiu bem na casa da tia Rosa?', kind: 'yes_no' },
      AT('09:00'),
    );
    const data = await exportPatientData(db, doctor, fx.p1.id, AT('12:00'));
    const qs = data.files['questions.json'];
    expect(qs.map((q) => q.label)).toContain('Dormiu bem na casa da tia Rosa?');
    expect(data.manifest.counts.questions).toBe(qs.length);
    // e chega no zip, não só no objeto em memória
    const zip = await JSZip.loadAsync(await buildExportZip(data));
    expect(Object.keys(zip.files)).toContain('questions.json');
  });

  it('P2-2: anonimizar tira o nome do enunciado E da chave da pergunta extra, sem perder a série', async () => {
    const q = await addPatientQuestion(
      db,
      doctor,
      fx.p2.id,
      { label: 'A dona Marlene teve tontura?', kind: 'yes_no' },
      AT('09:00'),
    );
    expect(q.key).toContain('marlene'); // a chave é derivada do enunciado: carrega o nome junto
    await anonymizePatient(db, doctor, fx.p2.id, { reason: 'pedido do titular' }, AT('13:00'));
    const depois = await db('questions').where({ id: q.id }).first();
    expect(depois.label).toBe('Pergunta extra 1');
    expect(depois.key).toBe('extra_1');
    expect(depois.id).toBe(q.id); // a linha é a mesma → answers.question_id segue válido
    expect(depois.alert_threshold_json ?? null).toEqual(q.alert_threshold_json ?? null);
  });

  it('DECISÃO: anonimizar preserva a conduta clínica (prontuário) enquanto apaga a identidade', async () => {
    const antes = await db('alert_actions as x')
      .join('alerts as a', 'a.id', 'x.alert_id')
      .where('a.patient_id', fx.p1.id)
      .whereNotNull('x.note')
      .select('x.id', 'x.note');
    expect(antes.length).toBeGreaterThan(0);

    await anonymizePatient(db, doctor, fx.p1.id, { reason: 'titular pediu saída' }, AT('15:00'));

    const depois = await db('alert_actions').whereIn(
      'id',
      antes.map((a) => a.id),
    );
    // a conduta é prontuário: sai o QUEM, fica o QUE FOI FEITO
    expect(depois.map((d) => d.note).sort()).toEqual(antes.map((a) => a.note).sort());
    expect(depois.some((d) => d.note.includes('Orientei tomar após refeição.'))).toBe(true);
    // e a identidade foi de fato embora
    const p = await db('patients').where({ id: fx.p1.id }).first();
    expect(p.name).not.toContain('Sintético');
    expect(p.birth_date).toBeNull();
  });
});

// Banco próprio: o describe acima anonimiza p1 e p2 em testes anteriores, e este precisa de um
// paciente que recebeu alta mas nunca foi anonimizado.
describe('D28 — alta não é anonimização', () => {
  let db, fx, doctor;
  beforeAll(async () => {
    db = await freshDb();
    fx = await seedFixture(db);
    ({ doctor } = await scenario(db, fx));
  });
  afterAll(async () => db.destroy());

  it('D28: alta NÃO é anonimização — paciente com alta continua anonimizável, e a data da 1ª anonimização fica', async () => {
    // "Dar alta" e "anonimizar" gravam o mesmo status; só anonymized_at distingue os dois.
    await updatePatient(db, doctor, fx.p2.id, { status: 'discharged' }, AT('09:00'));
    const comAlta = await db('patients').where({ id: fx.p2.id }).first();
    expect(comAlta.status).toBe('discharged');
    expect(comAlta.anonymized_at).toBeNull();

    await anonymizePatient(db, doctor, fx.p2.id, { reason: 'pedido após a alta' }, AT('10:00'));
    const anon = await db('patients').where({ id: fx.p2.id }).first();
    expect(anon.name).toMatch(/^Paciente anonimizado /);
    expect(anon.anonymized_at).not.toBeNull();
    const primeira = new Date(anon.anonymized_at).getTime();

    // idempotente: repetir não reescreve quando aconteceu
    await anonymizePatient(db, doctor, fx.p2.id, { reason: 'repetido' }, AT('11:00'));
    const denovo = await db('patients').where({ id: fx.p2.id }).first();
    expect(new Date(denovo.anonymized_at).getTime()).toBe(primeira);
  });
});
