import { toDT } from '../time.js';
import { newToken, hashToken } from './tokens.js';

const TOUCH_EVERY_MINUTES = 5;
export const SESSION_DAYS = { user: 30, respondent: 180 };

/** Cria sessão para um principal. Devolve o token em claro (uma vez) e a sessão resolvida. */
export async function createSession(
  db,
  { userId = null, respondentId = null, clinicId, ua = null },
  now,
) {
  if (!!userId === !!respondentId) throw new Error('createSession: exatamente um principal.');
  const nowDT = toDT(now);
  const token = newToken();
  const days = userId ? SESSION_DAYS.user : SESSION_DAYS.respondent;
  await db('sessions').insert({
    token_hash: hashToken(token),
    user_id: userId,
    respondent_id: respondentId,
    clinic_id: clinicId,
    expires_at: nowDT.plus({ days }).toJSDate(),
    last_seen_at: nowDT.toJSDate(),
    ua: ua ? String(ua).slice(0, 300) : null,
    created_at: nowDT.toJSDate(),
  });
  const session = await getSession(db, token, now);
  return { sessionToken: token, session };
}

/**
 * Resolve o token do cookie → sessão com principal, ou null (inexistente/expirada/revogada).
 * Atualiza last_seen_at no máximo 1×/5 min.
 */
export async function getSession(db, sessionToken, now) {
  if (!sessionToken) return null;
  const nowDT = toDT(now);
  const nowJs = nowDT.toJSDate();
  const s = await db('sessions')
    .where({ token_hash: hashToken(sessionToken) })
    .first();
  if (!s || s.revoked_at || new Date(s.expires_at) <= nowJs) return null;

  const lastSeen = s.last_seen_at ? toDT(new Date(s.last_seen_at)) : null;
  if (!lastSeen || nowDT.diff(lastSeen, 'minutes').minutes >= TOUCH_EVERY_MINUTES) {
    await db('sessions').where({ id: s.id }).update({ last_seen_at: nowJs });
  }

  if (s.user_id) {
    const u = await db('users').where({ id: s.user_id }).first();
    if (!u) return null;
    return {
      kind: 'user',
      sessionId: s.id,
      userId: u.id,
      clinicId: u.clinic_id,
      role: u.role,
      name: u.name,
      email: u.email,
    };
  }
  const r = await db('respondents as r')
    .join('patients as p', 'p.id', 'r.patient_id')
    .where('r.id', s.respondent_id)
    .select(
      'r.id',
      'r.name',
      'r.kind as respondent_kind',
      'r.patient_id',
      'r.can_answer',
      'r.receives_alarms',
      'p.clinic_id',
    )
    .first();
  if (!r) return null;
  return {
    kind: 'respondent',
    sessionId: s.id,
    respondentId: r.id,
    respondentKind: r.respondent_kind,
    patientId: r.patient_id,
    clinicId: r.clinic_id,
    name: r.name,
    canAnswer: r.can_answer,
    receivesAlarms: r.receives_alarms,
  };
}

export async function revokeSession(db, sessionToken, now) {
  return db('sessions')
    .where({ token_hash: hashToken(sessionToken) })
    .whereNull('revoked_at')
    .update({ revoked_at: toDT(now).toJSDate() });
}

export async function revokeAllForPrincipal(db, { userId = null, respondentId = null }, now) {
  const q = db('sessions').whereNull('revoked_at');
  if (userId) q.where({ user_id: userId });
  else if (respondentId) q.where({ respondent_id: respondentId });
  else throw new Error('revokeAllForPrincipal: principal obrigatório');
  return q.update({ revoked_at: toDT(now).toJSDate() });
}
