'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { BellRingIcon, CheckIcon } from 'lucide-react';
import type { RespondentTodayView, TodayQuestion } from '@medcheckin/core';

import { api, ApiError } from '@/lib/client';
import { pushSupported, registerServiceWorker } from '@/lib/push-client';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NoSession } from './NoSession';

/** Extremos da escala em palavras: "7" sozinho não quer dizer nada às 6 da manhã. */
const EXTREMOS: Record<string, [string, string]> = {
  dor: ['nenhuma dor', 'a pior possível'],
  sono: ['péssimo', 'ótimo'],
  humor: ['péssimo', 'ótimo'],
};

/** Verde → âmbar → vermelho. A cor acompanha a altura; as duas dizem a mesma coisa. */
function tomDaEscala(n: number) {
  if (n <= 3) return 'var(--sev-low)';
  if (n <= 6) return 'var(--sev-medium)';
  if (n <= 8) return 'var(--sev-high)';
  return 'var(--sev-critical)';
}

function QuestionForm({
  checkinId,
  q,
  onAnswered,
}: {
  checkinId: string;
  q: TodayQuestion;
  onAnswered: () => void;
}) {
  const [value, setValue] = useState<unknown>(q.kind === 'yes_no' ? null : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setValue(q.kind === 'yes_no' ? null : '');
    setError(null);
  }, [q.key, q.kind]);
  async function send(v: unknown) {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/p/checkins/${checkinId}/answers`, {
        method: 'POST',
        json: { questionKey: q.key, value: v },
      });
      onAnswered();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Erro');
    } finally {
      setBusy(false);
    }
  }
  const extremos = EXTREMOS[q.key];
  return (
    <div className="space-y-5" data-testid={`question-${q.key}`}>
      <p className="text-xl leading-snug font-semibold tracking-tight text-balance">{q.label}</p>

      {q.kind === 'scale_0_10' && (
        <div>
          {/* Altura e cor sobem juntas: dá para responder de relance, sem ler o número. */}
          <div className="flex items-end gap-1" style={{ height: 132 }}>
            {Array.from({ length: 11 }, (_, n) => (
              <button
                key={n}
                type="button"
                disabled={busy}
                onClick={() => send(n)}
                data-testid={`scale-${n}`}
                aria-label={`${n}${extremos ? (n === 0 ? ` — ${extremos[0]}` : n === 10 ? ` — ${extremos[1]}` : '') : ''}`}
                className="flex-1 rounded-t-md rounded-b-sm border border-transparent transition-transform active:translate-y-0.5 disabled:opacity-50"
                style={{
                  height: `${38 + n * 9}px`,
                  background: `color-mix(in oklab, ${tomDaEscala(n)} 26%, var(--muted))`,
                }}
              />
            ))}
          </div>
          <div className="mt-1.5 flex gap-1">
            {Array.from({ length: 11 }, (_, n) => (
              <span key={n} className="flex-1 text-center font-mono text-xs text-muted-foreground">
                {n}
              </span>
            ))}
          </div>
          {extremos && (
            <div className="mt-2 flex justify-between text-xs text-muted-foreground">
              <span>{extremos[0]}</span>
              <span>{extremos[1]}</span>
            </div>
          )}
        </div>
      )}

      {q.kind === 'yes_no' && (
        <div className="grid grid-cols-2 gap-3">
          <Button
            className="h-14 text-base"
            disabled={busy}
            onClick={() => send(1)}
            data-testid="yes"
          >
            Sim
          </Button>
          <Button
            className="h-14 text-base"
            variant="outline"
            disabled={busy}
            onClick={() => send(0)}
            data-testid="no"
          >
            Não
          </Button>
        </div>
      )}

      {q.kind === 'choice' && (
        <div className="grid gap-2.5">
          {q.options.map((o) => (
            <Button
              key={o}
              variant="outline"
              className="h-14 justify-start px-4 text-base"
              disabled={busy}
              onClick={() => send(o)}
              data-testid={`choice-${o}`}
            >
              {o}
            </Button>
          ))}
        </div>
      )}

      {(q.kind === 'number' || q.kind === 'text') && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(q.kind === 'number' ? Number(value) : value);
          }}
          className="flex gap-2"
        >
          <Input
            className="h-14 flex-1 text-base"
            type={q.kind === 'number' ? 'number' : 'text'}
            inputMode={q.kind === 'number' ? 'numeric' : 'text'}
            value={String(value ?? '')}
            onChange={(e) => setValue(e.target.value)}
            aria-label={q.label}
            data-testid="input"
            required={q.required}
          />
          <Button type="submit" className="h-14 px-6 text-base" disabled={busy} data-testid="send">
            Enviar
          </Button>
        </form>
      )}

      {!q.required && (
        <Button
          variant="ghost"
          className="h-11 w-full text-muted-foreground"
          disabled={busy}
          onClick={() => send(null)}
          data-testid="skip"
        >
          Pular esta pergunta
        </Button>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

/**
 * E9.3: o estado dos avisos deste celular, em linguagem de gente. Falta algo → um botão que leva
 * direto ao passo que falta. Nunca "funcionando" sem teste confirmado e inscrição ativa.
 */
function SetupBanner({ setup }: { setup: RespondentTodayView['setup'] }) {
  if (setup.device === 'shared') return null;
  if (setup.complete)
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="push-ok">
        <CheckIcon className="size-4 text-primary" /> Avisos funcionando neste celular ·{' '}
        <Link href="/p/ajuda" className="underline underline-offset-4">
          testar de novo
        </Link>
      </p>
    );
  return (
    <div
      className="space-y-3 rounded-xl border border-primary/30 bg-primary/5 p-4"
      data-testid="push-setup"
    >
      <p className="flex items-start gap-2.5 text-[15px] leading-snug">
        <BellRingIcon className="mt-0.5 size-5 shrink-0 text-primary" />
        {setup.push_active
          ? 'Falta testar se os avisos chegam neste celular.'
          : 'Os avisos ainda não estão ativados neste celular. Sem eles, os lembretes não chegam.'}
      </p>
      <Link
        href="/p/ajuda"
        className={buttonVariants({ className: 'h-12 w-full text-base' })}
        data-testid="push-setup-go"
      >
        {setup.push_active ? 'Testar agora' : 'Ativar os avisos'}
      </Link>
    </div>
  );
}

export function TodayView() {
  const [data, setData] = useState<RespondentTodayView | null>(null);
  const [status, setStatus] = useState<'loading' | 'ok' | 'nosession' | 'error'>('loading');
  const load = useCallback(async () => {
    try {
      setData(await api<RespondentTodayView>('/api/p/today'));
      setStatus('ok');
    } catch (e) {
      setStatus(e instanceof ApiError && e.status === 401 ? 'nosession' : 'error');
    }
  }, []);
  useEffect(() => {
    load();
    // Registra o SW a cada abertura (é idempotente): o clique no aviso volta para cá por ele.
    if (pushSupported())
      registerServiceWorker().catch((e) => console.error('[pwa] service worker', e));
  }, [load]);

  if (status === 'loading')
    return (
      <div className="space-y-3" aria-busy="true">
        <div className="h-6 w-40 animate-pulse rounded-md bg-muted" />
        <div className="h-28 animate-pulse rounded-xl bg-muted" />
      </div>
    );
  if (status === 'nosession') return <NoSession />;
  if (status === 'error' || !data)
    return <p className="text-sm text-destructive">Não foi possível carregar. Tente novamente.</p>;

  const ck = data.checkin;
  const progresso = ck && !ck.completed && ck.next ? (ck.answered + 1) / ck.total : 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Olá, {data.respondent.name}</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {data.respondent.kind === 'caregiver'
            ? `Acompanhando ${data.patient.name}`
            : data.patient.clinic_name}
        </p>
      </div>
      <SetupBanner setup={data.setup} />

      {data.respondent.receives_alarms && (
        <section className="space-y-2.5">
          <h2 className="text-[13px] font-semibold tracking-tight">Medicação de hoje</h2>
          {data.alarms.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum horário de medicação hoje.</p>
          ) : (
            <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
              {data.alarms.map((a, i) => (
                <div
                  key={a.time}
                  className={`flex gap-4 px-4 py-3.5 ${i > 0 ? 'border-t' : ''}`}
                  data-testid="alarm"
                >
                  <div className="min-w-[3.5rem] font-mono text-lg leading-tight font-semibold">
                    {a.time}
                  </div>
                  <div className="text-[15px] leading-snug" data-testid="alarm-description">
                    {a.description}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {data.respondent.can_answer && (
        <section data-testid="checkin-card">
          {!ck ? (
            <p className="text-sm text-muted-foreground">Nenhum check-in hoje.</p>
          ) : ck.completed ? (
            <div
              className="flex flex-col items-center gap-2 py-10 text-center"
              data-testid="checkin-done"
            >
              {/* Único efeito do app inteiro: acontece uma vez, quando o dia é vencido. */}
              <div className="relative mb-1 flex size-20 items-center justify-center">
                <span className="absolute inset-0 rounded-full bg-primary/15 motion-safe:animate-ping" />
                <span className="relative flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  <CheckIcon className="size-7" />
                </span>
              </div>
              <p className="text-lg font-semibold tracking-tight">Check-in concluído</p>
              <p className="text-sm text-muted-foreground">
                Obrigado. <span className="font-mono">{ck.answered}</span>{' '}
                {ck.answered === 1 ? 'resposta enviada' : 'respostas enviadas'}.
              </p>
            </div>
          ) : ck.next ? (
            <div className="space-y-5">
              <div className="space-y-1.5">
                <div className="h-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-[width] duration-300"
                    style={{ width: `${Math.round(progresso * 100)}%` }}
                  />
                </div>
                <p className="font-mono text-xs text-muted-foreground" data-testid="progress">
                  {ck.answered + 1} de {ck.total}
                </p>
              </div>
              <QuestionForm checkinId={ck.id} q={ck.next} onAnswered={load} />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {ck.status === 'missed'
                ? 'O check-in de hoje expirou sem resposta. O próximo chega no horário de sempre.'
                : 'Nada a responder agora.'}
            </p>
          )}
        </section>
      )}
    </div>
  );
}
