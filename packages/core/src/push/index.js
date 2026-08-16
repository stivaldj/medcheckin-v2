import webpush from 'web-push';
import { AuthError } from '../auth/tokens.js';
import { logger } from '../logger.js';

const GONE = new Set([404, 410]);

/**
 * Notifier Web Push (VAPID). Fail-closed sem chaves. Envia a todas as inscrições ativas do
 * respondente; ≥1 aceita → ok. 404/410 → inscrição revogada.
 */
export function createWebPushNotifier({ vapidPublicKey, vapidPrivateKey, subject }, db) {
  if (!vapidPublicKey || !vapidPrivateKey || !subject) {
    throw new Error(
      'VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY e VAPID_SUBJECT são obrigatórios para Web Push.',
    );
  }
  if (!db) throw new Error('createWebPushNotifier: db obrigatório');
  const details = { subject, publicKey: vapidPublicKey, privateKey: vapidPrivateKey };

  return {
    kind: 'webpush',
    async send(notification) {
      const subs = await db('push_subscriptions')
        .where({ respondent_id: notification.respondent_id })
        .whereNull('revoked_at');
      if (!subs.length) return { ok: false, error: 'no_subscription' };
      const payload = JSON.stringify({
        kind: notification.kind,
        notification_id: notification.id,
        url: '/p/hoje',
        ...(typeof notification.payload === 'string'
          ? JSON.parse(notification.payload)
          : notification.payload || {}),
      });
      let okCount = 0;
      const errors = [];
      for (const s of subs) {
        const subscription = {
          endpoint: s.endpoint,
          keys: typeof s.keys === 'string' ? JSON.parse(s.keys) : s.keys,
        };
        try {
          // generateRequestDetails + fetch: mesmo payload cifrado (aes128gcm) e header VAPID do
          // web-push, mas sem forçar https (permite push service local nos testes) e com status legível.
          const req = webpush.generateRequestDetails(subscription, payload, {
            vapidDetails: details,
            TTL: 60 * 60 * 12,
            urgency: 'high',
          });
          const res = await fetch(req.endpoint, {
            method: req.method,
            headers: req.headers,
            body: req.body,
          });
          if (res.status >= 200 && res.status < 300) {
            okCount += 1;
          } else {
            const body = (await res.text().catch(() => '')).slice(0, 80);
            errors.push(`${res.status}:${body}`);
            if (GONE.has(res.status)) {
              await db('push_subscriptions')
                .where({ id: s.id })
                .update({ revoked_at: db.fn.now() });
              logger.warn('push.subscription_gone', { subscription_id: s.id, status: res.status });
            }
          }
        } catch (err) {
          errors.push(`ERR:${String(err?.message || err).slice(0, 80)}`);
        }
      }
      if (okCount > 0) return { ok: true, delivered: okCount, failed: errors.length };
      return { ok: false, error: `push_failed: ${errors.join(' | ')}` };
    },
  };
}

function requireRespondent(session) {
  if (!session || session.kind !== 'respondent')
    throw new AuthError('unauthenticated', 'Sessão do respondente necessária.');
}

/** Upsert por endpoint (reativa se estava revogada). */
export async function savePushSubscription(db, session, { endpoint, keys, ua = null }) {
  requireRespondent(session);
  if (!endpoint || !/^https?:\/\//.test(String(endpoint)))
    throw new AuthError('validation', 'endpoint inválido');
  if (!keys || !keys.p256dh || !keys.auth)
    throw new AuthError('validation', 'keys (p256dh, auth) obrigatórias');
  const [row] = await db('push_subscriptions')
    .insert({
      respondent_id: session.respondentId,
      endpoint: String(endpoint),
      keys: JSON.stringify({ p256dh: keys.p256dh, auth: keys.auth }),
      ua: ua ? String(ua).slice(0, 300) : null,
    })
    .onConflict('endpoint')
    .merge({
      respondent_id: session.respondentId,
      keys: JSON.stringify({ p256dh: keys.p256dh, auth: keys.auth }),
      ua: ua ? String(ua).slice(0, 300) : null,
      revoked_at: null,
    })
    .returning('*');
  logger.info('push.subscribed', { respondent_id: session.respondentId, subscription_id: row.id });
  return row;
}

export async function removePushSubscription(db, session, { endpoint }) {
  requireRespondent(session);
  return db('push_subscriptions')
    .where({ respondent_id: session.respondentId, endpoint: String(endpoint) })
    .del();
}
