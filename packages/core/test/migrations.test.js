import { describe, it, expect, afterAll } from 'vitest';
import { createDb } from '../src/db.js';
import { migrationConfig } from '../src/migrate.js';
import { runSeed } from '../src/seed/index.js';

// Os `down` precisam funcionar mesmo com dados (inclusive respostas puladas).
describe('migrations — latest → seed → rollback total → latest', () => {
  const db = createDb(process.env.DATABASE_URL_TEST || process.env.DATABASE_URL);
  afterAll(async () => db.destroy());

  it('sobe, popula, desce tudo e sobe de novo sem erro', async () => {
    await db.raw('drop schema public cascade; create schema public');
    await db.migrate.latest(migrationConfig);
    await runSeed(db, { reset: true });
    const p = await db('patients').first();
    const ep = await db('episodes').where({ patient_id: p.id }).first();
    const q = await db('questions').where({ key: 'obs' }).first();
    const r = await db('respondents').where({ patient_id: p.id }).first();
    const [ck] = await db('checkins')
      .insert({ patient_id: p.id, episode_id: ep.id, scheduled_for: new Date() })
      .returning('id');
    await db('answers').insert({
      checkin_id: ck.id,
      question_id: q.id,
      respondent_id: r.id,
      skipped: true,
    });
    await db.migrate.rollback(migrationConfig, true);
    expect(await db.schema.hasTable('patients')).toBe(false);
    const [, files] = await db.migrate.latest(migrationConfig);
    expect(files.length).toBeGreaterThanOrEqual(3);
  });
});
