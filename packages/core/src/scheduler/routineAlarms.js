import { toDT } from '../time.js';
import { parseHm, toHm } from './next-run.js';
import { enqueueAndSend } from '../checkin/engine.js';
import { logger } from '../logger.js';

/**
 * Alarmes de rotina (E9.1 / D15): nascem de `routine_alarms` do período que cobre o DIA LOCAL
 * do paciente. Fora de período nada é enviado — a rotina para sozinha no fim.
 * O alarme é LEMBRETE PURO: o corpo do push é a descrição em texto livre, sem nada a confirmar.
 * Idempotência: `dedup_key = routine:<alarm_id>:<dia local>:<respondent_id>` (L8).
 */
export async function dispatchDueRoutineAlarms(db, now, { notifier } = {}) {
  if (!notifier) throw new Error('dispatchDueRoutineAlarms: notifier obrigatório');
  const nowDT = toDT(now);
  const patients = await db('patients').where({ status: 'active' }).select('id', 'timezone');

  const out = { due: 0, sent: 0, failed: 0, duplicate: 0, no_respondent: 0 };
  for (const p of patients) {
    const tz = p.timezone || 'UTC';
    const local = nowDT.setZone(tz);
    const day = local.toISODate();
    const period = await db('routine_periods')
      .where({ patient_id: p.id })
      .andWhere('starts_on', '<=', day)
      .andWhere((q) => q.whereNull('ends_on').orWhere('ends_on', '>=', day))
      .first();
    if (!period) continue;
    const alarms = await db('routine_alarms').where({ period_id: period.id }).orderBy('time');
    const due = alarms.filter((a) => {
      const { hour, minute } = parseHm(toHm(a.time));
      return local.startOf('day').set({ hour, minute }) <= local;
    });
    if (!due.length) continue;

    const respondents = await db('respondents')
      .where({ patient_id: p.id, receives_alarms: true })
      .whereNotNull('accepted_at')
      .select('id');
    for (const a of due) {
      out.due += 1;
      if (!respondents.length) {
        out.no_respondent += 1;
        continue;
      }
      const { hour, minute } = parseHm(toHm(a.time));
      const at = local.startOf('day').set({ hour, minute }).toUTC().toJSDate();
      for (const r of respondents) {
        const res = await enqueueAndSend(db, notifier, {
          patient_id: p.id,
          respondent_id: r.id,
          kind: 'alarm',
          payload: {
            routine_alarm_id: a.id,
            period_id: period.id,
            date: day,
            time: toHm(a.time),
            title: `Hora da medicação · ${toHm(a.time)}`,
            body: a.description,
          },
          scheduled_at: at,
          dedup_key: `routine:${a.id}:${day}:${r.id}`,
        });
        out[res.status] += 1;
      }
    }
  }
  if (out.sent || out.failed) logger.info('scheduler.routine_alarms', out);
  return out;
}
