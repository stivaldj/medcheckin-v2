import { getPatientDetail, updatePatient } from '@medcheckin/core';
import { doctorRoute, json } from '@/lib/api';

export const dynamic = 'force-dynamic';

export const GET = doctorRoute<{ id: string }>(async ({ db, session, params, baseUrl }) =>
  json(await getPatientDetail(db, session, params.id, { baseUrl, now: new Date() })),
);

export const PATCH = doctorRoute<{ id: string }>(async ({ db, session, params, body }) =>
  json(await updatePatient(db, session, params.id, body as Record<string, unknown>, new Date())),
);
