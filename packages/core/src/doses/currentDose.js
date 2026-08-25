import { localDate } from '../time.js';

/**
 * Dose vigente (D3): último dose_event com effective_from <= dia de referência.
 * Sem ajuste vigente → null (nunca 0 — L5).
 * O corte do dia é o DIA LOCAL do paciente (auditoria 2026-08-25, P0-1): com o dia UTC, um
 * ajuste agendado para amanhã já aparecia como vigente às 21:00 locais (Cuiabá é UTC-4).
 * @param {import('knex').Knex} db
 * @param {string} medicationId
 * @param {Date} at momento de referência (default: agora)
 * @param {string|null} timezone fuso do paciente (ex.: 'America/Cuiaba'); null → UTC
 */
export async function currentDose(db, medicationId, at = new Date(), timezone = null) {
  const day = localDate(at, timezone);
  const row = await db('dose_events')
    .where({ medication_id: medicationId })
    .andWhere('effective_from', '<=', day)
    .orderBy('effective_from', 'desc')
    .first();
  return row ?? null;
}
