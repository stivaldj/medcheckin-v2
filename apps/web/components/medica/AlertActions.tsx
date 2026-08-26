'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/client';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

/** Reconhecer / Resolver com conduta (L15: nota obrigatória — o servidor recusa sem ela). */
export function AlertActions({ alertId, status }: { alertId: string; status: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function ack() {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/alerts/${alertId}/ack`, { method: 'POST' });
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Erro');
    } finally {
      setBusy(false);
    }
  }
  async function resolve(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/api/alerts/${alertId}/resolve`, { method: 'POST', json: { note } });
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erro');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mt-2 space-y-2">
      <div className="flex gap-2">
        {status === 'open' && (
          <Button size="sm" variant="outline" disabled={busy} onClick={ack} data-testid="ack">
            Reconhecer
          </Button>
        )}
        <Button
          size="sm"
          variant="secondary"
          disabled={busy}
          onClick={() => setOpen((v) => !v)}
          data-testid="resolve-open"
        >
          Resolver com conduta
        </Button>
      </div>
      {open && (
        <form onSubmit={resolve} className="space-y-2">
          <Textarea
            required
            minLength={3}
            placeholder="Conduta (obrigatória): o que foi feito/orientado"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            data-testid="conduct-note"
          />
          <Button size="sm" type="submit" disabled={busy} data-testid="resolve-submit">
            {busy ? 'Salvando…' : 'Registrar conduta e resolver'}
          </Button>
        </form>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
