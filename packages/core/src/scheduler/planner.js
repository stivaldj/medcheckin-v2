import { DateTime } from 'luxon';
import { toDT } from '../time.js';
import { computeNextAttemptAt, planFromEpisode } from './next-run.js';
import { logger } from '../logger.js';

const EXPIRE_AFTER_HOURS = 24;

/**
 * Planner: garante o check-in do dia local para cada paciente ativo com episódio aberto.
 * Idempotente por unique(patient_id, scheduled_for). Não toca em check-ins existentes.
 * Cria mesmo que o horário de hoje já tenha passado (o dispatcher envia atrasado, respeitando
 * quiet hours) — evita "pular o dia" se o processo estava fora do ar (v1 pulava).
 */
export async function planCheckins(db, now) {
  const nowDT = toDT(now);
  const rows = await db('episodes as e')
    .join('patients as p', 'p.id', 'e.patient_id')
    .whereNull('e.ended_at')
    .andWhere('p.status', 'active')
    .select(
      'e.id as episode_id',
      'e.patient_id',
      'e.checkin_frequency',
      'e.started_at',
      'p.timezone',
      'p.checkin_time',
      'p.quiet_start',
      'p.quiet_end',
    );

  let created = 0;
  for (const r of rows) {
    const plan = planFromEpisode(r, r);
    const localStart = nowDT.setZone(plan.timezone).startOf('day');
    // Próximo slot a partir do início do dia local: se cair hoje, é "o check-in de hoje".
    const nextIso = computeNextAttemptAt(localStart.toUTC(), plan);
    const next = DateTime.fromISO(nextIso, { zone: 'utc' });
    if (!next.setZone(plan.timezone).hasSame(localStart, 'day')) continue;

    const inserted = await db('checkins')
      .insert({
        patient_id: r.patient_id,
        episode_id: r.episode_id,
        scheduled_for: next.toJSDate(),
        next_attempt_at: next.toJSDate(),
        status: 'pending',
      })
      .onConflict(['patient_id', 'scheduled_for'])
      .ignore()
      .returning('id');
    if (inserted.length) created += 1;
  }
  logger.info('planner.checkins', { candidates: rows.length, created });
  return { candidates: rows.length, created };
}

/** Check-ins não concluídos com scheduled_for há mais de 24 h viram `missed`. */
export async function expireCheckins(db, now) {
  const cutoff = toDT(now).minus({ hours: EXPIRE_AFTER_HOURS }).toJSDate();
  const ids = await db('checkins')
    .whereIn('status', ['pending', 'sent', 'in_progress'])
    .andWhere('scheduled_for', '<', cutoff)
    .update({ status: 'missed', next_attempt_at: null, updated_at: db.fn.now() })
    .returning('id');
  if (ids.length) logger.info('planner.expire', { missed: ids.length });
  return { missed: ids.length };
}
