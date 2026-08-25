import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DateTime } from 'luxon';
import { freshDb, seedFixture, fakeNotifier } from './helpers/db.js';
import { runCycle, resetCycleState } from '../src/scheduler/cycle.js';
import { answerFromRespondent } from '../src/respondent/index.js';
import { adjustDose } from '../src/medications/index.js';
import { resolveAlert } from '../src/alerts/actions.js';
import {
  pilotReport,
  renderPilotReportMarkdown,
  PILOT_CRITERIA,
  PILOT_ABORT_RULES,
} from '../src/report/pilotReport.js';

const TZ = 'America/Cuiaba';
const TODAY = DateTime.utc().setZone(TZ).startOf('day');
const AT = (hm, d = 0) => {
  const [h, m] = hm.split(':').map(Number);
  return TODAY.plus({ days: d }).set({ hour: h, minute: m }).toUTC().toJSDate();
};
const DAY = (d) => TODAY.plus({ days: d }).toISODate();

describe('pilotReport — E10: critérios de sucesso e de aborto escritos ANTES', () => {
  let db, fx, doctor;
  beforeAll(async () => {
    db = await freshDb();
    fx = await seedFixture(db);
    resetCycleState();
    doctor = { kind: 'user', userId: fx.doctor.id, clinicId: fx.clinic.id, role: 'doctor' };
    const s1 = {
      kind: 'respondent',
      respondentId: fx.r1.id,
      patientId: fx.p1.id,
      clinicId: fx.clinic.id,
    };
    const notifier = fakeNotifier();
    // 3 dias de piloto: P1 responde tudo (adesão sim, sim, não); P2 (semanal) não responde.
    for (const d of [-2, -1, 0]) {
      await runCycle(db, AT('09:05', d), { notifier, force: true });
      const ck = await db('checkins')
        .where({ patient_id: fx.p1.id })
        .orderBy('scheduled_for', 'desc')
        .first();
      for (const [k, v] of [
        ['adesao', d === 0 ? 0 : 1],
        ['dor', d === -2 ? 8 : 4],
        ['sono', 6],
        ['humor', 6],
        ['crises', 0],
        ['efeito_adverso', 0],
        ['obs', null],
      ]) {
        await answerFromRespondent(
          db,
          s1,
          { checkinId: ck.id, questionKey: k, value: v },
          AT('09:17', d),
        );
      }
    }
    // ajuste de dose no meio do piloto (o gráfico sintoma × dose precisa de um marcador)
    await adjustDose(
      db,
      doctor,
      fx.m1.id,
      {
        effective_from: DAY(-1),
        dose_amount: 6,
        dose_unit: 'gotas',
        times_per_day: 2,
        schedule_times: ['08:00', '20:00'],
        reason: 'dor 8 no dia 1',
      },
      AT('10:00', -1),
    );
    // alerta clínico do dia -2 (dor 8) resolvido com conduta 30 min depois
    const a = await db('alerts').where({ patient_id: fx.p1.id, code: 'threshold:dor' }).first();
    await resolveAlert(
      db,
      {
        alertId: a.id,
        userId: fx.doctor.id,
        note: 'Aumentei a dose e orientei retorno em 7 dias.',
      },
      new Date(new Date(a.first_seen_at).getTime() + 30 * 60000),
    );
  });
  afterAll(async () => db.destroy());

  const run = () =>
    pilotReport(db, {
      clinicId: fx.clinic.id,
      from: DAY(-2),
      to: DAY(0),
      now: AT('23:00'),
      seriesMinDays: 2,
    });

  it('critérios são numéricos, com métrica e rótulo, e escritos antes (constante congelada)', () => {
    expect(PILOT_CRITERIA.length).toBeGreaterThanOrEqual(10);
    expect(
      PILOT_CRITERIA.every(
        (c) =>
          typeof c.threshold === 'number' &&
          c.metric &&
          c.label &&
          ['>=', '<=', '=='].includes(c.op),
      ),
    ).toBe(true);
    expect(Object.isFrozen(PILOT_CRITERIA)).toBe(true);
    expect(PILOT_ABORT_RULES.length).toBeGreaterThanOrEqual(4);
    expect(PILOT_ABORT_RULES.every((r) => typeof r === 'string' && r.length > 10)).toBe(true);
  });

  it('mede engajamento, adesão, cobertura da rotina, conduta clínica, ruído e confiabilidade', async () => {
    const r = await run();
    expect(r.period).toMatchObject({ from: DAY(-2), to: DAY(0), timezone: TZ });
    expect(r.patients.enrolled).toBe(2);

    // P1 respondeu os 3 check-ins; P2 (semanal) recebeu e não respondeu
    expect(r.engagement.completed).toBe(3);
    expect(r.engagement.sent).toBeGreaterThanOrEqual(3);
    expect(r.engagement.response_rate).toBeCloseTo(3 / r.engagement.sent, 5);
    expect(r.engagement.median_minutes_to_first_answer).toBe(12);
    // "responde pelo menos metade dos check-ins que RECEBEU": só P1 recebeu (P2 é semanal e
    // não caiu na janela) — quem não recebeu nada não entra no denominador
    expect(r.engagement.patients_responding_half).toBe(1);
    expect(r.engagement.patients_responding_half_rate).toBe(1);
    expect(r.patients.still_engaged_rate).toBe(1);

    // adesão pela pergunta do check-in: 2 sim, 1 não
    expect(r.adherence).toMatchObject({ answered: 3, yes: 2, no: 1 });
    expect(r.adherence.rate).toBeCloseTo(2 / 3, 2);

    // rotina: o seed cobre os 3 dias dos 2 pacientes
    expect(r.routine.patient_days_total).toBe(6);
    expect(r.routine.patient_days_covered).toBe(6);
    expect(r.routine.coverage_rate).toBe(1);
    expect(r.routine.patients_without_period).toBe(0);

    // clínico: 2 alertas (dor 8 no dia 1, adesão "não" no dia 3); só o primeiro teve conduta
    expect(r.clinical).toMatchObject({
      alerts_clinical: 2,
      alerts_with_conduct: 1,
      conduct_rate: 0.5,
    });
    expect(r.clinical.median_minutes_to_conduct).toBe(30);
    expect(r.clinical.dose_adjustments).toBe(1);
    // série utilizável (≥ seriesMinDays dias com resposta E ≥ 1 ajuste no período): só P1
    expect(r.clinical.patients_with_series).toBe(1);
    expect(r.clinical.series_rate).toBeCloseTo(0.5, 5);

    expect(r.reliability.push_delivery_rate).toBe(1);
    expect(r.reliability.scheduler_max_gap_min).toBeGreaterThan(0);
    expect(r.false_success).toBe(0);
  });

  it('não vaza PII: o relatório é só contagem, nenhum nome/e-mail/telefone (D7)', async () => {
    const r = await run();
    const dump = JSON.stringify(r);
    for (const needle of [
      'Paciente Sintético Um',
      'Cuidadora Sintética',
      'medcheckin.test',
      '+55659100',
    ]) {
      expect(dump).not.toContain(needle);
    }
  });

  it('markdown: critério × resultado × veredito, regras de aborto e espaço para a decisão', async () => {
    const md = renderPilotReportMarkdown(await run());
    expect(md).toContain('| Critério |');
    expect(md).toContain('Adesão relatada no check-in');
    expect(md).toMatch(/✅|❌/);
    expect(md).toContain('## Critérios de aborto');
    expect(md).toContain('## Decisão');
    expect(md).toMatch(/ampliar|encerrar/i);
  });
});
