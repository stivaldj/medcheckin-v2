import { toDT } from '../time.js';
import { planCheckins, expireCheckins } from './planner.js';
import { dispatchDueCheckins } from '../checkin/engine.js';
import { planMedicationIntakes, dispatchDueIntakes } from './reminders.js';
import { evaluateAllAlerts } from '../alerts/evaluate.js';
import { logger } from '../logger.js';

const ALERTS_EVERY_MINUTES = 60;
let lastAlertsRunAt = null;

/**
 * Um ciclo do scheduler, com o MESMO `now` em todas as fases (v1 fazia isso; mantido).
 * Idempotente: rodar duas vezes no mesmo minuto não cria nem envia nada a mais.
 * Alertas rodam no máximo 1×/h por processo (`force: true` para forçar).
 */
export async function runCycle(db, now, { notifier, force = false } = {}) {
  if (!notifier) throw new Error('runCycle: notifier obrigatório (fail-closed).');
  const nowDT = toDT(now);
  const started = Date.now();

  const checkins = await planCheckins(db, nowDT);
  const expired = await expireCheckins(db, nowDT);
  const dispatch = await dispatchDueCheckins(db, nowDT, { notifier });
  const intakes = await planMedicationIntakes(db, nowDT);
  const alarms = await dispatchDueIntakes(db, nowDT, { notifier });

  let alerts = null;
  const dueAlerts =
    force ||
    !lastAlertsRunAt ||
    nowDT.diff(lastAlertsRunAt, 'minutes').minutes >= ALERTS_EVERY_MINUTES;
  if (dueAlerts) {
    alerts = await evaluateAllAlerts(db, nowDT);
    lastAlertsRunAt = nowDT;
  }

  const summary = {
    at: nowDT.toISO(),
    ms: Date.now() - started,
    checkins,
    expired,
    dispatch,
    intakes,
    alarms,
    alerts,
  };
  logger.info('scheduler.cycle', summary);
  return summary;
}

/** Só para testes: zera o relógio interno de alertas. */
export function resetCycleState() {
  lastAlertsRunAt = null;
}
