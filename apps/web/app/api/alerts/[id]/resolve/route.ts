import { resolveAlert } from '@medcheckin/core';
import { doctorRoute, json } from '@/lib/api';
import { alertInClinic } from '@/lib/alerts';

export const dynamic = 'force-dynamic';
/** L15: conduta obrigatória — sem nota o core lança e a rota devolve 400. */
export const POST = doctorRoute<{ id: string }>(async ({ db, session, params, body }) => {
  await alertInClinic(db, session, params.id, 'resolve');
  const note = String((body as { note?: string })?.note ?? '');
  try {
    return json(
      await resolveAlert(db, { alertId: params.id, userId: session.userId, note }, new Date()),
    );
  } catch (err) {
    if (/conduta|nota/i.test((err as Error).message))
      return json({ error: 'validation', message: (err as Error).message, field: 'note' }, 400);
    throw err;
  }
});
