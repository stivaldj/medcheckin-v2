/**
 * Migration 002 — configuração de score por pergunta, marcador de resposta pulada e trend.
 * - questions.score_direction (null = fora do score) e score_weight (v1 tinha tabela separada).
 * - answers.skipped: pergunta opcional pulada explicitamente (v1 usava string vazia — armadilha).
 * - patient_scores_daily.trend: score − média dos 3 dias anteriores (usado pelas regras de alerta).
 */
export async function up(knex) {
  await knex.schema.alterTable('questions', (t) => {
    t.string('score_direction');
    t.check(
      "score_direction is null or score_direction in ('higher_is_better','lower_is_better')",
      [],
      'chk_score_direction',
    );
    t.decimal('score_weight', 5, 2).notNullable().defaultTo(1);
    t.check('score_weight > 0', [], 'chk_score_weight_pos');
  });

  await knex.schema.alterTable('answers', (t) => {
    t.boolean('skipped').notNullable().defaultTo(false);
    t.dropChecks(['chk_answer_has_value']);
    t.check(
      'skipped or value_num is not null or value_text is not null or value_choice is not null',
      [],
      'chk_answer_has_value',
    );
  });

  await knex.schema.alterTable('patient_scores_daily', (t) => {
    t.decimal('trend', 5, 2);
  });
}

export async function down(knex) {
  await knex.schema.alterTable('patient_scores_daily', (t) => {
    t.dropColumn('trend');
  });
  await knex.schema.alterTable('answers', (t) => {
    t.dropChecks(['chk_answer_has_value']);
    t.dropColumn('skipped');
    t.check(
      'value_num is not null or value_text is not null or value_choice is not null',
      [],
      'chk_answer_has_value',
    );
  });
  await knex.schema.alterTable('questions', (t) => {
    t.dropColumn('score_direction');
    t.dropColumn('score_weight');
  });
}
