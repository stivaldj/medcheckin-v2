import { pushTestStatus, confirmPushTest } from '@medcheckin/core';
import { respondentRoute, json } from '@/lib/api';

export const dynamic = 'force-dynamic';

export const GET = respondentRoute<{ id: string }>(async ({ db, session, params }) =>
  json(await pushTestStatus(db, session, params.id)),
);

/** "Chegou?" — body `{ arrived: boolean }`. Teste ainda não enviado → 409. */
export const POST = respondentRoute<{ id: string }>(async ({ db, session, params, body }) => {
  const arrived = (body as { arrived?: unknown } | undefined)?.arrived === true;
  return json(
    await confirmPushTest(db, session, { notificationId: params.id, arrived }, new Date()),
  );
});
