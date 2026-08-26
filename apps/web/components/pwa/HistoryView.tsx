'use client';
import { useEffect, useState } from 'react';
import { CalendarDaysIcon } from 'lucide-react';
import type { HistoryDay } from '@medcheckin/core';

import { api, ApiError } from '@/lib/client';
import { NoSession } from './NoSession';

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
  if (status === 'loading')
    return (
      <div className="space-y-3" aria-busy="true">
        <div className="h-6 w-44 animate-pulse rounded-md bg-muted" />
        <div className="h-20 animate-pulse rounded-xl bg-muted" />
        <div className="h-20 animate-pulse rounded-xl bg-muted" />
      </div>
    );
  if (status === 'nosession') return <NoSession />;
  if (status === 'error' || !days)
    return <p className="text-sm text-destructive">Não foi possível carregar.</p>;
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold tracking-tight">
        Histórico <span className="text-muted-foreground">· 30 dias</span>
      </h1>
      {days.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <CalendarDaysIcon className="size-5" />
          </div>
          <p className="text-sm text-muted-foreground">
            Nada registrado ainda. Depois do primeiro check-in, seus dias aparecem aqui.
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {days.map((d) => (
            <div
              key={d.date}
              className="overflow-hidden rounded-xl border bg-card shadow-sm"
              data-testid={`day-${d.date}`}
            >
              <div className="border-b px-4 py-2 font-mono text-[13px] font-medium">
                {d.date.split('-').reverse().join('/')}
              </div>
              <div className="space-y-3 px-4 py-3">
                {d.answers && (
                  <ul className="space-y-1.5 text-sm">
                    {Object.entries(d.answers).map(([k, v]) => (
                      /* Rótulo e valor no mesmo nó de texto: separá-los em <dt>/<dd> come os
                         dois-pontos, e o par "pergunta: resposta" é o que a pessoa lê. */
                      <li key={k} className="flex justify-between gap-4">
                        <span className="text-muted-foreground" title={k}>
                          {d.answerLabels?.[k] ?? k}:{' '}
                        </span>
                        <span className="shrink-0 font-mono">{String(v)}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {d.alarms.length > 0 && (
                  <ul className="space-y-1 border-t pt-2.5 text-[13px] text-muted-foreground">
                    {d.alarms.map((a) => (
                      <li key={a.time}>
                        <span className="font-mono">{a.time}</span> — {a.description}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
