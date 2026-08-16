'use client';
import { useCallback, useEffect, useState } from 'react';
import type { RespondentTodayView, TodayAlarm, TodayQuestion } from '@medcheckin/core';
import { api, ApiError } from '@/lib/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { NoSession } from './NoSession';
import { PushToggle } from './PushToggle';

const hm = (v: string | Date) =>
  new Date(v).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

function AlarmRow({ a, onDone }: { a: TodayAlarm; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [effect, setEffect] = useState(false);
  const [note, setNote] = useState('');
  async function confirm(status: 'taken' | 'skipped', sideEffect = false) {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/p/intakes/${a.intake_id}/confirm`, {
        method: 'POST',
        json: { status, sideEffect, note: note || null },
      });
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Erro');
    } finally {
      setBusy(false);
    }
  }
  const label: Record<string, string> = {
    taken: 'Tomou',
    late: 'Tomou (atrasado)',
    skipped: 'Não tomou',
    pending: 'Pendente',
  };
  return (
    <div className="rounded-md border p-3" data-testid="alarm">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-medium">
            {hm(a.scheduled_at)} — {a.product_name}
          </div>
          <div className="text-sm text-muted-foreground">
            {a.dose_amount != null ? `${a.dose_amount} ${a.dose_unit}` : 'dose não definida'}
          </div>
        </div>
        <span className="text-sm" data-testid="alarm-status">
          {label[a.status] ?? a.status}
          {a.side_effect_flag ? ' · efeito' : ''}
        </span>
      </div>
      {a.status === 'pending' && (
        <div className="mt-2 space-y-2">
          {!effect ? (
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={busy}
                onClick={() => confirm('taken')}
                data-testid="taken"
              >
                Tomei
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => confirm('skipped')}
                data-testid="skipped"
              >
                Não tomei
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => setEffect(true)}
                data-testid="effect"
              >
                Tive efeito
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <input
                className="w-full rounded-md border px-2 py-1 text-sm"
                placeholder="Qual efeito? (opcional)"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                data-testid="effect-note"
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() => confirm('taken', true)}
                  data-testid="taken-effect"
                >
                  Tomei e tive efeito
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => confirm('skipped', true)}
                  data-testid="skipped-effect"
                >
                  Não tomei por efeito
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
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
  return (
    <div className="space-y-3" data-testid={`question-${q.key}`}>
      <p className="text-base font-medium">{q.label}</p>
      {q.kind === 'scale_0_10' && (
        <div className="grid grid-cols-6 gap-2 sm:grid-cols-11">
          {Array.from({ length: 11 }, (_, n) => (
            <Button
              key={n}
              variant="outline"
              disabled={busy}
              onClick={() => send(n)}
              data-testid={`scale-${n}`}
            >
              {n}
            </Button>
          ))}
        </div>
      )}
      {q.kind === 'yes_no' && (
        <div className="flex gap-2">
          <Button disabled={busy} onClick={() => send(1)} data-testid="yes">
            Sim
          </Button>
          <Button variant="outline" disabled={busy} onClick={() => send(0)} data-testid="no">
            Não
          </Button>
        </div>
      )}
      {q.kind === 'choice' && (
        <div className="flex flex-wrap gap-2">
          {q.options.map((o) => (
            <Button
              key={o}
              variant="outline"
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
          <input
            className="flex-1 rounded-md border px-2 py-1"
            type={q.kind === 'number' ? 'number' : 'text'}
            inputMode={q.kind === 'number' ? 'numeric' : 'text'}
            value={String(value ?? '')}
            onChange={(e) => setValue(e.target.value)}
            data-testid="input"
            required={q.required}
          />
          <Button type="submit" disabled={busy} data-testid="send">
            Enviar
          </Button>
        </form>
      )}
      {!q.required && (
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => send(null)}
          data-testid="skip"
        >
          Pular
        </Button>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
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
  }, [load]);

  if (status === 'loading') return <p className="text-sm text-muted-foreground">Carregando…</p>;
  if (status === 'nosession') return <NoSession />;
  if (status === 'error' || !data)
    return <p className="text-sm text-destructive">Não foi possível carregar. Tente novamente.</p>;

  const ck = data.checkin;
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Olá, {data.respondent.name}</h1>
        <p className="text-sm text-muted-foreground">
          {data.respondent.kind === 'caregiver'
            ? `Acompanhando ${data.patient.name}`
            : data.patient.clinic_name}
        </p>
      </div>
      <PushToggle subscriptions={data.push.subscriptions} />

      {data.respondent.receives_alarms && (
        <Card>
          <CardHeader>
            <CardTitle>Medicação de hoje</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.alarms.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum horário de medicação hoje.</p>
            ) : (
              data.alarms.map((a) => <AlarmRow key={a.intake_id} a={a} onDone={load} />)
            )}
          </CardContent>
        </Card>
      )}

      {data.respondent.can_answer && (
        <Card data-testid="checkin-card">
          <CardHeader>
            <CardTitle>Check-in de hoje</CardTitle>
          </CardHeader>
          <CardContent>
            {!ck ? (
              <p className="text-sm text-muted-foreground">Nenhum check-in hoje.</p>
            ) : ck.completed ? (
              <p className="text-sm" data-testid="checkin-done">
                Check-in concluído. Obrigado! ({ck.answered} respostas)
              </p>
            ) : ck.next ? (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground" data-testid="progress">
                  {ck.answered + 1} de {ck.total}
                </p>
                <QuestionForm checkinId={ck.id} q={ck.next} onAnswered={load} />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Check-in {ck.status}.</p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
