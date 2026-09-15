import { createNote, listNotes } from '@medcheckin/core';
import { doctorRoute, json } from '@/lib/api';

export const dynamic = 'force-dynamic';

export const GET = doctorRoute<{ id: string }>(async ({ db, session, params }) =>
  json(await listNotes(db, session, params.id)),
);

export const POST = doctorRoute<{ id: string }>(async ({ db, session, params, body }) =>
  json(await createNote(db, session, params.id, body as { body: string }, new Date()), 201),
);
