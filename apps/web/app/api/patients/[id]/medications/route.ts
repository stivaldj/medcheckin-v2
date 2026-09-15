import { addMedication, type AddMedicationInput } from '@medcheckin/core';
import { doctorRoute, json } from '@/lib/api';

export const dynamic = 'force-dynamic';

export const POST = doctorRoute<{ id: string }>(async ({ db, session, params, body }) =>
  json(await addMedication(db, session, params.id, body as AddMedicationInput, new Date()), 201),
);
