import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DateTime } from 'luxon';
import { freshDb, seedFixture, fakeNotifier } from './helpers/db.js';
import { runCycle, resetCycleState } from '../src/scheduler/cycle.js';
import { getSystemState } from '../src/scheduler/cycle.js';
import { answerFromRespondent } from '../src/respondent/index.js';
import { adjustDose } from '../src/medications/index.js';
import { dashboardToday } from '../src/dashboard/today.js';
import { symptomDoseSeries } from '../src/analytics/series.js';

const TODAY = DateTime.utc().setZone('America/Cuiaba').startOf('day');
const AT = (hm, dayOffset = 0) => {
  const [h, m] = hm.split(':').map(Number);
  return TODAY.plus({ days: dayOffset }).set({ hour: h, minute: m }).toUTC().toJSDate();
};

describe('system_state — carimbos duráveis do scheduler', () => {
  let db;
  beforeAll(async () => {
    db = await freshDb();
    await seedFixture(db);
    resetCycleState();
  });
  afterAll(async () => db.destroy());

  it('runCycle grava scheduler.last_cycle_at e alerts.last_run_at; alertas só 1×/h mesmo após "reinício" (estado no banco)', async () => {
    const a = await runCycle(db, AT('09:00'), { notifier: fakeNotifier() });
    expect(a.alerts).not.toBeNull();
    const st = await getSystemState(db);
    expect(new Date(st['scheduler.last_cycle_at']).getTime()).toBe(AT('09:00').getTime());
    expect(new Date(st['alerts.last_run_at']).getTime()).toBe(AT('09:00').getTime());
    resetCycleState(); // simula reinício do processo
    const b = await runCycle(db, AT('09:30'), { notifier: fakeNotifier() });
    expect(b.alerts).toBeNull(); // relógio veio do banco
    const c = await runCycle(db, AT('10:01'), { notifier: fakeNotifier() });
    expect(c.alerts).not.toBeNull();
  });
});

describe('dashboardToday — tela Hoje da médica (cada número com fonte)', () => {
  let db, fx, s1, notifier;
  beforeAll(async () => {
    db = await freshDb();
    fx = await seedFixture(db);
    resetCycleState();
    notifier = fakeNotifier();
    s1 = {
      kind: 'respondent',
      respondentId: fx.r1.id,
      patientId: fx.p1.id,
      clinicId: fx.clinic.id,
    };
    // P2 ganha um check-in hoje (episódio weekly não bate): inserido direto
    await db('checkins').insert({
      patient_id: fx.p2.id,
      episode_id: fx.ep2.id,
      scheduled_for: AT('09:00'),
      next_attempt_at: AT('09:00'),
    });
    await runCycle(db, AT('09:05'), { notifier }); // P1 criado+enviado; P2 enviado; intakes 5; alarmes vencidos 2
  });
  afterAll(async () => db.destroy());

  it('sem resposta: P1 e P2 aguardando (sent); P1 responde tudo → some da lista; alerta threshold aparece', async () => {
    let d = await dashboardToday(db, { clinicId: fx.clinic.id }, AT('09:10'));
    expect(d.awaiting.map((a) => a.patient_name).sort()).toEqual([
      'Paciente Sintético Dois',
      'Paciente Sintético Um',
    ]);
    expect(d.awaiting[0]).toMatchObject({ status: 'sent', attempt_count: 1 });
    const ck1 = await db('checkins').where({ patient_id: fx.p1.id }).first();
    for (const [k, v] of [
      ['dor', 9],
      ['sono', 5],
      ['humor', 5],
      ['crises', 0],
      ['efeito_adverso', 0],
      ['obs', null],
    ]) {
      await answerFromRespondent(
        db,
        s1,
        { checkinId: ck1.id, questionKey: k, value: v },
        AT('09:20'),
      );
    }
    d = await dashboardToday(db, { clinicId: fx.clinic.id }, AT('09:30'));
    expect(d.awaiting.map((a) => a.patient_name)).toEqual(['Paciente Sintético Dois']);
    expect(d.completed_today).toBe(1);
    expect(d.open_alerts.map((a) => a.code)).toContain('threshold:dor');
    expect(d.open_alerts[0].patient_name).toBe('Paciente Sintético Um');
  });

  it('confirmações de dose: vencidas sem confirmação vs confirmadas; próximos envios nas 24 h; scheduler heartbeat', async () => {
    const d = await dashboardToday(db, { clinicId: fx.clinic.id }, AT('09:30'));
    // vencidos às 09:30: P1 08:00, P2 07:00 → 2 pendentes; futuros: P2 13:00, P1 20:00, P2 21:00 → 3 upcoming alarms
    expect(d.intakes.pending_confirmation).toHaveLength(2);
    expect(d.intakes.pending_confirmation[0]).toMatchObject({
      patient_name: 'Paciente Sintético Dois',
    });
    expect(d.intakes.taken + d.intakes.late + d.intakes.skipped).toBe(0);
    expect(d.upcoming.filter((u) => u.kind === 'alarm')).toHaveLength(3);
    // retry do check-in de P2 às 10:05 aparece como próximo envio de check-in
    expect(d.upcoming.filter((u) => u.kind === 'checkin').map((u) => u.patient_name)).toContain(
      'Paciente Sintético Dois',
    );
    expect(d.scheduler.last_cycle_at).not.toBeNull();
    expect(d.scheduler.stale).toBe(true); // último ciclo 09:05, agora 09:30 → > 10 min
    const fresh = await dashboardToday(db, { clinicId: fx.clinic.id }, AT('09:10'));
    expect(fresh.scheduler.stale).toBe(false);
    const late = await dashboardToday(db, { clinicId: fx.clinic.id }, AT('09:30', 1));
    expect(late.scheduler.stale).toBe(true);
  });

  it('missed hoje aparece separado; escopo por clínica', async () => {
    await db('checkins').where({ patient_id: fx.p2.id }).update({ status: 'missed' });
    const d = await dashboardToday(db, { clinicId: fx.clinic.id }, AT('12:00'));
    expect(d.awaiting).toEqual([]);
    expect(d.missed_today.map((m) => m.patient_name)).toEqual(['Paciente Sintético Dois']);
    const other = await dashboardToday(
      db,
      { clinicId: '00000000-0000-0000-0000-000000000000' },
      AT('12:00'),
    );
    expect(other.awaiting).toEqual([]);
    expect(other.open_alerts).toEqual([]);
    expect(other.intakes.pending_confirmation).toEqual([]);
  });

  it('symptomDoseSeries: pontos por dia (null sem resposta), marcadores de dose e antes/depois', async () => {
    const session = { kind: 'user', userId: fx.doctor.id, clinicId: fx.clinic.id };
    await adjustDose(
      db,
      session,
      fx.m1.id,
      {
        effective_from: TODAY.toISODate(),
        dose_amount: 6,
        dose_unit: 'gotas',
        times_per_day: 2,
        schedule_times: ['08:00', '20:00'],
        reason: 'aumento',
      },
      AT('10:00'),
    );
    const s = await symptomDoseSeries(db, fx.p1.id, {
      questionKey: 'dor',
      days: 14,
      now: AT('12:00'),
    });
    expect(s.question.key).toBe('dor');
    expect(s.points).toHaveLength(14);
    const today = s.points[13];
    expect(today).toMatchObject({ date: TODAY.toISODate(), value: 9 });
    expect(today.score).not.toBeNull();
    expect(s.points[0].value).toBeNull();
    expect(s.doseMarkers.map((m) => m.dose_amount)).toContain(6);
    const ba = s.beforeAfter.find((b) => b.dose_amount === 6);
    expect(ba.after_avg).toBe(9);
    expect(ba.before_avg).toBeNull();
    await expect(
      symptomDoseSeries(db, fx.p1.id, { questionKey: 'nao_existe', days: 14, now: AT('12:00') }),
    ).rejects.toThrow(/pergunta/i);
  });
});
