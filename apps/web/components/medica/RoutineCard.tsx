'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { DoseDialog, type Med } from './DoseDialog';
import type { QuestionSetRow, RoutinePeriod, RoutineView } from '@medcheckin/core';

type QSet = Pick<QuestionSetRow, 'id' | 'name'>;
type AlarmForm = { time: string; description: string };

const br = (iso: string | null) => (iso ? iso.split('-').reverse().join('/') : '—');
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

function AlarmFields({
  alarms,
  setAlarms,
}: {
  alarms: AlarmForm[];
  setAlarms: (a: AlarmForm[]) => void;
}) {
  const patch = (i: number, p: Partial<AlarmForm>) =>
    setAlarms(alarms.map((a, j) => (j === i ? { ...a, ...p } : a)));
  return (
    <div className="space-y-2">
      <Label>Alarmes (horário + o que tomar)</Label>
      {alarms.map((a, i) => (
        <div key={i} className="flex items-start gap-2">
          <Input
            type="time"
            required
            className="w-28"
            value={a.time}
            data-testid={`routine-time-${i}`}
            onChange={(e) => patch(i, { time: e.target.value })}
          />
          <Input
            required
            placeholder="ômega 3 1cp / 4 gts óleo IBRACAN 10% / vitamina D"
            value={a.description}
            data-testid={`routine-desc-${i}`}
            onChange={(e) => patch(i, { description: e.target.value })}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={alarms.length === 1}
            onClick={() => setAlarms(alarms.filter((_, j) => j !== i))}
            data-testid={`routine-remove-${i}`}
          >
            remover
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setAlarms([...alarms, { time: '12:00', description: '' }])}
        data-testid="routine-add-alarm"
      >
        Adicionar horário
      </Button>
    </div>
  );
}

function PeriodDialog({
  patientId,
  mode,
  source,
  period,
  medications,
  questionSets,
  today,
  trigger,
  testId,
}: {
  patientId: string;
  mode: 'create' | 'replicate' | 'edit';
  source?: RoutinePeriod | null;
  period?: RoutinePeriod;
  medications: Med[];
  questionSets: QSet[];
  today: string;
  trigger: string;
  testId: string;
}) {
  const router = useRouter();
  const base = mode === 'edit' ? period : mode === 'replicate' ? source : null;
  const defaultStart =
    mode === 'edit'
      ? (period?.starts_on ?? today)
      : mode === 'replicate' && source?.ends_on
        ? addDays(source.ends_on, 1)
        : today;
  const [open, setOpen] = useState(false);
  const [starts, setStarts] = useState(defaultStart);
  const [ends, setEnds] = useState(mode === 'edit' ? (period?.ends_on ?? '') : '');
  const [alarms, setAlarms] = useState<AlarmForm[]>(
    base?.alarms.map((a) => ({ time: a.time, description: a.description })) ?? [
      { time: '08:00', description: '' },
    ],
  );
  // D27: nulo = padrão do sistema (60 min). O campo é opcional de propósito — a médica só mexe
  // quando o regime pede horário rígido.
  const [maxLate, setMaxLate] = useState<string>(
    base?.max_late_min === null || base?.max_late_min === undefined
      ? ''
      : String(base.max_late_min),
  );
  const [withDose, setWithDose] = useState(false);
  const [doseOpen, setDoseOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const payload = {
        starts_on: starts,
        ends_on: ends || null,
        alarms,
        max_late_min: maxLate === '' ? null : Number(maxLate),
      };
      if (mode === 'edit') {
        await api(`/api/routine-periods/${period!.id}`, { method: 'PATCH', json: payload });
      } else {
        await api(`/api/patients/${patientId}/routine-periods`, {
          method: 'POST',
          json: { ...payload, replicated_from: mode === 'replicate' ? (source?.id ?? null) : null },
        });
      }
      setOpen(false);
      // D16: a dose estruturada do óleo continua existindo em paralelo ao texto livre.
      if (withDose && medications.length) setDoseOpen(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erro');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger
          render={
            <Button
              size="sm"
              variant={mode === 'create' ? 'default' : 'outline'}
              data-testid={testId}
            />
          }
        >
          {trigger}
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {mode === 'edit'
                ? 'Editar período'
                : mode === 'replicate'
                  ? 'Replicar período'
                  : 'Novo período'}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-3">
            {mode === 'replicate' && (
              <p className="text-xs text-muted-foreground">
                Horários e textos copiados do período vigente — edite o que mudou antes de salvar.
              </p>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor={`${testId}-start`}>Início</Label>
                <Input
                  id={`${testId}-start`}
                  type="date"
                  required
                  value={starts}
                  onChange={(e) => setStarts(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor={`${testId}-end`}>Fim (opcional)</Label>
                <Input
                  id={`${testId}-end`}
                  type="date"
                  value={ends}
                  onChange={(e) => setEnds(e.target.value)}
                />
              </div>
            </div>
            <AlarmFields alarms={alarms} setAlarms={setAlarms} />
            <div>
              <Label htmlFor={`${testId}-maxlate`}>Atraso máximo do lembrete (opcional)</Label>
              <div className="flex items-center gap-2">
                <Input
                  id={`${testId}-maxlate`}
                  type="number"
                  min={0}
                  max={1440}
                  step={5}
                  className="w-28"
                  placeholder="60"
                  value={maxLate}
                  onChange={(e) => setMaxLate(e.target.value)}
                  data-testid={`${testId}-maxlate`}
                />
                <span className="text-sm text-muted-foreground">minutos</span>
              </div>
              <p className="mt-1 max-w-[62ch] text-xs text-muted-foreground">
                Se o sistema ficar fora do ar, um lembrete atrasado além disso não é enviado — em
                branco usa 60 min. Independente do valor, um lembrete nunca é enviado depois que a
                dose seguinte já venceu.
              </p>
            </div>
            {mode !== 'edit' && medications.length > 0 && (
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={withDose}
                  onCheckedChange={(v) => setWithDose(v === true)}
                  data-testid="routine-with-dose"
                />{' '}
                houve ajuste do óleo? registrar a dose estruturada em seguida
              </label>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" disabled={busy} data-testid={`${testId}-submit`}>
              {busy ? 'Salvando…' : 'Salvar período'}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
      {medications.length > 0 && (
        <DoseDialog
          med={medications[0]}
          questionSets={questionSets}
          withTrigger={false}
          open={doseOpen}
          onOpenChange={setDoseOpen}
          onDone={() => router.refresh()}
        />
      )}
    </>
  );
}

function AlarmList({ period }: { period: RoutinePeriod }) {
  return (
    <ul className="mt-2 space-y-1 text-sm">
      {period.alarms.map((a) => (
        <li key={a.id} className="flex gap-2">
          <span className="w-14 shrink-0 font-medium tabular-nums">{a.time}</span>
          <span>— {a.description}</span>
        </li>
      ))}
    </ul>
  );
}

/** PRIMEIRO card da página do paciente: a rotina de avisos à primeira vista (E9.1 / D15). */
export function RoutineCard({
  patientId,
  routine,
  medications,
  questionSets,
}: {
  patientId: string;
  routine: RoutineView;
  medications: Med[];
  questionSets: QSet[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cur = routine.current;

  async function endToday() {
    if (!cur) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/routine-periods/${cur.id}/end-today`, { method: 'POST' });
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erro');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card data-testid="routine-card">
      <CardHeader>
        <CardTitle>Rotina de alarmes</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div data-testid="routine-current">
          {cur ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">
                  {br(cur.starts_on)} → {cur.ends_on ? br(cur.ends_on) : 'sem fim previsto'}
                </span>
                <Badge variant="secondary">
                  {cur.alarms.length} {cur.alarms.length === 1 ? 'alarme' : 'alarmes'}
                </Badge>
                {cur.replicated_from && <Badge variant="outline">replicado</Badge>}
              </div>
              <AlarmList period={cur} />
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Nenhum período vigente — os alarmes estão parados. Crie um período para retomar.
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <PeriodDialog
            patientId={patientId}
            mode="create"
            medications={medications}
            questionSets={questionSets}
            today={routine.today}
            trigger="Novo período"
            testId="routine-new"
          />
          {cur && (
            <>
              <PeriodDialog
                patientId={patientId}
                mode="replicate"
                source={cur}
                medications={medications}
                questionSets={questionSets}
                today={routine.today}
                trigger="Replicar período"
                testId="routine-replicate"
              />
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={endToday}
                data-testid="routine-end-today"
              >
                Encerrar hoje
              </Button>
            </>
          )}
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}

        {routine.upcoming.length > 0 && (
          <div data-testid="routine-upcoming">
            <h3 className="text-sm font-medium">Próximos períodos</h3>
            {routine.upcoming.map((p) => (
              <div key={p.id} className="mt-2 rounded-md border p-2" data-testid="routine-future">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium">
                    {br(p.starts_on)} → {p.ends_on ? br(p.ends_on) : 'sem fim previsto'} ·{' '}
                    {p.alarms.length} alarmes
                  </span>
                  <PeriodDialog
                    patientId={patientId}
                    mode="edit"
                    period={p}
                    medications={medications}
                    questionSets={questionSets}
                    today={routine.today}
                    trigger="Editar"
                    testId={`routine-edit-${p.id}`}
                  />
                </div>
                <AlarmList period={p} />
              </div>
            ))}
          </div>
        )}

        <div className="text-sm" data-testid="routine-recipients">
          <h3 className="font-medium">Quem recebe</h3>
          {routine.recipients.length === 0 ? (
            <p className="text-muted-foreground">
              Ninguém marcado para receber alarmes — os avisos não saem.
            </p>
          ) : (
            <ul className="mt-1 space-y-0.5 text-muted-foreground">
              {routine.recipients.map((r) => (
                <li key={r.id}>
                  {r.name} ({r.kind === 'caregiver' ? 'cuidador' : 'paciente'}) ·{' '}
                  {!r.accepted
                    ? 'convite não aceito'
                    : r.push_subscriptions > 0
                      ? `push ativo (${r.push_subscriptions})`
                      : 'sem push no aparelho'}
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
