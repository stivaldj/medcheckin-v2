/**
 * D27 — teto de atraso do lembrete, por período de rotina.
 *
 * Nulo = usa o padrão do sistema (`ALARM_MAX_LATE_MIN`). Fica no PERÍODO, e não na clínica ou no
 * paciente, porque é onde a médica já descreve o regime: o mesmo paciente pode ter um período de
 * titulação com horário rígido e um de manutenção mais frouxo.
 */
export async function up(knex) {
  await knex.schema.alterTable('routine_periods', (t) => {
    t.integer('max_late_min').nullable();
  });
  await knex.raw(
    'alter table routine_periods add constraint chk_routine_max_late ' +
      'check (max_late_min is null or (max_late_min >= 0 and max_late_min <= 1440))',
  );
}

export async function down(knex) {
  await knex.raw('alter table routine_periods drop constraint if exists chk_routine_max_late');
  await knex.schema.alterTable('routine_periods', (t) => {
    t.dropColumn('max_late_min');
  });
}
