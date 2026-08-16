import { savePushSubscription, removePushSubscription } from '@medcheckin/core';
import { respondentRoute, json } from '@/lib/api';

export const dynamic = 'force-dynamic';
export const POST = respondentRoute(async ({ db, session, body, req }) => {
  const b = (body ?? {}) as { endpoint?: string; keys?: { p256dh: string; auth: string } };
  const row = await savePushSubscription(db, session, {
    endpoint: String(b.endpoint ?? ''),
    keys: b.keys!,
    ua: req.headers.get('user-agent'),
  });
  return json({ id: row.id }, 201);
});
export const DELETE = respondentRoute(async ({ db, session, body }) => {
  const b = (body ?? {}) as { endpoint?: string };
  const n = await removePushSubscription(db, session, { endpoint: String(b.endpoint ?? '') });
  return json({ removed: n });
});
