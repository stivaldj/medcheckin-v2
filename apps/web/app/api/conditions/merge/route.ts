import { mergeConditions } from '@medcheckin/core';
import { doctorRoute, json } from '@/lib/api';

export const dynamic = 'force-dynamic';

export const POST = doctorRoute(async ({ db, session, body }) =>
  json(
    await mergeConditions(db, session, body as { from_id: string; into_id: string }, new Date()),
  ),
);
