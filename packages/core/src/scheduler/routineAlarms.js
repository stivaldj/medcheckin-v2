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
/**
 * P2-3 — teto de atraso do lembrete, em minutos.
 *
 * Sem ele, um scheduler que ficasse horas fora do ar voltava à noite e mandava de uma vez os
 * lembretes de manhã, meio-dia e noite. Num lembrete de medicação isso é pior que ruído: às
 * 23:30 a pessoa recebe "Hora da medicação · 08:00" e pode tomar a dose da manhã em cima da
 * dose da noite. Passou do teto, o lembrete perdeu o sentido — some, mas some CONTADO
 * (`stale` no resumo do ciclo), porque lembrete engolido em silêncio é sucesso falso.
 */
export const ALARM_MAX_LATE_MIN = 60;

export async function dispatchDueRoutineAlarms(db, now, { notifier, maxLateMin } = {}) {
  // `Number.isFinite` recusaria Infinity, que é justamente como um teste desliga o teto.
  const teto =
    typeof maxLateMin === 'number' && !Number.isNaN(maxLateMin) ? maxLateMin : ALARM_MAX_LATE_MIN;
  if (!notifier) throw new Error('dispatchDueRoutineAlarms: notifier obrigatório');
  const nowDT = toDT(now);
  const patients = await db('patients').where({ status: 'active' }).select('id', 'timezone');

  const out = { due: 0, sent: 0, failed: 0, duplicate: 0, no_respondent: 0, stale: 0 };
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
    // D27 — o teto pode ser afinado por período (titulação com horário rígido × manutenção
    // frouxa). Nulo no período = padrão do sistema; o parâmetro da chamada existe para teste.
    const tetoDoPeriodo = Number.isInteger(period.max_late_min) ? period.max_late_min : teto;

    const due = [];
    for (const [idx, a] of alarms.entries()) {
      const { hour, minute } = parseHm(toHm(a.time));
      const at = local.startOf('day').set({ hour, minute });
      if (at > local) continue; // ainda não deu a hora
      const atrasoMin = local.diff(at, 'minutes').minutes;

      /**
       * A parte que nenhuma configuração pode afrouxar: um lembrete atrasado NUNCA atravessa a
       * próxima dose. Se já deu a hora da seguinte, o de trás perdeu o sentido e vira risco de
       * dose dobrada — não importa que teto a médica tenha escolhido.
       */
      const proximo = alarms[idx + 1];
      let limite = tetoDoPeriodo;
      if (proximo) {
        const pr = parseHm(toHm(proximo.time));
        const emMin = local
          .startOf('day')
          .set({ hour: pr.hour, minute: pr.minute })
          .diff(at, 'minutes').minutes;
        limite = Math.min(limite, emMin);
      }
      if (atrasoMin > limite) {
        out.stale += 1;
        logger.warn('alarm.stale', {
          patient_id: p.id,
          routine_alarm_id: a.id,
          time: toHm(a.time),
          late_min: Math.round(atrasoMin),
          limit_min: limite,
        });
        continue;
      }
      due.push(a);
    }
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
