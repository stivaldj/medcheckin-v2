import { requirePatientInClinic, symptomDoseSeries } from '@medcheckin/core';
import { doctorRoute, json } from '@/lib/api';

export const dynamic = 'force-dynamic';
export const GET = doctorRoute<{ id: string }>(async ({ db, session, params, req }) => {
  await requirePatientInClinic(db, session, params.id);
  const u = new URL(req.url);
  const questionKey = u.searchParams.get('question') ?? '';
  const days = Math.min(Math.max(Number(u.searchParams.get('days') ?? 30), 7), 180);
  try {
    return json(await symptomDoseSeries(db, params.id, { questionKey, days, now: new Date() }));
  } catch (err) {
    if (/pergunta/i.test((err as Error).message))
      return json({ error: 'validation', message: (err as Error).message }, 400);
    throw err;
  }
});
