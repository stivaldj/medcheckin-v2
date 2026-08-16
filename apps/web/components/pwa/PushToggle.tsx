'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/client';
import { Button } from '@/components/ui/button';

function b64ToUint8(b64: string) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

type State = 'checking' | 'unsupported' | 'denied' | 'off' | 'on' | 'error';

/** Registra o SW e assina Web Push. Nunca diz "ativado" sem o servidor confirmar (201). */
export function PushToggle({ subscriptions }: { subscriptions: number }) {
  const [state, setState] = useState<State>('checking');
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      if (
        !('serviceWorker' in navigator) ||
        !('PushManager' in window) ||
        !('Notification' in window)
      )
        return setState('unsupported');
      try {
        const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/p/' });
        // Alguns ambientes (headless, sem push service) nunca resolvem getSubscription: não travar a UI.
        const sub = await Promise.race([
          reg.pushManager.getSubscription(),
          new Promise<null>((r) => setTimeout(() => r(null), 3000)),
        ]);
        if (Notification.permission === 'denied') return setState('denied');
        setState(sub && subscriptions > 0 ? 'on' : 'off');
      } catch (e) {
        setMsg((e as Error).message);
        setState('error');
      }
    })();
  }, [subscriptions]);

  async function enable() {
    setMsg(null);
    try {
      const { publicKey } = await api<{ publicKey: string }>('/api/p/vapid');
      const reg = await navigator.serviceWorker.ready;
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') return setState('denied');
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: b64ToUint8(publicKey),
      });
      const json = sub.toJSON();
      await api('/api/p/push', {
        method: 'POST',
        json: { endpoint: json.endpoint, keys: json.keys },
      });
      setState('on');
    } catch (e) {
      setMsg((e as Error).message);
      setState('error');
    }
  }

  if (state === 'checking') return null;
  if (state === 'unsupported')
    return (
      <p className="text-xs text-muted-foreground" data-testid="push-unsupported">
        Este navegador não suporta notificações push. Instale o app na tela inicial ou use o
        Chrome/Safari atualizado.
      </p>
    );
  if (state === 'on')
    return (
      <p className="text-xs text-green-700" data-testid="push-on">
        Notificações ativas neste dispositivo.
      </p>
    );
  if (state === 'denied')
    return (
      <p className="text-xs text-destructive" data-testid="push-denied">
        Notificações bloqueadas no navegador. Libere nas configurações do site para receber alarmes.
      </p>
    );
  return (
    <div className="space-y-1">
      <Button size="sm" variant="outline" onClick={enable} data-testid="push-enable">
        Ativar notificações neste dispositivo
      </Button>
      {msg && (
        <p className="text-xs text-destructive" data-testid="push-error">
          {msg}
        </p>
      )}
    </div>
  );
}
