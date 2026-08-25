import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { DateTime } from 'luxon';
import { freshDb, seedFixture, fakeNotifier } from './helpers/db.js';
import {
  createRoutinePeriod,
  updateRoutinePeriod,
  endRoutinePeriodToday,
  listRoutine,
  routineAlarmsForDay,
  ADHERENCE_QUESTION_KEY,
} from '../src/routine/index.js';
import { dispatchDueRoutineAlarms } from '../src/scheduler/routineAlarms.js';
import { respondentToday, respondentHistory } from '../src/respondent/index.js';
import { dashboardToday } from '../src/dashboard/today.js';
import { patientReport } from '../src/report/patientReport.js';
import { recordAnswer } from '../src/checkin/engine.js';

const TZ = 'America/Cuiaba';
const TODAY = DateTime.utc().setZone(TZ).startOf('day');
const D = (offset) => TODAY.plus({ days: offset }).toISODate();
const AT = (hm, dayOffset = 0) => {
  const [h, m] = hm.split(':').map(Number);
  return TODAY.plus({ days: dayOffset }).set({ hour: h, minute: m }).toUTC().toJSDate();
};

describe('E9.1 — rotina de alarmes por período', () => {
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
    await db('routine_periods').del();
    await db('notifications').del();
  });

  it('cria período com alarmes (horário + texto livre), ordenados por horário', async () => {
    const r = await createRoutinePeriod(
      db,
      session,
      fx.p1.id,
      {
        starts_on: D(0),
        ends_on: D(4),
        note: 'ciclo de 5 dias',
        alarms: [
          { time: '20:00', description: '5 gts óleo IBRACAN 10% sublingual, segurar 1–3 min' },
          { time: '08:00', description: 'ômega 3 1cp / 4 gts óleo IBRACAN 10% / vitamina D' },
        ],
      },
      AT('10:00'),
    );
    expect(r.starts_on).toBe(D(0));
    expect(r.ends_on).toBe(D(4));
    expect(r.alarms.map((a) => a.time)).toEqual(['08:00', '20:00']);
    expect(r.alarms[0].description).toMatch(/ômega 3/);
    expect(r.replicated_from).toBeNull();
  });

  it('recusa período sem alarme, com horário repetido, com fim antes do início e sobreposto', async () => {
    await createRoutinePeriod(
      db,
      session,
      fx.p1.id,
      { starts_on: D(0), ends_on: D(4), alarms: [{ time: '08:00', description: 'x' }] },
      AT('10:00'),
    );
    await expect(
      createRoutinePeriod(db, session, fx.p1.id, { starts_on: D(10), alarms: [] }, AT('10:00')),
    ).rejects.toThrow(/alarme/i);
    await expect(
      createRoutinePeriod(
        db,
        session,
        fx.p1.id,
        {
          starts_on: D(10),
          alarms: [
            { time: '08:00', description: 'a' },
            { time: '08:00', description: 'b' },
          ],
        },
        AT('10:00'),
      ),
    ).rejects.toThrow(/horário/i);
    await expect(
      createRoutinePeriod(
        db,
        session,
        fx.p1.id,
        { starts_on: D(10), ends_on: D(9), alarms: [{ time: '08:00', description: 'a' }] },
        AT('10:00'),
      ),
    ).rejects.toThrow(/fim/i);
    // sobreposição com o período D(0)..D(4)
    await expect(
      createRoutinePeriod(
        db,
        session,
        fx.p1.id,
        { starts_on: D(4), ends_on: D(8), alarms: [{ time: '08:00', description: 'a' }] },
        AT('10:00'),
      ),
    ).rejects.toThrow(/período/i);
    // encostado (começa no dia seguinte ao fim) é aceito
    const ok = await createRoutinePeriod(
      db,
      session,
      fx.p1.id,
      { starts_on: D(5), ends_on: D(8), alarms: [{ time: '08:00', description: 'a' }] },
      AT('10:00'),
    );
    expect(ok.starts_on).toBe(D(5));
    // outro paciente pode ter período nas mesmas datas
    const other = await createRoutinePeriod(
      db,
      session,
      fx.p2.id,
      { starts_on: D(0), ends_on: D(4), alarms: [{ time: '07:00', description: 'a' }] },
      AT('10:00'),
    );
    expect(other.patient_id).toBe(fx.p2.id);
  });

  it('replicar: copia horários e textos, permite editar antes de salvar e guarda replicated_from', async () => {
    const base = await createRoutinePeriod(
      db,
      session,
      fx.p1.id,
      {
        starts_on: D(0),
        ends_on: D(4),
        alarms: [
          { time: '08:00', description: '4 gts óleo' },
          { time: '20:00', description: '4 gts óleo' },
        ],
      },
      AT('10:00'),
    );
    const next = await createRoutinePeriod(
      db,
      session,
      fx.p1.id,
      {
        starts_on: D(5),
        ends_on: D(9),
        replicated_from: base.id,
        alarms: [
          { time: '08:00', description: '5 gts óleo' }, // texto editado
          { time: '20:00', description: '4 gts óleo' },
        ],
      },
      AT('10:00'),
    );
    expect(next.replicated_from).toBe(base.id);
    expect(next.alarms.map((a) => a.description)).toEqual(['5 gts óleo', '4 gts óleo']);
    // original intacto
    const view = await listRoutine(db, session, fx.p1.id, { now: AT('10:00') });
    expect(view.current.id).toBe(base.id);
    expect(view.current.alarms.map((a) => a.description)).toEqual(['4 gts óleo', '4 gts óleo']);
    expect(view.upcoming.map((p) => p.id)).toEqual([next.id]);
    // quem recebe: respondentes receives_alarms + estado do push
    expect(view.recipients.map((r) => r.id)).toEqual([fx.r1.id]);
    expect(view.recipients[0].push_subscriptions).toBe(0);
  });

  it('editar período futuro (horários e textos) e encerrar hoje', async () => {
    const cur = await createRoutinePeriod(
      db,
      session,
      fx.p1.id,
      { starts_on: D(-2), ends_on: D(10), alarms: [{ time: '08:00', description: 'a' }] },
      AT('10:00'),
    );
    const fut = await createRoutinePeriod(
      db,
      session,
      fx.p1.id,
      { starts_on: D(11), ends_on: D(20), alarms: [{ time: '08:00', description: 'a' }] },
      AT('10:00'),
    );
    const edited = await updateRoutinePeriod(
      db,
      session,
      fut.id,
      {
        starts_on: D(12),
        ends_on: D(20),
        alarms: [
          { time: '09:00', description: 'novo texto' },
          { time: '21:00', description: 'noite' },
        ],
      },
      AT('10:00'),
    );
    expect(edited.starts_on).toBe(D(12));
    expect(edited.alarms.map((a) => `${a.time} ${a.description}`)).toEqual([
      '09:00 novo texto',
      '21:00 noite',
    ]);
    const ended = await endRoutinePeriodToday(db, session, cur.id, AT('10:00'));
    expect(ended.ends_on).toBe(D(0));
  });

  it('alarmes do dia nascem do período que cobre o dia; fora do período, nenhum', async () => {
    await createRoutinePeriod(
      db,
      session,
      fx.p1.id,
      {
        starts_on: D(0),
        ends_on: D(1),
        alarms: [
          { time: '08:00', description: 'manhã' },
          { time: '20:00', description: 'noite' },
        ],
      },
      AT('10:00'),
    );
    expect((await routineAlarmsForDay(db, fx.p1.id, D(0))).map((a) => a.time)).toEqual([
      '08:00',
      '20:00',
    ]);
    expect(await routineAlarmsForDay(db, fx.p1.id, D(1))).toHaveLength(2);
    expect(await routineAlarmsForDay(db, fx.p1.id, D(2))).toEqual([]);
    expect(await routineAlarmsForDay(db, fx.p1.id, D(-1))).toEqual([]);
  });

  it('dispatch: só alarmes vencidos do dia, push com a descrição no corpo, idempotente; fora do período, zero', async () => {
    const notifier = fakeNotifier();
    await createRoutinePeriod(
      db,
      session,
      fx.p1.id,
      {
        starts_on: D(0),
        ends_on: D(0),
        alarms: [
          { time: '08:00', description: 'ômega 3 1cp / 4 gts óleo IBRACAN 10%' },
          { time: '20:00', description: '5 gts óleo' },
        ],
      },
      AT('07:00'),
    );
    const out = await dispatchDueRoutineAlarms(db, AT('08:05'), { notifier });
    expect(out).toMatchObject({ due: 1, sent: 1 });
    const n = await db('notifications').where({ kind: 'alarm' }).first();
    expect(n.payload.body).toBe('ômega 3 1cp / 4 gts óleo IBRACAN 10%');
    expect(n.respondent_id).toBe(fx.r1.id);
    // idempotente no mesmo dia
    expect((await dispatchDueRoutineAlarms(db, AT('08:10'), { notifier })).sent).toBe(0);
    // 20:00 vence mais tarde
    expect((await dispatchDueRoutineAlarms(db, AT('20:01'), { notifier })).sent).toBe(1);
    // dia seguinte está fora do período → param sozinhos
    expect(await dispatchDueRoutineAlarms(db, AT('08:05', 1), { notifier })).toMatchObject({
      due: 0,
      sent: 0,
    });
  });

  it('PWA: "Medicação de hoje" = horários + descrições, sem nada para confirmar', async () => {
    await createRoutinePeriod(
      db,
      session,
      fx.p1.id,
      {
        starts_on: D(0),
        ends_on: D(3),
        alarms: [
          { time: '08:00', description: 'manhã: 4 gts' },
          { time: '20:00', description: 'noite: 5 gts' },
        ],
      },
      AT('07:00'),
    );
    const s = {
      kind: 'respondent',
      respondentId: fx.r1.id,
      patientId: fx.p1.id,
      clinicId: fx.clinic.id,
    };
    const view = await respondentToday(db, s, AT('09:00'));
    expect(view.alarms).toEqual([
      { time: '08:00', description: 'manhã: 4 gts' },
      { time: '20:00', description: 'noite: 5 gts' },
    ]);
    expect(JSON.stringify(view.alarms)).not.toMatch(/intake_id|status/);
    const hist = await respondentHistory(db, s, { days: 3, now: AT('09:00') });
    expect(hist.days.find((d) => d.date === D(0)).alarms).toHaveLength(2);
  });

  it('adesão: pack padrão tem a pergunta, "não" gera alerta medium e alimenta relatório e /hoje', async () => {
    const q = await db('questions')
      .where({ question_set_id: fx.qs.id, key: ADHERENCE_QUESTION_KEY })
      .first();
    expect(q).toBeTruthy();
    expect(q.label).toMatch(/Tomou as medicações corretamente hoje\?/);
    expect(q.kind).toBe('yes_no');
    expect(q.alert_threshold_json).toMatchObject({ op: '==', value: 0, severity: 'medium' });
    expect(q.is_side_effect).toBe(false);

    const [ck] = await db('checkins')
      .insert({
        patient_id: fx.p1.id,
        episode_id: fx.ep1.id,
        scheduled_for: AT('09:00'),
        status: 'sent',
        sent_at: AT('09:00'),
      })
      .returning('id');
    await recordAnswer(
      db,
      {
        checkinId: ck.id,
        respondentId: fx.r1.id,
        questionKey: ADHERENCE_QUESTION_KEY,
        value: 0,
      },
      AT('09:10'),
    );
    const { evaluatePatientAlerts } = await import('../src/alerts/evaluate.js');
    await db('checkins')
      .where({ id: ck.id })
      .update({ status: 'completed', completed_at: AT('09:20') });
    await evaluatePatientAlerts(db, fx.p1.id, AT('09:30'));
    const alert = await db('alerts')
      .where({ patient_id: fx.p1.id, code: `threshold:${ADHERENCE_QUESTION_KEY}` })
      .first();
    expect(alert.severity).toBe('medium');

    const rep = await patientReport(db, session, fx.p1.id, { days: 30, now: AT('10:00') });
    expect(rep.adherence).toMatchObject({ answered: 1, yes: 0, no: 1, rate: 0 });

    const home = await dashboardToday(db, { clinicId: fx.clinic.id }, AT('10:00'));
    expect(home.adherence).toMatchObject({ answered: 1, yes: 0, no: 1 });
    expect(home.adherence.no_patients.map((p) => p.patient_id)).toEqual([fx.p1.id]);
    expect(home).not.toHaveProperty('intakes');
  });
});
