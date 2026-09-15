import { removePatientCondition } from '@medcheckin/core';
import { doctorRoute } from '@/lib/api';

export const dynamic = 'force-dynamic';

export const DELETE = doctorRoute<{ id: string; conditionId: string }>(
  async ({ db, session, params }) => {
    await removePatientCondition(db, session, params.id, params.conditionId, new Date());
    return new Response(null, { status: 204 });
  },
);
