import { adjustDose } from '@medcheckin/core';
import { doctorRoute, json } from '@/lib/api';

export const dynamic = 'force-dynamic';

export const POST = doctorRoute<{ id: string }>(async ({ db, session, params, body }) =>
  json(await adjustDose(db, session, params.id, body as Record<string, unknown>, new Date()), 201),
);
