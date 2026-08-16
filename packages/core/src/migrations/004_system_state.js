/** Migration 004 — carimbos duráveis do scheduler (fecha ACHADOS E2/E5). */
export async function up(knex) {
  await knex.schema.createTable('system_state', (t) => {
    t.string('key', 80).primary();
    t.jsonb('value').notNullable();
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
}
export async function down(knex) {
  await knex.schema.dropTableIfExists('system_state');
}
