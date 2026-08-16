import { anonymizePatient, requirePatientInClinic } from '@medcheckin/core';
import { doctorRoute, json } from '@/lib/api';

export const dynamic = 'force-dynamic';
/** Irreversível: exige digitar o nome do paciente + motivo. */
export const POST = doctorRoute<{ id: string }>(async ({ db, session, params, body }) => {
  const b = (body ?? {}) as { reason?: string; confirmName?: string };
  const p = await requirePatientInClinic(db, session, params.id);
  if (String(b.confirmName ?? '').trim() !== p.name)
    return json(
      {
        error: 'validation',
        message: 'Digite o nome do paciente exatamente como cadastrado para confirmar.',
        field: 'confirmName',
      },
      400,
    );
  return json(
    await anonymizePatient(db, session, params.id, { reason: b.reason ?? '' }, new Date()),
  );
});
