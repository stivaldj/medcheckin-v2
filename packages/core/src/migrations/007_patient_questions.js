/**
 * Migration 007 — perguntas extras por paciente (E9.2).
 * Ficam na MESMA tabela `questions` (com `patient_id` no lugar de `question_set_id`) para que
 * `answers.question_id` continue apontando para um só lugar — a intenção do v1
 * (`patient_custom_questions`) sem duplicar o modelo de resposta.
 */
export async function up(knex) {
  await knex.schema.alterTable('questions', (t) => {
    t.uuid('patient_id').references('id').inTable('patients').onDelete('CASCADE');
    t.index(['patient_id']);
  });
  await knex.raw('alter table questions alter column question_set_id drop not null');
  await knex.raw(`
    alter table questions add constraint chk_questions_owner
    check ((question_set_id is null) <> (patient_id is null))
  `);
  await knex.raw(`
    create unique index questions_patient_key on questions (patient_id, key)
    where patient_id is not null
  `);
}

export async function down(knex) {
  await knex.raw('drop index if exists questions_patient_key');
  await knex.raw('alter table questions drop constraint if exists chk_questions_owner');
  // as respostas das extras somem junto (o `down` recria o mundo sem elas)
  await knex('answers')
    .whereIn('question_id', knex('questions').select('id').whereNotNull('patient_id'))
    .del();
  await knex('questions').whereNotNull('patient_id').del();
  await knex.raw('alter table questions alter column question_set_id set not null');
  await knex.schema.alterTable('questions', (t) => {
    t.dropIndex(['patient_id']);
    t.dropColumn('patient_id');
  });
}
