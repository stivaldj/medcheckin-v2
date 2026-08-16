import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { DateTime } from 'luxon';
import { freshDb, seedFixture } from './helpers/db.js';
import { evaluatePatientAlerts, evaluateAllAlerts } from '../src/alerts/evaluate.js';
import {
  acknowledgeAlert,
  resolveAlert,
  silenceAlerts,
  listOpenAlerts,
} from '../src/alerts/actions.js';

const NOW = new Date('2026-08-16T15:00:00Z');
const ago = (h) => DateTime.fromJSDate(NOW).minus({ hours: h }).toJSDate();

describe('alertas — avaliação por paciente', () => {
  let db, fx;
  beforeAll(async () => {
    db = await freshDb();
    fx = await seedFixture(db);
  });
  afterAll(async () => db.destroy());
  beforeEach(async () => {
    await db('alert_actions').del();
    await db('alert_silences').del();
    await db('alerts').del();
    await db('answers').del();
    await db('notifications').del();
    await db('checkins').del();
    await db('patient_scores_daily').del();
  });

  it('L3: no_response só existe se houve envio real (sent_at) sem completed há ≥ 48h', async () => {
    // P2 nunca recebeu nada → sem alerta mesmo sem resposta alguma
    await evaluatePatientAlerts(db, fx.p2.id, NOW);
    expect(await db('alerts').where({ patient_id: fx.p2.id })).toHaveLength(0);

    // P1: check-in enviado há 3 dias, nunca respondido → alerta
    await db('checkins').insert({
      patient_id: fx.p1.id,
      episode_id: fx.ep1.id,
      scheduled_for: ago(72),
      status: 'missed',
      attempt_count: 2,
      sent_at: ago(72),
    });
    await evaluatePatientAlerts(db, fx.p1.id, NOW);
    const open = await db('alerts').where({ patient_id: fx.p1.id, status: 'open' });
    expect(open.map((a) => a.code)).toEqual(['no_response']);
    expect(open[0].context).toMatchObject({ hoursSinceLastSend: 72 });

    // enviado há 3 dias mas respondido ontem → sem alerta (auto_cleared)
    await db('checkins').insert({
      patient_id: fx.p1.id,
      episode_id: fx.ep1.id,
      scheduled_for: ago(24),
      status: 'completed',
      sent_at: ago(24),
      completed_at: ago(23),
    });
    await evaluatePatientAlerts(db, fx.p1.id, NOW);
    const after = await db('alerts').where({ patient_id: fx.p1.id });
    expect(after[0].status).toBe('resolved');
    expect(after[0].resolved_reason).toBe('auto_cleared');
  });

  it('envio há 30h sem resposta ainda não é no_response (limiar 48h)', async () => {
    await db('checkins').insert({
      patient_id: fx.p1.id,
      episode_id: fx.ep1.id,
      scheduled_for: ago(30),
      status: 'sent',
      attempt_count: 1,
      sent_at: ago(30),
    });
    await evaluatePatientAlerts(db, fx.p1.id, NOW);
    expect(await db('alerts').where({ patient_id: fx.p1.id })).toHaveLength(0);
  });

  it('delivery_failed: ≥3 notificações falhas em 24h', async () => {
    for (let i = 0; i < 3; i += 1) {
      await db('notifications').insert({
        patient_id: fx.p1.id,
        respondent_id: fx.r1.id,
        kind: 'checkin',
        scheduled_at: ago(i + 1),
        failed_at: ago(i + 1),
        error: 'x',
        dedup_key: `t:${i}`,
      });
    }
    await evaluatePatientAlerts(db, fx.p1.id, NOW);
    const a = await db('alerts').where({ patient_id: fx.p1.id, code: 'delivery_failed' }).first();
    expect(a).toBeTruthy();
    expect(a.status).toBe('open');
  });

  it('threshold por pergunta e side_effect a partir do último check-in completed; upsert toca last_seen sem duplicar', async () => {
    const [ck] = await db('checkins')
      .insert({
        patient_id: fx.p1.id,
        episode_id: fx.ep1.id,
        scheduled_for: ago(2),
        status: 'completed',
        sent_at: ago(2),
        completed_at: ago(1),
      })
      .returning('id');
    await db('answers').insert([
      { checkin_id: ck.id, question_id: fx.q.dor.id, respondent_id: fx.r1.id, value_num: 9 },
      { checkin_id: ck.id, question_id: fx.q.sono.id, respondent_id: fx.r1.id, value_num: 8 },
      {
        checkin_id: ck.id,
        question_id: fx.q.efeito_adverso.id,
        respondent_id: fx.r1.id,
        value_num: 1,
      },
      {
        checkin_id: ck.id,
        question_id: fx.q.efeito_qual.id,
        respondent_id: fx.r1.id,
        value_choice: 'náusea',
      },
    ]);
    await evaluatePatientAlerts(db, fx.p1.id, NOW);
    await evaluatePatientAlerts(db, fx.p1.id, new Date(NOW.getTime() + 60000));
    const open = await db('alerts').where({ patient_id: fx.p1.id, status: 'open' });
    const byCode = Object.fromEntries(open.map((a) => [a.code, a]));
    expect(Object.keys(byCode).sort()).toEqual(['side_effect', 'threshold:dor']);
    expect(byCode['threshold:dor'].context).toMatchObject({ key: 'dor', value: 9 });
    expect(byCode['side_effect'].severity).toBe('high');
    expect(byCode['side_effect'].context).toMatchObject({ details: ['náusea'] });
    expect(new Date(byCode['side_effect'].last_seen_at).getTime()).toBeGreaterThan(
      new Date(byCode['side_effect'].first_seen_at).getTime(),
    );
  });

  it('regras de score (low_score_streak) sobre patient_scores_daily', async () => {
    const d = (n) => DateTime.fromJSDate(NOW).minus({ days: n }).toISODate();
    await db('patient_scores_daily').insert([
      { patient_id: fx.p1.id, date: d(2), score: 3, risk_level: 'high' },
      { patient_id: fx.p1.id, date: d(1), score: 2.5, risk_level: 'high' },
      { patient_id: fx.p1.id, date: d(0), score: 2, risk_level: 'high' },
    ]);
    await evaluatePatientAlerts(db, fx.p1.id, NOW);
    const codes = (await db('alerts').where({ patient_id: fx.p1.id, status: 'open' })).map(
      (a) => a.code,
    );
    expect(codes).toContain('low_score_streak');
  });

  it('silêncio suprime o código (ou todos) até until_at', async () => {
    await silenceAlerts(db, {
      patientId: fx.p1.id,
      code: 'no_response',
      untilAt: ago(-48),
      reason: 'viagem',
      userId: fx.doctor.id,
    });
    await db('checkins').insert({
      patient_id: fx.p1.id,
      episode_id: fx.ep1.id,
      scheduled_for: ago(72),
      status: 'missed',
      sent_at: ago(72),
    });
    await evaluatePatientAlerts(db, fx.p1.id, NOW);
    expect(await db('alerts').where({ patient_id: fx.p1.id })).toHaveLength(0);
  });

  it('evaluateAllAlerts percorre pacientes ativos e devolve resumo', async () => {
    const out = await evaluateAllAlerts(db, NOW);
    expect(out.patients).toBe(2);
  });
});

describe('alertas — ações (L15: conduta obrigatória)', () => {
  let db, fx, alertId;
  beforeAll(async () => {
    db = await freshDb();
    fx = await seedFixture(db);
    const [a] = await db('alerts')
      .insert({
        patient_id: fx.p1.id,
        code: 'side_effect',
        severity: 'high',
        title: 'Efeito adverso',
        context: {},
      })
      .returning('id');
    alertId = a.id;
  });
  afterAll(async () => db.destroy());

  it('acknowledge muda status e registra ação', async () => {
    const a = await acknowledgeAlert(db, { alertId, userId: fx.doctor.id });
    expect(a.status).toBe('acknowledged');
    const acts = await db('alert_actions').where({ alert_id: alertId });
    expect(acts.map((x) => x.action)).toEqual(['acknowledge']);
  });

  it('resolve sem nota é rejeitado; com nota grava alert_actions e alerts na mesma transação', async () => {
    await expect(resolveAlert(db, { alertId, userId: fx.doctor.id, note: '  ' })).rejects.toThrow(
      /conduta|nota/i,
    );
    expect((await db('alerts').where({ id: alertId }).first()).status).toBe('acknowledged');
    const a = await resolveAlert(db, {
      alertId,
      userId: fx.doctor.id,
      note: 'Reduzi a dose para 2 gotas e orientei observar.',
    });
    expect(a.status).toBe('resolved');
    expect(a.resolved_reason).toBe('doctor');
    const acts = await db('alert_actions').where({ alert_id: alertId }).orderBy('at');
    expect(acts.map((x) => x.action)).toEqual(['acknowledge', 'resolve']);
    expect(acts[1].note).toMatch(/Reduzi/);
    // listOpenAlerts não devolve mais
    expect((await listOpenAlerts(db, { clinicId: fx.clinic.id })).map((x) => x.id)).not.toContain(
      alertId,
    );
  });

  it('listOpenAlerts ordena por severidade e é escopado por clínica', async () => {
    await db('alerts').insert([
      { patient_id: fx.p1.id, code: 'a', severity: 'low', title: 'a', context: {} },
      { patient_id: fx.p1.id, code: 'b', severity: 'critical', title: 'b', context: {} },
    ]);
    const rows = await listOpenAlerts(db, { clinicId: fx.clinic.id });
    expect(rows.map((r) => r.severity)).toEqual(['critical', 'low']);
    expect(rows[0].patient_name).toBe('Paciente Sintético Um');
    expect(await listOpenAlerts(db, { clinicId: '00000000-0000-0000-0000-000000000000' })).toEqual(
      [],
    );
  });
});
