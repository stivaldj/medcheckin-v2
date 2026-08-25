import { addAlertNote } from '@medcheckin/core';
import { doctorRoute, json } from '@/lib/api';
import { alertInClinic } from '@/lib/alerts';

export const dynamic = 'force-dynamic';
export const POST = doctorRoute<{ id: string }>(async ({ db, session, params, body }) => {
  await alertInClinic(db, session, params.id, 'note');
  const note = String((body as { note?: string })?.note ?? '');
  return json(
    await addAlertNote(db, { alertId: params.id, userId: session.userId, note }, new Date()),
    201,
  );
});
