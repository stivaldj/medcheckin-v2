import { updatePatientQuestion } from '@medcheckin/core';
import { doctorRoute, json } from '@/lib/api';

export const dynamic = 'force-dynamic';

export const PATCH = doctorRoute<{ id: string }>(async ({ db, session, params, body }) =>
  json(await updatePatientQuestion(db, session, params.id, body as never, new Date())),
);
