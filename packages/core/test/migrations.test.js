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

    /**
     * P2-8 — o `down` da 007 apaga `answers` de perguntas POR PACIENTE, e esse caminho nunca
     * rodava: o seed não cria nenhuma extra, então a linha 27-29 da migration atravessava o
     * teste sem tocar em nada. Um rollback em produção seria a primeira vez de verdade.
     */
    const [extra] = await db('questions')
      .insert({
        patient_id: p.id,
        question_set_id: null,
        key: 'extra_rollback',
        label: 'Pergunta extra para exercitar o rollback',
        kind: 'yes_no',
        sort_order: 99,
      })
      .returning('id');
    await db('answers').insert({
      checkin_id: ck.id,
      question_id: extra.id,
      respondent_id: r.id,
      value_num: 1,
    });
    const antes = await db('answers').where({ checkin_id: ck.id }).count().first();
    expect(Number(antes.count)).toBe(2);

    await db.migrate.rollback(migrationConfig, true);
    expect(await db.schema.hasTable('patients')).toBe(false);
    const [, files] = await db.migrate.latest(migrationConfig);
    expect(files.length).toBeGreaterThanOrEqual(3);
  });

  /**
   * D28 — o backfill da 010 reconhece quem já foi anonimizado ANTES da coluna existir (pelo nome
   * que a anonimização grava) e não confunde isso com alta.
   */
  it('010: backfill marca os já anonimizados e deixa a alta em paz', async () => {
    await db.raw('drop schema public cascade; create schema public');
    await db.migrate.latest(migrationConfig);
    await runSeed(db, { reset: true });
    // Volta para antes da 010 — desfazendo também as que vieram depois (011+), uma por vez.
    for (let i = 0; i < 20 && (await db.schema.hasColumn('patients', 'anonymized_at')); i += 1)
      await db.migrate.down(migrationConfig);
    expect(await db.schema.hasColumn('patients', 'anonymized_at')).toBe(false);

    const [anon, alta] = await db('patients').orderBy('created_at').limit(2);
    await db('patients')
      .where({ id: anon.id })
      .update({ name: 'Paciente anonimizado 1a2b3c4d', status: 'discharged' });
    await db('patients').where({ id: alta.id }).update({ status: 'discharged' });

    await db.migrate.latest(migrationConfig);
    const depoisAnon = await db('patients').where({ id: anon.id }).first();
    const depoisAlta = await db('patients').where({ id: alta.id }).first();
    expect(depoisAnon.anonymized_at).not.toBeNull();
    expect(new Date(depoisAnon.anonymized_at).getTime()).toBe(
      new Date(depoisAnon.updated_at).getTime(),
    );
    expect(depoisAlta.anonymized_at).toBeNull();
  });
});
