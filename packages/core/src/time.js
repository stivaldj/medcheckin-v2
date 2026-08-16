import { DateTime } from 'luxon';

/** Normaliza Date | ISO string | DateTime → DateTime UTC. */
export function toDT(value) {
  if (value == null) return DateTime.utc();
  if (DateTime.isDateTime(value)) return value.toUTC();
  if (value instanceof Date) return DateTime.fromJSDate(value, { zone: 'utc' });
  const dt = DateTime.fromISO(String(value), { zone: 'utc' });
  if (!dt.isValid) throw new Error(`toDT: instante inválido: ${value}`);
  return dt;
}

/** Data local (YYYY-MM-DD) de um instante num fuso. */
export function localDate(value, timezone) {
  return toDT(value)
    .setZone(timezone || 'UTC')
    .toISODate();
}
