import http from 'node:http';
import { getSystemState, STATE_KEYS } from './cycle.js';
import { logger } from '../logger.js';

/**
 * /health do scheduler: 200 se o último ciclo (system_state) é recente; 503 caso contrário.
 * Usado pelo HEALTHCHECK do container e por monitores externos.
 */
export function startHealthServer(db, { port = 3001, staleMinutes = 5 } = {}) {
  const server = http.createServer(async (req, res) => {
    if (req.url !== '/health') {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'not_found' }));
      return;
    }
    try {
      const st = await getSystemState(db);
      const last = st[STATE_KEYS.lastCycle] ? new Date(String(st[STATE_KEYS.lastCycle])) : null;
      const ageMin = last ? (Date.now() - last.getTime()) / 60000 : null;
      const ok = last !== null && ageMin <= staleMinutes;
      res.writeHead(ok ? 200 : 503, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          ok,
          last_cycle_at: last,
          age_minutes: ageMin === null ? null : Number(ageMin.toFixed(1)),
          stale_after_minutes: staleMinutes,
        }),
      );
    } catch (err) {
      res.writeHead(503, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'db', message: err?.message }));
    }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '0.0.0.0', () => {
      const actual = server.address().port;
      logger.info('scheduler.health.listening', { port: actual });
      resolve({ port: actual, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}
