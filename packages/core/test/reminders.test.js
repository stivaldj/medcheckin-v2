import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { DateTime } from 'luxon';
import { freshDb, seedFixture, fakeNotifier } from './helpers/db.js';
import {
  planMedicationIntakes,
  dispatchDueIntakes,
  confirmIntake,
} from '../src/scheduler/reminders.js';

const TODAY = DateTime.utc().setZone('America/Cuiaba').startOf('day');
const AT = (hm) => {
  const [h, m] = hm.split(':').map(Number);
  return TODAY.set({ hour: h, minute: m }).toUTC().toJSDate();
};

describe('lembretes de medicação (alarmes de dose)', () => {
  let db, fx, notifier;
  beforeAll(async () => {
    db = await freshDb();
    fx = await seedFixture(db);
  });
  afterAll(async () => db.destroy());
  beforeEach(async () => {
    await db('notifications').del();
    await db('medication_intakes').del();
    notifier = fakeNotifier();
  });

  it('planeja intakes do dia pela dose vigente: P1 2×/dia (08:00, 20:00), P2 3×/dia; idempotente', async () => {
    const r1 = await planMedicationIntakes(db, AT('05:00'));
    const r2 = await planMedicationIntakes(db, AT('05:30'));
    expect(r1.created).toBe(5);
    expect(r2.created).toBe(0);
    const p1 = await db('medication_intakes')
      .where({ medication_id: fx.m1.id })
      .orderBy('scheduled_at');
    expect(p1.map((i) => new Date(i.scheduled_at).toISOString())).toEqual([
      AT('08:00').toISOString(),
      AT('20:00').toISOString(),
    ]);
    expect(p1.every((i) => i.status === 'pending')).toBe(true);
    // vinculado ao dose_event vigente (4 gotas)
    const de = await db('dose_events').where({ id: p1[0].dose_event_id }).first();
    expect(de.dose_amount).toBe(4);
  });

  it('dispara alarme só para intakes vencidos, para respondentes receives_alarms, com dose vigente no payload; PROVA E2 (L4): envio NÃO confirma', async () => {
    await planMedicationIntakes(db, AT('05:00'));
    const out = await dispatchDueIntakes(db, AT('08:05'), { notifier });
    // 08:00 de P1 e 07:00 de P2 venceram; 13:00/20:00/21:00 não
    expect(out.sent).toBe(2);
    const ns = await db('notifications').where({ kind: 'alarm' }).orderBy('created_at');
    expect(ns).toHaveLength(2);
    const forP1 = ns.find((n) => n.respondent_id === fx.r1.id);
    expect(forP1.payload).toMatchObject({ dose_amount: 4, dose_unit: 'gotas', times_per_day: 2 });
    expect(forP1.sent_at).not.toBeNull();
    // P2: só a cuidadora (receives_alarms) — a criança tem receives_alarms=false
    expect(ns.map((n) => n.respondent_id)).toEqual(expect.arrayContaining([fx.r1.id, fx.r2c.id]));
    expect(ns.map((n) => n.respondent_id)).not.toContain(fx.r2p.id);
    // status continua pending: só o respondente confirma
    const intakes = await db('medication_intakes').whereIn('medication_id', [fx.m1.id, fx.m2.id]);
    expect(intakes.every((i) => i.status === 'pending' && i.taken_at === null)).toBe(true);
    // segunda chamada no mesmo instante não duplica
    const again = await dispatchDueIntakes(db, AT('08:05'), { notifier });
    expect(again.sent).toBe(0);
    expect(await db('notifications').count().first()).toMatchObject({ count: 2 });
  });

  it('falha de envio → notification.failed_at; intake pending; nova tentativa no próximo ciclo', async () => {
    await planMedicationIntakes(db, AT('05:00'));
    notifier.state.failIds.add(fx.r1.id);
    const out = await dispatchDueIntakes(db, AT('08:05'), { notifier });
    expect(out.failed).toBe(1);
    const n = await db('notifications').where({ respondent_id: fx.r1.id }).first();
    expect(n.failed_at).not.toBeNull();
    notifier.state.failIds.clear();
    const retry = await dispatchDueIntakes(db, AT('08:10'), { notifier });
    expect(retry.sent).toBe(1);
  });

  it('confirmIntake: taken (dentro de 60 min), late (>60 min), skipped com efeito; respondente de outro paciente é rejeitado', async () => {
    await planMedicationIntakes(db, AT('05:00'));
    const [i8, i20] = await db('medication_intakes')
      .where({ medication_id: fx.m1.id })
      .orderBy('scheduled_at');
    let r = await confirmIntake(
      db,
      { intakeId: i8.id, respondentId: fx.r1.id, status: 'taken' },
      AT('08:30'),
    );
    expect(r.status).toBe('taken');
    r = await confirmIntake(
      db,
      { intakeId: i20.id, respondentId: fx.r1.id, status: 'taken' },
      AT('21:30'),
    );
    expect(r.status).toBe('late');
    const [i7] = await db('medication_intakes')
      .where({ medication_id: fx.m2.id })
      .orderBy('scheduled_at');
    r = await confirmIntake(
      db,
      {
        intakeId: i7.id,
        respondentId: fx.r2c.id,
        status: 'skipped',
        sideEffect: true,
        note: 'vomitou',
      },
      AT('07:30'),
    );
    expect(r).toMatchObject({ status: 'skipped', side_effect_flag: true });
    await expect(
      confirmIntake(db, { intakeId: i7.id, respondentId: fx.r1.id, status: 'taken' }, AT('07:40')),
    ).rejects.toThrow(/respondente/i);
    await expect(
      confirmIntake(db, { intakeId: i8.id, respondentId: fx.r1.id, status: 'zumbi' }, AT('07:40')),
    ).rejects.toThrow(/status/i);
  });

  it('medicação inativa ou paciente pausado não gera intake', async () => {
    await db('medications').where({ id: fx.m1.id }).update({ active: false });
    await db('patients').where({ id: fx.p2.id }).update({ status: 'paused' });
    const r = await planMedicationIntakes(db, AT('05:00'));
    expect(r.created).toBe(0);
    await db('medications').where({ id: fx.m1.id }).update({ active: true });
    await db('patients').where({ id: fx.p2.id }).update({ status: 'active' });
  });
});
