import { catalogNameKey } from '../catalog/nameKey.js';

/**
 * E12.1 — prontuário mínimo.
 *
 * D35: `clinical_notes` é texto livre datado, nunca apagado (`deleted_at` oculta). `source`
 * fica nulo aqui; a E12.3 grava { file, page, excerpt } quando a nota vier de importação.
 *
 * D36: `patients.condition_tags` (lista solta por paciente) vira catálogo da clínica com a mesma
 * chave normalizada dos produtos (D34) e CID-10 opcional. Backfill em JS com a MESMA função do
 * runtime; tags que caem na mesma chave viram UMA condição (é o objetivo: "Ansiedade" e
 * "ansiedade" nunca deveriam ter sido duas). Depois a coluna sai.
 */
const ID = (t, knex) => t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
const TS = (t, knex) => {
  t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
};

export async function up(knex) {
  await knex.schema.createTable('clinical_notes', (t) => {
    ID(t, knex);
    t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
    t.text('kind').notNullable().defaultTo('consulta');
    t.check("kind in ('consulta', 'evolucao', 'contato', 'importada')", [], 'chk_note_kind');
    t.date('occurred_at').notNullable();
    t.text('body').notNullable();
    t.jsonb('source');
    t.uuid('created_by').notNullable().references('id').inTable('users').onDelete('RESTRICT');
    t.timestamp('deleted_at', { useTz: true });
    TS(t, knex);
    t.index(['patient_id', 'occurred_at']);
  });

  await knex.schema.createTable('conditions', (t) => {
    ID(t, knex);
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.text('name').notNullable();
    t.text('name_key').notNullable();
    t.text('cid10');
    TS(t, knex);
    t.unique(['clinic_id', 'name_key']);
  });

  await knex.schema.createTable('patient_conditions', (t) => {
    t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
    t.uuid('condition_id')
      .notNullable()
      .references('id')
      .inTable('conditions')
      .onDelete('RESTRICT');
    t.date('noted_at');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.primary(['patient_id', 'condition_id']);
    t.index(['condition_id']);
  });

  const patients = await knex('patients').select('id', 'clinic_id', 'condition_tags');
  const byKey = new Map(); // `${clinic}|${key}` -> { id, name }
  for (const p of patients) {
    for (const raw of p.condition_tags ?? []) {
      const name = String(raw).trim();
      const key = catalogNameKey(name);
      if (!key) continue;
      const k = `${p.clinic_id}|${key}`;
      let entry = byKey.get(k);
      if (!entry) {
        const [row] = await knex('conditions')
          .insert({ clinic_id: p.clinic_id, name, name_key: key })
          .returning('id');
        entry = { id: row.id, name };
        byKey.set(k, entry);
      } else if (name === key && entry.name !== key) {
        // Duas grafias caem na mesma chave (ex.: "Ansiedade" e "ansiedade"). A ordem de leitura
        // dos pacientes não é garantida, então o desempate é determinístico: a grafia já
        // normalizada (sem acento, minúscula, sem espaços extras) vence como nome de exibição.
        await knex('conditions').where({ id: entry.id }).update({ name });
        entry.name = name;
      }
      await knex('patient_conditions')
        .insert({ patient_id: p.id, condition_id: entry.id })
        .onConflict(['patient_id', 'condition_id'])
        .ignore();
    }
  }

  await knex.schema.alterTable('patients', (t) => {
    t.dropColumn('condition_tags');
  });
}

export async function down(knex) {
  await knex.schema.alterTable('patients', (t) => {
    t.specificType('condition_tags', 'text[]').notNullable().defaultTo('{}');
  });
  await knex.raw(`
    update patients p set condition_tags = coalesce(
      (select array_agg(c.name order by c.name)
         from patient_conditions pc join conditions c on c.id = pc.condition_id
        where pc.patient_id = p.id),
      '{}')
  `);
  await knex.schema.dropTable('patient_conditions');
  await knex.schema.dropTable('conditions');
  await knex.schema.dropTable('clinical_notes');
}
