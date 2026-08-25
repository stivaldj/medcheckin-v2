import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DateTime } from 'luxon';
import { freshDb, seedFixture, fakeNotifier } from './helpers/db.js';
import { planCheckins } from '../src/scheduler/planner.js';
import { dispatchDueCheckins } from '../src/checkin/engine.js';
import {
  respondentToday,
  respondentHistory,
  answerFromRespondent,
} from '../src/respondent/index.js';

const TODAY = DateTime.utc().setZone('America/Cuiaba').startOf('day');
const AT = (hm) => {
  const [h, m] = hm.split(':').map(Number);
  return TODAY.set({ hour: h, minute: m }).toUTC().toJSDate();
};

describe('respondent — hoje, responder, histórico', () => {
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
    await dispatchDueCheckins(db, AT('09:00'), { notifier: fakeNotifier() });
  });
  afterAll(async () => db.destroy());

  it('today: P1 vê o check-in de hoje (sent) com progresso e próxima pergunta, e os 2 lembretes da rotina', async () => {
    const t = await respondentToday(db, s1, AT('09:10'));
    expect(t.respondent).toMatchObject({ name: 'Paciente Sintético Um', kind: 'patient' });
    expect(t.patient.name).toBe('Paciente Sintético Um');
    expect(t.checkin).toMatchObject({ status: 'sent', total: 7, answered: 0, completed: false });
    expect(t.checkin.next.key).toBe('adesao');
    // E9.1: lembrete puro — horário + texto livre, nada a confirmar
    expect(t.alarms).toEqual([
      {
        time: '08:00',
        description: 'ômega 3 1cp / 4 gts óleo IBRACAN 10% sublingual (segurar 1–3 min)',
      },
      { time: '20:00', description: '4 gts óleo IBRACAN 10% sublingual' },
    ]);
    expect(t.push.subscriptions).toBe(0);
    const audit = await db('access_audit').where({ respondent_id: fx.r1.id, route: 'p.today' });
    expect(audit).toHaveLength(1);
  });

  it('today: criança (can_answer=false, receives_alarms=false) não vê check-in nem alarmes; cuidadora vê os 3 lembretes de P2 mas P2 (weekly) não tem check-in hoje', async () => {
    const tp = await respondentToday(db, s2p, AT('09:10'));
    expect(tp.checkin).toBeNull();
    expect(tp.alarms).toEqual([]);
    const tc = await respondentToday(db, s2c, AT('09:10'));
    expect(tc.checkin).toBeNull();
    expect(tc.alarms).toHaveLength(3);
  });

  it('answerFromRespondent: responde na ordem, progresso avança, encerra; check-in de outro paciente → not_found', async () => {
    const t = await respondentToday(db, s1, AT('09:10'));
    await answerFromRespondent(
      db,
      s1,
      { checkinId: t.checkin.id, questionKey: 'adesao', value: 1 },
      AT('09:11'),
    );
    let r = await answerFromRespondent(
      db,
      s1,
      { checkinId: t.checkin.id, questionKey: 'dor', value: 3 },
      AT('09:11'),
    );
    expect(r.next.key).toBe('sono');
    expect(r.completed).toBe(false);
    const t2 = await respondentToday(db, s1, AT('09:12'));
    expect(t2.checkin).toMatchObject({ status: 'in_progress', answered: 2 });
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

  it('history: últimos dias com respostas e a rotina do dia; sem dado → dias ausentes', async () => {
    const h = await respondentHistory(db, s1, { days: 7, now: AT('21:00') });
    const today = TODAY.toISODate();
    const day = h.days.find((d) => d.date === today);
    expect(day.answers).toMatchObject({
      adesao: 1,
      dor: 3,
      sono: 7,
      humor: 7,
      crises: 0,
      efeito_adverso: 0,
    });
    expect(day.alarms.map((a) => a.time)).toEqual(['08:00', '20:00']);
    expect(h.days.every((d) => d.answers || d.alarms.length)).toBe(true);
  });
});
