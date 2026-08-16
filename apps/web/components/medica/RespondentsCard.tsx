'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

import type { RespondentRow } from '@medcheckin/core';

type Respondent = RespondentRow & { invite_url: string };

export function RespondentsCard({
  patientId,
  respondents,
}: {
  patientId: string;
  respondents: Respondent[];
}) {
  const router = useRouter();
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', relationship: '', email: '', phone: '' });
  const [busy, setBusy] = useState(false);

  async function copy(r: Respondent) {
    try {
      await navigator.clipboard.writeText(r.invite_url);
      setCopied(r.id);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      setError('Não foi possível copiar; selecione o link manualmente.');
    }
  }
  async function toggle(r: Respondent, field: 'can_answer' | 'receives_alarms') {
    setError(null);
    try {
      await api(`/api/respondents/${r.id}`, { method: 'PATCH', json: { [field]: !r[field] } });
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Erro');
    }
  }
  async function rotate(r: Respondent) {
    if (!confirm('Gerar novo link invalida o anterior. Continuar?')) return;
    try {
      await api(`/api/respondents/${r.id}/rotate`, { method: 'POST' });
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Erro');
    }
  }
  async function addCaregiver(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/api/patients/${patientId}/respondents`, {
        method: 'POST',
        json: { kind: 'caregiver', ...form, email: form.email || null, phone: form.phone || null },
      });
      setOpen(false);
      setForm({ name: '', relationship: '', email: '', phone: '' });
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erro');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card data-testid="respondents-card">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Respondentes</CardTitle>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger render={<Button size="sm" variant="outline" />}>
            Convidar cuidador
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Novo cuidador</DialogTitle>
            </DialogHeader>
            <form onSubmit={addCaregiver} className="space-y-3">
              <div>
                <Label htmlFor="cg-name">Nome</Label>
                <Input
                  id="cg-name"
                  required
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="cg-rel">Relação</Label>
                <Input
                  id="cg-rel"
                  value={form.relationship}
                  onChange={(e) => setForm({ ...form, relationship: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="cg-email">E-mail (opcional)</Label>
                <Input
                  id="cg-email"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="cg-phone">Telefone (opcional)</Label>
                <Input
                  id="cg-phone"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                />
              </div>
              <Button type="submit" disabled={busy}>
                {busy ? 'Salvando…' : 'Criar convite'}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent className="space-y-3">
        {respondents.map((r) => (
          <div
            key={r.id}
            className="rounded-md border p-3 text-sm"
            data-testid={`respondent-${r.kind}`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <strong>{r.name}</strong>
              <Badge variant="outline">
                {r.kind === 'patient'
                  ? 'paciente'
                  : `cuidador${r.relationship ? ` · ${r.relationship}` : ''}`}
              </Badge>
              <Badge variant={r.accepted_at ? 'default' : 'secondary'}>
                {r.accepted_at ? 'aceitou' : 'convite pendente'}
              </Badge>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <code
                className="max-w-full truncate rounded bg-muted px-2 py-1 text-xs"
                data-testid="invite-url"
              >
                {r.invite_url}
              </code>
              <Button size="sm" variant="secondary" onClick={() => copy(r)}>
                {copied === r.id ? 'Copiado!' : 'Copiar link'}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => rotate(r)}>
                Novo link
              </Button>
            </div>
            <div className="mt-2 flex gap-4 text-xs">
              <label className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={r.can_answer}
                  onChange={() => toggle(r, 'can_answer')}
                />{' '}
                responde check-ins
              </label>
              <label className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={r.receives_alarms}
                  onChange={() => toggle(r, 'receives_alarms')}
                />{' '}
                recebe alarmes
              </label>
            </div>
          </div>
        ))}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
