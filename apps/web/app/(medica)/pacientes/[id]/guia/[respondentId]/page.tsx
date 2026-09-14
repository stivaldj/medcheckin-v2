import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getPatientDetail, AuthError } from '@medcheckin/core';
import { getDb } from '@/lib/db';
import { requireUserPage } from '@/lib/session';
import { QrCode } from '@/components/QrCode';
import { PrintButton } from '@/components/medica/PrintButton';

export const dynamic = 'force-dynamic';

/**
 * E9.3 — guia de 1 página para entregar na consulta: QR do convite + 4 passos em letra grande.
 * O wizard dentro do app faz o resto; a folha é a rede de segurança.
 */
export default async function GuiaRespondentePage({
  params,
}: {
  params: Promise<{ id: string; respondentId: string }>;
}) {
  const { id, respondentId } = await params;
  const session = await requireUserPage();
  let detail;
  try {
    detail = await getPatientDetail(getDb(), session, id, {
      baseUrl: process.env.APP_BASE_URL ?? '',
      now: new Date(),
    });
  } catch (err) {
    if (err instanceof AuthError && err.code === 'not_found') notFound();
    throw err;
  }
  const r = detail.respondents.find((x) => x.id === respondentId);
  if (!r) notFound();
  const para = r.kind === 'caregiver' ? `${r.name}, que cuida de ${detail.patient.name}` : r.name;

  return (
    <div className="mx-auto max-w-2xl space-y-6 print:max-w-none" data-testid="guide-respondent">
      <style>{`@media print { header, nav, .no-print { display: none !important; } main { padding: 0 !important } @page { margin: 14mm } }`}</style>
      <div className="no-print flex items-center justify-between">
        <Link href={`/pacientes/${id}`} className="text-sm underline">
          ← voltar ao paciente
        </Link>
        <PrintButton />
      </div>

      <div className="space-y-1">
        <h1 className="text-3xl font-semibold tracking-tight">Como começar a usar o MedCheck-in</h1>
        <p className="text-lg">
          Para: <strong>{para}</strong>
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-6 rounded-2xl border-2 p-5">
        <QrCode value={r.invite_url} size={220} label={`QR code do convite de ${r.name}`} />
        <p className="flex-1 text-xl leading-relaxed">
          Abra a <strong>câmera</strong> do celular, aponte para este código e toque no link que
          aparecer.
        </p>
      </div>

      <ol className="space-y-5 text-xl leading-relaxed">
        <li className="flex gap-4">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary font-semibold text-primary-foreground">
            1
          </span>
          <span>
            O link abre no <strong>Safari</strong> (iPhone) ou no <strong>Chrome</strong> (Android).
            Não abra pelo WhatsApp nem pelo e-mail.
          </span>
        </li>
        <li className="flex gap-4">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary font-semibold text-primary-foreground">
            2
          </span>
          <span>
            Siga os passos da tela: aceitar, <strong>colocar o app na tela inicial</strong> e{' '}
            <strong>ativar os avisos</strong> (toque em “Permitir”).
          </span>
        </li>
        <li className="flex gap-4">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary font-semibold text-primary-foreground">
            3
          </span>
          <span>
            O app manda um <strong>aviso de teste</strong>. Quando chegar, toque em{' '}
            <strong>“Sim, chegou”</strong>.
          </span>
        </li>
        <li className="flex gap-4">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary font-semibold text-primary-foreground">
            4
          </span>
          <span>
            Pronto. Todo dia chegam os <strong>lembretes de medicação</strong> e o{' '}
            <strong>check-in</strong>. Toque no aviso para responder.
          </span>
        </li>
      </ol>

      <div className="space-y-2 rounded-2xl bg-muted/60 p-5 text-lg leading-relaxed">
        <p className="font-semibold">Deu problema?</p>
        <p>
          No app, toque em <strong>“Ativar os avisos”</strong> ou <strong>“testar de novo”</strong>{' '}
          na tela de hoje. O app mostra o que fazer.
        </p>
        <p>Trocou de celular ou apagou o app? Leia este código de novo.</p>
        <p className="pt-2">Telefone da clínica: ________________________________</p>
      </div>
      <p className="text-sm text-muted-foreground">
        Este código é pessoal: ele dá acesso ao acompanhamento. Não compartilhe.
      </p>
    </div>
  );
}
