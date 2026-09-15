import { productNameKey } from '../medications/nameKey.js';

/**
 * D34 — produto identificado na clínica por `name_key` (nome normalizado), com índice único.
 *
 * Antes, `products` só nascia pelo seed ou por uma rota que nenhuma tela chamava, e a médica
 * ficava com um select vazio. Agora ela digita o nome; o backend acha ou cria. Para "achar"
 * ser confiável (inclusive com o agente da E12 escrevendo o mesmo produto de dez jeitos, e com
 * duas requisições em paralelo), a chave vive no banco com unique por clínica.
 *
 * Backfill em JS com a MESMA função do runtime — sem `unaccent`, para a chave ser idêntica
 * nos dois lugares. Colisão no backfill = falha nomeando os ids: só existem produtos de seed
 * hoje, e fundir dados às cegas seria pior do que parar.
 */
export async function up(knex) {
  await knex.schema.alterTable('products', (t) => {
    t.text('name_key');
  });

  const rows = await knex('products').select('id', 'clinic_id', 'name');
  const vistos = new Map(); // `${clinic_id}|${key}` -> id
  for (const r of rows) {
    const key = productNameKey(r.name);
    const k = `${r.clinic_id}|${key}`;
    if (vistos.has(k)) {
      throw new Error(
        `migration 012: produtos ${vistos.get(k)} e ${r.id} da clínica ${r.clinic_id} têm a ` +
          `mesma chave "${key}". Renomeie ou funda um deles antes de migrar.`,
      );
    }
    vistos.set(k, r.id);
    await knex('products').where({ id: r.id }).update({ name_key: key });
  }

  await knex.schema.alterTable('products', (t) => {
    t.text('name_key').notNullable().alter();
    t.unique(['clinic_id', 'name_key']);
  });
}

export async function down(knex) {
  await knex.schema.alterTable('products', (t) => {
    t.dropUnique(['clinic_id', 'name_key']);
    t.dropColumn('name_key');
  });
}
