import { listPatients, createPatient, type PatientListStatus } from '@medcheckin/core';
import { doctorRoute, json } from '@/lib/api';
import { UUID_RE } from '@/lib/format';

export const dynamic = 'force-dynamic';

export const GET = doctorRoute(async ({ req, db, session }) => {
  const sp = new URL(req.url).searchParams;
  const rawCondition = sp.get('condition') ?? '';
  return json(
    await listPatients(
      db,
      {
        clinicId: session.clinicId,
        condition: UUID_RE.test(rawCondition) ? rawCondition : null,
        q: sp.get('q') ?? '',
        status: (sp.get('status') as PatientListStatus) || 'following',
        page: Number(sp.get('page') ?? 1),
        pageSize: Number(sp.get('pageSize') ?? 50),
      },
      new Date(),
    ),
  );
});

export const POST = doctorRoute(async ({ db, session, body, baseUrl }) => {
  const out = await createPatient(db, session, body as Record<string, unknown>, new Date());
  const respondents = out.respondents.map((r) => ({
    ...r,
    invite_url: `${baseUrl}/p/convite/${r.invite_token}`,
  }));
  return json({ patient: out.patient, respondents }, 201);
});
