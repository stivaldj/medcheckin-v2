import { toDT } from '../time.js';
import { inQuietHours, shiftOutOfQuietHours, toHm } from '../scheduler/next-run.js';
import { evaluateThreshold } from '../alerts/rules.js';
import { computeDailyScore } from '../scoring/computeDailyScore.js';
import { evaluatePatientAlerts } from '../alerts/evaluate.js';
import { logger } from '../logger.js';
import { questionsForPatient } from '../questions/patientQuestions.js';

const RETRY_MINUTES = 60;
const FAIL_RETRY_MINUTES = 15;
const PAUSED_DEFER_MINUTES = 60;

export class EngineError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/* ------------------------------------------------------------------------ */
/* Notificações: enfileirar + enviar; a verdade fica em notifications        */
/* ------------------------------------------------------------------------ */

/**
 * Enfileira (idempotente por dedup_key) e envia. Se já existe uma notificação com a mesma
 * chave que FALHOU, reabre e tenta de novo; se já foi enviada, não faz nada.
 * @returns {{status:'sent'|'failed'|'duplicate', notification?:object}}
 */
export async function enqueueAndSend(db, notifier, row) {
  const [n] = await db('notifications')
    .insert({ ...row, payload: JSON.stringify(row.payload ?? {}) })
    .onConflict('dedup_key')
    // reenvio após falha: mantém o último erro e conta a tentativa (observabilidade), limpa failed_at
    .merge({ failed_at: null, attempts: db.raw('notifications.attempts + 1') })
    .where('notifications.sent_at', null)
    .returning('*');
  if (!n) return { status: 'duplicate' };

  let result;
  try {
    result = await notifier.send(n);
  } catch (err) {
    result = { ok: false, error: `notifier threw: ${err?.message || err}` };
  }
  if (result?.ok) {
    await db('notifications').where({ id: n.id }).update({ sent_at: db.fn.now() });
    return { status: 'sent', notification: n };
  }
  const error = String(result?.error || 'unknown').slice(0, 500);
  await db('notifications').where({ id: n.id }).update({ failed_at: db.fn.now(), error });
  logger.warn('notification.failed', { notification_id: n.id, kind: n.kind, error });
  return { status: 'failed', notification: n, error };
}

/* ------------------------------------------------------------------------ */
/* Dispatch                                                                  */
/* ------------------------------------------------------------------------ */

async function respondentsWhoCanAnswer(db, patientId) {
  return db('respondents')
    .where({ patient_id: patientId, can_answer: true })
    .whereNotNull('accepted_at')
    .select('id', 'kind', 'name');
}

/**
 * Envia (ou reenvia) check-ins vencidos. L2: o check-in só avança se pelo menos uma
 * notificação foi de fato aceita pelo notifier.
 */
export async function dispatchDueCheckins(db, now, { notifier }) {
  if (!notifier) throw new EngineError('no_notifier', 'dispatchDueCheckins: notifier obrigatório');
  const nowDT = toDT(now);
  const nowJs = nowDT.toJSDate();
  const due = await db('checkins as c')
    .join('patients as p', 'p.id', 'c.patient_id')
    .whereIn('c.status', ['pending', 'sent'])
    .whereNotNull('c.next_attempt_at')
    .andWhere('c.next_attempt_at', '<=', nowJs)
    .orderBy('c.next_attempt_at')
    .select(
      'c.*',
      'p.status as patient_status',
      'p.timezone',
      'p.quiet_start',
      'p.quiet_end',
      'p.name as patient_name',
    );

  const out = {
    due: due.length,
    sent: 0,
    failed: 0,
    deferred: 0,
    skipped_no_respondent: 0,
    exhausted: 0,
  };

  for (const ck of due) {
    const setNext = (dt) =>
      db('checkins').where({ id: ck.id }).update({ next_attempt_at: dt, updated_at: db.fn.now() });

    if (ck.patient_status !== 'active') {
      await setNext(nowDT.plus({ minutes: PAUSED_DEFER_MINUTES }).toJSDate());
      out.deferred += 1;
      continue;
    }
    const localNow = nowDT.setZone(ck.timezone || 'UTC');
    const qs = toHm(ck.quiet_start);
    const qe = toHm(ck.quiet_end);
    if (inQuietHours(localNow, qs, qe)) {
      await setNext(shiftOutOfQuietHours(localNow, qs, qe).toUTC().toJSDate());
      out.deferred += 1;
      continue;
    }
    if (ck.attempt_count >= ck.max_attempts) {
      await setNext(null);
      out.exhausted += 1;
      continue;
    }

    const respondents = await respondentsWhoCanAnswer(db, ck.patient_id);
    if (!respondents.length) {
      logger.warn('checkin.no_respondent', { checkin_id: ck.id, patient_id: ck.patient_id });
      out.skipped_no_respondent += 1;
      continue;
    }

    const attempt = ck.attempt_count + 1;
    const nextQuestion = await getNextQuestion(db, ck.id);
    let anySent = false;
    let anyFailed = false;
    for (const r of respondents) {
      const res = await enqueueAndSend(db, notifier, {
        patient_id: ck.patient_id,
        respondent_id: r.id,
        kind: 'checkin',
        payload: {
          checkin_id: ck.id,
          attempt,
          title: 'Check-in do dia',
          body: nextQuestion ? nextQuestion.label : 'Seu check-in está disponível.',
        },
        scheduled_at: nowJs,
        dedup_key: `checkin:${ck.id}:${r.id}:${attempt}`,
      });
      if (res.status === 'sent') anySent = true;
      else if (res.status === 'failed') anyFailed = true;
    }

    if (anySent) {
      const hasMore = attempt < ck.max_attempts;
      await db('checkins')
        .where({ id: ck.id })
        .update({
          status: ck.status === 'pending' ? 'sent' : ck.status,
          attempt_count: attempt,
          sent_at: ck.sent_at ?? nowJs,
          next_attempt_at: hasMore ? nowDT.plus({ minutes: RETRY_MINUTES }).toJSDate() : null,
          updated_at: db.fn.now(),
        });
      out.sent += 1;
    } else if (anyFailed) {
      // Nada foi entregue: check-in intocado (status/attempt/sent_at). Só adia a nova tentativa.
      await setNext(nowDT.plus({ minutes: FAIL_RETRY_MINUTES }).toJSDate());
      out.failed += 1;
    } else {
      // Só duplicatas (todas já enviadas nesta tentativa): estado já refletia isso.
      out.deferred += 1;
    }
  }
  return out;
}

/* ------------------------------------------------------------------------ */
/* Perguntas, condições, valores                                             */
/* ------------------------------------------------------------------------ */

/** Pack do episódio + extras do paciente válidas para ESTE check-in (E9.2). */
async function loadQuestions(db, checkin) {
  const ep = await db('episodes').where({ id: checkin.episode_id }).first();
  return questionsForPatient(db, {
    patientId: checkin.patient_id,
    questionSetId: ep.question_set_id,
    at: checkin.scheduled_for,
  });
}

async function loadAnswerMap(db, checkinId) {
  const rows = await db('answers as a')
    .join('questions as q', 'q.id', 'a.question_id')
    .where('a.checkin_id', checkinId)
    .select('q.key', 'a.value_num', 'a.value_text', 'a.value_choice', 'a.skipped');
  const map = new Map();
  for (const r of rows) {
    map.set(r.key, {
      value: r.skipped ? null : (r.value_num ?? r.value_choice ?? r.value_text),
      skipped: r.skipped,
    });
  }
  return map;
}

/** Condição {when, op, value}: satisfeita só se a pergunta referenciada foi respondida e bate. */
export function conditionSatisfied(condition, answerMap) {
  if (!condition || typeof condition !== 'object' || !condition.when) return true;
  const ref = answerMap.get(condition.when);
  if (!ref || ref.skipped) return false;
  return evaluateThreshold({ op: condition.op, value: condition.value }, ref.value);
}

function normalizeValue(question, value) {
  const empty = value === null || value === undefined || value === '';
  if (empty) {
    if (question.required)
      throw new EngineError('required', `Pergunta "${question.key}" é obrigatória.`);
    return { skipped: true };
  }
  switch (question.kind) {
    case 'scale_0_10': {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 0 || n > 10) {
        throw new EngineError(
          'invalid_value',
          `Valor inválido para "${question.key}": use um número inteiro de 0 a 10.`,
        );
      }
      return { value_num: n };
    }
    case 'yes_no': {
      const v =
        value === true || value === 1 || value === '1'
          ? 1
          : value === false || value === 0 || value === '0'
            ? 0
            : null;
      if (v === null)
        throw new EngineError(
          'invalid_value',
          `Valor inválido para "${question.key}": use sim (1) ou não (0).`,
        );
      return { value_num: v };
    }
    case 'number': {
      const n = Number(value);
      if (typeof value === 'boolean' || !Number.isFinite(n)) {
        throw new EngineError(
          'invalid_value',
          `Valor inválido para "${question.key}": use um número.`,
        );
      }
      return { value_num: n };
    }
    case 'choice': {
      const options = Array.isArray(question.options) ? question.options.map(String) : [];
      const s = String(value);
      if (!options.includes(s)) {
        throw new EngineError(
          'invalid_value',
          `Opção inválida para "${question.key}": escolha uma de ${options.join(', ')}.`,
        );
      }
      return { value_choice: s };
    }
    case 'text': {
      const s = String(value).trim();
      if (!s) {
        if (question.required)
          throw new EngineError('required', `Pergunta "${question.key}" é obrigatória.`);
        return { skipped: true };
      }
      return { value_text: s.slice(0, 2000) };
    }
    default:
      throw new EngineError('invalid_kind', `Tipo de pergunta desconhecido: ${question.kind}`);
  }
}

/** Próxima pergunta não respondida cuja condição está satisfeita; null = fim. */
export async function getNextQuestion(db, checkinId) {
  const checkin = await db('checkins').where({ id: checkinId }).first();
  if (!checkin) return null;
  const questions = await loadQuestions(db, checkin);
  const answers = await loadAnswerMap(db, checkinId);
  for (const q of questions) {
    if (answers.has(q.key)) continue;
    if (!conditionSatisfied(q.condition_json, answers)) continue;
    return q;
  }
  return null;
}

/* ------------------------------------------------------------------------ */
/* recordAnswer / completeCheckin                                            */
/* ------------------------------------------------------------------------ */

/**
 * Entrada ESTRUTURADA (D2): sem parser de texto.
 * @returns {{answer:object, next:object|null, completed:boolean}}
 */
export async function recordAnswer(db, { checkinId, respondentId, questionKey, value }, now) {
  const nowJs = toDT(now).toJSDate();
  const checkin = await db('checkins').where({ id: checkinId }).first();
  if (!checkin) throw new EngineError('not_found', 'Check-in não encontrado.');
  if (checkin.status === 'completed' || checkin.status === 'missed') {
    throw new EngineError(
      'closed',
      `Check-in encerrado (${checkin.status}); não aceita respostas.`,
    );
  }

  const respondent = await db('respondents')
    .where({ id: respondentId, patient_id: checkin.patient_id, can_answer: true })
    .whereNotNull('accepted_at')
    .first();
  if (!respondent) {
    throw new EngineError('forbidden', 'Respondente não autorizado a responder por este paciente.');
  }

  const questions = await loadQuestions(db, checkin);
  const question = questions.find((q) => q.key === questionKey);
  if (!question) throw new EngineError('unknown_question', `Pergunta desconhecida: ${questionKey}`);

  const answers = await loadAnswerMap(db, checkinId);
  if (!conditionSatisfied(question.condition_json, answers)) {
    throw new EngineError(
      'condition',
      `Pergunta "${questionKey}" depende de uma condição ainda não satisfeita.`,
    );
  }

  const v = normalizeValue(question, value);
  const row = {
    checkin_id: checkinId,
    question_id: question.id,
    respondent_id: respondentId,
    value_num: v.value_num ?? null,
    value_text: v.value_text ?? null,
    value_choice: v.value_choice ?? null,
    skipped: !!v.skipped,
    answered_at: nowJs,
  };
  const [answer] = await db('answers')
    .insert(row)
    .onConflict(['checkin_id', 'question_id'])
    .merge()
    .returning('*');

  if (checkin.status !== 'in_progress') {
    await db('checkins')
      .where({ id: checkinId })
      .update({ status: 'in_progress', updated_at: db.fn.now() });
  }

  const next = await getNextQuestion(db, checkinId);
  if (next) return { answer, next, completed: false };
  await completeCheckin(db, checkinId, now);
  return { answer, next: null, completed: true };
}

/** Idempotente. Fecha o check-in, calcula score do dia e avalia alertas do paciente. */
export async function completeCheckin(db, checkinId, now) {
  const nowJs = toDT(now).toJSDate();
  const checkin = await db('checkins').where({ id: checkinId }).first();
  if (!checkin) throw new EngineError('not_found', 'Check-in não encontrado.');
  if (checkin.status === 'completed') return { already: true };
  await db('checkins').where({ id: checkinId }).update({
    status: 'completed',
    completed_at: nowJs,
    next_attempt_at: null,
    updated_at: db.fn.now(),
  });
  const score = await computeDailyScore(db, checkinId);
  const alerts = await evaluatePatientAlerts(db, checkin.patient_id, now);
  logger.info('checkin.completed', {
    checkin_id: checkinId,
    patient_id: checkin.patient_id,
    score: score?.score ?? null,
  });
  return { already: false, score, alerts };
}
