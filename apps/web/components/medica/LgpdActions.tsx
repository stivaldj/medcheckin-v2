'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

export function LgpdActions({
  patientId,
  patientName,
  discharged,
}: {
  patientId: string;
  patientName: string;
  discharged: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [confirmName, setConfirmName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function anonymize(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/api/patients/${patientId}/anonymize`, {
        method: 'POST',
        json: { reason, confirmName },
      });
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erro');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="lgpd-actions">
      <Button
        variant="outline"
        size="sm"
        nativeButton={false}
        render={<a href={`/pacientes/${patientId}/relatorio`} />}
      >
        Relatório 30 d
      </Button>
      <Button
        variant="outline"
        size="sm"
        nativeButton={false}
        render={<a href={`/api/patients/${patientId}/export`} download />}
        data-testid="export"
      >
        Exportar dados (LGPD)
      </Button>
      {!discharged && (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger render={<Button variant="ghost" size="sm" data-testid="anonymize-open" />}>
            Anonimizar
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Anonimizar paciente (irreversível)</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              Remove nome, nascimento, contatos dos respondentes e textos livres das respostas;
              revoga acessos. Mantém as séries clínicas sem identificação, por obrigação de guarda.
              Ver docs/LGPD.md.
            </p>
            <p className="rounded-lg border border-sev-high/40 bg-sev-high-soft p-3 text-sm text-sev-high">
              <strong className="font-semibold">As condutas que você registrou ficam.</strong> Elas
              são prontuário e não são apagadas. Se alguma delas tiver o nome de outra pessoa
              escrito no texto, edite antes de anonimizar — depois não dá para voltar.
            </p>
            <form onSubmit={anonymize} className="space-y-3">
              <div>
                <Label htmlFor="an-reason">Motivo</Label>
                <Textarea
                  id="an-reason"
                  required
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  data-testid="anonymize-reason"
                />
              </div>
              <div>
                <Label htmlFor="an-name">Digite o nome do paciente para confirmar</Label>
                <Input
                  id="an-name"
                  required
                  value={confirmName}
                  onChange={(e) => setConfirmName(e.target.value)}
                  placeholder={patientName}
                  data-testid="anonymize-name"
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button
                type="submit"
                variant="destructive"
                disabled={busy || confirmName !== patientName}
                data-testid="anonymize-submit"
              >
                {busy ? 'Anonimizando…' : 'Anonimizar definitivamente'}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
