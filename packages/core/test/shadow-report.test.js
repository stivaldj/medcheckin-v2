import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DateTime } from 'luxon';
import { freshDb, seedFixture, fakeNotifier } from './helpers/db.js';
import { runCycle, resetCycleState, getSystemState } from '../src/scheduler/cycle.js';
import { answerFromRespondent } from '../src/respondent/index.js';
import { resolveAlert } from '../src/alerts/actions.js';
import {
  shadowReport,
  renderShadowReportMarkdown,
  SHADOW_CRITERIA,
} from '../src/report/shadowReport.js';

const TODAY = DateTime.utc().setZone('America/Cuiaba').startOf('day');
const AT = (hm, d = 0) => {
  const [h, m] = hm.split(':').map(Number);
  return TODAY.plus({ days: d }).set({ hour: h, minute: m }).toUTC().toJSDate();
};

describe('shadowReport — métricas critério × resultado', () => {
  let db, fx;
  beforeAll(async () => {
    db = await freshDb();
    fx = await seedFixture(db);
    resetCycleState();
    const s1 = {
      kind: 'respondent',
      respondentId: fx.r1.id,
      patientId: fx.p1.id,
      clinicId: fx.clinic.id,
    };
    const notifier = fakeNotifier();
    // dia -1: check-in enviado e respondido em 12 min, com dor 9 → alerta; conduta 30 min depois
    await runCycle(db, AT('09:05', -1), { notifier, force: true });
    let ck = await db('checkins')
      .where({ patient_id: fx.p1.id })
      .orderBy('scheduled_for', 'desc')
      .first();
    for (const [k, v] of [
      ['adesao', 1],
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
        { checkinId: ck.id, questionKey: k, value: v },
        AT('09:17', -1),
      );
    }
    const a = await db('alerts').where({ patient_id: fx.p1.id, code: 'threshold:dor' }).first();
    await resolveAlert(
      db,
      { alertId: a.id, userId: fx.doctor.id, note: 'liguei' },
      AT('09:47', -1),
    );
    // dia 0: enviado, não respondido; uma notificação falha
    notifier.state.failNext = 1;
    await runCycle(db, AT('09:05'), { notifier, force: true }); // envio falha → check-in continua pending, retry +15 min
    await runCycle(db, AT('09:06'), { notifier });
    await runCycle(db, AT('09:21'), { notifier }); // reenvio ok
  });
  afterAll(async () => db.destroy());

  it('calcula entrega, resposta, tempos, adesão, alertas/condutas, ruído e scheduler', async () => {
    const r = await shadowReport(db, {
      clinicId: fx.clinic.id,
      from: TODAY.minus({ days: 1 }).toISODate(),
      to: TODAY.toISODate(),
      now: AT('12:00'),
    });
    expect(r.push.sent).toBeGreaterThan(0);
    expect(r.push.failed).toBeGreaterThanOrEqual(1);
    expect(r.push.delivery_rate).toBeGreaterThan(0.5);
    expect(r.checkins.sent).toBeGreaterThanOrEqual(2);
    expect(r.checkins.completed).toBe(1);
    expect(r.checkins.response_rate).toBeCloseTo(1 / r.checkins.sent, 5);
    expect(r.checkins.median_minutes_to_first_answer).toBe(12);
    expect(r.adherence).toMatchObject({ answered: 1, yes: 1, no: 0, rate: 1 });
    expect(r.alerts.by_code['threshold:dor']).toMatchObject({ opened: 1, resolved_by_doctor: 1 });
    expect(r.alerts.median_minutes_to_conduct).toBe(30);
    expect(r.alerts.noise_codes).toEqual(
      expect.arrayContaining(['no_response', 'delivery_failed']),
    );
    expect(r.scheduler.cycle_count).toBeGreaterThanOrEqual(3);
    expect(r.scheduler.max_gap_min).toBeGreaterThan(0);
    const st = await getSystemState(db);
    expect(st['scheduler.cycle_count']).toBeGreaterThanOrEqual(3);
  });

  it('renderiza markdown critério × resultado × veredito com os critérios escritos antes', async () => {
    const r = await shadowReport(db, {
      clinicId: fx.clinic.id,
      from: TODAY.minus({ days: 1 }).toISODate(),
      to: TODAY.toISODate(),
      now: AT('12:00'),
    });
    const md = renderShadowReportMarkdown(r, SHADOW_CRITERIA);
    expect(md).toContain('| Critério |');
    expect(md).toContain('Entrega de push');
    expect(md).toMatch(/✅|❌/);
    expect(SHADOW_CRITERIA.length).toBeGreaterThanOrEqual(6);
    expect(
      SHADOW_CRITERIA.every((c) => typeof c.threshold === 'number' && c.metric && c.label),
    ).toBe(true);
  });
});
