import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DateTime } from 'luxon';
import { freshDb, seedFixture, fakeNotifier } from './helpers/db.js';
import { runCycle } from '../src/scheduler/cycle.js';

const TODAY = DateTime.utc().setZone('America/Cuiaba').startOf('day');
const AT = (hm) => {
  const [h, m] = hm.split(':').map(Number);
  return TODAY.set({ hour: h, minute: m }).toUTC().toJSDate();
};

describe('runCycle — um ciclo do scheduler (planner → expire → dispatch → alarmes da rotina → alertas)', () => {
  let db, fx, notifier;
  beforeAll(async () => {
    db = await freshDb();
    fx = await seedFixture(db);
    notifier = fakeNotifier();
  });
  afterAll(async () => db.destroy());

  it('cron duplo (t e t+1min) não duplica check-in nem notificação; alertas só 1×/h', async () => {
    // Este teste é sobre DEDUPLICAÇÃO, não sobre frescor: às 09:00 o alarme das 07:00 já passou
    // do teto de atraso (P2-3) e seria descartado, o que esvaziaria a prova de que o 2º ciclo não
    // repete. O teto é neutralizado aqui de propósito; quem prova o teto é routine.test.js.
    const semTeto = { notifier, maxLateMin: Infinity };
    const a = await runCycle(db, AT('09:00'), semTeto);
    const b = await runCycle(db, AT('09:01'), semTeto);
    expect(a.checkins.created).toBe(1);
    expect(b.checkins.created).toBe(0);
    expect(a.dispatch.sent).toBe(1);
    expect(b.dispatch.sent).toBe(0);
    expect(await db('checkins').where({ patient_id: fx.p1.id }).count().first()).toMatchObject({
      count: 1,
    });
    expect(await db('notifications').where({ kind: 'checkin' }).count().first()).toMatchObject({
      count: 1,
    });
    // alarmes da rotina vencidos às 09:00: 08:00 (P1) e 07:00 (P2) → 2 notificações; o 2º ciclo não repete
    expect(a.alarms).toMatchObject({ sent: 2 });
    expect(b.alarms).toMatchObject({ sent: 0, duplicate: 2 });
    expect(await db('notifications').where({ kind: 'alarm' }).count().first()).toMatchObject({
      count: 2,
    });
    // alertas: rodou no 1º ciclo, pulou no 2º (menos de 1h)
    expect(a.alerts).not.toBeNull();
    expect(b.alerts).toBeNull();
  });

  it('sem notifier → lança (fail-closed)', async () => {
    await expect(runCycle(db, AT('09:02'), {})).rejects.toThrow(/notifier/);
  });
});
