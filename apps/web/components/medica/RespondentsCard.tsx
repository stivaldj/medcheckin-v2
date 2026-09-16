'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CheckIcon, CircleIcon, MessageCircleIcon, PrinterIcon } from 'lucide-react';
import { api, ApiError } from '@/lib/client';
import { whatsappLink } from '@/lib/invite';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { QrCode } from '@/components/QrCode';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

import type { RespondentRow, SetupStatus } from '@medcheckin/core';

type Respondent = RespondentRow & { invite_url: string; setup: SetupStatus };

const STEPS: Array<[keyof SetupStatus, string]> = [
  ['accepted', 'Convite aceito'],
  ['installed', 'App instalado'],
  ['push_active', 'Avisos ativos'],
  ['test_confirmed', 'Teste confirmado'],
];

/** Onde a configuração parou, passo a passo. Cada ✓ é uma data gravada no servidor. */
function SetupSteps({ setup }: { setup: SetupStatus }) {
  return (
    <ol className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs" data-testid="setup-steps">
      {STEPS.map(([key, label]) => {
        const done = setup[key] === true;
        return (
          <li
            key={key}
            className={`flex items-center gap-1 ${done ? 'text-foreground' : 'text-muted-foreground'}`}
            data-testid={`setup-${key}`}
            data-done={done ? 'true' : 'false'}
          >
            {done ? (
              <CheckIcon className="size-3.5 text-primary" />
            ) : (
              <CircleIcon className="size-3" />
            )}
            {label}
          </li>
        );
      })}
    </ol>
  );
}

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
  async function patch(r: Respondent, json: Record<string, boolean>) {
    setError(null);
    try {
      await api(`/api/respondents/${r.id}`, { method: 'PATCH', json });
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Erro');
    }
  }
  async function rotate(r: Respondent) {
    if (!confirm('Gerar novo link invalida o anterior (e o app instalado com ele). Continuar?'))
      return;
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
    <Card id="respondents-card" data-testid="respondents-card" className="lg:col-span-2">
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
                <Label htmlFor="cg-phone">Celular com DDD (para enviar pelo WhatsApp)</Label>
                <Input
                  id="cg-phone"
                  inputMode="tel"
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
        {respondents.map((r) => {
          const label =
            r.kind === 'patient'
              ? 'paciente'
              : `cuidador${r.relationship ? ` · ${r.relationship}` : ''}`;
          if (r.setup.device === 'shared') {
            return (
              <div
                key={r.id}
                className="rounded-md border border-dashed p-3 text-sm"
                data-testid={`respondent-${r.kind}`}
                data-device="shared"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <strong>{r.name}</strong>
                  <Badge variant="outline">{label}</Badge>
                  <Badge variant="secondary">usa o celular de outra pessoa da casa</Badge>
                </div>
                <p className="mt-1.5 text-muted-foreground">
                  Não recebe convite nem avisos. Quem responde e recebe os lembretes é quem tem o
                  app no celular.
                </p>
                <Button
                  size="sm"
                  variant="ghost"
                  className="mt-1 px-0"
                  onClick={() => patch(r, { can_answer: true, receives_alarms: true })}
                  data-testid="device-own"
                >
                  Voltar a usar celular próprio
                </Button>
              </div>
            );
          }
          return (
            <div
              key={r.id}
              className="rounded-md border p-3 text-sm"
              data-testid={`respondent-${r.kind}`}
              data-device="own"
            >
              <div className="flex flex-wrap items-center gap-2">
                <strong>{r.name}</strong>
                <Badge variant="outline">{label}</Badge>
                <Badge variant={r.setup.complete ? 'default' : 'secondary'}>
                  {r.setup.complete ? 'celular pronto' : 'configuração pendente'}
                </Badge>
              </div>
              <div className="mt-2">
                <SetupSteps setup={r.setup} />
              </div>

              <div className="mt-3 flex flex-wrap items-start gap-4">
                <QrCode
                  value={r.invite_url}
                  size={132}
                  label={`QR code do convite de ${r.name}`}
                  testId="invite-qr"
                />
                <div className="min-w-0 flex-1 space-y-2">
                  <p className="text-xs text-muted-foreground">
                    Na consulta: a pessoa aponta a câmera do celular para o código e segue os
                    passos. Espere “Teste confirmado” ficar ✓ antes de ela ir embora.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <a
                      href={whatsappLink(r)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={buttonVariants({ size: 'sm' })}
                      data-testid="invite-whatsapp"
                    >
                      <MessageCircleIcon /> Enviar por WhatsApp
                    </a>
                    <Link
                      href={`/pacientes/${patientId}/guia/${r.id}`}
                      className={buttonVariants({ size: 'sm', variant: 'outline' })}
                      data-testid="invite-print"
                    >
                      <PrinterIcon /> Imprimir guia com QR
                    </Link>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
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
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
                <Label className="gap-1 text-xs font-normal">
                  <Checkbox
                    checked={r.can_answer}
                    onCheckedChange={() => patch(r, { can_answer: !r.can_answer })}
                  />{' '}
                  responde check-ins
                </Label>
                <Label className="gap-1 text-xs font-normal">
                  <Checkbox
                    checked={r.receives_alarms}
                    onCheckedChange={() => patch(r, { receives_alarms: !r.receives_alarms })}
                  />{' '}
                  recebe alarmes
                </Label>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-auto px-0 text-xs text-muted-foreground underline underline-offset-4"
                  onClick={() => {
                    if (
                      confirm(
                        `${r.name} usa o celular de outra pessoa da casa? Deixa de receber convite e avisos; quem tem o app no celular responde.`,
                      )
                    )
                      patch(r, { can_answer: false, receives_alarms: false });
                  }}
                  data-testid="device-shared"
                >
                  Usa o celular de outra pessoa da casa
                </Button>
              </div>
            </div>
          );
        })}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
