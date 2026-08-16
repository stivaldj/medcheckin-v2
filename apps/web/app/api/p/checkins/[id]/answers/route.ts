import { answerFromRespondent } from '@medcheckin/core';
import { respondentRoute, json } from '@/lib/api';

export const dynamic = 'force-dynamic';
export const POST = respondentRoute<{ id: string }>(async ({ db, session, params, body }) => {
  const b = (body ?? {}) as { questionKey?: string; value?: unknown };
  const out = await answerFromRespondent(
    db,
    session,
    { checkinId: params.id, questionKey: String(b.questionKey ?? ''), value: b.value ?? null },
    new Date(),
  );
  return json({ next: out.next, completed: out.completed, progress: out.progress });
});
