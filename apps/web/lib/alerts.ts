import { AuthError, logAccess } from '@medcheckin/core';
import type { Knex } from 'knex';
import type { UserSession } from './auth';

/** Alerta da clínica da sessão ou 404 (nunca 403). Audita a ação. */
export async function alertInClinic(
  db: Knex,
  session: UserSession,
  alertId: string,
  action: string,
) {
  const a = await db('alerts as a')
    .join('patients as p', 'p.id', 'a.patient_id')
    .where('a.id', alertId)
    .andWhere('p.clinic_id', session.clinicId)
    .select('a.id', 'a.patient_id')
    .first();
  if (!a) throw new AuthError('not_found', 'Alerta não encontrado.');
  await logAccess(
    db,
    { session, patientId: a.patient_id, route: `alerts.${action}`, action: 'update' },
    new Date(),
  );
  return a;
}
