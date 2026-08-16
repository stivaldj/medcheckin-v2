import { toDT } from '../time.js';
import { planCheckins, expireCheckins } from './planner.js';
import { dispatchDueCheckins } from '../checkin/engine.js';
import { planMedicationIntakes, dispatchDueIntakes } from './reminders.js';
import { evaluateAllAlerts } from '../alerts/evaluate.js';
import { applyRetention } from '../lgpd/retention.js';
import { logger } from '../logger.js';

const ALERTS_EVERY_MINUTES = 60;
export const STATE_KEYS = {
  lastCycle: 'scheduler.last_cycle_at',
  lastAlerts: 'alerts.last_run_at',
  lastRetention: 'retention.last_run_at',
};
const RETENTION_EVERY_HOURS = 24;
let cache = {}; // só otimização; a verdade é system_state

export async function setSystemState(db, key, value) {
  await db('system_state')
    .insert({ key, value: JSON.stringify(value), updated_at: db.fn.now() })
    .onConflict('key')
    .merge();
  cache[key] = value;
}

/** { key: value } de todos os carimbos. */
export async function getSystemState(db) {
  const rows = await db('system_state');
  const out = {};
  for (const r of rows) out[r.key] = r.value;
  return out;
}

/**
 * Um ciclo do scheduler, com o MESMO `now` em todas as fases. Idempotente.
 * Alertas no máx. 1×/h (relógio em `system_state`, sobrevive a reinícios); `force: true` força.
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
  const lastRaw =
    cache[STATE_KEYS.lastAlerts] ?? (await getSystemState(db))[STATE_KEYS.lastAlerts] ?? null;
  const last = lastRaw ? toDT(new Date(lastRaw)) : null;
  if (force || !last || nowDT.diff(last, 'minutes').minutes >= ALERTS_EVERY_MINUTES) {
    alerts = await evaluateAllAlerts(db, nowDT);
    await setSystemState(db, STATE_KEYS.lastAlerts, nowDT.toISO());
  }
  let retention = null;
  const lastRetRaw =
    cache[STATE_KEYS.lastRetention] ?? (await getSystemState(db))[STATE_KEYS.lastRetention] ?? null;
  const lastRet = lastRetRaw ? toDT(new Date(lastRetRaw)) : null;
  if (force || !lastRet || nowDT.diff(lastRet, 'hours').hours >= RETENTION_EVERY_HOURS) {
    retention = await applyRetention(db, nowDT);
    await setSystemState(db, STATE_KEYS.lastRetention, nowDT.toISO());
  }
  await setSystemState(db, STATE_KEYS.lastCycle, nowDT.toISO());

  const summary = {
    at: nowDT.toISO(),
    ms: Date.now() - started,
    checkins,
    expired,
    dispatch,
    intakes,
    alarms,
    alerts,
    retention,
  };
  logger.info('scheduler.cycle', summary);
  return summary;
}

/** Só para testes: zera o cache em memória (o banco continua sendo a verdade). */
export function resetCycleState() {
  cache = {};
}
