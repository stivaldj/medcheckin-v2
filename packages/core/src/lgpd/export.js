import JSZip from 'jszip';
import { toDT } from '../time.js';
import { AuthError } from '../auth/tokens.js';
import { requirePatientInClinic, logAccess } from '../auth/access.js';

function requireDoctor(session) {
  if (!session || session.kind !== 'user')
    throw new AuthError('unauthenticated', 'Sessão da clínica necessária.');
}

/** Portabilidade/acesso (LGPD art. 18): tudo do paciente, por tabela, com manifest de contagens. */
export async function exportPatientData(db, session, patientId, now) {
  requireDoctor(session);
  const patient = await requirePatientInClinic(db, session, patientId);
  const respondents = await db('respondents')
    .where({ patient_id: patientId })
    .select(
      'id',
      'kind',
      'name',
      'email',
      'phone',
      'relationship',
      'can_answer',
      'receives_alarms',
      'accepted_at',
      'consent_version',
      'consent_at',
      'created_at',
    );
  const medications = await db('medications as m')
    .join('products as pr', 'pr.id', 'm.product_id')
    .where('m.patient_id', patientId)
    .select(
      'm.id',
      'm.active',
      'm.created_at',
      'pr.name as product_name',
      'pr.form',
      'pr.cbd_mg_ml',
      'pr.thc_mg_ml',
    );
  const medIds = medications.map((m) => m.id);
  const doseEvents = medIds.length
    ? await db('dose_events').whereIn('medication_id', medIds).orderBy('effective_from')
    : [];
  const intakes = medIds.length
    ? await db('medication_intakes').whereIn('medication_id', medIds).orderBy('scheduled_at')
    : [];
  const episodes = await db('episodes').where({ patient_id: patientId }).orderBy('started_at');
  const checkinRows = await db('checkins')
    .where({ patient_id: patientId })
    .orderBy('scheduled_for');
  const answers = checkinRows.length
    ? await db('answers as a')
        .join('questions as q', 'q.id', 'a.question_id')
        .whereIn(
          'a.checkin_id',
          checkinRows.map((c) => c.id),
        )
        .select(
          'a.checkin_id',
          'q.key',
          'q.label',
          'a.value_num',
          'a.value_text',
          'a.value_choice',
          'a.skipped',
          'a.answered_at',
          'a.respondent_id',
        )
    : [];
  const checkins = checkinRows.map((c) => ({
    ...c,
    answers: answers.filter((a) => a.checkin_id === c.id),
  }));
  const alertRows = await db('alerts').where({ patient_id: patientId }).orderBy('created_at');
  const actions = alertRows.length
    ? await db('alert_actions')
        .whereIn(
          'alert_id',
          alertRows.map((a) => a.id),
        )
        .orderBy('at')
    : [];
  const alerts = alertRows.map((a) => ({
    ...a,
    actions: actions.filter((x) => x.alert_id === a.id),
  }));
  const scores = await db('patient_scores_daily').where({ patient_id: patientId }).orderBy('date');
  const notifications = await db('notifications')
    .where({ patient_id: patientId })
    .orderBy('created_at')
    .select(
      'id',
      'respondent_id',
      'kind',
      'scheduled_at',
      'sent_at',
      'delivered_at',
      'failed_at',
      'error',
      'created_at',
    );
  const audit = await db('access_audit').where({ patient_id: patientId }).orderBy('at');

  const files = {
    'patient.json': patient,
    'respondents.json': respondents,
    'medications.json': medications.map((m) => ({
      ...m,
      dose_events: doseEvents.filter((d) => d.medication_id === m.id),
    })),
    'medication_intakes.json': intakes,
    'episodes.json': episodes,
    'checkins.json': checkins,
    'alerts.json': alerts,
    'scores.json': scores,
    'notifications.json': notifications,
    'access_audit.json': audit,
  };
  const manifest = {
    generated_at: toDT(now).toISO(),
    patient_id: patientId,
    clinic_id: session.clinicId,
    consent: { version: patient.consent_version, at: patient.consent_at },
    counts: {
      respondents: respondents.length,
      medications: medications.length,
      dose_events: doseEvents.length,
      medication_intakes: intakes.length,
      episodes: episodes.length,
      checkins: checkins.length,
      answers: answers.length,
      alerts: alerts.length,
      alert_actions: actions.length,
      patient_scores_daily: scores.length,
      notifications: notifications.length,
      access_audit: audit.length,
    },
    note: 'notifications.json contém só metadados de entrega (sem conteúdo).',
  };
  await logAccess(db, { session, patientId, route: 'patients.export', action: 'export' }, now);
  return { manifest, files };
}

/** zip: manifest.json + um json por tabela. */
export async function buildExportZip({ manifest, files }) {
  const zip = new JSZip();
  zip.file('manifest.json', JSON.stringify(manifest, null, 2));
  for (const [name, data] of Object.entries(files)) zip.file(name, JSON.stringify(data, null, 2));
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
