import { respondentHistory } from '@medcheckin/core';
import { respondentRoute, json } from '@/lib/api';

export const dynamic = 'force-dynamic';
export const GET = respondentRoute(async ({ db, session }) =>
  json(await respondentHistory(db, session, { days: 30, now: new Date() })),
);
