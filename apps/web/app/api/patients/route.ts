import { listPatients, createPatient } from '@medcheckin/core';
import { doctorRoute, json } from '@/lib/api';

export const dynamic = 'force-dynamic';

export const GET = doctorRoute(async ({ db, session }) =>
  json(await listPatients(db, { clinicId: session.clinicId }, new Date())),
);

export const POST = doctorRoute(async ({ db, session, body, baseUrl }) => {
  const out = await createPatient(db, session, body as Record<string, unknown>, new Date());
  const respondents = out.respondents.map((r) => ({
    ...r,
    invite_url: `${baseUrl}/p/convite/${r.invite_token}`,
  }));
  return json({ patient: out.patient, respondents }, 201);
});
