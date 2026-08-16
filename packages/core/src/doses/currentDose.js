/**
 * Dose vigente (D3): último dose_event com effective_from <= data de referência.
 * Sem ajuste vigente → null (nunca 0 — L5).
 * @param {import('knex').Knex} db
 * @param {string} medicationId
 * @param {Date} at momento de referência (default: agora)
 */
export async function currentDose(db, medicationId, at = new Date()) {
  const day = at.toISOString().slice(0, 10);
  const row = await db('dose_events')
    .where({ medication_id: medicationId })
    .andWhere('effective_from', '<=', day)
    .orderBy('effective_from', 'desc')
    .first();
  return row ?? null;
}
