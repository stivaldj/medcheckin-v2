/**
 * E9.3 — primeiro acesso guiado.
 *
 * `install_confirmed_at`: o app aberto em modo instalado (tela inicial) avisou o servidor.
 * `push_test_confirmed_at`: a própria pessoa disse "chegou" a um teste de aviso que o servidor
 * REALMENTE enviou. A página da médica só mostra ✓ com essas datas — nunca por dedução.
 * `notifications.kind` ganha `test` (o teste vai pela mesma fila e o mesmo scheduler dos alarmes).
 */
export async function up(knex) {
  await knex.schema.alterTable('respondents', (t) => {
    t.timestamp('install_confirmed_at', { useTz: true }).nullable();
    t.timestamp('push_test_confirmed_at', { useTz: true }).nullable();
  });
  await knex.raw('alter table notifications drop constraint chk_kind');
  await knex.raw(
    "alter table notifications add constraint chk_kind check (kind in ('checkin', 'alarm', 'alert', 'test'))",
  );
}

export async function down(knex) {
  await knex('notifications').where({ kind: 'test' }).del();
  await knex.raw('alter table notifications drop constraint chk_kind');
  await knex.raw(
    "alter table notifications add constraint chk_kind check (kind in ('checkin', 'alarm', 'alert'))",
  );
  await knex.schema.alterTable('respondents', (t) => {
    t.dropColumn('install_confirmed_at');
    t.dropColumn('push_test_confirmed_at');
  });
}
