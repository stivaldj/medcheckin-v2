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

  /**
   * D34 — o backfill da 012 não funde produtos às cegas: duas linhas da mesma clínica que caem
   * na mesma chave fazem a migration falhar nomeando os ids, para alguém decidir.
   */
  it('012 falha com mensagem clara quando dois produtos da clínica têm a mesma chave', async () => {
    await db.raw('drop schema public cascade; create schema public');
    // sobe até a 011 (tudo antes da 012 — não mais "tudo menos a última", pois a 013 (D36)
    // passou a ser a mais nova e quebraria essa suposição).
    const [, pendentes] = await db.migrate.list(migrationConfig);
    const ate012 = pendentes.findIndex((m) => m.file.startsWith('012_'));
    for (let i = 0; i < ate012; i += 1) await db.migrate.up(migrationConfig);
    expect(await db.schema.hasColumn('products', 'name_key')).toBe(false);

    const [clinic] = await db('clinics').insert({ name: 'Clínica colisão' }).returning('id');
    await db('products').insert([
      { clinic_id: clinic.id, name: 'Óleo CBD 50mg/ml', form: 'oil' },
      { clinic_id: clinic.id, name: 'oleo cbd 50mg/ml', form: 'oil' },
    ]);

    await expect(db.migrate.up(migrationConfig)).rejects.toThrow(/mesma chave.*oleo cbd 50mg\/ml/);

    // sem a colisão, a 012 sobe e o índice único vale
    await db('products').where({ name: 'oleo cbd 50mg/ml' }).delete();
    await db.migrate.up(migrationConfig);
    const row = await db('products').where({ name: 'Óleo CBD 50mg/ml' }).first();
    expect(row.name_key).toBe('oleo cbd 50mg/ml');
    await expect(
      db('products').insert({
        clinic_id: clinic.id,
        name: 'ÓLEO CBD 50MG/ML',
        name_key: 'oleo cbd 50mg/ml',
        form: 'oil',
      }),
    ).rejects.toMatchObject({ code: '23505' });
  });
  /**
   * D36 — a 013 leva `patients.condition_tags` para o catálogo da clínica sem perder nada, e o
   * `down` reconstrói a lista a partir dos vínculos.
   */
  it('013: condition_tags vira conditions + patient_conditions; down reconstrói a coluna', async () => {
    await db.raw('drop schema public cascade; create schema public');
    const [, pendentes] = await db.migrate.list(migrationConfig);
    const ate013 = pendentes.findIndex((m) => m.file.startsWith('013_'));
    for (let i = 0; i < ate013; i += 1) await db.migrate.up(migrationConfig);
    expect(await db.schema.hasColumn('patients', 'condition_tags')).toBe(true);
    expect(await db.schema.hasTable('conditions')).toBe(false);

    const [clinic] = await db('clinics').insert({ name: 'Clínica 013' }).returning('id');
    const [user] = await db('users')
      .insert({ clinic_id: clinic.id, role: 'doctor', email: 'dra-013@example.test', name: 'Dra.' })
      .returning('id');
    const [a] = await db('patients')
      .insert({
        clinic_id: clinic.id,
        name: 'A',
        timezone: 'America/Cuiaba',
        created_by: user.id,
        condition_tags: ['epilepsia', 'Ansiedade'],
      })
      .returning('id');
    const [b] = await db('patients')
      .insert({
        clinic_id: clinic.id,
        name: 'B',
        timezone: 'America/Cuiaba',
        created_by: user.id,
        condition_tags: ['ansiedade'],
      })
      .returning('id');

    await db.migrate.up(migrationConfig);
    expect(await db.schema.hasColumn('patients', 'condition_tags')).toBe(false);
    const conds = await db('conditions').where({ clinic_id: clinic.id }).orderBy('name_key');
    // "Ansiedade" e "ansiedade" caem na MESMA chave → uma condição só, dois vínculos
    expect(conds.map((c) => c.name_key)).toEqual(['ansiedade', 'epilepsia']);
    const links = await db('patient_conditions').whereIn('patient_id', [a.id, b.id]);
    expect(links).toHaveLength(3);

    await db.migrate.down(migrationConfig);
    expect(await db.schema.hasTable('conditions')).toBe(false);
    const pa = await db('patients').where({ id: a.id }).first();
    const pb = await db('patients').where({ id: b.id }).first();
    expect([...pa.condition_tags].sort()).toEqual(['ansiedade', 'epilepsia']);
    expect(pb.condition_tags).toEqual(['ansiedade']);
    await db.migrate.up(migrationConfig);
  });

  /**
   * D37/D38 — a 014 adiciona status `registered`, colunas de origem, `name_key` com backfill e a
   * tabela `attachments`; o `down` leva `registered` para `paused` antes de restaurar o CHECK.
   */
  it('014: registered, name_key com backfill, attachments; down rebaixa registered para paused', async () => {
    await db.raw('drop schema public cascade; create schema public');
    const [, pendentes] = await db.migrate.list(migrationConfig);
    const idx = pendentes.findIndex((m) => m.file.startsWith('014_'));
    for (let i = 0; i < idx; i += 1) await db.migrate.up(migrationConfig);
    expect(await db.schema.hasColumn('patients', 'name_key')).toBe(false);

    const [clinic] = await db('clinics').insert({ name: 'Clínica 014' }).returning('id');
    const [user] = await db('users')
      .insert({ clinic_id: clinic.id, role: 'doctor', email: 'dra-014@example.test', name: 'Dra.' })
      .returning('id');
    const [p] = await db('patients')
      .insert({
        clinic_id: clinic.id,
        name: '  José  da Silva ',
        timezone: 'America/Cuiaba',
        created_by: user.id,
      })
      .returning('id');

    await db.migrate.up(migrationConfig);
    const row = await db('patients').where({ id: p.id }).first();
    expect(row.name_key).toBe('jose da silva');
    expect(row.status).toBe('active');
    await db('patients')
      .where({ id: p.id })
      .update({ status: 'registered', external_source: 'versatilis', external_ref: '42' });
    await expect(
      db('patients').insert({
        clinic_id: clinic.id,
        name: 'Outro',
        name_key: 'outro',
        timezone: 'America/Cuiaba',
        created_by: user.id,
        external_source: 'versatilis',
        external_ref: '42',
      }),
    ).rejects.toMatchObject({ code: '23505' });
    expect(await db.schema.hasTable('attachments')).toBe(true);

    await db.migrate.down(migrationConfig);
    expect(await db.schema.hasTable('attachments')).toBe(false);
    expect(await db.schema.hasColumn('patients', 'name_key')).toBe(false);
    expect((await db('patients').where({ id: p.id }).first()).status).toBe('paused');
    await expect(
      db('patients').where({ id: p.id }).update({ status: 'registered' }),
    ).rejects.toMatchObject({ code: '23514' });
    await db.migrate.up(migrationConfig);
  });
});
