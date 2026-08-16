import { toDT } from '../time.js';
import { newToken, hashToken, AuthError } from './tokens.js';
import { createSession } from './session.js';
import { logger } from '../logger.js';

const TOKEN_MINUTES = 15;
const THROTTLE_MAX = 3;
const THROTTLE_WINDOW_MINUTES = 15;

export function normalizeEmail(email) {
  return String(email ?? '')
    .trim()
    .toLowerCase();
}

/**
 * Pede link mágico. Resposta sempre { ok: true } (sem enumeração de e-mail).
 * Só envia se o e-mail pertence a um usuário da clínica; throttle 3/15 min por e-mail.
 */
export async function requestMagicLink(db, { email, baseUrl, mailer }, now) {
  if (!mailer) throw new Error('requestMagicLink: mailer obrigatório');
  if (!baseUrl) throw new Error('requestMagicLink: baseUrl obrigatório');
  const nowDT = toDT(now);
  const normalized = normalizeEmail(email);
  if (!normalized || !normalized.includes('@')) return { ok: true };

  const user = await db('users').where({ email: normalized }).first();
  if (!user) {
    logger.warn('auth.magic_link.unknown_email', { email_domain: normalized.split('@')[1] });
    return { ok: true };
  }

  const [{ count }] = await db('auth_tokens')
    .where({ email: normalized })
    .andWhere('created_at', '>', nowDT.minus({ minutes: THROTTLE_WINDOW_MINUTES }).toJSDate())
    .count();
  if (Number(count) >= THROTTLE_MAX) {
    logger.warn('auth.magic_link.throttled', { user_id: user.id });
    return { ok: true };
  }

  const token = newToken();
  await db('auth_tokens').insert({
    kind: 'magic_link',
    email: normalized,
    user_id: user.id,
    token_hash: hashToken(token),
    expires_at: nowDT.plus({ minutes: TOKEN_MINUTES }).toJSDate(),
    created_at: nowDT.toJSDate(),
  });
  const link = `${String(baseUrl).replace(/\/$/, '')}/auth/verify?token=${token}`;
  await mailer.sendMail({
    to: normalized,
    subject: 'Seu acesso ao MedCheck-in',
    text: `Olá, ${user.name}.\n\nPara entrar, abra este link (válido por ${TOKEN_MINUTES} minutos):\n${link}\n\nSe não foi você, ignore este e-mail.`,
  });
  logger.info('auth.magic_link.sent', { user_id: user.id });
  return { ok: true };
}

/** Troca o token do link por uma sessão. Token é de uso único. */
export async function verifyMagicLink(db, { token, ua = null }, now) {
  const nowDT = toDT(now);
  const nowJs = nowDT.toJSDate();
  if (!token) throw new AuthError('invalid_token', 'Link inválido.');
  const updated = await db('auth_tokens')
    .where({ token_hash: hashToken(token) })
    .whereNull('used_at')
    .andWhere('expires_at', '>', nowJs)
    .update({ used_at: nowJs })
    .returning('*');
  const row = updated[0];
  if (!row) throw new AuthError('invalid_token', 'Link inválido ou expirado.');
  const user = await db('users').where({ id: row.user_id }).first();
  if (!user) throw new AuthError('invalid_token', 'Usuário não encontrado.');
  const out = await createSession(db, { userId: user.id, clinicId: user.clinic_id, ua }, now);
  logger.info('auth.login', { user_id: user.id, kind: 'user' });
  return out;
}
