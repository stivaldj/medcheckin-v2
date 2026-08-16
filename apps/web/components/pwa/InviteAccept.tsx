'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/client';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';

export const CONSENT_VERSION = 'v1';

export function InviteAccept({
  token,
  name,
  kind,
  patientName,
  clinicName,
  alreadyAccepted,
}: {
  token: string;
  name: string;
  kind: string;
  patientName: string;
  clinicName: string;
  alreadyAccepted: boolean;
}) {
  const router = useRouter();
  const [agree, setAgree] = useState(alreadyAccepted);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function accept() {
    setBusy(true);
    setError(null);
    try {
      await api('/api/p/accept', {
        method: 'POST',
        json: { token, consentVersion: CONSENT_VERSION },
      });
      router.push('/p/hoje');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Erro ao aceitar.');
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Olá, {name}</h1>
      <p className="text-sm">
        {clinicName} convidou você para acompanhar{' '}
        {kind === 'patient' ? 'o seu tratamento' : `o tratamento de ${patientName}`} pelo
        MedCheck-in: você receberá lembretes de medicação e check-ins curtos, e a equipe verá suas
        respostas.
      </p>
      <section className="rounded-md border bg-muted/40 p-3 text-sm" data-testid="consent-text">
        <h2 className="mb-1 font-medium">Termo de consentimento ({CONSENT_VERSION})</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            Suas respostas e confirmações de dose são registradas e vistas apenas pela equipe da
            clínica.
          </li>
          <li>
            As notificações são enviadas a este dispositivo; você pode desativá-las quando quiser.
          </li>
          <li>Você pode pedir a exportação ou a exclusão dos dados à clínica (LGPD).</li>
        </ul>
      </section>
      {!alreadyAccepted && (
        <label className="flex items-start gap-2 text-sm">
          <Checkbox
            checked={agree}
            onCheckedChange={(v) => setAgree(v === true)}
            data-testid="agree"
          />
          <span>Li e concordo com o termo.</span>
        </label>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button className="w-full" disabled={!agree || busy} onClick={accept} data-testid="accept">
        {busy ? 'Entrando…' : alreadyAccepted ? 'Entrar neste dispositivo' : 'Aceitar e entrar'}
      </Button>
    </div>
  );
}
