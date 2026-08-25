import { addPatientQuestion, addAdherenceQuestion, listPatientQuestions } from '@medcheckin/core';
import { doctorRoute, json } from '@/lib/api';

export const dynamic = 'force-dynamic';

export const GET = doctorRoute<{ id: string }>(async ({ db, session, params }) =>
  json(await listPatientQuestions(db, session, params.id)),
);

export const POST = doctorRoute<{ id: string }>(async ({ db, session, params, body }) => {
  const input = (body ?? {}) as Record<string, unknown>;
  // preset "adesao": fecha o buraco dos conjuntos criados antes de E9.1 (ACHADOS 25/08)
  if (input.preset === 'adesao')
    return json(await addAdherenceQuestion(db, session, params.id, new Date()), 201);
  return json(await addPatientQuestion(db, session, params.id, input, new Date()), 201);
});
