import { randomUUID } from 'node:crypto';
import { toDT } from '../time.js';
import { AuthError } from '../auth/tokens.js';
import { enqueueAndSend } from '../checkin/engine.js';
import { logger } from '../logger.js';

/**
 * E9.3 — primeiro acesso guiado. Tudo que o wizard e a página da médica mostram como ✓ sai
 * daqui, e cada ✓ tem uma data gravada por um evento real:
 * - teste de aviso "enviado" = `notifications.sent_at` (o push service aceitou);
 * - "confirmado" = a própria pessoa respondeu "chegou" DEPOIS do envio.
 *
 * O teste não é enviado pelo web: vai para a fila e o scheduler envia (a chave privada VAPID
 * continua só no scheduler). O wizard acompanha o status até `sent` ou `failed`.
 */

/** Teste mais velho que isto não é enviado atrasado — a pessoa já saiu da tela. */
export const PUSH_TEST_MAX_AGE_MIN = 10;

const TEST_PAYLOAD = {
  title: 'Teste do MedCheck-in',
  body: 'Se você está lendo isto, os avisos estão funcionando. Volte ao app e toque em "Chegou".',
  url: '/p/hoje',
};

function requireRespondent(session) {
  if (!session || session.kind !== 'respondent')
    throw new AuthError('unauthenticated', 'Sessão do respondente necessária.');
}

async function activeSubscriptions(db, respondentId) {
  const [{ count }] = await db('push_subscriptions')
    .where({ respondent_id: respondentId })
    .whereNull('revoked_at')
    .count();
  return Number(count);
}

/** Enfileira um teste de aviso. Se já há um esperando envio, devolve o mesmo (sem duplicar). */
export async function requestPushTest(db, session, now) {
  requireRespondent(session);
  if (!(await activeSubscriptions(db, session.respondentId)))
    throw new AuthError(
      'no_subscription',
      'Os avisos ainda não estão ativados neste celular. Ative antes de testar.',
    );
  const nowDT = toDT(now);
  const waiting = await db('notifications')
    .where({ respondent_id: session.respondentId, kind: 'test' })
    .whereNull('sent_at')
    .whereNull('failed_at')
    .andWhere('scheduled_at', '>=', nowDT.minus({ minutes: PUSH_TEST_MAX_AGE_MIN }).toJSDate())
    .orderBy('scheduled_at', 'desc')
    .first();
  if (waiting) return { notificationId: waiting.id };

  const [n] = await db('notifications')
    .insert({
      respondent_id: session.respondentId,
      patient_id: session.patientId,
      kind: 'test',
      payload: JSON.stringify(TEST_PAYLOAD),
      scheduled_at: nowDT.toJSDate(),
      dedup_key: `test:${session.respondentId}:${randomUUID()}`,
      // o scheduler passa por enqueueAndSend, que soma 1 ao reencontrar a linha: 0 + 1 = 1ª tentativa
      attempts: 0,
    })
    .returning('id');
  logger.info('onboarding.push_test.requested', {
    respondent_id: session.respondentId,
    notification_id: n.id,
  });
  return { notificationId: n.id };
}

/** Ciclo do scheduler: envia os testes pendentes; os velhos demais viram `failed` contados. */
export async function dispatchPushTests(db, now, { notifier } = {}) {
  if (!notifier) throw new Error('dispatchPushTests: notifier obrigatório');
  const nowDT = toDT(now);
  const cutoff = nowDT.minus({ minutes: PUSH_TEST_MAX_AGE_MIN }).toJSDate();
  const out = { due: 0, sent: 0, failed: 0, duplicate: 0, expired: 0 };

  out.expired = await db('notifications')
    .where({ kind: 'test' })
    .whereNull('sent_at')
    .whereNull('failed_at')
    .andWhere('scheduled_at', '<', cutoff)
    .update({ failed_at: nowDT.toJSDate(), error: 'expirou antes do envio (scheduler parado?)' });

  const pending = await db('notifications')
    .where({ kind: 'test' })
    .whereNull('sent_at')
    .whereNull('failed_at')
    .andWhere('scheduled_at', '<=', nowDT.toJSDate())
    .orderBy('scheduled_at');
  for (const n of pending) {
    out.due += 1;
    const r = await enqueueAndSend(db, notifier, {
      respondent_id: n.respondent_id,
      patient_id: n.patient_id,
      kind: 'test',
      payload: typeof n.payload === 'string' ? JSON.parse(n.payload) : n.payload,
      scheduled_at: n.scheduled_at,
      dedup_key: n.dedup_key,
    });
    out[r.status] += 1;
  }
  if (out.due || out.expired) logger.info('onboarding.push_test.dispatch', out);
  return out;
}

async function ownTest(db, session, notificationId) {
  requireRespondent(session);
  const n = await db('notifications')
    .where({ id: notificationId, kind: 'test', respondent_id: session.respondentId })
    .first();
  if (!n) throw new AuthError('not_found', 'Teste não encontrado.');
  return n;
}

export async function pushTestStatus(db, session, notificationId) {
  const n = await ownTest(db, session, notificationId);
  if (n.sent_at) return { status: 'sent', sent_at: n.sent_at };
  if (n.failed_at) return { status: 'failed', error: n.error };
  return { status: 'waiting' };
}

/** "Chegou?" — só vale para teste enviado; "não" não grava nada (o wizard mostra o conserto). */
export async function confirmPushTest(db, session, { notificationId, arrived }, now) {
  const n = await ownTest(db, session, notificationId);
  if (!n.sent_at)
    throw new AuthError('not_sent', 'Este teste ainda não foi enviado; não há o que confirmar.');
  if (arrived !== true) {
    logger.warn('onboarding.push_test.not_arrived', {
      respondent_id: session.respondentId,
      notification_id: n.id,
    });
    return { confirmed: false };
  }
  await db('respondents')
    .where({ id: session.respondentId })
    .update({ push_test_confirmed_at: toDT(now).toJSDate(), updated_at: db.fn.now() });
  logger.info('onboarding.push_test.confirmed', {
    respondent_id: session.respondentId,
    notification_id: n.id,
  });
  return { confirmed: true };
}

/** O app abriu em modo instalado. Guarda a primeira vez. */
export async function markInstalled(db, session, now) {
  requireRespondent(session);
  await db('respondents')
    .where({ id: session.respondentId })
    .whereNull('install_confirmed_at')
    .update({ install_confirmed_at: toDT(now).toJSDate(), updated_at: db.fn.now() });
  return { ok: true };
}

/**
 * Estado de configuração de um respondente, derivado só do banco.
 * `shared`: não responde nem recebe alarme — usa o celular de outra pessoa da casa (D29).
 * `complete` exige inscrição ATIVA hoje: teste confirmado de um aparelho que foi revogado não conta.
 */
export function setupStatus(respondent, activeSubscriptionCount) {
  const device = !respondent.can_answer && !respondent.receives_alarms ? 'shared' : 'own';
  const accepted = !!respondent.accepted_at;
  const installed = !!respondent.install_confirmed_at;
  const push_active = Number(activeSubscriptionCount) > 0;
  const test_confirmed = !!respondent.push_test_confirmed_at;
  return {
    device,
    accepted,
    installed,
    push_active,
    test_confirmed,
    complete: device === 'own' && accepted && push_active && test_confirmed,
  };
}

/** Contagem de inscrições ativas por respondente (uma consulta). */
export async function activeSubscriptionCounts(db, respondentIds) {
  if (!respondentIds.length) return new Map();
  const rows = await db('push_subscriptions')
    .whereIn('respondent_id', respondentIds)
    .whereNull('revoked_at')
    .groupBy('respondent_id')
    .select('respondent_id')
    .count('* as n');
  return new Map(rows.map((r) => [r.respondent_id, Number(r.n)]));
}
