import { patientReport } from '@medcheckin/core';
import { doctorRoute, json } from '@/lib/api';

export const dynamic = 'force-dynamic';
export const GET = doctorRoute<{ id: string }>(async ({ db, session, params, req }) => {
  const days = Math.min(Math.max(Number(new URL(req.url).searchParams.get('days') ?? 30), 7), 180);
  return json(await patientReport(db, session, params.id, { days, now: new Date() }));
});
