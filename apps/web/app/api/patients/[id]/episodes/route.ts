import { setEpisode } from '@medcheckin/core';
import { doctorRoute, json } from '@/lib/api';

export const dynamic = 'force-dynamic';

export const POST = doctorRoute<{ id: string }>(async ({ db, session, params, body }) =>
  json(
    await setEpisode(
      db,
      session,
      params.id,
      body as { kind: string; checkin_frequency: string; question_set_id: string },
      new Date(),
    ),
    201,
  ),
);
