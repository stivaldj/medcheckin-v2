import { getSystemState, STATE_KEYS, RETENTION_DEFAULTS } from '@medcheckin/core';
import { doctorRoute, json } from '@/lib/api';

export const dynamic = 'force-dynamic';
export const GET = doctorRoute(async ({ db, session }) => {
  const clinic = await db('clinics').where({ id: session.clinicId }).first();
  const respondents = await db('respondents as r')
    .join('patients as p', 'p.id', 'r.patient_id')
    .where('p.clinic_id', session.clinicId)
    .orderBy('p.name')
    .orderBy('r.created_at')
    .select(
      'r.id',
      'r.kind',
      'r.name',
      'r.relationship',
      'r.can_answer',
      'r.receives_alarms',
      'r.accepted_at',
      'r.consent_version',
      'p.id as patient_id',
      'p.name as patient_name',
      'p.status as patient_status',
    );
  const subs = await db('push_subscriptions as s')
    .join('respondents as r', 'r.id', 's.respondent_id')
    .join('patients as p', 'p.id', 'r.patient_id')
    .where('p.clinic_id', session.clinicId)
    .whereNull('s.revoked_at')
    .select('r.id as respondent_id')
    .count('* as n')
    .groupBy('r.id');
  const subBy = Object.fromEntries(subs.map((s) => [s.respondent_id, Number(s.n)]));
  const state = await getSystemState(db);
  return json({
    user: { id: session.userId, name: session.name, email: session.email, role: session.role },
    clinic: { id: clinic.id, name: clinic.name, timezone: clinic.timezone },
    respondents: respondents.map((r) => ({ ...r, push_subscriptions: subBy[r.id] ?? 0 })),
    system: {
      scheduler_last_cycle_at: state[STATE_KEYS.lastCycle] ?? null,
      alerts_last_run_at: state[STATE_KEYS.lastAlerts] ?? null,
      retention_last_run_at: state[STATE_KEYS.lastRetention] ?? null,
      retention: RETENTION_DEFAULTS,
      push_configured: !!process.env.VAPID_PUBLIC_KEY,
      mail_transport:
        process.env.MAIL_TRANSPORT === 'fake'
          ? 'fake'
          : process.env.SMTP_HOST
            ? 'smtp'
            : 'não configurado',
      version: process.env.APP_VERSION ?? 'dev',
    },
  });
});
