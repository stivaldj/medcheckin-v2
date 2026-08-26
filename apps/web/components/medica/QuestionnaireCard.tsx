'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SimpleSelect } from '@/components/ui/simple-select';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { PatientQuestion } from '@medcheckin/core';

const KINDS = [
  { value: 'yes_no', label: 'sim / não' },
  { value: 'scale_0_10', label: 'escala 0–10' },
  { value: 'number', label: 'número' },
  { value: 'text', label: 'texto livre' },
] as const;

const KIND_LABEL = Object.fromEntries(KINDS.map((k) => [k.value, k.label]));
const PRESETS = [
  { label: 'Manhã (09:00)', value: '09:00' },
  { label: 'Noite (20:00)', value: '20:00' },
];

function CheckinTime({ patientId, value }: { patientId: string; value: string }) {
  const router = useRouter();
  const current = String(value ?? '').slice(0, 5);
  const [time, setTime] = useState(current);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(next: string) {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/patients/${patientId}`, { method: 'PATCH', json: { checkin_time: next } });
      setTime(next);
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Erro');
      setTime(current);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2" data-testid="checkin-time">
      <Label htmlFor="checkin-time-input">Horário do check-in</Label>
      <div className="flex flex-wrap items-center gap-2">
        {PRESETS.map((p) => (
          <Button
            key={p.value}
            size="sm"
            variant={current === p.value ? 'default' : 'outline'}
            disabled={busy}
            onClick={() => save(p.value)}
            data-testid={`checkin-time-${p.value}`}
          >
            {p.label}
          </Button>
        ))}
        <Input
          id="checkin-time-input"
          type="time"
          className="w-28"
          value={time}
          disabled={busy}
          onChange={(e) => setTime(e.target.value)}
          onBlur={() => time && time !== current && save(time)}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Vale a partir do próximo check-in. Fora da janela de silêncio do paciente.
      </p>
      {error && (
        <p className="text-sm text-destructive" data-testid="checkin-time-error">
          {error}
        </p>
      )}
    </div>
  );
}

/** E9.2 — questionário do paciente: horário do disparo + perguntas extras da médica. */
export function QuestionnaireCard({
  patientId,
  checkinTime,
  questions,
  packHasAdherence,
}: {
  patientId: string;
  checkinTime: string;
  questions: PatientQuestion[];
  packHasAdherence: boolean;
}) {
  const router = useRouter();
  const [label, setLabel] = useState('');
  const [kind, setKind] = useState<string>('yes_no');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasAdherence = packHasAdherence || questions.some((q) => q.key === 'adesao' && q.active);

  async function post(json: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/patients/${patientId}/questions`, { method: 'POST', json });
      setLabel('');
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Erro');
    } finally {
      setBusy(false);
    }
  }

  async function toggle(q: PatientQuestion) {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/questions/${q.id}`, { method: 'PATCH', json: { active: !q.active } });
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Erro');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card data-testid="questionnaire-card">
      <CardHeader>
        <CardTitle>Questionário</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <CheckinTime patientId={patientId} value={checkinTime} />

        <div className="space-y-2">
          <h3 className="text-sm font-medium">Perguntas extras deste paciente</h3>
          {questions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhuma. O paciente responde só o pack do episódio.
            </p>
          ) : (
            <ul className="space-y-1">
              {questions.map((q) => (
                <li
                  key={q.id}
                  className="flex flex-wrap items-center gap-2 rounded-md border p-2 text-sm"
                  data-testid={`patient-question-${q.key}`}
                >
                  <span className={q.active ? '' : 'text-muted-foreground line-through'}>
                    {q.label}
                  </span>
                  <Badge variant="outline">{KIND_LABEL[q.kind] ?? q.kind}</Badge>
                  {!q.active && <Badge variant="secondary">desativada</Badge>}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="ml-auto"
                    disabled={busy}
                    onClick={() => toggle(q)}
                    data-testid={`toggle-${q.key}`}
                  >
                    {q.active ? 'Desativar' : 'Reativar'}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            post({ label, kind });
          }}
        >
          <div className="min-w-56 flex-1">
            <Label htmlFor="pq-label">Adicionar pergunta</Label>
            <Input
              id="pq-label"
              required
              minLength={6}
              placeholder="Teve espasmos hoje?"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              data-testid="patient-question-label"
            />
          </div>
          <div>
            <Label htmlFor="pq-kind">Tipo</Label>
            <SimpleSelect
              id="pq-kind"
              value={kind}
              onValueChange={setKind}
              options={KINDS.map((k) => ({ value: k.value, label: k.label }))}
              data-testid="patient-question-kind"
            />
          </div>
          <Button
            type="submit"
            variant="outline"
            disabled={busy}
            data-testid="add-patient-question"
          >
            Adicionar
          </Button>
        </form>

        {!hasAdherence && (
          <div className="rounded-md border border-dashed p-2 text-sm">
            <p className="text-muted-foreground">
              O questionário deste paciente não pergunta adesão — sem ela, o relatório e o “Hoje”
              ficam sem esse número.
            </p>
            <Button
              size="sm"
              variant="outline"
              className="mt-2"
              disabled={busy}
              onClick={() => post({ preset: 'adesao' })}
              data-testid="add-adherence-question"
            >
              Adicionar “Tomou as medicações corretamente hoje?”
            </Button>
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          As extras entram depois do pack, a partir do próximo check-in. Desativar não apaga as
          respostas já dadas.
        </p>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
