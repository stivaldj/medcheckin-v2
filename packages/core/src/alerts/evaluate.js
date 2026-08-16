import { DateTime } from 'luxon';
import { toDT } from '../time.js';
import { detectScoreRules, evaluateThreshold } from './rules.js';
import { logger } from '../logger.js';

const NO_RESPONSE_HOURS = 48;
const DELIVERY_FAILED_MIN = 3;
/** Só alertas operacionais se resolvem sozinhos; clínicos exigem conduta (L15). */
const AUTO_RESOLVE = new Set(['no_response', 'delivery_failed']);

/* ---- coleta de gatilhos --------------------------------------------------- */

async function thresholdTriggers(db, patientId) {
  const last = await db('checkins')
    .where({ patient_id: patientId, status: 'completed' })
    .whereNotNull('completed_at')
    .orderBy('completed_at', 'desc')
    .first();
  if (!last) return [];
  const answers = await db('answers as a')
    .join('questions as q', 'q.id', 'a.question_id')
    .where('a.checkin_id', last.id)
    .andWhere('a.skipped', false)
    .select(
      'q.key',
      'q.label',
      'q.is_side_effect',
      'q.alert_threshold_json',
      'a.value_num',
      'a.value_choice',
      'a.value_text',
    );
  const evidenceAt = new Date(last.completed_at);
  const out = [];
  const sideEffectDetails = [];
  let sideEffect = false;
  for (const a of answers) {
    const value = a.value_num ?? a.value_choice ?? a.value_text;
    const hit = evaluateThreshold(a.alert_threshold_json, value);
    if (a.is_side_effect) {
      if (hit) sideEffect = true;
      if (a.value_choice) sideEffectDetails.push(a.value_choice);
      continue;
    }
    if (hit) {
      out.push({
        code: `threshold:${a.key}`,
        severity: a.alert_threshold_json?.severity || 'medium',
        title: `${a.label}: ${value}`,
        context: { key: a.key, value, threshold: a.alert_threshold_json, checkin_id: last.id },
        evidenceAt,
      });
    }
  }
  if (sideEffect) {
    out.push({
      code: 'side_effect',
      severity: 'high',
      title: 'Efeito adverso relatado',
      context: {
        details: sideEffectDetails,
        checkin_id: last.id,
        reportedAt: evidenceAt.toISOString(),
      },
      evidenceAt,
    });
  }
  return out;
}

/** L3: no_response só existe se houve envio real e nenhuma conclusão desde então há ≥ 48h. */
async function noResponseTrigger(db, patientId, nowDT) {
  const [{ last_sent: lastSent, last_completed: lastCompleted }] = await db('checkins')
    .where({ patient_id: patientId })
    .max('sent_at as last_sent')
    .max('completed_at as last_completed');
  if (!lastSent) return null;
  if (lastCompleted && new Date(lastCompleted) >= new Date(lastSent)) return null;
  const hours = Math.floor(nowDT.diff(DateTime.fromJSDate(new Date(lastSent)), 'hours').hours);
  if (hours < NO_RESPONSE_HOURS) return null;
  return {
    code: 'no_response',
    severity: 'medium',
    title: `Sem resposta há ${hours} h`,
    context: {
      hoursSinceLastSend: hours,
      lastSentAt: new Date(lastSent).toISOString(),
      thresholdHours: NO_RESPONSE_HOURS,
    },
    evidenceAt: new Date(lastSent),
  };
}

async function deliveryFailedTrigger(db, patientId, nowDT) {
  const since = nowDT.minus({ hours: 24 }).toJSDate();
  const rows = await db('notifications')
    .where({ patient_id: patientId })
    .whereNotNull('failed_at')
    .andWhere('failed_at', '>=', since)
    .select('failed_at');
  if (rows.length < DELIVERY_FAILED_MIN) return null;
  const latest = rows.reduce(
    (m, r) => (new Date(r.failed_at) > m ? new Date(r.failed_at) : m),
    new Date(0),
  );
  return {
    code: 'delivery_failed',
    severity: 'medium',
    title: `Falhas de entrega: ${rows.length} em 24 h`,
    context: { failures24h: rows.length },
    evidenceAt: latest,
  };
}

async function scoreTriggers(db, patientId, nowDT) {
  const rows = await db('patient_scores_daily')
    .where({ patient_id: patientId })
    .andWhere('date', '>=', nowDT.minus({ days: 14 }).toISODate())
    .orderBy('date', 'desc')
    .select('date', 'score', 'trend');
  const mapped = rows.map((r) => ({
    date: r.date instanceof Date ? DateTime.fromJSDate(r.date).toISODate() : String(r.date),
    score: r.score,
    trend: r.trend,
  }));
  const latestDate = mapped[0]?.date;
  return detectScoreRules(mapped).map((t) => ({
    ...t,
    evidenceAt: latestDate ? new Date(`${latestDate}T23:59:59Z`) : nowDT.toJSDate(),
  }));
}

/* ---- persistência --------------------------------------------------------- */

async function activeSilences(db, patientId, nowJs) {
  return db('alert_silences').where({ patient_id: patientId }).andWhere('until_at', '>', nowJs);
}

function silenced(silences, code) {
  return silences.some((s) => s.code === null || s.code === code);
}

async function upsertAlert(db, patientId, t, nowJs) {
  const open = await db('alerts')
    .where({ patient_id: patientId, code: t.code })
    .whereNot('status', 'resolved')
    .first();
  if (open) {
    await db('alerts')
      .where({ id: open.id })
      .update({ last_seen_at: nowJs, context: JSON.stringify(t.context ?? {}), title: t.title });
    return 'touched';
  }
  // Já resolvido depois da evidência? Não reabrir (senão a conduta da médica seria ignorada).
  const resolvedAfter = await db('alerts')
    .where({ patient_id: patientId, code: t.code, status: 'resolved' })
    .andWhere('resolved_at', '>=', t.evidenceAt)
    .first();
  if (resolvedAfter) return 'suppressed_resolved';
  await db('alerts').insert({
    patient_id: patientId,
    code: t.code,
    severity: t.severity,
    title: t.title,
    context: JSON.stringify(t.context ?? {}),
    status: 'open',
    first_seen_at: nowJs,
    last_seen_at: nowJs,
    created_at: nowJs,
  });
  return 'created';
}

/**
 * Avalia todas as regras de um paciente e sincroniza `alerts`.
 * @returns {{patientId, triggered:string[], created:number, touched:number, autoResolved:number}}
 */
export async function evaluatePatientAlerts(db, patientId, now) {
  const nowDT = toDT(now);
  const nowJs = nowDT.toJSDate();
  const triggers = [
    ...(await thresholdTriggers(db, patientId)),
    await noResponseTrigger(db, patientId, nowDT),
    await deliveryFailedTrigger(db, patientId, nowDT),
    ...(await scoreTriggers(db, patientId, nowDT)),
  ].filter(Boolean);

  const silences = await activeSilences(db, patientId, nowJs);
  const effective = triggers.filter((t) => !silenced(silences, t.code));
  const codes = new Set(effective.map((t) => t.code));

  let created = 0;
  let touched = 0;
  for (const t of effective) {
    const r = await upsertAlert(db, patientId, t, nowJs);
    if (r === 'created') created += 1;
    if (r === 'touched') touched += 1;
  }

  const open = await db('alerts').where({ patient_id: patientId }).whereNot('status', 'resolved');
  let autoResolved = 0;
  for (const a of open) {
    if (AUTO_RESOLVE.has(a.code) && !codes.has(a.code)) {
      await db('alerts').where({ id: a.id }).update({
        status: 'resolved',
        resolved_reason: 'auto_cleared',
        resolved_at: nowJs,
        last_seen_at: nowJs,
      });
      autoResolved += 1;
    }
  }
  if (created || autoResolved) {
    logger.info('alerts.evaluated', {
      patient_id: patientId,
      created,
      touched,
      autoResolved,
      codes: [...codes],
    });
  }
  return { patientId, triggered: [...codes], created, touched, autoResolved };
}

export async function evaluateAllAlerts(db, now) {
  const patients = await db('patients').where({ status: 'active' }).select('id');
  const results = [];
  for (const p of patients) results.push(await evaluatePatientAlerts(db, p.id, now));
  return { patients: patients.length, results };
}
