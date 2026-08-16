import { rotateInviteToken, logAccess, AuthError } from '@medcheckin/core';
import { doctorRoute, json } from '@/lib/api';

export const dynamic = 'force-dynamic';

export const POST = doctorRoute<{ id: string }>(async ({ db, session, params, baseUrl }) => {
  const r = await db('respondents as r')
    .join('patients as p', 'p.id', 'r.patient_id')
    .where('r.id', params.id)
    .andWhere('p.clinic_id', session.clinicId)
    .select('r.patient_id')
    .first();
  if (!r) throw new AuthError('not_found', 'Respondente não encontrado.');
  const token = await rotateInviteToken(db, params.id);
  await logAccess(
    db,
    { session, patientId: r.patient_id, route: 'respondents.rotate', action: 'update' },
    new Date(),
  );
  return json({ id: params.id, invite_token: token, invite_url: `${baseUrl}/p/convite/${token}` });
});
