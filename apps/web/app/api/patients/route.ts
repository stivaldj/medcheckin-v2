import { listPatients, createPatient } from '@medcheckin/core';
import { doctorRoute, json } from '@/lib/api';
import { UUID_RE } from '@/lib/format';

export const dynamic = 'force-dynamic';

export const GET = doctorRoute(async ({ req, db, session }) => {
  const raw = new URL(req.url).searchParams.get('condition');
  const condition = raw && UUID_RE.test(raw) ? raw : null;
  return json(await listPatients(db, { clinicId: session.clinicId, condition }, new Date()));
});

export const POST = doctorRoute(async ({ db, session, body, baseUrl }) => {
  const out = await createPatient(db, session, body as Record<string, unknown>, new Date());
  const respondents = out.respondents.map((r) => ({
    ...r,
    invite_url: `${baseUrl}/p/convite/${r.invite_token}`,
  }));
  return json({ patient: out.patient, respondents }, 201);
});
