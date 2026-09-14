import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { DateTime } from 'luxon';
import { freshDb, seedFixture, fakeNotifier } from './helpers/db.js';
import {
  createRoutinePeriod,
  updateRoutinePeriod,
  endRoutinePeriodToday,
  deleteRoutinePeriod,
  listRoutine,
} from '../src/routine/index.js';
import { dispatchDueRoutineAlarms } from '../src/scheduler/routineAlarms.js';

/**
 * Bug do teste real (14/09): a médica criou um período de rotina errado e ficou presa — não dava
 * para editar o vigente, não havia como apagar, e um novo começando hoje batia na sobreposição
 * (até depois de "Encerrar hoje", que grava fim = hoje).
 *
 * Regras (D33): o vigente se edita (horários, textos, fim ≥ hoje), mas o INÍCIO de quem já começou
 * não muda — é o registro do que valeu nos dias passados. Editar preserva o alarme de um horário
 * que continua, para o lembrete que já saiu hoje não sair de novo. Apagar só o que não deixou
 * rastro: futuro, ou começou hoje sem nenhum lembrete enviado.
 */
const TZ = 'America/Cuiaba';
const TODAY = DateTime.utc().setZone(TZ).startOf('day');
const D = (offset) => TODAY.plus({ days: offset }).toISODate();
const AT = (hm, dayOffset = 0) => {
  const [h, m] = hm.split(':').map(Number);
  return TODAY.plus({ days: dayOffset }).set({ hour: h, minute: m }).toUTC().toJSDate();
};

describe('rotina — editar o vigente, apagar o que não valeu, mensagem de sobreposição útil', () => {
  let db, fx, session;
  beforeAll(async () => {
    db = await freshDb();
    fx = await seedFixture(db);
    session = { kind: 'user', userId: fx.doctor.id, clinicId: fx.clinic.id, role: 'doctor' };
  });
  afterAll(async () => db.destroy());
  beforeEach(async () => {
    await db('routine_periods').del();
    await db('notifications').del();
  });

  const create = (input, at = AT('07:00')) => createRoutinePeriod(db, session, fx.p1.id, input, at);

  it('edita horários e textos do período VIGENTE; o horário que continua mantém o alarme e não reenvia hoje', async () => {
    const notifier = fakeNotifier();
    const cur = await create({
      starts_on: D(-3),
      alarms: [
        { time: '08:00', description: 'texto errado' },
        { time: '20:00', description: 'noite' },
      ],
    });
    expect((await dispatchDueRoutineAlarms(db, AT('08:05'), { notifier })).sent).toBe(1);
    const id0800 = cur.alarms.find((a) => a.time === '08:00').id;

    const edited = await updateRoutinePeriod(
      db,
      session,
      cur.id,
      {
        alarms: [
          { time: '08:00', description: '4 gts óleo 10%' },
          { time: '13:00', description: 'almoço' },
          { time: '20:00', description: 'noite' },
        ],
      },
      AT('08:30'),
    );
    expect(edited.alarms.map((a) => `${a.time} ${a.description}`)).toEqual([
      '08:00 4 gts óleo 10%',
      '13:00 almoço',
      '20:00 noite',
    ]);
    expect(edited.alarms.find((a) => a.time === '08:00').id).toBe(id0800);
    // o 08:00 já saiu hoje: editar o texto não o manda de novo
    expect((await dispatchDueRoutineAlarms(db, AT('08:40'), { notifier })).sent).toBe(0);
    // o horário novo segue a regra normal
    expect((await dispatchDueRoutineAlarms(db, AT('13:05'), { notifier })).sent).toBe(1);
  });

  it('vigente: o início não muda e o fim não pode ficar antes de hoje; fim ≥ hoje é aceito', async () => {
    const cur = await create({ starts_on: D(-3), alarms: [{ time: '08:00', description: 'a' }] });
    await expect(
      updateRoutinePeriod(db, session, cur.id, { starts_on: D(-1) }, AT('09:00')),
    ).rejects.toMatchObject({ field: 'starts_on' });
    await expect(
      updateRoutinePeriod(db, session, cur.id, { ends_on: D(-1) }, AT('09:00')),
    ).rejects.toMatchObject({ field: 'ends_on' });
    const ok = await updateRoutinePeriod(db, session, cur.id, { ends_on: D(5) }, AT('09:00'));
    expect(ok.ends_on).toBe(D(5));
  });

  it('apagar: futuro sim; começou hoje sem lembrete enviado sim; com lembrete enviado ou passado, não', async () => {
    const fut = await create({ starts_on: D(10), alarms: [{ time: '08:00', description: 'a' }] });
    await deleteRoutinePeriod(db, session, fut.id, AT('09:00'));
    expect(await db('routine_periods').where({ id: fut.id })).toHaveLength(0);
    expect(await db('routine_alarms').where({ period_id: fut.id })).toHaveLength(0);

    // criado hoje por engano, nada saiu ainda → apaga e deixa criar outro começando hoje
    const errado = await create({ starts_on: D(0), alarms: [{ time: '22:00', description: 'x' }] });
    await deleteRoutinePeriod(db, session, errado.id, AT('09:00'));
    const certo = await create({ starts_on: D(0), alarms: [{ time: '21:00', description: 'y' }] });
    expect(certo.starts_on).toBe(D(0));

    // já mandou lembrete hoje → não apaga (é o registro do que o paciente recebeu)
    await dispatchDueRoutineAlarms(db, AT('21:05'), { notifier: fakeNotifier() });
    await expect(deleteRoutinePeriod(db, session, certo.id, AT('21:10'))).rejects.toMatchObject({
      code: 'validation',
    });

    // começou em dia passado → não apaga
    await db('routine_periods').del();
    const velho = await create({ starts_on: D(-2), alarms: [{ time: '08:00', description: 'z' }] });
    await expect(deleteRoutinePeriod(db, session, velho.id, AT('09:00'))).rejects.toMatchObject({
      code: 'validation',
    });
  });

  it('listRoutine diz o que a tela pode oferecer em cada período (editar/apagar/encerrar)', async () => {
    const cur = await create({
      starts_on: D(-1),
      ends_on: D(2),
      alarms: [{ time: '08:00', description: 'a' }],
    });
    await create({ starts_on: D(3), alarms: [{ time: '08:00', description: 'b' }] });
    const r = await listRoutine(db, session, fx.p1.id, { now: AT('09:00') });
    expect(r.current.id).toBe(cur.id);
    expect(r.current.actions).toEqual({ edit: true, delete: false, end_today: true });
    expect(r.upcoming[0].actions).toEqual({ edit: true, delete: true, end_today: false });
  });

  it('sobreposição: a mensagem diz com qual período bate e o caminho (editar o vigente ou começar amanhã)', async () => {
    const cur = await create({ starts_on: D(-1), alarms: [{ time: '08:00', description: 'a' }] });
    await endRoutinePeriodToday(db, session, cur.id, AT('09:00'));
    const err = await create(
      { starts_on: D(0), alarms: [{ time: '09:00', description: 'b' }] },
      AT('09:10'),
    ).catch((e) => e);
    expect(err).toMatchObject({ code: 'validation', field: 'starts_on' });
    const [, m, d] = D(-1).split('-');
    expect(err.message).toContain(`${d}/${m}`);
    expect(err.message).toMatch(/Editar/);
    expect(err.message).toMatch(/amanhã/);
  });
});
