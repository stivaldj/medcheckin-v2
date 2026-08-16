'use client';
import { useEffect, useState } from 'react';
import type { HistoryDay } from '@medcheckin/core';
import { api, ApiError } from '@/lib/client';
import { NoSession } from './NoSession';

const STATUS: Record<string, string> = {
  taken: 'tomou',
  late: 'tomou (atrasado)',
  skipped: 'não tomou',
  pending: 'pendente',
};

export function HistoryView() {
  const [days, setDays] = useState<HistoryDay[] | null>(null);
  const [status, setStatus] = useState<'loading' | 'ok' | 'nosession' | 'error'>('loading');
  useEffect(() => {
    api<{ days: HistoryDay[] }>('/api/p/history')
      .then((h) => {
        setDays(h.days);
        setStatus('ok');
      })
      .catch((e) => setStatus(e instanceof ApiError && e.status === 401 ? 'nosession' : 'error'));
  }, []);
  if (status === 'loading') return <p className="text-sm text-muted-foreground">Carregando…</p>;
  if (status === 'nosession') return <NoSession />;
  if (status === 'error' || !days)
    return <p className="text-sm text-destructive">Não foi possível carregar.</p>;
  return (
    <div className="space-y-3">
      <h1 className="text-xl font-semibold">Histórico (30 dias)</h1>
      {days.length === 0 && <p className="text-sm text-muted-foreground">Nada registrado ainda.</p>}
      {days.map((d) => (
        <div key={d.date} className="rounded-md border p-3 text-sm" data-testid={`day-${d.date}`}>
          <div className="font-medium">{d.date.split('-').reverse().join('/')}</div>
          {d.answers && (
            <ul className="mt-1 grid grid-cols-2 gap-x-4">
              {Object.entries(d.answers).map(([k, v]) => (
                <li key={k}>
                  <span className="text-muted-foreground">{k}:</span> {String(v)}
                </li>
              ))}
            </ul>
          )}
          {d.intakes.length > 0 && (
            <ul className="mt-1 text-muted-foreground">
              {d.intakes.map((i, idx) => (
                <li key={idx}>
                  {new Date(i.scheduled_at).toLocaleTimeString('pt-BR', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}{' '}
                  {i.product_name}: {STATUS[i.status] ?? i.status}
                  {i.side_effect_flag ? ' · efeito' : ''}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}
