import { toDT } from '../time.js';

const SEVERITY_ORDER = `case severity when 'critical' then 0 when 'high' then 1 when 'medium' then 2 else 3 end`;

async function getAlert(db, alertId) {
  const a = await db('alerts').where({ id: alertId }).first();
  if (!a) throw new Error('Alerta não encontrado.');
  return a;
}

export async function acknowledgeAlert(db, { alertId, userId }, now) {
  const nowJs = toDT(now).toJSDate();
  return db.transaction(async (trx) => {
    const a = await getAlert(trx, alertId);
    if (a.status === 'resolved') throw new Error('Alerta já resolvido.');
    await trx('alerts')
      .where({ id: alertId })
      .update({ status: 'acknowledged', last_seen_at: nowJs });
    await trx('alert_actions').insert({
      alert_id: alertId,
      user_id: userId,
      action: 'acknowledge',
      at: nowJs,
    });
    return trx('alerts').where({ id: alertId }).first();
  });
}

/** L15: resolver exige conduta (note); alerts + alert_actions na mesma transação. */
export async function resolveAlert(db, { alertId, userId, note }, now) {
  const text = String(note ?? '').trim();
  if (!text) throw new Error('Conduta obrigatória: informe a nota ao resolver o alerta.');
  const nowJs = toDT(now).toJSDate();
  return db.transaction(async (trx) => {
    const a = await getAlert(trx, alertId);
    if (a.status === 'resolved') throw new Error('Alerta já resolvido.');
    await trx('alerts').where({ id: alertId }).update({
      status: 'resolved',
      resolved_reason: 'doctor',
      resolved_at: nowJs,
      last_seen_at: nowJs,
    });
    await trx('alert_actions').insert({
      alert_id: alertId,
      user_id: userId,
      action: 'resolve',
      note: text,
      at: nowJs,
    });
    return trx('alerts').where({ id: alertId }).first();
  });
}

export async function addAlertNote(db, { alertId, userId, note }, now) {
  const text = String(note ?? '').trim();
  if (!text) throw new Error('Nota vazia.');
  await getAlert(db, alertId);
  const [row] = await db('alert_actions')
    .insert({
      alert_id: alertId,
      user_id: userId,
      action: 'note',
      note: text,
      at: toDT(now).toJSDate(),
    })
    .returning('*');
  return row;
}

export async function silenceAlerts(
  db,
  { patientId, code = null, untilAt, reason = null, userId },
) {
  if (!untilAt) throw new Error('untilAt obrigatório.');
  const [row] = await db('alert_silences')
    .insert({
      patient_id: patientId,
      code,
      until_at: toDT(untilAt).toJSDate(),
      reason,
      created_by: userId,
    })
    .returning('*');
  return row;
}

/** Alertas abertos/reconhecidos da clínica, ordenados por severidade e recência. */
export async function listOpenAlerts(db, { clinicId, patientId = null }) {
  const q = db('alerts as a')
    .join('patients as p', 'p.id', 'a.patient_id')
    .where('p.clinic_id', clinicId)
    .whereNot('a.status', 'resolved')
    .orderByRaw(SEVERITY_ORDER)
    .orderBy('a.last_seen_at', 'desc')
    .select('a.*', 'p.name as patient_name');
  if (patientId) q.andWhere('a.patient_id', patientId);
  return q;
}

export async function listAlertActions(db, alertId) {
  return db('alert_actions as x')
    .leftJoin('users as u', 'u.id', 'x.user_id')
    .where('x.alert_id', alertId)
    .orderBy('x.at')
    .select('x.*', 'u.name as user_name');
}
