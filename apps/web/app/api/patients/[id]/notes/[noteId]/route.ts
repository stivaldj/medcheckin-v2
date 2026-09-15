import { updateNote, deleteNote } from '@medcheckin/core';
import { doctorRoute, json } from '@/lib/api';

export const dynamic = 'force-dynamic';

export const PATCH = doctorRoute<{ id: string; noteId: string }>(
  async ({ db, session, params, body }) =>
    json(await updateNote(db, session, params.noteId, body as Record<string, unknown>, new Date())),
);

export const DELETE = doctorRoute<{ id: string; noteId: string }>(
  async ({ db, session, params }) => {
    await deleteNote(db, session, params.noteId, new Date());
    return new Response(null, { status: 204 });
  },
);
