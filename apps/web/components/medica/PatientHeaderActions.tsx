'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/client';
import { Button } from '@/components/ui/button';

export function PatientHeaderActions({ patientId, status }: { patientId: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function setStatus(next: 'active' | 'paused' | 'discharged') {
    if (
      next === 'discharged' &&
      !confirm('Dar alta encerra envios e o acesso do respondente. Confirmar?')
    )
      return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/patients/${patientId}`, { method: 'PATCH', json: { status: next } });
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Erro');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex items-center gap-2">
      {status === 'active' && (
        <Button variant="outline" disabled={busy} onClick={() => setStatus('paused')}>
          Pausar envios
        </Button>
      )}
      {status === 'paused' && (
        <Button variant="outline" disabled={busy} onClick={() => setStatus('active')}>
          Retomar envios
        </Button>
      )}
      {status !== 'discharged' && (
        <Button variant="ghost" disabled={busy} onClick={() => setStatus('discharged')}>
          Dar alta
        </Button>
      )}
      {error && <span className="text-sm text-destructive">{error}</span>}
    </div>
  );
}
