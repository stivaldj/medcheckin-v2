import { fmtDate } from '@/lib/format';

/** D37 — paciente importado: tem histórico, não está no acompanhamento. O convite (aba
 *  Configuração → Respondentes) é o que o torna ativo, no aceite do consentimento. */
export function RegisteredBanner({
  patientId,
  importedAt,
  source,
}: {
  patientId: string;
  importedAt: Date | string | null;
  source: string | null;
}) {
  return (
    <section
      className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 text-sm"
      data-testid="registered-banner"
    >
      <strong>Cadastrado</strong> a partir do{' '}
      {source === 'versatilis' ? 'Versatilis' : 'sistema anterior'}
      {importedAt
        ? ` em ${fmtDate(importedAt, { day: '2-digit', month: '2-digit', year: 'numeric' })}`
        : ''}
      . Sem acompanhamento no app: nenhum lembrete ou check-in é enviado.{' '}
      <a
        href={`/pacientes/${patientId}?tab=configuracao#respondents-card`}
        className="font-medium underline underline-offset-4"
        data-testid="start-followup"
      >
        Iniciar acompanhamento
      </a>{' '}
      — convide quem responde na aba <strong>A configuração → Respondentes</strong> (se ainda não
      houver ninguém, crie o convite ali) e peça o consentimento; ao aceitar, o paciente passa a
      Ativo.
    </section>
  );
}
