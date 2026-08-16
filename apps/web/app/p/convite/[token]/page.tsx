import { InviteAccept } from '@/components/pwa/InviteAccept';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** Mostra para quem é o convite (sem dados clínicos) e o termo; o aceite acontece no cliente. */
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
      <div className="space-y-2">
        <h1 className="text-xl font-semibold">Convite inválido</h1>
        <p className="text-sm text-muted-foreground">
          Este link não é válido ou foi substituído. Peça um novo link à clínica.
        </p>
      </div>
    );
  }
  return (
    <InviteAccept
      token={token}
      name={r.name}
      kind={r.kind}
      patientName={r.patient_name}
      clinicName={r.clinic_name}
      alreadyAccepted={!!r.accepted_at}
    />
  );
}
