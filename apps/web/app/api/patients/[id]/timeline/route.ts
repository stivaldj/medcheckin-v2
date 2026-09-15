import { patientTimeline, noteDay } from '@medcheckin/core';
import { doctorRoute, json } from '@/lib/api';

export const dynamic = 'force-dynamic';

export const GET = doctorRoute<{ id: string }>(async ({ req, db, session, params }) => {
  const before = new URL(req.url).searchParams.get('before');
  const ok = before && /^\d{4}-\d{2}-\d{2}$/.test(before) ? before : null;
  const page = await patientTimeline(db, session, params.id, { now: new Date(), before: ok });
  return json({
    ...page,
    days: page.days.map((d) => ({
      ...d,
      notes: d.notes.map((n) => ({ ...n, occurred_at: noteDay(n.occurred_at) })),
    })),
  });
});
