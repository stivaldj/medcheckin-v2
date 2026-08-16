import { saveQuestions } from '@medcheckin/core';
import { doctorRoute, json } from '@/lib/api';

export const dynamic = 'force-dynamic';

export const PUT = doctorRoute<{ id: string }>(async ({ db, session, params, body }) => {
  if (!Array.isArray(body))
    return json({ error: 'validation', message: 'Corpo deve ser uma lista de perguntas.' }, 400);
  return json(await saveQuestions(db, session, params.id, body));
});
