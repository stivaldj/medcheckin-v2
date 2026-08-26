import { resolveAlert } from '@medcheckin/core';
import { doctorRoute, json } from '@/lib/api';
import { alertInClinic } from '@/lib/alerts';

export const dynamic = 'force-dynamic';
/** L15: conduta obrigatória — sem nota o core lança ValidationError e o envelope devolve 400. */
export const POST = doctorRoute<{ id: string }>(async ({ db, session, params, body }) => {
  await alertInClinic(db, session, params.id, 'resolve');
  const note = String((body as { note?: string })?.note ?? '');
  return json(
    await resolveAlert(db, { alertId: params.id, userId: session.userId, note }, new Date()),
  );
});
