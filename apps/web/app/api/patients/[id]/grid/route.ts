import { requirePatientInClinic, patientGrid } from '@medcheckin/core';
import { doctorRoute, json } from '@/lib/api';

export const dynamic = 'force-dynamic';

export const GET = doctorRoute<{ id: string }>(async ({ db, session, params, req }) => {
  await requirePatientInClinic(db, session, params.id);
  const days = Number(new URL(req.url).searchParams.get('days') ?? 14);
  return json(
    await patientGrid(db, params.id, { days: Math.min(Math.max(days, 1), 90), now: new Date() }),
  );
});
