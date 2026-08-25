import { toDT } from '../time.js';
import { currentDose } from '../doses/currentDose.js';
import { enqueueAndSend } from '../checkin/engine.js';
import { toHm, parseHm } from './next-run.js';
import { logger } from '../logger.js';

const LATE_AFTER_MINUTES = 60;

/**
 * @deprecated D17/E9.1 — fora do ciclo desde a rotina por período (`routine_alarms`).
 * Mantido só para o histórico já gravado em `medication_intakes`.
 *
 * Cria os `medication_intakes` do dia local para cada medicação ativa de paciente ativo,
 * um por horário da DOSE VIGENTE (D3). Idempotente por unique(medication_id, scheduled_at).
 */
export async function planMedicationIntakes(db, now) {
  const nowDT = toDT(now);
  const meds = await db('medications as m')
    .join('patients as p', 'p.id', 'm.patient_id')
    .where('m.active', true)
    .andWhere('p.status', 'active')
    .select('m.id', 'm.patient_id', 'p.timezone');

  let created = 0;
  for (const m of meds) {
    const dose = await currentDose(db, m.id, nowDT.toJSDate());
    if (!dose) continue;
    const localDay = nowDT.setZone(m.timezone || 'UTC').startOf('day');
    for (const raw of dose.schedule_times || []) {
      const hm = toHm(raw);
      if (!hm) continue;
      const { hour, minute } = parseHm(hm);
      const at = localDay.set({ hour, minute }).toUTC().toJSDate();
      const ins = await db('medication_intakes')
        .insert({
          medication_id: m.id,
          dose_event_id: dose.id,
          scheduled_at: at,
          status: 'pending',
        })
        .onConflict(['medication_id', 'scheduled_at'])
        .ignore()
        .returning('id');
      if (ins.length) created += 1;
    }
  }
  if (created) logger.info('planner.intakes', { medications: meds.length, created });
  return { medications: meds.length, created };
}

/**
 * @deprecated D17/E9.1 — substituído por `dispatchDueRoutineAlarms`.
 *
 * Alarme de dose para intakes vencidos e ainda pendentes, aos respondentes `receives_alarms`.
 * L4: enviar NUNCA muda o status do intake — só `confirmIntake` muda.
 */
export async function dispatchDueIntakes(db, now, { notifier }) {
  if (!notifier) throw new Error('dispatchDueIntakes: notifier obrigatório');
  const nowJs = toDT(now).toJSDate();
  const due = await db('medication_intakes as i')
    .join('medications as m', 'm.id', 'i.medication_id')
    .join('patients as p', 'p.id', 'm.patient_id')
    .join('products as pr', 'pr.id', 'm.product_id')
    .leftJoin('dose_events as d', 'd.id', 'i.dose_event_id')
    .where('i.status', 'pending')
    .andWhere('i.scheduled_at', '<=', nowJs)
    .andWhere('p.status', 'active')
    .select(
      'i.id',
      'i.scheduled_at',
      'm.patient_id',
      'pr.name as product_name',
      'd.dose_amount',
      'd.dose_unit',
      'd.times_per_day',
    );

  const out = { due: due.length, sent: 0, failed: 0, duplicate: 0, no_respondent: 0 };
  for (const i of due) {
    const respondents = await db('respondents')
      .where({ patient_id: i.patient_id, receives_alarms: true })
      .whereNotNull('accepted_at')
      .select('id');
    if (!respondents.length) {
      out.no_respondent += 1;
      continue;
    }
    for (const r of respondents) {
      const res = await enqueueAndSend(db, notifier, {
        patient_id: i.patient_id,
        respondent_id: r.id,
        kind: 'alarm',
        payload: {
          intake_id: i.id,
          scheduled_at: new Date(i.scheduled_at).toISOString(),
          product_name: i.product_name,
          dose_amount: i.dose_amount,
          dose_unit: i.dose_unit,
          times_per_day: i.times_per_day,
          title: 'Hora da medicação',
          body: `${i.product_name}: ${i.dose_amount} ${i.dose_unit}`,
        },
        scheduled_at: nowJs,
        dedup_key: `alarm:${i.id}:${r.id}`,
      });
      out[res.status] += 1;
    }
  }
  return out;
}

const CONFIRM_STATUSES = new Set(['taken', 'skipped']);

/**
 * @deprecated D17/E9.1 — fora da UI; a adesão vem da pergunta do check-in.
 *
 * Único caminho que muda `medication_intakes.status` (L4).
 * `taken` mais de 60 min após o horário vira `late`.
 */
export async function confirmIntake(
  db,
  { intakeId, respondentId, status, sideEffect = false, note = null },
  now,
) {
  if (!CONFIRM_STATUSES.has(status))
    throw new Error(`status inválido: ${status} (use taken|skipped)`);
  const nowDT = toDT(now);
  const intake = await db('medication_intakes as i')
    .join('medications as m', 'm.id', 'i.medication_id')
    .where('i.id', intakeId)
    .select('i.*', 'm.patient_id')
    .first();
  if (!intake) throw new Error('Intake não encontrado.');
  const respondent = await db('respondents')
    .where({ id: respondentId, patient_id: intake.patient_id })
    .whereNotNull('accepted_at')
    .first();
  if (!respondent) throw new Error('Respondente não autorizado para este paciente.');

  let finalStatus = status;
  if (status === 'taken') {
    const late =
      nowDT.diff(toDT(new Date(intake.scheduled_at)), 'minutes').minutes > LATE_AFTER_MINUTES;
    finalStatus = late ? 'late' : 'taken';
  }
  const [row] = await db('medication_intakes')
    .where({ id: intakeId })
    .update({
      status: finalStatus,
      taken_at: status === 'taken' ? nowDT.toJSDate() : null,
      respondent_id: respondentId,
      side_effect_flag: !!sideEffect,
      note: note ? String(note).slice(0, 1000) : null,
      updated_at: db.fn.now(),
    })
    .returning('*');
  return row;
}
