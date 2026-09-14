import { requestPushTest } from '@medcheckin/core';
import { respondentRoute, json } from '@/lib/api';

export const dynamic = 'force-dynamic';

/** E9.3: pede um teste de aviso. O scheduler envia; o wizard acompanha em /api/p/push-test/[id]. */
export const POST = respondentRoute(async ({ db, session }) => {
  const out = await requestPushTest(db, session, new Date());
  return json(out, 201);
});
