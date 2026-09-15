'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SimpleSelect } from '@/components/ui/simple-select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { ConditionRow } from '@medcheckin/core';

type Row = ConditionRow & { patients: number };

/** D36 — catálogo da clínica: CID-10 editável inline; Fundir corrige duplicata que escapou da chave. */
export function ConditionsTable({ rows }: { rows: Row[] }) {
  const router = useRouter();
  const [cid, setCid] = useState<Record<string, string>>({});
  const [merging, setMerging] = useState<string | null>(null);
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function saveCid(row: Row) {
    if (busy) return;
    const value = cid[row.id];
    if (value === undefined || value === (row.cid10 ?? '')) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/conditions/${row.id}`, { method: 'PATCH', json: { cid10: value || null } });
      setCid((prev) => {
        const next = { ...prev };
        delete next[row.id];
        return next;
      });
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erro');
    } finally {
      setBusy(false);
    }
  }
  async function merge(from: Row) {
    if (!target || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api('/api/conditions/merge', {
        method: 'POST',
        json: { from_id: from.id, into_id: target },
      });
      setMerging(null);
      setTarget('');
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erro');
    } finally {
      setBusy(false);
    }
  }

  if (rows.length === 0)
    return <p className="text-sm text-muted-foreground">Nenhuma condição cadastrada ainda.</p>;

  return (
    <div className="space-y-2">
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Table data-testid="conditions-table">
        <TableHeader>
          <TableRow>
            <TableHead>Condição</TableHead>
            <TableHead>CID-10</TableHead>
            <TableHead className="text-right">Pacientes</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id} data-testid="condition-row" data-name={r.name}>
              <TableCell className="font-medium">{r.name}</TableCell>
              <TableCell>
                <Input
                  className="w-28 font-mono"
                  placeholder="F41.1"
                  value={cid[r.id] ?? r.cid10 ?? ''}
                  onChange={(e) => setCid({ ...cid, [r.id]: e.target.value.toUpperCase() })}
                  onBlur={() => void saveCid(r)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void saveCid(r);
                    }
                  }}
                  disabled={busy}
                  aria-label={`CID-10 de ${r.name}`}
                  data-testid="condition-cid10"
                />
              </TableCell>
              <TableCell className="text-right font-mono">{r.patients}</TableCell>
              <TableCell className="text-right">
                {merging === r.id ? (
                  <span className="flex items-center justify-end gap-2">
                    <span className="w-56">
                      <SimpleSelect
                        value={target}
                        onValueChange={setTarget}
                        options={rows
                          .filter((x) => x.id !== r.id)
                          .map((x) => ({ value: x.id, label: x.name }))}
                        placeholder="Fundir em…"
                        size="sm"
                        data-testid="condition-merge-target"
                      />
                    </span>
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={!target || busy}
                      onClick={() => void merge(r)}
                      data-testid="condition-merge-confirm"
                    >
                      Fundir ({r.patients} vínculo{r.patients === 1 ? '' : 's'})
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setMerging(null)}>
                      Cancelar
                    </Button>
                  </span>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={rows.length < 2}
                    onClick={() => {
                      setMerging(r.id);
                      setTarget('');
                    }}
                    data-testid="condition-merge"
                  >
                    Fundir em…
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
