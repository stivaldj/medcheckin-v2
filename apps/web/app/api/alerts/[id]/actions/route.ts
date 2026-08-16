import { listAlertActions } from '@medcheckin/core';
import { doctorRoute, json } from '@/lib/api';
import { alertInClinic } from '@/lib/alerts';

export const dynamic = 'force-dynamic';
export const GET = doctorRoute<{ id: string }>(async ({ db, session, params }) => {
  await alertInClinic(db, session, params.id, 'actions');
  return json(await listAlertActions(db, params.id));
});
