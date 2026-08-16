import { addRespondent } from '@medcheckin/core';
import { doctorRoute, json } from '@/lib/api';

export const dynamic = 'force-dynamic';

export const POST = doctorRoute<{ id: string }>(async ({ db, session, params, body, baseUrl }) => {
  const r = await addRespondent(
    db,
    session,
    params.id,
    body as Record<string, unknown>,
    new Date(),
  );
  return json({ ...r, invite_url: `${baseUrl}/p/convite/${r.invite_token}` }, 201);
});
