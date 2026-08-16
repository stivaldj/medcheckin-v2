'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { fmt, fmtDate, isoDay } from '@/lib/format';

import type { DoseEvent, MedicationRow, ProductRow, QuestionSetRow } from '@medcheckin/core';

type Med = MedicationRow & { dose_history: DoseEvent[] };
type Product = Pick<ProductRow, 'id' | 'name'>;
type QSet = Pick<QuestionSetRow, 'id' | 'name'>;

const UNITS = ['gotas', 'ml', 'mg', 'cápsulas'];

function DoseDialog({
  med,
  questionSets,
  onDone,
}: {
  med: Med;
  questionSets: QSet[];
  onDone: () => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const cur = med.current_dose;
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    effective_from: today,
    dose_amount: cur ? String(cur.dose_amount) : '',
    dose_unit: cur?.dose_unit ?? 'gotas',
    times_per_day: cur ? cur.times_per_day : 2,
    schedule_times: cur?.schedule_times?.map((t) => String(t).slice(0, 5)) ?? ['08:00', '20:00'],
    reason: '',
    note: '',
    open_titration: true,
    question_set_id: questionSets[0]?.id ?? '',
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function setTimes(n: number) {
    const times = [...form.schedule_times];
    while (times.length < n) times.push('12:00');
    setForm({ ...form, times_per_day: n, schedule_times: times.slice(0, n) });
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/api/medications/${med.id}/doses`, {
        method: 'POST',
        json: {
          ...form,
          dose_amount: Number(form.dose_amount),
          reason: form.reason || null,
          note: form.note || null,
          question_set_id: form.question_set_id || undefined,
        },
      });
      setOpen(false);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erro');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" data-testid={`adjust-dose-${med.id}`} />}>
        Ajustar dose
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ajustar dose — {med.product_name}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="d-from">Vigente a partir de</Label>
              <Input
                id="d-from"
                type="date"
                required
                value={form.effective_from}
                onChange={(e) => setForm({ ...form, effective_from: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="d-amount">Dose</Label>
              <Input
                id="d-amount"
                type="number"
                step="0.01"
                min="0.01"
                required
                value={form.dose_amount}
                onChange={(e) => setForm({ ...form, dose_amount: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="d-unit">Unidade</Label>
              <select
                id="d-unit"
                className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                value={form.dose_unit}
                onChange={(e) => setForm({ ...form, dose_unit: e.target.value })}
              >
                {UNITS.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="d-tpd">Vezes por dia</Label>
              <Input
                id="d-tpd"
                type="number"
                min={1}
                max={12}
                required
                value={form.times_per_day}
                onChange={(e) => setTimes(Math.max(1, Math.min(12, Number(e.target.value) || 1)))}
              />
            </div>
          </div>
          <div>
            <Label>Horários</Label>
            <div className="flex flex-wrap gap-2">
              {form.schedule_times.map((t, i) => (
                <Input
                  key={i}
                  type="time"
                  className="w-28"
                  required
                  value={t}
                  data-testid={`dose-time-${i}`}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      schedule_times: form.schedule_times.map((x, j) =>
                        j === i ? e.target.value : x,
                      ),
                    })
                  }
                />
              ))}
            </div>
          </div>
          <div>
            <Label htmlFor="d-reason">Motivo</Label>
            <Input
              id="d-reason"
              value={form.reason}
              placeholder="titulação: dor persistente"
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="d-note">Observação</Label>
            <Textarea
              id="d-note"
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={form.open_titration}
              onCheckedChange={(v) => setForm({ ...form, open_titration: v === true })}
            />{' '}
            abrir episódio de titulação (check-in diário) a partir deste ajuste
          </label>
          {form.open_titration && questionSets.length > 1 && (
            <div>
              <Label htmlFor="d-qs">Conjunto de perguntas</Label>
              <select
                id="d-qs"
                className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                value={form.question_set_id}
                onChange={(e) => setForm({ ...form, question_set_id: e.target.value })}
              >
                {questionSets.map((q) => (
                  <option key={q.id} value={q.id}>
                    {q.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={busy}>
            {busy ? 'Salvando…' : 'Registrar ajuste'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

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
