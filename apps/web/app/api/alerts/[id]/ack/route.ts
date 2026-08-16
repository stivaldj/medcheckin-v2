import { acknowledgeAlert } from '@medcheckin/core';
import { doctorRoute, json } from '@/lib/api';
import { alertInClinic } from '@/lib/alerts';

export const dynamic = 'force-dynamic';
export const POST = doctorRoute<{ id: string }>(async ({ db, session, params }) => {
  await alertInClinic(db, session, params.id, 'ack');
  return json(
    await acknowledgeAlert(db, { alertId: params.id, userId: session.userId }, new Date()),
  );
});
