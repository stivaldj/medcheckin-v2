import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Bug do primeiro teste real (iPhone, 14/09): no iOS o pedido de permissão de notificação só é
 * aceito se sair DIRETO do toque. Com `await`s antes (registrar SW, buscar VAPID, esperar o SW),
 * o iOS ignora o pedido em silêncio — a permissão fica "default" e o wizard dizia "bloqueado",
 * mandando a pessoa procurar em Ajustes um app que nem aparece lá.
 */
type Call = string;
let calls: Call[];
let permResult: NotificationPermission;

function installBrowser() {
  calls = [];
  const reg = {
    pushManager: {
      subscribe: vi.fn(async () => {
        calls.push('subscribe');
        return {
          toJSON: () => ({
            endpoint: 'https://push.example.test/x',
            keys: { p256dh: 'a', auth: 'b' },
          }),
        };
      }),
    },
  };
  const g = globalThis as unknown as Record<string, unknown>;
  g.window = { PushManager: function PushManager() {}, Notification: {} };
  (g.window as Record<string, unknown>).PushManager = function PushManager() {};
  g.PushManager = function PushManager() {};
  g.Notification = {
    permission: 'default',
    requestPermission: vi.fn(() => {
      calls.push('requestPermission');
      return Promise.resolve(permResult);
    }),
  };
  (g.window as Record<string, unknown>).Notification = g.Notification;
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      serviceWorker: {
        register: vi.fn(async () => {
          calls.push('register');
          return reg;
        }),
        ready: Promise.resolve(reg),
      },
    },
  });
  g.fetch = vi.fn(async (url: string) => {
    calls.push(`fetch ${url}`);
    const body = url.endsWith('/vapid')
      ? {
          publicKey:
            'BLUhM2hi2AZAnDIDP0OOQY48kOUGBDVqHehzDHXVWoHulP1SbAkZye0FdweR-cJb5cMQzr6JyDlkjWE3FSj2YLo',
        }
      : { id: 'sub-1' };
    return new Response(JSON.stringify(body), { status: url.endsWith('/push') ? 201 : 200 });
  });
}

describe('subscribePush — ordem exigida pelo iPhone', () => {
  beforeEach(() => {
    vi.resetModules();
    permResult = 'granted';
    installBrowser();
  });

  it('pede a permissão ANTES de qualquer outra chamada assíncrona (ainda dentro do toque)', async () => {
    const { subscribePush } = await import('../lib/push-client');
    const out = await subscribePush();
    expect(out).toEqual({ ok: true });
    expect(calls[0]).toBe('requestPermission');
    expect(calls).toContain('fetch /api/p/push');
  });

  it('pedido ignorado/fechado ("default") não é "bloqueado": vira "dismissed" para a tela oferecer tentar de novo', async () => {
    permResult = 'default';
    const { subscribePush } = await import('../lib/push-client');
    expect(await subscribePush()).toEqual({ ok: false, reason: 'dismissed' });
    expect(calls).not.toContain('fetch /api/p/push');
  });

  it('"denied" continua "denied" (aí sim a pessoa precisa liberar nos ajustes)', async () => {
    permResult = 'denied';
    const { subscribePush } = await import('../lib/push-client');
    expect(await subscribePush()).toEqual({ ok: false, reason: 'denied' });
  });
});
