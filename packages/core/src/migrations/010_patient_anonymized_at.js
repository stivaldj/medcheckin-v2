/**
 * D28 — a anonimização ganha registro próprio.
 *
 * Antes, "anonimizado" era deduzido de `status = 'discharged'`, que é o mesmo status gravado por
 * "Dar alta". Resultado: paciente com alta perdia o botão de anonimizar — justamente quem mais
 * pede exclusão depois do tratamento. `anonymized_at` separa os dois conceitos.
 *
 * Backfill: pacientes já anonimizados são reconhecidos pelo nome que a própria anonimização
 * grava (`Paciente anonimizado <hash>`); `updated_at` é a melhor aproximação da data.
 */
export async function up(knex) {
  await knex.schema.alterTable('patients', (t) => {
    t.timestamp('anonymized_at', { useTz: true }).nullable();
  });
  await knex('patients')
    .where('name', 'like', 'Paciente anonimizado %')
    .whereNull('anonymized_at')
    .update({ anonymized_at: knex.ref('updated_at') });
}

export async function down(knex) {
  await knex.schema.alterTable('patients', (t) => {
    t.dropColumn('anonymized_at');
  });
}
