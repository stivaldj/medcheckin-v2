/**
 * Travas de regressão dos achados da auditoria 2026-08-25 (tasks/AUDITORIA_2026-08-25.md):
 * P1-1 (paciente com entrega quebrada invisível), P1-2 (envio duplicado sob concorrência),
 * P1-3 (completeCheckin sem transação). P0-1 está em doses.test.js.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DateTime } from 'luxon';
import { freshDb, seedFixture } from './helpers/db.js';
import { enqueueAndSend, completeCheckin } from '../src/checkin/engine.js';
import { evaluatePatientAlerts } from '../src/alerts/evaluate.js';
import { dashboardToday } from '../src/dashboard/today.js';

const TZ = 'America/Cuiaba';

describe('P1-2: envio único sob concorrência (claim por notificação)', () => {
  let db, fx;
  beforeAll(async () => {
    db = await freshDb();
    fx = await seedFixture(db);
  });
  afterAll(async () => db.destroy());

  it('duas chamadas concorrentes com a mesma dedup_key fazem UM envio', async () => {
    const calls = [];
    const slow = {
      async send(n) {
        calls.push(n.dedup_key);
        await new Promise((r) => setTimeout(r, 300));
        return { ok: true };
      },
    };
    const row = {
      patient_id: fx.p1.id,
      respondent_id: fx.r1.id,
      kind: 'checkin',
      payload: { t: 1 },
      scheduled_at: new Date(),
      dedup_key: 'conc:1',
    };
    const [a, b] = await Promise.all([
      enqueueAndSend(db, slow, { ...row }),
      enqueueAndSend(db, slow, { ...row }),
    ]);
    expect(calls).toHaveLength(1);
    expect([a.status, b.status].sort()).toEqual(['duplicate', 'sent']);
    const n = await db('notifications').where({ dedup_key: 'conc:1' }).first();
    expect(n.sent_at).not.toBeNull();
  });

  it('falha libera o claim: a tentativa seguinte reenvia', async () => {
    const fail = {
      async send() {
        return { ok: false, error: 'x' };
      },
    };
    const ok = {
      async send() {
        return { ok: true };
      },
    };
    const row = {
      patient_id: fx.p1.id,
      respondent_id: fx.r1.id,
      kind: 'checkin',
      payload: { t: 2 },
      scheduled_at: new Date(),
      dedup_key: 'conc:2',
    };
    expect((await enqueueAndSend(db, fail, { ...row })).status).toBe('failed');
    expect((await enqueueAndSend(db, ok, { ...row })).status).toBe('sent');
    const n = await db('notifications').where({ dedup_key: 'conc:2' }).first();
    expect(n.sent_at).not.toBeNull();
    expect(n.attempts).toBe(2);
  });
});

describe('P1-1: falhas repetidas na MESMA notificação contam para delivery_failed', () => {
  let db, fx;
  beforeAll(async () => {
    db = await freshDb();
    fx = await seedFixture(db);
  });
  afterAll(async () => db.destroy());

  it('um check-in preso (1 linha com attempts 4) dispara o alerta', async () => {
    const now = new Date();
    await db('notifications').insert({
      patient_id: fx.p1.id,
      respondent_id: fx.r1.id,
      kind: 'checkin',
      scheduled_at: now,
      failed_at: now,
      error: 'no_subscription',
      attempts: 4,
      dedup_key: 'stuck:1',
    });
    await evaluatePatientAlerts(db, fx.p1.id, now);
    const a = await db('alerts').where({ patient_id: fx.p1.id, code: 'delivery_failed' }).first();
    expect(a).toBeTruthy();
    expect(a.status).toBe('open');
    expect(a.context.failures24h).toBe(4);
  });
});

describe('P1-1: /hoje separa "aguardando horário" de "falhou a entrega"', () => {
  let db, fx;
  beforeAll(async () => {
    db = await freshDb();
    fx = await seedFixture(db);
  });
  afterAll(async () => db.destroy());

  it('check-in pendente com falha de entrega aparece nomeado e marcado', async () => {
    const sched = DateTime.now().setZone(TZ).startOf('day').set({ hour: 9 }).toUTC().toJSDate();
    const nowJs = DateTime.now().setZone(TZ).startOf('day').set({ hour: 10 }).toUTC().toJSDate();
    await db('checkins').insert({
      patient_id: fx.p1.id,
      episode_id: fx.ep1.id,
      scheduled_for: sched,
      next_attempt_at: sched,
      status: 'pending',
    });
    await db('notifications').insert({
      patient_id: fx.p1.id,
      respondent_id: fx.r1.id,
      kind: 'checkin',
      scheduled_at: sched,
      failed_at: nowJs,
      error: 'no_subscription',
      attempts: 2,
      dedup_key: 'dash:1',
    });
    const d = await dashboardToday(db, { clinicId: fx.clinic.id }, nowJs);
    const row = (d.pending_today ?? []).find((x) => x.patient_id === fx.p1.id);
    expect(row).toBeTruthy();
    expect(row.patient_name).toBe('Paciente Sintético Um');
    expect(row.delivery_failed).toBe(true);
    // compat: a contagem existente continua
    expect(d.not_sent_yet).toBeGreaterThanOrEqual(1);
  });

  it('check-in pendente SEM falha aparece como aguardando (delivery_failed=false)', async () => {
    const sched = DateTime.now().setZone(TZ).startOf('day').set({ hour: 9 }).toUTC().toJSDate();
    const nowJs = DateTime.now().setZone(TZ).startOf('day').set({ hour: 10 }).toUTC().toJSDate();
    await db('checkins').insert({
      patient_id: fx.p2.id,
      episode_id: fx.ep2.id,
      scheduled_for: sched,
      next_attempt_at: sched,
      status: 'pending',
    });
    const d = await dashboardToday(db, { clinicId: fx.clinic.id }, nowJs);
    const row = (d.pending_today ?? []).find((x) => x.patient_id === fx.p2.id);
    expect(row).toBeTruthy();
    expect(row.delivery_failed).toBe(false);
  });
});

describe('P1-3: completeCheckin é atômico', () => {
  let db, fx;
  beforeAll(async () => {
    db = await freshDb();
    fx = await seedFixture(db);
  });
  afterAll(async () => db.destroy());

  it('se a avaliação de alertas falha no meio, status e score revertem juntos', async () => {
    const now = new Date();
    const [ck] = await db('checkins')
      .insert({
        patient_id: fx.p1.id,
        episode_id: fx.ep1.id,
        scheduled_for: now,
        status: 'in_progress',
        sent_at: now,
      })
      .returning('*');
    await db('answers').insert({
      checkin_id: ck.id,
      question_id: fx.q.dor.id,
      respondent_id: fx.r1.id,
      value_num: 5,
      answered_at: now,
    });
    // força uma falha DEPOIS do update de status e do score: a avaliação de alertas lê esta tabela
    await db.schema.dropTable('alert_silences');
    await expect(completeCheckin(db, ck.id, now)).rejects.toThrow();
    const after = await db('checkins').where({ id: ck.id }).first();
    expect(after.status).toBe('in_progress'); // não ficou completed pela metade
    expect(after.completed_at).toBeNull();
    expect(await db('patient_scores_daily').where({ patient_id: fx.p1.id })).toHaveLength(0);
  });
});
