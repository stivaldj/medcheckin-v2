import { listQuestionSets, createQuestionSet } from '@medcheckin/core';
import { doctorRoute, json } from '@/lib/api';

export const dynamic = 'force-dynamic';

export const GET = doctorRoute(async ({ db, session }) =>
  json(await listQuestionSets(db, session.clinicId)),
);
export const POST = doctorRoute(async ({ db, session, body }) =>
  json(await createQuestionSet(db, session, body as { name: string }), 201),
);
