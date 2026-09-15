'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError } from '@/lib/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { fmtDate } from '@/lib/format';
import type { AttachmentRow } from '@medcheckin/core';

const MAX = 25 * 1024 * 1024;
const fmtBytes = (n: number) =>
  n >= 1024 * 1024
    ? `${(n / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(n / 1024))} KB`;

/** D38 — anexos do paciente: PDF/JPG/PNG até 25 MB, visualizador embutido, ocultar sem apagar. */
export function AttachmentsCard({
  patientId,
  attachments,
}: {
  patientId: string;
  attachments: AttachmentRow[];
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [hiding, setHiding] = useState<string | null>(null);

  async function upload(file: File) {
    setError(null);
    if (file.size > MAX) {
      setError('Arquivo acima de 25 MB.');
      return;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`/api/patients/${patientId}/attachments`, {
        method: 'POST',
        body: fd,
        credentials: 'same-origin',
      });
      if (!res.ok) {
        const e = (await res.json().catch(() => ({}))) as { message?: string };
        throw new ApiError(res.status, 'error', e.message ?? `Erro ${res.status}`);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erro ao enviar');
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }
  async function hide(id: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/patients/${patientId}/attachments/${id}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      });
      if (!res.ok) throw new ApiError(res.status, 'error', `Erro ${res.status}`);
      setHiding(null);
      if (open === id) setOpen(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erro');
    } finally {
      setBusy(false);
    }
  }
  const url = (id: string) => `/api/patients/${patientId}/attachments/${id}`;

  return (
    <Card data-testid="attachments-card">
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle>Anexos</CardTitle>
        <div className="print:hidden">
          <input
            ref={input}
            type="file"
            accept="application/pdf,image/jpeg,image/png"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void upload(f);
            }}
            data-testid="attachment-upload"
          />
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => input.current?.click()}
          >
            {busy ? 'Enviando…' : 'Anexar arquivo'}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground print:hidden">
          PDF, JPG ou PNG até 25 MB. Exames, prontuários antigos, laudos.
        </p>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {attachments.length === 0 && <p className="text-sm text-muted-foreground">Nenhum anexo.</p>}
        <ul className="divide-y">
          {attachments.map((a) => (
            <li key={a.id} className="py-2 text-sm" data-testid="attachment-item">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  className="text-left font-medium underline-offset-2 hover:underline"
                  onClick={() => setOpen(open === a.id ? null : a.id)}
                  data-testid="attachment-open"
                >
                  {a.original_name}
                </button>
                <span className="font-mono text-xs text-muted-foreground">
                  {a.kind === 'pdf' ? 'PDF' : 'imagem'} · {fmtBytes(a.size_bytes)} ·{' '}
                  {fmtDate(a.created_at)} · {a.source === 'import' ? 'importado' : 'enviado'}
                </span>
                <span className="flex gap-1 print:hidden">
                  <a
                    href={url(a.id)}
                    target="_blank"
                    rel="noopener"
                    className="text-xs underline underline-offset-2"
                  >
                    abrir em nova aba
                  </a>
                  {hiding === a.id ? (
                    <>
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={busy}
                        onClick={() => void hide(a.id)}
                        data-testid="attachment-hide-confirm"
                      >
                        Confirmar
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setHiding(null)}>
                        Voltar
                      </Button>
                    </>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setHiding(a.id)}
                      data-testid="attachment-hide"
                    >
                      Ocultar
                    </Button>
                  )}
                </span>
              </div>
              {open === a.id && (
                <div className="mt-2 print:hidden" data-testid="attachment-viewer">
                  {a.kind === 'pdf' ? (
                    <iframe
                      src={url(a.id)}
                      title={a.original_name}
                      className="h-[70vh] w-full rounded-md border"
                    />
                  ) : (
                    <img
                      src={url(a.id)}
                      alt={a.original_name}
                      className="max-h-[70vh] rounded-md border"
                    />
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
