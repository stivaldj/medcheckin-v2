/**
 * Migration 001 — schema inicial do MedCheck-in v2 (PG-first).
 * Fonte: DECISOES.md §3, inspirada nas migrations 001/002/003/004/008/010/011/016/017/030 do v1.
 * Regras: uuid em tudo; timestamptz; enums via CHECK; toda tabela de paciente tem clinic_id
 * (direto ou por FK) e índice por clinic_id; nada de dialeto alternativo.
 */

const ID = (t, knex) => t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
const TS = (t, knex) => {
  t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
};
const CHECK_IN = (t, col, values) =>
  t.check(`${col} in (${values.map((v) => `'${v}'`).join(', ')})`, [], `chk_${col}`);

export async function up(knex) {
  // --- Tenancy -------------------------------------------------------------
  await knex.schema.createTable('clinics', (t) => {
    ID(t, knex);
    t.string('name').notNullable();
    t.string('timezone').notNullable().defaultTo('America/Cuiaba');
    TS(t, knex);
  });

  await knex.schema.createTable('users', (t) => {
    ID(t, knex);
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.string('role').notNullable().defaultTo('doctor');
    CHECK_IN(t, 'role', ['doctor', 'staff']);
    t.string('email').notNullable().unique();
    t.string('name').notNullable();
    TS(t, knex);
    t.index(['clinic_id']);
  });

  // --- Pacientes e respondentes -------------------------------------------
  await knex.schema.createTable('patients', (t) => {
    ID(t, knex);
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.string('name').notNullable();
    t.date('birth_date');
    t.specificType('condition_tags', 'text[]').notNullable().defaultTo('{}');
    t.string('timezone').notNullable().defaultTo('America/Cuiaba');
    t.string('status').notNullable().defaultTo('active');
    CHECK_IN(t, 'status', ['active', 'paused', 'discharged']);
    // Janela de contato (v1: preferred_window_*). Fora dela nada é enviado (quiet hours).
    t.time('checkin_time').notNullable().defaultTo('09:00');
    t.time('quiet_start').notNullable().defaultTo('21:00');
    t.time('quiet_end').notNullable().defaultTo('08:00');
    t.string('consent_version');
    t.timestamp('consent_at', { useTz: true });
    t.uuid('created_by').notNullable().references('id').inTable('users').onDelete('RESTRICT');
    TS(t, knex);
    t.index(['clinic_id']);
    t.index(['clinic_id', 'status']);
  });

  await knex.schema.createTable('respondents', (t) => {
    ID(t, knex);
    t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
    t.string('kind').notNullable();
    CHECK_IN(t, 'kind', ['patient', 'caregiver']);
    t.string('name').notNullable();
    t.string('email'); // opcional (D12: convite por link copiável)
    t.string('phone');
    t.string('relationship'); // ex.: mãe, cônjuge — só para caregiver
    t.boolean('can_answer').notNullable().defaultTo(true);
    t.boolean('receives_alarms').notNullable().defaultTo(true);
    t.string('invite_token').notNullable().unique();
    t.timestamp('accepted_at', { useTz: true });
    t.string('consent_version');
    t.timestamp('consent_at', { useTz: true });
    TS(t, knex);
    t.index(['patient_id']);
  });

  await knex.schema.createTable('push_subscriptions', (t) => {
    ID(t, knex);
    t.uuid('respondent_id')
      .notNullable()
      .references('id')
      .inTable('respondents')
      .onDelete('CASCADE');
    t.text('endpoint').notNullable().unique();
    t.jsonb('keys').notNullable();
    t.string('ua');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('revoked_at', { useTz: true });
    t.index(['respondent_id']);
  });

  // --- Produtos, medicações, doses ----------------------------------------
  await knex.schema.createTable('products', (t) => {
    ID(t, knex);
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.string('name').notNullable();
    t.decimal('cbd_mg_ml', 8, 2);
    t.decimal('thc_mg_ml', 8, 2);
    t.string('form').notNullable().defaultTo('oil');
    CHECK_IN(t, 'form', ['oil', 'capsule', 'flower', 'other']);
    TS(t, knex);
    t.index(['clinic_id']);
  });

  await knex.schema.createTable('medications', (t) => {
    ID(t, knex);
    t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
    t.uuid('product_id').notNullable().references('id').inTable('products').onDelete('RESTRICT');
    t.boolean('active').notNullable().defaultTo(true);
    TS(t, knex);
    t.index(['patient_id']);
  });

  await knex.schema.createTable('dose_events', (t) => {
    ID(t, knex);
    t.uuid('medication_id')
      .notNullable()
      .references('id')
      .inTable('medications')
      .onDelete('CASCADE');
    t.date('effective_from').notNullable();
    t.decimal('dose_amount', 8, 2).notNullable();
    t.string('dose_unit').notNullable(); // gotas | ml | mg | cápsulas
    t.integer('times_per_day').notNullable();
    t.specificType('schedule_times', 'time[]').notNullable().defaultTo('{}');
    t.string('reason');
    t.text('note');
    t.uuid('created_by').notNullable().references('id').inTable('users').onDelete('RESTRICT');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.check('dose_amount > 0', [], 'chk_dose_amount_pos');
    t.check('times_per_day between 1 and 12', [], 'chk_times_per_day');
    t.unique(['medication_id', 'effective_from']);
    t.index(['medication_id', 'effective_from']);
  });

  await knex.schema.createTable('medication_intakes', (t) => {
    ID(t, knex);
    t.uuid('medication_id')
      .notNullable()
      .references('id')
      .inTable('medications')
      .onDelete('CASCADE');
    t.uuid('dose_event_id').references('id').inTable('dose_events').onDelete('SET NULL');
    t.uuid('respondent_id').references('id').inTable('respondents').onDelete('SET NULL');
    t.timestamp('scheduled_at', { useTz: true }).notNullable();
    t.timestamp('taken_at', { useTz: true });
    t.string('status').notNullable().defaultTo('pending');
    // L4: só muda de pending por ação do respondente.
    CHECK_IN(t, 'status', ['pending', 'taken', 'skipped', 'late']);
    t.boolean('side_effect_flag').notNullable().defaultTo(false);
    t.text('note');
    TS(t, knex);
    t.unique(['medication_id', 'scheduled_at']);
    t.index(['medication_id', 'status']);
  });

  // --- Episódios, perguntas -----------------------------------------------
  await knex.schema.createTable('question_sets', (t) => {
    ID(t, knex);
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.string('name').notNullable();
    t.boolean('active').notNullable().defaultTo(true);
    TS(t, knex);
    t.index(['clinic_id']);
  });

  await knex.schema.createTable('questions', (t) => {
    ID(t, knex);
    t.uuid('question_set_id')
      .notNullable()
      .references('id')
      .inTable('question_sets')
      .onDelete('CASCADE');
    t.string('key').notNullable(); // slug estável (ex.: dor, sono)
    t.string('label').notNullable();
    t.string('kind').notNullable();
    CHECK_IN(t, 'kind', ['scale_0_10', 'yes_no', 'choice', 'number', 'text']);
    t.jsonb('options').notNullable().defaultTo('[]');
    t.string('unit');
    t.integer('sort_order').notNullable().defaultTo(0);
    t.boolean('required').notNullable().defaultTo(true);
    t.boolean('active').notNullable().defaultTo(true);
    t.jsonb('condition_json'); // fluxo condicional (ex.: {when:'sono', op:'<=', value:3})
    t.jsonb('alert_threshold_json'); // limiar por pergunta (L3: nada hardcoded)
    t.boolean('is_side_effect').notNullable().defaultTo(false);
    TS(t, knex);
    t.unique(['question_set_id', 'key']);
    t.index(['question_set_id', 'active', 'sort_order']);
  });

  await knex.schema.createTable('episodes', (t) => {
    ID(t, knex);
    t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
    t.string('kind').notNullable();
    CHECK_IN(t, 'kind', ['titration', 'maintenance']);
    t.timestamp('started_at', { useTz: true }).notNullable();
    t.timestamp('ended_at', { useTz: true });
    t.string('checkin_frequency').notNullable();
    CHECK_IN(t, 'checkin_frequency', ['daily', 'weekly', 'biweekly']);
    t.uuid('question_set_id')
      .notNullable()
      .references('id')
      .inTable('question_sets')
      .onDelete('RESTRICT');
    t.uuid('dose_event_id').references('id').inTable('dose_events').onDelete('SET NULL'); // ajuste que abriu o episódio
    TS(t, knex);
    t.index(['patient_id', 'started_at']);
  });
  // Só um episódio aberto por paciente.
  await knex.raw(
    `create unique index episodes_one_open_per_patient on episodes (patient_id) where ended_at is null`,
  );

  // --- Check-ins e respostas ----------------------------------------------
  await knex.schema.createTable('checkins', (t) => {
    ID(t, knex);
    t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
    t.uuid('episode_id').notNullable().references('id').inTable('episodes').onDelete('CASCADE');
    t.timestamp('scheduled_for', { useTz: true }).notNullable();
    t.string('status').notNullable().defaultTo('pending');
    CHECK_IN(t, 'status', ['pending', 'sent', 'in_progress', 'completed', 'missed']);
    t.integer('attempt_count').notNullable().defaultTo(0);
    t.integer('max_attempts').notNullable().defaultTo(2);
    t.timestamp('next_attempt_at', { useTz: true });
    t.timestamp('sent_at', { useTz: true }); // L2: só preenchido com notificação real
    t.timestamp('completed_at', { useTz: true });
    TS(t, knex);
    t.unique(['patient_id', 'scheduled_for']);
    t.index(['patient_id', 'status']);
    t.index(['status', 'next_attempt_at']);
  });

  await knex.schema.createTable('answers', (t) => {
    ID(t, knex);
    t.uuid('checkin_id').notNullable().references('id').inTable('checkins').onDelete('CASCADE');
    t.uuid('question_id').notNullable().references('id').inTable('questions').onDelete('RESTRICT');
    t.uuid('respondent_id')
      .notNullable()
      .references('id')
      .inTable('respondents')
      .onDelete('RESTRICT');
    t.decimal('value_num', 10, 2);
    t.text('value_text');
    t.string('value_choice');
    t.timestamp('answered_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.unique(['checkin_id', 'question_id']);
    t.index(['question_id', 'answered_at']);
    t.check(
      'value_num is not null or value_text is not null or value_choice is not null',
      [],
      'chk_answer_has_value',
    );
  });

  // --- Notificações (fila) -------------------------------------------------
  await knex.schema.createTable('notifications', (t) => {
    ID(t, knex);
    t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
    t.uuid('respondent_id')
      .notNullable()
      .references('id')
      .inTable('respondents')
      .onDelete('CASCADE');
    t.string('kind').notNullable();
    CHECK_IN(t, 'kind', ['checkin', 'alarm', 'alert']);
    t.jsonb('payload').notNullable().defaultTo('{}');
    t.timestamp('scheduled_at', { useTz: true }).notNullable();
    t.timestamp('sent_at', { useTz: true }); // provedor aceitou
    t.timestamp('delivered_at', { useTz: true }); // dispositivo confirmou (quando houver)
    t.timestamp('failed_at', { useTz: true });
    t.text('error');
    t.string('dedup_key').notNullable().unique(); // L8: única barreira de idempotência
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['respondent_id', 'scheduled_at']);
    t.index(['patient_id', 'kind', 'scheduled_at']);
  });
  await knex.raw(
    `create index notifications_pending on notifications (scheduled_at) where sent_at is null and failed_at is null`,
  );

  // --- Alertas -------------------------------------------------------------
  await knex.schema.createTable('alerts', (t) => {
    ID(t, knex);
    t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
    t.string('code').notNullable(); // no_response | threshold | worsening | side_effect | delivery_failed
    t.string('severity').notNullable();
    CHECK_IN(t, 'severity', ['low', 'medium', 'high', 'critical']);
    t.string('title').notNullable();
    t.jsonb('context').notNullable().defaultTo('{}');
    t.string('status').notNullable().defaultTo('open');
    CHECK_IN(t, 'status', ['open', 'acknowledged', 'resolved']);
    t.string('resolved_reason');
    t.timestamp('first_seen_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('last_seen_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('resolved_at', { useTz: true });
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['patient_id', 'status']);
    t.index(['status', 'severity']);
  });
  await knex.raw(
    `create unique index alerts_one_open_per_code on alerts (patient_id, code) where status <> 'resolved'`,
  );

  await knex.schema.createTable('alert_actions', (t) => {
    ID(t, knex);
    t.uuid('alert_id').notNullable().references('id').inTable('alerts').onDelete('CASCADE');
    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('RESTRICT');
    t.string('action').notNullable(); // acknowledge | note | resolve | silence
    t.text('note'); // L15: obrigatório ao resolver (garantido na camada de serviço + teste)
    t.timestamp('at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['alert_id', 'at']);
  });

  await knex.schema.createTable('alert_silences', (t) => {
    ID(t, knex);
    t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
    t.string('code'); // null = todos os códigos
    t.timestamp('until_at', { useTz: true }).notNullable();
    t.string('reason');
    t.uuid('created_by').notNullable().references('id').inTable('users').onDelete('RESTRICT');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['patient_id', 'until_at']);
  });

  // --- Score, auditoria ----------------------------------------------------
  await knex.schema.createTable('patient_scores_daily', (t) => {
    t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
    t.date('date').notNullable();
    t.decimal('score', 4, 2); // null = sem dado (L5)
    t.string('risk_level');
    CHECK_IN(t, 'risk_level', ['low', 'medium', 'high']);
    t.timestamp('computed_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.primary(['patient_id', 'date']);
  });

  await knex.schema.createTable('access_audit', (t) => {
    ID(t, knex);
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.uuid('user_id').references('id').inTable('users').onDelete('SET NULL');
    t.uuid('respondent_id').references('id').inTable('respondents').onDelete('SET NULL');
    t.uuid('patient_id').references('id').inTable('patients').onDelete('SET NULL');
    t.string('route').notNullable();
    t.string('action').notNullable(); // view | create | update | export | delete
    t.timestamp('at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['clinic_id', 'at']);
    t.index(['patient_id', 'at']);
  });
}

export async function down(knex) {
  const tables = [
    'access_audit',
    'patient_scores_daily',
    'alert_silences',
    'alert_actions',
    'alerts',
    'notifications',
    'answers',
    'checkins',
    'episodes',
    'questions',
    'question_sets',
    'medication_intakes',
    'dose_events',
    'medications',
    'products',
    'push_subscriptions',
    'respondents',
    'patients',
    'users',
    'clinics',
  ];
  for (const t of tables) await knex.schema.dropTableIfExists(t);
}
