import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import webpush from 'web-push';
import { freshDb, seedFixture } from './helpers/db.js';
import {
  createWebPushNotifier,
  savePushSubscription,
  removePushSubscription,
} from '../src/push/index.js';
import { enqueueAndSend } from '../src/checkin/engine.js';

/** Push service local: recebe o POST cifrado do web-push e responde 201 (ou 410 para endpoints /gone). */
function localPushService() {
  const received = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      received.push({ url: req.url, headers: req.headers, bytes: Buffer.concat(chunks).length });
      if (req.url.startsWith('/gone')) {
        res.writeHead(410);
        res.end();
        return;
      }
      res.writeHead(201);
      res.end();
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () =>
      resolve({ server, received, base: `http://127.0.0.1:${server.address().port}` }),
    );
  });
}

describe('push — notifier Web Push contra push service local (PROVA E5-a)', () => {
  let db, fx, svc, notifier, keys, s1;
  beforeAll(async () => {
    db = await freshDb();
    fx = await seedFixture(db);
    svc = await localPushService();
    keys = webpush.generateVAPIDKeys();
    notifier = createWebPushNotifier(
      {
        vapidPublicKey: keys.publicKey,
        vapidPrivateKey: keys.privateKey,
        subject: 'mailto:dev@medcheckin.test',
      },
      db,
    );
    s1 = {
      kind: 'respondent',
      respondentId: fx.r1.id,
      patientId: fx.p1.id,
      clinicId: fx.clinic.id,
    };
  });
  afterAll(async () => {
    svc.server.close();
    await db.destroy();
  });

  it('fail-closed sem chaves VAPID', () => {
    expect(() => createWebPushNotifier({}, db)).toThrow(/VAPID/);
  });

  it('sem inscrição → ok:false no_subscription; notification vira failed', async () => {
    const r = await enqueueAndSend(db, notifier, {
      patient_id: fx.p1.id,
      respondent_id: fx.r1.id,
      kind: 'checkin',
      payload: { title: 't', body: 'b' },
      scheduled_at: new Date(),
      dedup_key: 'push:none',
    });
    expect(r.status).toBe('failed');
    expect(r.error).toMatch(/no_subscription/);
  });

  it('savePushSubscription (upsert por endpoint) + envio real cifrado → push service recebe; sent_at marcado', async () => {
    // chaves de cliente válidas (p256dh/auth) geradas como um browser faria
    const client = await clientKeys();
    const sub = await savePushSubscription(db, s1, {
      endpoint: `${svc.base}/ok/1`,
      keys: client,
      ua: 'vitest',
    });
    expect(sub.respondent_id).toBe(fx.r1.id);
    const again = await savePushSubscription(db, s1, {
      endpoint: `${svc.base}/ok/1`,
      keys: client,
      ua: 'vitest-2',
    });
    expect(again.id).toBe(sub.id);
    expect(await db('push_subscriptions').count().first()).toMatchObject({ count: 1 });

    const r = await enqueueAndSend(db, notifier, {
      patient_id: fx.p1.id,
      respondent_id: fx.r1.id,
      kind: 'checkin',
      payload: { title: 'Check-in do dia', body: 'Como está sua dor?', url: '/p/hoje' },
      scheduled_at: new Date(),
      dedup_key: 'push:ok',
    });
    expect(r.status).toBe('sent');
    expect(svc.received).toHaveLength(1);
    expect(svc.received[0].url).toBe('/ok/1');
    expect(svc.received[0].headers['content-encoding']).toBe('aes128gcm');
    expect(svc.received[0].headers.authorization).toMatch(/^vapid /);
    expect(svc.received[0].bytes).toBeGreaterThan(50);
    const n = await db('notifications').where({ dedup_key: 'push:ok' }).first();
    expect(n.sent_at).not.toBeNull();
  });

  it('410 do push service → inscrição revogada e envio falha; removePushSubscription', async () => {
    await db('push_subscriptions').del();
    const client = await clientKeys();
    await savePushSubscription(db, s1, { endpoint: `${svc.base}/gone/2`, keys: client, ua: 'x' });
    const r = await enqueueAndSend(db, notifier, {
      patient_id: fx.p1.id,
      respondent_id: fx.r1.id,
      kind: 'alarm',
      payload: { title: 'x' },
      scheduled_at: new Date(),
      dedup_key: 'push:gone',
    });
    expect(r.status).toBe('failed');
    const sub = await db('push_subscriptions')
      .where({ endpoint: `${svc.base}/gone/2` })
      .first();
    expect(sub.revoked_at).not.toBeNull();
    // segunda tentativa: nenhuma inscrição ativa
    const r2 = await enqueueAndSend(db, notifier, {
      patient_id: fx.p1.id,
      respondent_id: fx.r1.id,
      kind: 'alarm',
      payload: { title: 'x' },
      scheduled_at: new Date(),
      dedup_key: 'push:gone2',
    });
    expect(r2.error).toMatch(/no_subscription/);
    await savePushSubscription(db, s1, { endpoint: `${svc.base}/ok/3`, keys: client, ua: 'x' });
    const removed = await removePushSubscription(db, s1, { endpoint: `${svc.base}/ok/3` });
    expect(removed).toBe(1);
  });
});

/** Gera par ECDH P-256 + auth secret como o navegador (só para o teste). */
async function clientKeys() {
  const { webcrypto } = await import('node:crypto');
  const kp = await webcrypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ]);
  const raw = Buffer.from(await webcrypto.subtle.exportKey('raw', kp.publicKey));
  const auth = Buffer.from(webcrypto.getRandomValues(new Uint8Array(16)));
  return { p256dh: raw.toString('base64url'), auth: auth.toString('base64url') };
}
