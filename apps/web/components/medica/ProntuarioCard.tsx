'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { SimpleSelect } from '@/components/ui/simple-select';
import { Badge } from '@/components/ui/badge';
import { fmtDate, fmtDateTime } from '@/lib/format';
import { PrintButton } from './PrintButton';
import type { ClinicalNoteRow, NoteKind, TimelineDay } from '@medcheckin/core';

const KIND_LABEL: Record<NoteKind, string> = {
  consulta: 'Consulta',
  evolucao: 'Evolução',
  contato: 'Contato',
  importada: 'Importada',
};
const KIND_OPTIONS = (['consulta', 'evolucao', 'contato'] as NoteKind[]).map((k) => ({
  value: k,
  label: KIND_LABEL[k],
}));

type Draft = { id: string | null; kind: NoteKind; occurred_at: string; body: string };

/**
 * D35 — prontuário como nota livre datada. O editor é inline (sem modal) para o texto ficar
 * visível ao lado da linha do tempo; Ctrl+Enter salva. A linha do tempo agrupa por dia civil do
 * paciente: nota em cima, ajuste de dose e conduta do mesmo dia embaixo (core: patientTimeline).
 */
export function ProntuarioCard({
  patientId,
  timeline,
  today,
}: {
  patientId: string;
  timeline: TimelineDay[];
  today: string;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [hiding, setHiding] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function novaNota() {
    setError(null);
    setDraft({ id: null, kind: 'consulta', occurred_at: today, body: '' });
  }
  function editar(n: ClinicalNoteRow) {
    setError(null);
    setDraft({
      id: n.id,
      kind: n.kind,
      // occurred_at chega já normalizado como 'AAAA-MM-DD' (noteDay aplicado no servidor).
      occurred_at: n.occurred_at as string,
      body: n.body,
    });
  }
  async function salvar() {
    if (!draft || busy || draft.body.trim().length === 0) return;
    setBusy(true);
    setError(null);
    try {
      if (draft.id)
        await api(`/api/patients/${patientId}/notes/${draft.id}`, {
          method: 'PATCH',
          json: { kind: draft.kind, occurred_at: draft.occurred_at, body: draft.body },
        });
      else
        await api(`/api/patients/${patientId}/notes`, {
          method: 'POST',
          json: { kind: draft.kind, occurred_at: draft.occurred_at, body: draft.body },
        });
      setDraft(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erro');
    } finally {
      setBusy(false);
    }
  }
  async function ocultar(id: string) {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/patients/${patientId}/notes/${id}`, { method: 'DELETE' });
      setHiding(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erro');
    } finally {
      setBusy(false);
    }
  }

  const podeSalvar = !!draft && draft.body.trim().length > 0 && !busy;

  return (
    <Card data-testid="prontuario-card">
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle>Prontuário</CardTitle>
        <div className="flex gap-2 print:hidden">
          <PrintButton />
          <Button onClick={novaNota} disabled={!!draft} data-testid="note-new">
            Nova nota
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {draft && (
          <form
            className="space-y-3 rounded-md border p-3 print:hidden"
            onSubmit={(e) => {
              e.preventDefault();
              void salvar();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                void salvar();
              }
            }}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="note-kind">Tipo</Label>
                <SimpleSelect
                  id="note-kind"
                  value={draft.kind}
                  onValueChange={(v) => setDraft({ ...draft, kind: v as NoteKind })}
                  options={KIND_OPTIONS}
                  data-testid="note-kind"
                />
              </div>
              <div>
                <Label htmlFor="note-date">Data</Label>
                <Input
                  id="note-date"
                  type="date"
                  max={today}
                  value={draft.occurred_at}
                  onChange={(e) => setDraft({ ...draft, occurred_at: e.target.value })}
                  data-testid="note-date"
                />
              </div>
            </div>
            <div>
              <Label htmlFor="note-body">Nota</Label>
              <Textarea
                id="note-body"
                autoFocus
                rows={6}
                maxLength={20000}
                value={draft.body}
                placeholder="Escreva como você escreve: queixa, exame, hipótese, conduta…"
                onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                data-testid="note-body"
              />
              <p className="mt-1 text-xs text-muted-foreground">Ctrl+Enter salva.</p>
            </div>
            <div className="flex gap-2">
              <Button type="submit" disabled={!podeSalvar} data-testid="note-save">
                {draft.id ? 'Salvar alterações' : 'Salvar nota'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setDraft(null)}
                data-testid="note-cancel"
              >
                Cancelar
              </Button>
            </div>
          </form>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}

        {timeline.length === 0 && !draft && (
          <p className="text-sm text-muted-foreground">
            Nenhuma nota ainda. Toque em <strong>Nova nota</strong> na consulta.
          </p>
        )}

        <ol className="space-y-4">
          {timeline.map((d) => (
            <li key={d.day} data-testid="timeline-day" data-day={d.day}>
              <div className="mb-1 font-mono text-xs text-muted-foreground">
                {fmtDate(d.day + 'T12:00:00Z', {
                  day: '2-digit',
                  month: '2-digit',
                  year: 'numeric',
                })}
              </div>
              <div className="space-y-2 border-l-2 pl-3">
                {d.notes.map((n) => (
                  <article key={n.id} className="rounded-md border p-3" data-testid="note-item">
                    <header className="mb-1 flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className="flex items-center gap-2">
                        <Badge variant="outline">{KIND_LABEL[n.kind]}</Badge>
                        {n.source ? (
                          <span className="text-muted-foreground">
                            importada de {n.source.file ?? 'arquivo'}
                            {n.source.page ? `, p. ${n.source.page}` : ''}
                          </span>
                        ) : null}
                      </span>
                      {!n.source && hiding !== n.id && (
                        <span className="flex gap-1 print:hidden">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => editar(n)}
                            data-testid="note-edit"
                          >
                            Editar
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setHiding(n.id)}
                            data-testid="note-hide"
                          >
                            Ocultar
                          </Button>
                        </span>
                      )}
                      {hiding === n.id && (
                        <span className="flex items-center gap-2 print:hidden">
                          <span className="text-muted-foreground">
                            A nota some da lista, mas fica guardada.
                          </span>
                          <Button
                            size="sm"
                            variant="destructive"
                            disabled={busy}
                            onClick={() => void ocultar(n.id)}
                            data-testid="note-hide-confirm"
                          >
                            Confirmar
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setHiding(null)}>
                            Voltar
                          </Button>
                        </span>
                      )}
                    </header>
                    <p className="whitespace-pre-wrap text-sm">{n.body}</p>
                  </article>
                ))}
                {d.events.map((e) => (
                  <div
                    key={e.ref_id}
                    className="grid grid-cols-[5rem_1fr] gap-2 text-xs"
                    data-testid="timeline-event"
                    data-kind={e.kind}
                  >
                    <span className="font-mono text-muted-foreground">
                      {e.kind === 'dose' ? 'dose' : fmtDateTime(e.at).slice(-5)}
                    </span>
                    <span>
                      <span className="text-muted-foreground">
                        {e.kind === 'dose'
                          ? 'Ajuste de dose · '
                          : `Conduta${e.by ? ` · ${e.by}` : ''} · `}
                      </span>
                      {e.summary}
                    </span>
                  </div>
                ))}
              </div>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
