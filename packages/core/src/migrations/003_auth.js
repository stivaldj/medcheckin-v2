/**
 * Migration 003 — auth próprio (D14): tokens de link mágico e sessões opacas.
 * Só hashes vão ao banco. Sessão tem exatamente um principal (user OU respondent).
 */
export async function up(knex) {
  await knex.schema.createTable('auth_tokens', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('kind').notNullable().defaultTo('magic_link');
    t.check("kind in ('magic_link')", [], 'chk_auth_token_kind');
    t.string('email').notNullable();
    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('token_hash', 64).notNullable().unique();
    t.timestamp('expires_at', { useTz: true }).notNullable();
    t.timestamp('used_at', { useTz: true });
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['email', 'created_at']);
  });

  await knex.schema.createTable('sessions', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('token_hash', 64).notNullable().unique();
    t.uuid('user_id').references('id').inTable('users').onDelete('CASCADE');
    t.uuid('respondent_id').references('id').inTable('respondents').onDelete('CASCADE');
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('CASCADE');
    t.timestamp('expires_at', { useTz: true }).notNullable();
    t.timestamp('last_seen_at', { useTz: true });
    t.timestamp('revoked_at', { useTz: true });
    t.string('ua', 300);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.check(
      '(user_id is not null and respondent_id is null) or (user_id is null and respondent_id is not null)',
      [],
      'chk_session_one_principal',
    );
    t.index(['user_id']);
    t.index(['respondent_id']);
    t.index(['expires_at']);
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('sessions');
  await knex.schema.dropTableIfExists('auth_tokens');
}
