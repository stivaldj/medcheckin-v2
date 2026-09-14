'use client';
import { api, ApiError } from './client';

function b64ToUint8(b64: string) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export type PushResult =
  | { ok: true }
  | {
      ok: false;
      reason: 'unsupported' | 'denied' | 'taken' | 'unavailable' | 'error';
      message?: string;
    };

export function pushSupported() {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

export function registerServiceWorker() {
  return navigator.serviceWorker.register('/sw.js', { scope: '/p/' });
}

/**
 * Pede permissão, assina Web Push e grava no servidor. Só devolve ok com 201 do servidor —
 * nunca "ativado" por ter passado pelo pedido do sistema.
 */
export async function subscribePush(): Promise<PushResult> {
  if (!pushSupported()) return { ok: false, reason: 'unsupported' };
  try {
    await registerServiceWorker();
    const { publicKey } = await api<{ publicKey: string }>('/api/p/vapid');
    const reg = await navigator.serviceWorker.ready;
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return { ok: false, reason: 'denied' };
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: b64ToUint8(publicKey),
    });
    const json = sub.toJSON();
    await api('/api/p/push', {
      method: 'POST',
      json: { endpoint: json.endpoint, keys: json.keys },
    });
    return { ok: true };
  } catch (e) {
    // P2-4: a inscrição deste aparelho já pertence a outra pessoa (celular compartilhado).
    if (e instanceof ApiError && e.code === 'forbidden') return { ok: false, reason: 'taken' };
    // Servidor sem VAPID configurado: problema do sistema da clínica, não do celular.
    if (e instanceof ApiError && e.code === 'push_unavailable')
      return { ok: false, reason: 'unavailable' };
    return { ok: false, reason: 'error', message: (e as Error).message };
  }
}
