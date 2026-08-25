import { endRoutinePeriodToday } from '@medcheckin/core';
import { doctorRoute, json } from '@/lib/api';

export const dynamic = 'force-dynamic';

export const POST = doctorRoute<{ id: string }>(async ({ db, session, params }) =>
  json(await endRoutinePeriodToday(db, session, params.id, new Date())),
);
