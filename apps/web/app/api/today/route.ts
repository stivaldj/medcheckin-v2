import { dashboardToday } from '@medcheckin/core';
import { doctorRoute, json } from '@/lib/api';

export const dynamic = 'force-dynamic';
export const GET = doctorRoute(async ({ db, session }) =>
  json(await dashboardToday(db, { clinicId: session.clinicId }, new Date())),
);
