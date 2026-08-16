import { toDT } from '../time.js';
import { newToken, AuthError } from './tokens.js';
import { createSession } from './session.js';
import { logger } from '../logger.js';

/**
 * D12: respondente entra pelo link de convite (token). No primeiro aceite exige consentimento e
 * grava accepted_at/consent_*; reusos criam nova sessão (outro dispositivo) sem alterar consentimento.
 */
export async function acceptInvite(db, { inviteToken, consentVersion = null, ua = null }, now) {
  if (!inviteToken) throw new AuthError('invalid_token', 'Convite inválido.');
  const nowJs = toDT(now).toJSDate();
  const r = await db('respondents as r')
    .join('patients as p', 'p.id', 'r.patient_id')
    .where('r.invite_token', String(inviteToken))
    .select('r.*', 'p.clinic_id', 'p.status as patient_status')
    .first();
  if (!r) throw new AuthError('invalid_token', 'Convite inválido.');
  if (r.patient_status === 'discharged') throw new AuthError('invalid_token', 'Convite encerrado.');

  if (!r.accepted_at) {
    const v = String(consentVersion ?? '').trim();
    if (!v)
      throw new AuthError(
        'consent_required',
        'É preciso aceitar o termo de consentimento para continuar.',
      );
    await db('respondents').where({ id: r.id }).update({
      accepted_at: nowJs,
      consent_version: v,
      consent_at: nowJs,
      updated_at: db.fn.now(),
    });
    logger.info('auth.invite.accepted', {
      respondent_id: r.id,
      patient_id: r.patient_id,
      consent_version: v,
    });
  }
  const out = await createSession(db, { respondentId: r.id, clinicId: r.clinic_id, ua }, now);
  logger.info('auth.login', { respondent_id: r.id, kind: 'respondent' });
  return out;
}

/** Gera novo invite_token (invalida o link antigo). Devolve o token novo em claro. */
export async function rotateInviteToken(db, respondentId) {
  const token = newToken();
  const n = await db('respondents')
    .where({ id: respondentId })
    .update({ invite_token: token, updated_at: db.fn.now() });
  if (!n) throw new AuthError('not_found', 'Respondente não encontrado.');
  return token;
}
