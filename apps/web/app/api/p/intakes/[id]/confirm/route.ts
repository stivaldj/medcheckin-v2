import { confirmFromRespondent } from '@medcheckin/core';
import { respondentRoute, json } from '@/lib/api';

export const dynamic = 'force-dynamic';
export const POST = respondentRoute<{ id: string }>(async ({ db, session, params, body }) => {
  const b = (body ?? {}) as {
    status?: 'taken' | 'skipped';
    sideEffect?: boolean;
    note?: string | null;
  };
  return json(
    await confirmFromRespondent(
      db,
      session,
      {
        intakeId: params.id,
        status: b.status as 'taken' | 'skipped',
        sideEffect: !!b.sideEffect,
        note: b.note ?? null,
      },
      new Date(),
    ),
  );
});
