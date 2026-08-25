'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/client';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { fmt, fmtDate, isoDay } from '@/lib/format';
import { DoseDialog, type Med } from './DoseDialog';

import type { ProductRow, QuestionSetRow } from '@medcheckin/core';

type Product = Pick<ProductRow, 'id' | 'name'>;
type QSet = Pick<QuestionSetRow, 'id' | 'name'>;

export function MedicationsCard({
  patientId,
  medications,
  products,
  questionSets,
}: {
  patientId: string;
  medications: Med[];
  products: Product[];
  questionSets: QSet[];
}) {
  const router = useRouter();
  const [productId, setProductId] = useState(products[0]?.id ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function addMed(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/api/patients/${patientId}/medications`, {
        method: 'POST',
        json: { product_id: productId },
      });
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erro');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card data-testid="medications-card">
      <CardHeader>
        <CardTitle>Medicações e dose vigente</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {medications.length === 0 && (
          <p className="text-sm text-muted-foreground">Nenhuma medicação.</p>
        )}
        {medications.map((m) => (
          <div key={m.id} className="rounded-md border p-3" data-testid="medication">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="font-medium">{m.product_name}</div>
                <div className="text-sm" data-testid="current-dose">
                  {m.current_dose
                    ? `Dose vigente: ${fmt(m.current_dose.dose_amount)} ${m.current_dose.dose_unit} · ${m.current_dose.times_per_day}×/dia (${m.current_dose.schedule_times.map((t) => String(t).slice(0, 5)).join(', ')}) desde ${fmtDate(isoDay(m.current_dose.effective_from) + 'T12:00:00Z')}`
                    : 'Sem dose vigente — registre o primeiro ajuste.'}
                </div>
              </div>
              <DoseDialog med={m} questionSets={questionSets} onDone={() => router.refresh()} />
            </div>
            {m.dose_history.length > 0 && (
              <details className="mt-2 text-xs text-muted-foreground">
                <summary>Histórico ({m.dose_history.length})</summary>
                <ul className="mt-1 space-y-0.5">
                  {m.dose_history.map((d) => (
                    <li key={d.id}>
                      {fmtDate(isoDay(d.effective_from) + 'T12:00:00Z')}: {fmt(d.dose_amount)}{' '}
                      {d.dose_unit} · {d.times_per_day}×/dia{d.reason ? ` — ${d.reason}` : ''}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        ))}
        <form onSubmit={addMed} className="flex items-end gap-2">
          <div className="flex-1">
            <Label htmlFor="product">Adicionar medicação</Label>
            <select
              id="product"
              className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
              data-testid="product-select"
            >
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <Button
            type="submit"
            variant="outline"
            disabled={busy || !productId}
            data-testid="add-medication"
          >
            Adicionar
          </Button>
        </form>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
