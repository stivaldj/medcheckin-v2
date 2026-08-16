import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DateTime } from 'luxon';
import { freshDb, seedFixture, fakeNotifier } from './helpers/db.js';
import { planCheckins } from '../src/scheduler/planner.js';
import { planMedicationIntakes } from '../src/scheduler/reminders.js';
import { dispatchDueCheckins } from '../src/checkin/engine.js';
import {
  respondentToday,
  respondentHistory,
  answerFromRespondent,
  confirmFromRespondent,
} from '../src/respondent/index.js';

const TODAY = DateTime.utc().setZone('America/Cuiaba').startOf('day');
const AT = (hm) => {
  const [h, m] = hm.split(':').map(Number);
  return TODAY.set({ hour: h, minute: m }).toUTC().toJSDate();
};

describe('respondent — hoje, responder, confirmar, histórico', () => {
  let db, fx, s1, s2c, s2p;
  beforeAll(async () => {
    db = await freshDb();
    fx = await seedFixture(db);
    const mk = (r, patient) => ({
      kind: 'respondent',
      respondentId: r.id,
      respondentKind: r.kind,
      patientId: patient.id,
      clinicId: fx.clinic.id,
      name: r.name,
      canAnswer: r.can_answer,
      receivesAlarms: r.receives_alarms,
    });
    s1 = mk(fx.r1, fx.p1);
    s2c = mk(fx.r2c, fx.p2);
    s2p = mk(fx.r2p, fx.p2);
    await planCheckins(db, AT('06:00'));
    await planMedicationIntakes(db, AT('06:00'));
    await dispatchDueCheckins(db, AT('09:00'), { notifier: fakeNotifier() });
  });
  afterAll(async () => db.destroy());

  it('today: P1 vê o check-in de hoje (sent) com progresso e próxima pergunta, e os 2 alarmes de dose', async () => {
    const t = await respondentToday(db, s1, AT('09:10'));
    expect(t.respondent).toMatchObject({ name: 'Paciente Sintético Um', kind: 'patient' });
    expect(t.patient.name).toBe('Paciente Sintético Um');
    expect(t.checkin).toMatchObject({ status: 'sent', total: 6, answered: 0, completed: false });
    expect(t.checkin.next.key).toBe('dor');
    expect(t.alarms).toHaveLength(2);
    expect(t.alarms[0]).toMatchObject({
      status: 'pending',
      dose_amount: 4,
      dose_unit: 'gotas',
      product_name: 'Óleo Full Spectrum CBD 50mg/ml',
    });
    expect(t.push.subscriptions).toBe(0);
    const audit = await db('access_audit').where({ respondent_id: fx.r1.id, route: 'p.today' });
    expect(audit).toHaveLength(1);
  });

  it('today: criança (can_answer=false, receives_alarms=false) não vê check-in nem alarmes; cuidadora vê alarmes de P2 mas P2 (weekly) não tem check-in hoje', async () => {
    const tp = await respondentToday(db, s2p, AT('09:10'));
    expect(tp.checkin).toBeNull();
    expect(tp.alarms).toEqual([]);
    const tc = await respondentToday(db, s2c, AT('09:10'));
    expect(tc.checkin).toBeNull();
    expect(tc.alarms).toHaveLength(3);
  });

  it('answerFromRespondent: responde na ordem, progresso avança, encerra; check-in de outro paciente → not_found', async () => {
    const t = await respondentToday(db, s1, AT('09:10'));
    let r = await answerFromRespondent(
      db,
      s1,
      { checkinId: t.checkin.id, questionKey: 'dor', value: 3 },
      AT('09:11'),
    );
    expect(r.next.key).toBe('sono');
    expect(r.completed).toBe(false);
    const t2 = await respondentToday(db, s1, AT('09:12'));
    expect(t2.checkin).toMatchObject({ status: 'in_progress', answered: 1 });
    await answerFromRespondent(
      db,
      s1,
      { checkinId: t.checkin.id, questionKey: 'sono', value: 7 },
      AT('09:12'),
    );
    await answerFromRespondent(
      db,
      s1,
      { checkinId: t.checkin.id, questionKey: 'humor', value: 7 },
      AT('09:12'),
    );
    await answerFromRespondent(
      db,
      s1,
      { checkinId: t.checkin.id, questionKey: 'crises', value: 0 },
      AT('09:12'),
    );
    r = await answerFromRespondent(
      db,
      s1,
      { checkinId: t.checkin.id, questionKey: 'efeito_adverso', value: 0 },
      AT('09:13'),
    );
    expect(r.next.key).toBe('obs');
    r = await answerFromRespondent(
      db,
      s1,
      { checkinId: t.checkin.id, questionKey: 'obs', value: null },
      AT('09:14'),
    );
    expect(r.completed).toBe(true);
    const t3 = await respondentToday(db, s1, AT('09:15'));
    expect(t3.checkin).toMatchObject({ status: 'completed', completed: true, next: null });
    await expect(
      answerFromRespondent(
        db,
        s2c,
        { checkinId: t.checkin.id, questionKey: 'dor', value: 3 },
        AT('09:16'),
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
    // valor inválido → validation-like erro do engine
    const [ck2] = await db('checkins')
      .insert({
        patient_id: fx.p1.id,
        episode_id: fx.ep1.id,
        scheduled_for: AT('15:00'),
        status: 'sent',
        sent_at: AT('15:00'),
      })
      .returning('id');
    await expect(
      answerFromRespondent(
        db,
        s1,
        { checkinId: ck2.id, questionKey: 'dor', value: 99 },
        AT('15:01'),
      ),
    ).rejects.toMatchObject({ code: 'invalid_value' });
  });

  it('confirmFromRespondent: tomei / não tomei com efeito; intake de outro paciente → not_found; reflete no today', async () => {
    const t = await respondentToday(db, s1, AT('09:10'));
    const [a1, a2] = t.alarms;
    let r = await confirmFromRespondent(
      db,
      s1,
      { intakeId: a1.intake_id, status: 'taken' },
      AT('08:20'),
    );
    expect(r.status).toBe('taken');
    r = await confirmFromRespondent(
      db,
      s1,
      { intakeId: a2.intake_id, status: 'skipped', sideEffect: true, note: 'enjoo' },
      AT('20:30'),
    );
    expect(r).toMatchObject({ status: 'skipped', side_effect_flag: true });
    const after = await respondentToday(db, s1, AT('20:31'));
    expect(after.alarms.map((a) => a.status)).toEqual(['taken', 'skipped']);
    await expect(
      confirmFromRespondent(db, s2c, { intakeId: a1.intake_id, status: 'taken' }, AT('09:00')),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      confirmFromRespondent(db, s1, { intakeId: a1.intake_id, status: 'zumbi' }, AT('09:00')),
    ).rejects.toThrow(/status/);
  });

  it('history: últimos dias com respostas e intakes; sem dado → dias ausentes', async () => {
    const h = await respondentHistory(db, s1, { days: 7, now: AT('21:00') });
    const today = TODAY.toISODate();
    const day = h.days.find((d) => d.date === today);
    expect(day.answers).toMatchObject({ dor: 3, sono: 7, humor: 7, crises: 0, efeito_adverso: 0 });
    expect(day.intakes.map((i) => i.status)).toEqual(['taken', 'skipped']);
    expect(h.days.every((d) => d.answers || d.intakes.length)).toBe(true);
  });
});
