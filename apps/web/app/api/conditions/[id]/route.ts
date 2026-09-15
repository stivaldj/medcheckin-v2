import { updateCondition } from '@medcheckin/core';
import { doctorRoute, json } from '@/lib/api';

export const dynamic = 'force-dynamic';

export const PATCH = doctorRoute<{ id: string }>(async ({ db, session, params, body }) =>
  json(
    await updateCondition(
      db,
      session,
      params.id,
      body as { name?: string; cid10?: string | null },
      new Date(),
    ),
  ),
);
