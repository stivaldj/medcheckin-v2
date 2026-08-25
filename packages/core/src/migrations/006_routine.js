/**
 * Migration 006 — rotina de alarmes por período (E9.1 / D15).
 * A rotina da médica é um PERÍODO (com fim opcional) e, dentro dele, um alarme por horário
 * com a instrução em TEXTO LIVRE. Períodos do mesmo paciente não se sobrepõem (EXCLUDE gist).
 */
const ID = (t, knex) => t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
const TS = (t, knex) => {
  t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
};

export async function up(knex) {
  // uuid `=` dentro de um índice gist exige btree_gist (contrib, presente na imagem oficial).
  await knex.raw('create extension if not exists btree_gist');

  await knex.schema.createTable('routine_periods', (t) => {
    ID(t, knex);
    t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
    t.date('starts_on').notNullable();
    t.date('ends_on'); // null = em aberto (sem fim previsto)
    t.text('note');
    t.uuid('replicated_from').references('id').inTable('routine_periods').onDelete('SET NULL');
    t.uuid('created_by').notNullable().references('id').inTable('users').onDelete('RESTRICT');
    TS(t, knex);
    t.check('ends_on is null or ends_on >= starts_on', [], 'chk_routine_periods_range');
    t.index(['patient_id', 'starts_on']);
  });
  await knex.raw(`
    alter table routine_periods add constraint routine_periods_no_overlap
    exclude using gist (
      patient_id with =,
      daterange(starts_on, ends_on, '[]') with &&
    )
  `);

  await knex.schema.createTable('routine_alarms', (t) => {
    ID(t, knex);
    t.uuid('period_id')
      .notNullable()
      .references('id')
      .inTable('routine_periods')
      .onDelete('CASCADE');
    t.time('time').notNullable();
    t.text('description').notNullable(); // texto livre: o que tomar naquele horário
    TS(t, knex);
    t.unique(['period_id', 'time']); // um alarme por horário dentro do período
    t.index(['period_id']);
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('routine_alarms');
  await knex.schema.dropTableIfExists('routine_periods');
}
