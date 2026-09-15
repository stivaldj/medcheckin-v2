import {
  addPatientCondition,
  listPatientConditions,
  requirePatientInClinic,
} from '@medcheckin/core';
import { doctorRoute, json } from '@/lib/api';

export const dynamic = 'force-dynamic';

export const GET = doctorRoute<{ id: string }>(async ({ db, session, params }) => {
  await requirePatientInClinic(db, session, params.id);
  return json(await listPatientConditions(db, params.id));
});

export const POST = doctorRoute<{ id: string }>(async ({ db, session, params, body }) =>
  json(
    await addPatientCondition(
      db,
      session,
      params.id,
      body as { name?: string; condition_id?: string },
      new Date(),
    ),
    201,
  ),
);
