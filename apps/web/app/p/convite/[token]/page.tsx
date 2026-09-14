import type { Metadata } from 'next';
import { SetupWizard } from '@/components/pwa/setup/SetupWizard';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * E9.3: o manifest desta página é o do convite. Instalado daqui, o app da tela inicial do iPhone
 * (que não enxerga o cookie do Safari) abre no próprio convite e entra sozinho.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  return { manifest: `/p/convite/${encodeURIComponent(token)}/manifest.webmanifest` };
}

/** Mostra para quem é o convite (sem dados clínicos) e conduz a configuração do celular. */
export default async function ConvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const r = await getDb()('respondents as r')
    .join('patients as p', 'p.id', 'r.patient_id')
    .join('clinics as c', 'c.id', 'p.clinic_id')
    .where('r.invite_token', token)
    .select('r.name', 'r.kind', 'r.accepted_at', 'p.name as patient_name', 'c.name as clinic_name')
    .first();
  if (!r) {
    return (
      <div className="space-y-3" data-testid="invite-invalid">
        <h1 className="text-2xl font-semibold">Este link não vale mais</h1>
        <p className="text-[17px] leading-relaxed text-muted-foreground">
          Ele foi trocado ou digitado errado. Peça à clínica um QR code novo.
        </p>
      </div>
    );
  }
  return (
    <SetupWizard
      mode="invite"
      token={token}
      name={r.name}
      kind={r.kind}
      patientName={r.patient_name}
      clinicName={r.clinic_name}
      alreadyAccepted={!!r.accepted_at}
    />
  );
}
