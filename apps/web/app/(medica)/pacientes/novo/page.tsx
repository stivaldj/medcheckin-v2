import Link from 'next/link';
import { ChevronLeftIcon } from 'lucide-react';

import { NewPatientForm } from '@/components/medica/NewPatientForm';

export default function NovoPacientePage() {
  return (
    <div className="max-w-2xl space-y-5">
      <div>
        <Link
          href="/pacientes"
          className="mb-2 inline-flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground"
        >
          <ChevronLeftIcon className="size-3.5" /> Pacientes
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Novo paciente</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          O cadastro só é aceito com o consentimento confirmado — é registro de LGPD, não uma
          caixinha de formalidade.
        </p>
      </div>
      <NewPatientForm />
    </div>
  );
}
