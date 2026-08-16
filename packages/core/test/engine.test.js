import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { DateTime } from 'luxon';
import { freshDb, seedFixture, fakeNotifier } from './helpers/db.js';
import { planCheckins, expireCheckins } from '../src/scheduler/planner.js';
import {
  dispatchDueCheckins,
  recordAnswer,
  getNextQuestion,
  completeCheckin,
} from '../src/checkin/engine.js';

// P1 é daily às 09:00 America/Cuiaba (UTC-4) → 13:00Z. Quiet 21:00–08:00 local.
const T = (iso) => new Date(iso);
const TODAY = DateTime.utc().setZone('America/Cuiaba').startOf('day'); // hoje local
const AT = (hm) => {
  const [h, m] = hm.split(':').map(Number);
  return TODAY.set({ hour: h, minute: m }).toUTC().toJSDate();
};

describe('planner — cria o check-in do dia por episódio', () => {
  let db, fx;
  beforeAll(async () => {
    db = await freshDb();
    fx = await seedFixture(db);
  });
  afterAll(async () => db.destroy());

  it('P1 (daily) ganha 1 check-in hoje às 09:00 local; idempotente', async () => {
    const r1 = await planCheckins(db, AT('06:00'));
    const r2 = await planCheckins(db, AT('06:30'));
    const rows = await db('checkins').where({ patient_id: fx.p1.id });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('pending');
    expect(new Date(rows[0].scheduled_for).toISOString()).toBe(AT('09:00').toISOString());
    expect(new Date(rows[0].next_attempt_at).toISOString()).toBe(AT('09:00').toISOString());
    expect(r1.created).toBeGreaterThanOrEqual(1);
    expect(r2.created).toBe(0);
  });

  it('P2 (weekly, âncora = started_at há 10 dias) só ganha check-in no dia que bate o intervalo', async () => {
    const rows = await db('checkins').where({ patient_id: fx.p2.id });
    // 10 dias desde a âncora → não bate 7. Nenhum check-in hoje.
    expect(rows).toHaveLength(0);
  });

  it('paciente pausado não ganha check-in', async () => {
    await db('patients').where({ id: fx.p1.id }).update({ status: 'paused' });
    await db('checkins').where({ patient_id: fx.p1.id }).del();
    const r = await planCheckins(db, AT('06:00'));
    expect(r.created).toBe(0);
    await db('patients').where({ id: fx.p1.id }).update({ status: 'active' });
  });
});

describe('engine — dispatch (L2: estado só avança com envio real)', () => {
  let db, fx, notifier;
  beforeAll(async () => {
    db = await freshDb();
    fx = await seedFixture(db);
  });
  afterAll(async () => db.destroy());
  beforeEach(async () => {
    await db('notifications').del();
    await db('checkins').del();
    notifier = fakeNotifier();
  });

  it('envio ok → notification.sent_at, checkin sent, attempt_count 1, sent_at, dedup_key determinístico', async () => {
    await planCheckins(db, AT('06:00'));
    const out = await dispatchDueCheckins(db, AT('09:00'), { notifier });
    expect(out.sent).toBe(1);
    const ck = await db('checkins').where({ patient_id: fx.p1.id }).first();
    expect(ck.status).toBe('sent');
    expect(ck.attempt_count).toBe(1);
    expect(ck.sent_at).not.toBeNull();
    const n = await db('notifications').where({ respondent_id: fx.r1.id }).first();
    expect(n.kind).toBe('checkin');
    expect(n.sent_at).not.toBeNull();
    expect(n.dedup_key).toBe(`checkin:${ck.id}:${fx.r1.id}:1`);
    // retry agendado
    expect(new Date(ck.next_attempt_at).getTime()).toBe(AT('10:00').getTime());
  });

  it('PROVA E2: envio falha → notification.failed_at + error; check-in NÃO avança (pending, 0 tentativas, sem sent_at)', async () => {
    await planCheckins(db, AT('06:00'));
    notifier.state.failNext = 1;
    const out = await dispatchDueCheckins(db, AT('09:00'), { notifier });
    expect(out.sent).toBe(0);
    expect(out.failed).toBe(1);
    const ck = await db('checkins').where({ patient_id: fx.p1.id }).first();
    expect(ck.status).toBe('pending');
    expect(ck.attempt_count).toBe(0);
    expect(ck.sent_at).toBeNull();
    const n = await db('notifications').where({ respondent_id: fx.r1.id }).first();
    expect(n.failed_at).not.toBeNull();
    expect(n.error).toMatch(/falha simulada/);
    expect(n.sent_at).toBeNull();
  });

  it('mesmo instante duas vezes → não duplica notificação (dedup_key + next_attempt_at)', async () => {
    await planCheckins(db, AT('06:00'));
    await dispatchDueCheckins(db, AT('09:00'), { notifier });
    await dispatchDueCheckins(db, AT('09:00'), { notifier });
    expect(await db('notifications').count().first()).toMatchObject({ count: 1 });
    expect(notifier.sent).toHaveLength(1);
  });

  it('retry: às 10:00 envia 2ª tentativa; depois de max_attempts (2) não envia mais', async () => {
    await planCheckins(db, AT('06:00'));
    await dispatchDueCheckins(db, AT('09:00'), { notifier });
    const r2 = await dispatchDueCheckins(db, AT('10:00'), { notifier });
    expect(r2.sent).toBe(1);
    const r3 = await dispatchDueCheckins(db, AT('11:00'), { notifier });
    expect(r3.sent).toBe(0);
    const ck = await db('checkins').where({ patient_id: fx.p1.id }).first();
    expect(ck.attempt_count).toBe(2);
    expect(ck.next_attempt_at).toBeNull();
    expect(ck.status).toBe('sent');
  });

  it('quiet hours: às 23:00 local não envia e empurra next_attempt_at para 08:00 do dia seguinte', async () => {
    const [ck] = await db('checkins')
      .insert({
        patient_id: fx.p1.id,
        episode_id: fx.ep1.id,
        scheduled_for: AT('22:30'),
        next_attempt_at: AT('22:30'),
      })
      .returning('*');
    const out = await dispatchDueCheckins(db, AT('23:00'), { notifier });
    expect(out.sent).toBe(0);
    expect(out.deferred).toBe(1);
    const row = await db('checkins').where({ id: ck.id }).first();
    expect(row.status).toBe('pending');
    expect(new Date(row.next_attempt_at).getTime()).toBe(
      TODAY.plus({ days: 1 }).set({ hour: 8 }).toUTC().toMillis(),
    );
  });

  it('paciente pausado: não envia, empurra 1h', async () => {
    await planCheckins(db, AT('06:00'));
    await db('patients').where({ id: fx.p1.id }).update({ status: 'paused' });
    const out = await dispatchDueCheckins(db, AT('09:00'), { notifier });
    expect(out.sent).toBe(0);
    expect(notifier.sent).toHaveLength(0);
    await db('patients').where({ id: fx.p1.id }).update({ status: 'active' });
  });

  it('respondentes: só quem can_answer recebe (P2 → cuidadora sim, criança não); sem nenhum → check-in intocado', async () => {
    const [ck] = await db('checkins')
      .insert({
        patient_id: fx.p2.id,
        episode_id: fx.ep2.id,
        scheduled_for: AT('09:00'),
        next_attempt_at: AT('09:00'),
      })
      .returning('*');
    await dispatchDueCheckins(db, AT('09:00'), { notifier });
    const ns = await db('notifications').where({ patient_id: fx.p2.id });
    expect(ns.map((n) => n.respondent_id)).toEqual([fx.r2c.id]);
    // agora ninguém pode responder
    await db('respondents').where({ id: fx.r2c.id }).update({ can_answer: false });
    await db('notifications').del();
    await db('checkins')
      .where({ id: ck.id })
      .update({ status: 'pending', attempt_count: 0, sent_at: null, next_attempt_at: AT('09:00') });
    const out = await dispatchDueCheckins(db, AT('09:00'), { notifier });
    expect(out.skipped_no_respondent).toBe(1);
    const row = await db('checkins').where({ id: ck.id }).first();
    expect(row.status).toBe('pending');
    expect(row.attempt_count).toBe(0);
    await db('respondents').where({ id: fx.r2c.id }).update({ can_answer: true });
  });
});

describe('engine — recordAnswer / fluxo condicional / completeCheckin', () => {
  let db, fx, ck;
  beforeAll(async () => {
    db = await freshDb();
    fx = await seedFixture(db);
  });
  afterAll(async () => db.destroy());
  beforeEach(async () => {
    await db('answers').del();
    await db('alerts').del();
    await db('patient_scores_daily').del();
    await db('notifications').del();
    await db('checkins').del();
    [ck] = await db('checkins')
      .insert({
        patient_id: fx.p1.id,
        episode_id: fx.ep1.id,
        scheduled_for: AT('09:00'),
        status: 'sent',
        attempt_count: 1,
        sent_at: AT('09:00'),
      })
      .returning('*');
  });

  const answer = (questionKey, value, respondentId) =>
    recordAnswer(
      db,
      { checkinId: ck.id, respondentId: respondentId ?? fx.r1.id, questionKey, value },
      AT('09:10'),
    );

  it('primeira pergunta é a de menor sort_order; responder avança e muda status para in_progress', async () => {
    const first = await getNextQuestion(db, ck.id);
    expect(first.key).toBe('dor');
    const r = await answer('dor', 8);
    expect(r.completed).toBe(false);
    expect(r.next.key).toBe('sono');
    const row = await db('checkins').where({ id: ck.id }).first();
    expect(row.status).toBe('in_progress');
    const a = await db('answers').where({ checkin_id: ck.id }).first();
    expect(a).toMatchObject({ respondent_id: fx.r1.id, value_num: 8 });
  });

  it('fluxo condicional: efeito_adverso=1 → efeito_qual; =0 → pula para obs; obs opcional pulável → completed', async () => {
    await answer('dor', 2);
    await answer('sono', 7);
    await answer('humor', 7);
    await answer('crises', 0);
    let r = await answer('efeito_adverso', 1);
    expect(r.next.key).toBe('efeito_qual');
    r = await answer('efeito_qual', 'tontura');
    expect(r.next.key).toBe('obs');
    r = await answer('obs', null); // pular opcional
    expect(r.completed).toBe(true);
    const row = await db('checkins').where({ id: ck.id }).first();
    expect(row.status).toBe('completed');
    expect(row.completed_at).not.toBeNull();
  });

  it('efeito_adverso=0 pula a condicional', async () => {
    await answer('dor', 2);
    await answer('sono', 7);
    await answer('humor', 7);
    await answer('crises', 0);
    const r = await answer('efeito_adverso', 0);
    expect(r.next.key).toBe('obs');
  });

  it('completar calcula score do dia (dor lower_is_better ×2, sono, humor) e avalia alertas (limiar + efeito adverso no dia)', async () => {
    await answer('dor', 8); // ≥7 → threshold:dor
    await answer('sono', 6);
    await answer('humor', 6);
    await answer('crises', 0);
    await answer('efeito_adverso', 1); // is_side_effect → side_effect
    await answer('efeito_qual', 'náusea');
    const r = await answer('obs', 'tudo bem');
    expect(r.completed).toBe(true);
    const score = await db('patient_scores_daily').where({ patient_id: fx.p1.id }).first();
    // dor 8 lower→2 (w2), sono 6, humor 6 → (4+6+6)/4 = 4
    expect(score.score).toBe(4);
    expect(score.risk_level).toBe('medium');
    const alerts = await db('alerts').where({ patient_id: fx.p1.id, status: 'open' });
    const codes = alerts.map((a) => a.code).sort();
    expect(codes).toEqual(expect.arrayContaining(['threshold:dor', 'side_effect']));
    expect(alerts.find((a) => a.code === 'side_effect').severity).toBe('high');
  });

  it('sem resposta pontuável → score null e risk_level null (L5)', async () => {
    await db('questions').update({ score_direction: null });
    await answer('dor', 3);
    await answer('sono', 5);
    await answer('humor', 5);
    await answer('crises', 0);
    await answer('efeito_adverso', 0);
    await answer('obs', null);
    const score = await db('patient_scores_daily').where({ patient_id: fx.p1.id }).first();
    expect(score.score).toBeNull();
    expect(score.risk_level).toBeNull();
    await db('questions').where({ key: 'dor' }).update({ score_direction: 'lower_is_better' });
    await db('questions')
      .whereIn('key', ['sono', 'humor'])
      .update({ score_direction: 'higher_is_better' });
  });

  it('validações: valor fora da escala, choice inválida, pergunta fora do set, respondente de outro paciente, can_answer=false, check-in completed', async () => {
    await expect(answer('dor', 11)).rejects.toThrow(/0.*10/);
    await expect(answer('dor', 'oito')).rejects.toThrow(/inválido|número/i);
    await answer('dor', 5);
    await answer('sono', 5);
    await answer('humor', 5);
    await answer('crises', 1);
    await answer('efeito_adverso', 1);
    await expect(answer('efeito_qual', 'gripe')).rejects.toThrow(/opção/i);
    await expect(answer('nao_existe', 1)).rejects.toThrow(/pergunta/i);
    await expect(answer('dor', 5, fx.r2c.id)).rejects.toThrow(/respondente/i);
    await db('respondents').where({ id: fx.r1.id }).update({ can_answer: false });
    await expect(answer('dor', 5)).rejects.toThrow(/respondente/i);
    await db('respondents').where({ id: fx.r1.id }).update({ can_answer: true });
    await completeCheckin(db, ck.id, AT('09:30'));
    await expect(answer('dor', 5)).rejects.toThrow(/encerrado|completed/i);
  });

  it('pergunta obrigatória não pode ser pulada; condicional não satisfeita é rejeitada', async () => {
    await expect(answer('dor', null)).rejects.toThrow(/obrigatória/i);
    await answer('dor', 1);
    await expect(answer('efeito_qual', 'tontura')).rejects.toThrow(/condição|ainda não/i);
  });

  it('responder de novo a mesma pergunta atualiza (não duplica)', async () => {
    await answer('dor', 3);
    await answer('dor', 4);
    const rows = await db('answers').where({ checkin_id: ck.id });
    expect(rows).toHaveLength(1);
    expect(rows[0].value_num).toBe(4);
  });
});

describe('expireCheckins', () => {
  let db, fx;
  beforeAll(async () => {
    db = await freshDb();
    fx = await seedFixture(db);
  });
  afterAll(async () => db.destroy());

  it('sent/pending com scheduled_for há > 24h vira missed; completed fica', async () => {
    const old = T(DateTime.fromJSDate(AT('09:00')).minus({ days: 2 }).toISO());
    const [a] = await db('checkins')
      .insert({
        patient_id: fx.p1.id,
        episode_id: fx.ep1.id,
        scheduled_for: old,
        status: 'sent',
        sent_at: old,
      })
      .returning('id');
    const [b] = await db('checkins')
      .insert({
        patient_id: fx.p1.id,
        episode_id: fx.ep1.id,
        scheduled_for: T(DateTime.fromJSDate(old).minus({ days: 1 }).toISO()),
        status: 'completed',
        completed_at: old,
      })
      .returning('id');
    const out = await expireCheckins(db, AT('09:00'));
    expect(out.missed).toBe(1);
    expect((await db('checkins').where({ id: a.id }).first()).status).toBe('missed');
    expect((await db('checkins').where({ id: b.id }).first()).status).toBe('completed');
  });
});
