import { toDT } from '../time.js';
import { logger } from '../logger.js';

export const RETENTION_DEFAULTS = Object.freeze({
  notificationsDays: 90,
  sessionsDays: 30,
  authTokensDays: 7,
  accessAuditDays: 730,
});

/** Retenção mínima (docs/LGPD.md). Apaga só o que não é prontuário. */
export async function applyRetention(db, now, opts = {}) {
  const cfg = { ...RETENTION_DEFAULTS, ...opts };
  const nowDT = toDT(now);
  const before = (days) => nowDT.minus({ days }).toJSDate();
  const notifications = await db('notifications')
    .where('created_at', '<', before(cfg.notificationsDays))
    .del();
  const sessions = await db('sessions')
    .where((q) =>
      q
        .where('expires_at', '<', before(cfg.sessionsDays))
        .orWhere('revoked_at', '<', before(cfg.sessionsDays)),
    )
    .del();
  const auth_tokens = await db('auth_tokens')
    .where('created_at', '<', before(cfg.authTokensDays))
    .del();
  const access_audit = await db('access_audit').where('at', '<', before(cfg.accessAuditDays)).del();
  const out = { notifications, sessions, auth_tokens, access_audit, at: nowDT.toISO() };
  if (notifications || sessions || auth_tokens || access_audit)
    logger.info('retention.applied', out);
  return out;
}
