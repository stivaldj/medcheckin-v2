'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CatalogNameInput } from './CatalogNameInput';
import type { PatientCondition } from '@medcheckin/core';

/** D36 — condições do paciente vêm do catálogo da clínica; Enter adiciona, × remove. */
export function PatientConditions({
  patientId,
  conditions,
  catalog,
}: {
  patientId: string;
  conditions: PatientCondition[];
  catalog: string[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    if (name.trim().length < 2 || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/patients/${patientId}/conditions`, {
        method: 'POST',
        json: { name: name.trim() },
      });
      setName('');
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erro');
    } finally {
      setBusy(false);
    }
  }
  async function remove(id: string) {
    setBusy(true);
    try {
      await api(`/api/patients/${patientId}/conditions/${id}`, { method: 'DELETE' });
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erro');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {conditions.map((c) => (
        <Badge key={c.id} variant="outline" className="gap-1" data-testid="condition-badge">
          {c.name}
          {c.cid10 ? (
            <span className="font-mono text-[10px] text-muted-foreground">{c.cid10}</span>
          ) : null}
          {editing && (
            <button
              type="button"
              aria-label={`Remover ${c.name}`}
              className="rounded-full px-1 hover:bg-muted"
              disabled={busy}
              onClick={() => void remove(c.id)}
              data-testid="condition-remove"
            >
              ×
            </button>
          )}
        </Badge>
      ))}
      {editing ? (
        <span className="flex items-center gap-1">
          <span className="w-56">
            <CatalogNameInput
              id="condition"
              value={name}
              onChange={setName}
              suggestions={catalog}
              onSubmit={() => void add()}
              disabled={busy}
              placeholder="Condição — Enter adiciona"
              testId="condition"
            />
          </span>
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
            Pronto
          </Button>
        </span>
      ) : (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setEditing(true)}
          data-testid="condition-edit"
        >
          {conditions.length ? 'Editar condições' : 'Adicionar condição'}
        </Button>
      )}
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}
