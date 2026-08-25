/**
 * Migration 008 — claim de envio por notificação (auditoria 2026-08-25, P1-2).
 * A unique de dedup_key impede LINHA duplicada; o claim impede dois processos ENVIANDO a
 * mesma linha ao mesmo tempo (o send acontecia fora de qualquer lock).
 */
export async function up(knex) {
  await knex.schema.alterTable('notifications', (t) => {
    t.timestamp('claimed_at', { useTz: true }).nullable();
  });
}
export async function down(knex) {
  await knex.schema.alterTable('notifications', (t) => {
    t.dropColumn('claimed_at');
  });
}
