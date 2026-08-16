import { toDT } from '../time.js';
import { AuthError } from './tokens.js';

/**
 * Tenancy: devolve o paciente se a sessão pode vê-lo; senão `not_found` (404) — nunca 403,
 * para não revelar existência cross-clinic. Respondente só vê o próprio paciente.
 */
export async function requirePatientInClinic(db, session, patientId) {
  if (!session) throw new AuthError('unauthenticated', 'Sessão necessária.');
  if (!patientId) throw new AuthError('not_found', 'Paciente não encontrado.');
  if (session.kind === 'respondent' && session.patientId !== patientId) {
    throw new AuthError('not_found', 'Paciente não encontrado.');
  }
  const p = await db('patients').where({ id: patientId, clinic_id: session.clinicId }).first();
  if (!p) throw new AuthError('not_found', 'Paciente não encontrado.');
  return p;
}

/** Audit de acesso a prontuário (L16). */
export async function logAccess(db, { session, patientId = null, route, action = 'view' }, now) {
  if (!session) throw new Error('logAccess: sessão obrigatória');
  const [row] = await db('access_audit')
    .insert({
      clinic_id: session.clinicId,
      user_id: session.kind === 'user' ? session.userId : null,
      respondent_id: session.kind === 'respondent' ? session.respondentId : null,
      patient_id: patientId,
      route: String(route).slice(0, 200),
      action: String(action).slice(0, 40),
      at: toDT(now).toJSDate(),
    })
    .returning('*');
  return row;
}
