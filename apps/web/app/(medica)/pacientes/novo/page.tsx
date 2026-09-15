import Link from 'next/link';
import { ChevronLeftIcon } from 'lucide-react';
import { listConditions } from '@medcheckin/core';

import { getDb } from '@/lib/db';
import { requireUserPage } from '@/lib/session';
import { NewPatientForm } from '@/components/medica/NewPatientForm';

export default async function NovoPacientePage() {
  const session = await requireUserPage();
  const conds = await listConditions(getDb(), session.clinicId);
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
      <NewPatientForm conditionNames={conds.map((c) => c.name)} />
    </div>
  );
}
