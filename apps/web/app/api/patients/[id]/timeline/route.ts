import { patientTimeline } from '@medcheckin/core';
import { doctorRoute, json } from '@/lib/api';

export const dynamic = 'force-dynamic';

export const GET = doctorRoute<{ id: string }>(async ({ db, session, params }) =>
  json(await patientTimeline(db, session, params.id, { now: new Date() })),
);
