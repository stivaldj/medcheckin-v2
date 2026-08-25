import { toDT } from '../time.js';
import { planCheckins, expireCheckins } from './planner.js';
import { dispatchDueCheckins } from '../checkin/engine.js';
import { dispatchDueRoutineAlarms } from './routineAlarms.js';
import { evaluateAllAlerts } from '../alerts/evaluate.js';
import { applyRetention } from '../lgpd/retention.js';
import { logger } from '../logger.js';

const ALERTS_EVERY_MINUTES = 60;
export const STATE_KEYS = {
  lastCycle: 'scheduler.last_cycle_at',
  lastAlerts: 'alerts.last_run_at',
  lastRetention: 'retention.last_run_at',
  cycleCount: 'scheduler.cycle_count',
  maxGapMin: 'scheduler.max_gap_min',
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
  // E9.1/D15: os alarmes nascem da rotina por período (routine_alarms). `medication_intakes`
  // está deprecado (D17) — a tabela fica para histórico, mas nada novo é criado.
  const alarms = await dispatchDueRoutineAlarms(db, nowDT, { notifier });

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
  // observabilidade do scheduler (shadow run): contagem de ciclos e maior lacuna entre ciclos
  const prev = await getSystemState(db);
  const prevLast = prev[STATE_KEYS.lastCycle] ? toDT(new Date(prev[STATE_KEYS.lastCycle])) : null;
  const gapMin = prevLast ? Math.max(0, nowDT.diff(prevLast, 'minutes').minutes) : 0;
  const maxGap = Math.max(Number(prev[STATE_KEYS.maxGapMin] ?? 0), Number(gapMin.toFixed(1)));
  await setSystemState(db, STATE_KEYS.cycleCount, Number(prev[STATE_KEYS.cycleCount] ?? 0) + 1);
  await setSystemState(db, STATE_KEYS.maxGapMin, maxGap);
  await setSystemState(db, STATE_KEYS.lastCycle, nowDT.toISO());

  const summary = {
    at: nowDT.toISO(),
    ms: Date.now() - started,
    checkins,
    expired,
    dispatch,
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
