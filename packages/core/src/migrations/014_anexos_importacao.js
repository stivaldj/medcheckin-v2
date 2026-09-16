import { catalogNameKey } from '../catalog/nameKey.js';

/**
 * E12.2 — anexos e importação estruturada.
 *
 * D37: status `registered` ("Cadastrado"): paciente com histórico e sem acompanhamento. Só a
 * importação grava; vira `active` no primeiro aceite de consentimento. Scheduler/alarmes/Hoje já
 * filtram `active`, então nada dispara para ele.
 *
 * `name_key` em patients: a mesma chave dos catálogos (D34/D36), para busca sem acento e para a
 * importação casar por nome + nascimento. Backfill em JS com a função do runtime.
 *
 * D38: `attachments` guarda metadados; os bytes ficam em UPLOADS_DIR/<stored_path>. `deleted_at`
 * oculta sem apagar; a anonimização é quem remove do disco.
 */
const ID = (t, knex) => t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));

export async function up(knex) {
  await knex.schema.alterTable('patients', (t) => {
    t.dropChecks(['chk_status']);
    t.check("status in ('active', 'paused', 'discharged', 'registered')", [], 'chk_status');
    t.text('external_source');
    t.text('external_ref');
    t.timestamp('imported_at', { useTz: true });
    t.text('name_key');
  });
  const rows = await knex('patients').select('id', 'name');
  for (const r of rows) {
    await knex('patients')
      .where({ id: r.id })
      .update({ name_key: catalogNameKey(r.name) });
  }
  await knex.schema.alterTable('patients', (t) => {
    t.text('name_key').notNullable().alter();
    t.index(['clinic_id', 'name_key']);
  });
  await knex.raw(
    `create unique index patients_external_ref_unique on patients (clinic_id, external_source, external_ref)
       where external_ref is not null`,
  );

  await knex.schema.createTable('attachments', (t) => {
    ID(t, knex);
    t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
    t.text('kind').notNullable();
    t.check("kind in ('pdf', 'image')", [], 'chk_attachment_kind');
    t.text('original_name').notNullable();
    t.text('mime').notNullable();
    t.integer('size_bytes').notNullable();
    t.text('sha256').notNullable();
    t.text('stored_path').notNullable();
    t.text('source').notNullable().defaultTo('upload');
    t.check("source in ('upload', 'import')", [], 'chk_attachment_source');
    t.uuid('uploaded_by').references('id').inTable('users').onDelete('RESTRICT');
    t.timestamp('deleted_at', { useTz: true });
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['patient_id', 'created_at']);
    t.unique(['patient_id', 'sha256']);
  });
}

export async function down(knex) {
  await knex.schema.dropTable('attachments');
  // Sem `registered` no CHECK antigo: quem estava cadastrado vira pausado (não perde dado, e não
  // volta a receber envio sozinho). O log avisa quantos.
  const n = await knex('patients').where({ status: 'registered' }).update({ status: 'paused' });
  if (n)
    console.warn(`migration 014 down: ${n} paciente(s) 'registered' rebaixado(s) para 'paused'.`);
  await knex.raw('drop index if exists patients_external_ref_unique');
  await knex.schema.alterTable('patients', (t) => {
    t.dropChecks(['chk_status']);
    t.check("status in ('active', 'paused', 'discharged')", [], 'chk_status');
    t.dropIndex(['clinic_id', 'name_key']);
    t.dropColumn('name_key');
    t.dropColumn('imported_at');
    t.dropColumn('external_ref');
    t.dropColumn('external_source');
  });
}
