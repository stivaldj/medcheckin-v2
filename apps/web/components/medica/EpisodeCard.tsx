'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/client';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { SimpleSelect } from '@/components/ui/simple-select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { fmtDate, EPISODE_LABEL, FREQ_LABEL } from '@/lib/format';

import type { EpisodeRow, QuestionSetRow } from '@medcheckin/core';

type Episode = (EpisodeRow & { question_set_name: string | null }) | null;
type QSet = Pick<QuestionSetRow, 'id' | 'name'>;

export function EpisodeCard({
  patientId,
  episode,
  questionSets,
}: {
  patientId: string;
  episode: Episode;
  questionSets: QSet[];
}) {
  const router = useRouter();
  const [form, setForm] = useState<{
    kind: string;
    checkin_frequency: string;
    question_set_id: string;
  }>({
    kind: episode?.kind ?? 'maintenance',
    checkin_frequency: episode?.checkin_frequency ?? 'weekly',
    question_set_id: questionSets[0]?.id ?? '',
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/api/patients/${patientId}/episodes`, { method: 'POST', json: form });
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erro');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card data-testid="episode-card">
      <CardHeader>
        <CardTitle>Episódio de acompanhamento</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm">
          {episode ? (
            <>
              <strong>{EPISODE_LABEL[episode.kind] ?? episode.kind}</strong> · check-in{' '}
              {FREQ_LABEL[episode.checkin_frequency] ?? episode.checkin_frequency} · desde{' '}
              {fmtDate(episode.started_at)} · perguntas: {episode.question_set_name ?? '—'}
            </>
          ) : (
            'Nenhum episódio aberto — sem check-ins agendados.'
          )}
        </p>
        <form onSubmit={submit} className="grid grid-cols-3 items-end gap-2">
          <div>
            <Label>Tipo</Label>
            <SimpleSelect
              aria-label="Tipo"
              value={form.kind}
              onValueChange={(v) => setForm({ ...form, kind: v })}
              options={[
                { value: 'titration', label: 'Titulação' },
                { value: 'maintenance', label: 'Manutenção' },
              ]}
            />
          </div>
          <div>
            <Label>Frequência</Label>
            <SimpleSelect
              aria-label="Frequência"
              value={form.checkin_frequency}
              onValueChange={(v) => setForm({ ...form, checkin_frequency: v })}
              options={[
                { value: 'daily', label: 'diário' },
                { value: 'weekly', label: 'semanal' },
                { value: 'biweekly', label: 'quinzenal' },
              ]}
            />
          </div>
          <div>
            <Label>Perguntas</Label>
            <SimpleSelect
              aria-label="Perguntas"
              value={form.question_set_id}
              onValueChange={(v) => setForm({ ...form, question_set_id: v })}
              options={questionSets.map((q) => ({ value: q.id, label: q.name }))}
            />
          </div>
          <Button
            type="submit"
            variant="outline"
            className="col-span-3"
            disabled={busy || !form.question_set_id}
          >
            {episode ? 'Trocar episódio' : 'Abrir episódio'}
          </Button>
        </form>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
