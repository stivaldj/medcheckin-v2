import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DateTime } from 'luxon';
import { freshDb, seedFixture } from './helpers/db.js';
import { computeDailyScore } from '../src/scoring/computeDailyScore.js';

describe('computeDailyScore — integração', () => {
  let db, fx;
  beforeAll(async () => {
    db = await freshDb();
    fx = await seedFixture(db);
  });
  afterAll(async () => db.destroy());

  async function completedCheckin(dayOffset, { dor, sono, humor }) {
    const at = DateTime.fromISO('2026-08-16T13:00:00Z').minus({ days: dayOffset }).toJSDate();
    const [ck] = await db('checkins')
      .insert({
        patient_id: fx.p1.id,
        episode_id: fx.ep1.id,
        scheduled_for: at,
        status: 'completed',
        sent_at: at,
        completed_at: at,
      })
      .returning('id');
    const rows = [];
    if (dor != null)
      rows.push({
        checkin_id: ck.id,
        question_id: fx.q.dor.id,
        respondent_id: fx.r1.id,
        value_num: dor,
      });
    if (sono != null)
      rows.push({
        checkin_id: ck.id,
        question_id: fx.q.sono.id,
        respondent_id: fx.r1.id,
        value_num: sono,
      });
    if (humor != null)
      rows.push({
        checkin_id: ck.id,
        question_id: fx.q.humor.id,
        respondent_id: fx.r1.id,
        value_num: humor,
      });
    if (rows.length) await db('answers').insert(rows);
    return ck.id;
  }

  it('score ponderado (dor lower ×2, sono, humor) na data local do check-in; trend a partir dos 3 dias anteriores', async () => {
    // 3 dias anteriores: score 5 cada (dor 5→5, sono 5, humor 5)
    for (const off of [3, 2, 1]) {
      const id = await completedCheckin(off, { dor: 5, sono: 5, humor: 5 });
      const r = await computeDailyScore(db, id);
      expect(r.score).toBe(5);
    }
    // hoje: dor 2 → 8 (w2), sono 6, humor 6 → (16+6+6)/4 = 7
    const today = await completedCheckin(0, { dor: 2, sono: 6, humor: 6 });
    const r = await computeDailyScore(db, today);
    expect(r).toMatchObject({ score: 7, trend: 2, risk_level: 'low', date: '2026-08-16' });
    const row = await db('patient_scores_daily')
      .where({ patient_id: fx.p1.id, date: '2026-08-16' })
      .first();
    expect(row.score).toBe(7);
    // idempotente (upsert)
    await computeDailyScore(db, today);
    expect(
      await db('patient_scores_daily').where({ patient_id: fx.p1.id }).count().first(),
    ).toMatchObject({ count: 4 });
  });

  it('só dor respondida (baixa) → score baixo e risco high', async () => {
    const id = await completedCheckin(10, { dor: 9 });
    const r = await computeDailyScore(db, id);
    expect(r.score).toBe(1);
    expect(r.risk_level).toBe('high');
  });

  it('nenhuma resposta pontuável → score null, risk null (L5)', async () => {
    const id = await completedCheckin(20, {});
    const r = await computeDailyScore(db, id);
    expect(r.score).toBeNull();
    expect(r.risk_level).toBeNull();
    const row = await db('patient_scores_daily')
      .where({ patient_id: fx.p1.id, date: r.date })
      .first();
    expect(row.score).toBeNull();
  });
});
