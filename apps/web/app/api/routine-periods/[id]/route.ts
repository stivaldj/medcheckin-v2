import { updateRoutinePeriod, deleteRoutinePeriod } from '@medcheckin/core';
import { doctorRoute, json } from '@/lib/api';

export const dynamic = 'force-dynamic';

export const PATCH = doctorRoute<{ id: string }>(async ({ db, session, params, body }) =>
  json(
    await updateRoutinePeriod(db, session, params.id, body as Record<string, unknown>, new Date()),
  ),
);

/** D33: apaga só período que não deixou rastro (futuro, ou começou hoje sem lembrete enviado). */
export const DELETE = doctorRoute<{ id: string }>(async ({ db, session, params }) =>
  json(await deleteRoutinePeriod(db, session, params.id, new Date())),
);
