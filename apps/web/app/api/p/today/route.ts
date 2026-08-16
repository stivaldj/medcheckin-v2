import { respondentToday } from '@medcheckin/core';
import { respondentRoute, json } from '@/lib/api';

export const dynamic = 'force-dynamic';
export const GET = respondentRoute(async ({ db, session }) =>
  json(await respondentToday(db, session, new Date())),
);
