import {
  loadConfig,
  createDb,
  createWebPushNotifier,
  runCycle,
  logger,
  startHealthServer,
} from '@medcheckin/core';

/**
 * Scheduler: um ciclo (planner → expire → dispatch → intakes → alarmes → alertas 1×/h) a cada
 * SCHEDULER_INTERVAL_MS (default 60 s). `--once` roda um ciclo e sai. Fail-closed: sem DATABASE_URL
 * ou VAPID_* não sobe. Nunca sobrepõe ciclos.
 */
const cfg = loadConfig(process.env);
const db = createDb(cfg.databaseUrl);
const notifier = createWebPushNotifier(
  {
    vapidPublicKey: process.env.VAPID_PUBLIC_KEY,
    vapidPrivateKey: process.env.VAPID_PRIVATE_KEY,
    subject: process.env.VAPID_SUBJECT,
  },
  db,
);
const intervalMs = Number(process.env.SCHEDULER_INTERVAL_MS || 60_000);
const once = process.argv.includes('--once');

let running = false;
let stopping = false;
async function tick() {
  if (running) {
    logger.warn('scheduler.overlap_skipped');
    return null;
  }
  running = true;
  try {
    const summary = await runCycle(db, new Date(), { notifier });
    return summary;
  } catch (err) {
    logger.error('scheduler.cycle_failed', { message: err?.message, name: err?.name });
    return null;
  } finally {
    running = false;
  }
}

async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  logger.info('scheduler.stopping', { signal });
  clearInterval(timer);
  const wait = () => new Promise((r) => setTimeout(r, 200));
  while (running) await wait();
  if (health) await health.close();
  await db.destroy();
  process.exit(0);
}

let health = null;
if (!once)
  health = await startHealthServer(db, {
    port: Number(process.env.SCHEDULER_PORT || 3001),
    staleMinutes: 5,
  });
logger.info('scheduler.up', {
  intervalMs,
  once,
  notifier: notifier.kind,
  healthPort: health?.port ?? null,
});
const first = await tick();
if (once) {
  console.log(JSON.stringify({ once: true, summary: first }));
  await db.destroy();
  process.exit(first ? 0 : 1);
}
const timer = setInterval(tick, intervalMs);
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (err) => {
  logger.error('scheduler.unhandled_rejection', { message: err?.message ?? String(err) });
});
