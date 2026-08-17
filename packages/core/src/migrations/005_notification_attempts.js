/** Migration 005 — tentativas por notificação (falha + reenvio na mesma dedup_key não apaga a história). */
export async function up(knex) {
  await knex.schema.alterTable('notifications', (t) => {
    t.integer('attempts').notNullable().defaultTo(1);
  });
}
export async function down(knex) {
  await knex.schema.alterTable('notifications', (t) => {
    t.dropColumn('attempts');
  });
}
