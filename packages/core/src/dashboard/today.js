import { DateTime } from 'luxon';
import { toDT } from '../time.js';
import { listOpenAlerts } from '../alerts/actions.js';
import { getSystemState, STATE_KEYS } from '../scheduler/cycle.js';

const STALE_MINUTES = 10;

/**
 * Tela "Hoje" da médica. Cada bloco vem de uma consulta explícita (fonte rastreável):
 * - awaiting: check-ins de HOJE (fuso da clínica) com envio real e sem conclusão (sent/in_progress)
 * - missed_today: check-ins de hoje marcados missed
 * - completed_today: check-ins de hoje concluídos
 * - open_alerts: alerts não resolvidos da clínica (listOpenAlerts)
 * - upcoming: próximos envios (check-ins pending com next_attempt_at ≤ +24h; alarmes pending futuros ≤ +24h)
 * - intakes: de hoje — vencidos sem confirmação × confirmados (taken/late/skipped)
 * - scheduler: heartbeat de system_state (stale se > 10 min)
 */
export async function dashboardToday(db, { clinicId }, now) {
  const nowDT = toDT(now);
  const clinic = await db('clinics').where({ id: clinicId }).first();
  const tz = clinic?.timezone || 'America/Cuiaba';
  const dayStart = nowDT.setZone(tz).startOf('day').toUTC().toJSDate();
  const dayEnd = nowDT.setZone(tz).startOf('day').plus({ days: 1 }).toUTC().toJSDate();
  const nowJs = nowDT.toJSDate();
  const in24h = nowDT.plus({ hours: 24 }).toJSDate();

  const todayCheckins = await db('checkins as c')
    .join('patients as p', 'p.id', 'c.patient_id')
    .where('p.clinic_id', clinicId)
    .andWhere('c.scheduled_for', '>=', dayStart)
    .andWhere('c.scheduled_for', '<', dayEnd)
    .orderBy('c.scheduled_for')
    .select(
      'c.id as checkin_id',
      'c.status',
      'c.attempt_count',
      'c.sent_at',
      'c.next_attempt_at',
      'c.scheduled_for',
      'p.id as patient_id',
      'p.name as patient_name',
    );
  const awaiting = todayCheckins.filter(
    (c) => (c.status === 'sent' || c.status === 'in_progress') && c.sent_at,
  );
  const missed_today = todayCheckins.filter((c) => c.status === 'missed');
  const completed_today = todayCheckins.filter((c) => c.status === 'completed').length;
  const not_sent_yet = todayCheckins.filter((c) => c.status === 'pending').length;

  const open_alerts = await listOpenAlerts(db, { clinicId });

  const upcomingCheckins = await db('checkins as c')
    .join('patients as p', 'p.id', 'c.patient_id')
    .where('p.clinic_id', clinicId)
    .whereIn('c.status', ['pending', 'sent'])
    .whereNotNull('c.next_attempt_at')
    .andWhere('c.next_attempt_at', '>', nowJs)
    .andWhere('c.next_attempt_at', '<=', in24h)
    .select(
      'p.name as patient_name',
      'p.id as patient_id',
      'c.next_attempt_at as at',
      'c.attempt_count',
    );
  const upcomingAlarms = await db('medication_intakes as i')
    .join('medications as m', 'm.id', 'i.medication_id')
    .join('patients as p', 'p.id', 'm.patient_id')
    .join('products as pr', 'pr.id', 'm.product_id')
    .where('p.clinic_id', clinicId)
    .andWhere('i.status', 'pending')
    .andWhere('i.scheduled_at', '>', nowJs)
    .andWhere('i.scheduled_at', '<=', in24h)
    .select(
      'p.name as patient_name',
      'p.id as patient_id',
      'i.scheduled_at as at',
      'pr.name as product_name',
    );
  const upcoming = [
    ...upcomingCheckins.map((u) => ({
      kind: 'checkin',
      patient_id: u.patient_id,
      patient_name: u.patient_name,
      at: u.at,
      detail: u.attempt_count > 0 ? `reenvio (tentativa ${u.attempt_count + 1})` : 'check-in',
    })),
    ...upcomingAlarms.map((u) => ({
      kind: 'alarm',
      patient_id: u.patient_id,
      patient_name: u.patient_name,
      at: u.at,
      detail: u.product_name,
    })),
  ].sort((a, b) => new Date(a.at) - new Date(b.at));

  const todayIntakes = await db('medication_intakes as i')
    .join('medications as m', 'm.id', 'i.medication_id')
    .join('patients as p', 'p.id', 'm.patient_id')
    .join('products as pr', 'pr.id', 'm.product_id')
    .leftJoin('dose_events as d', 'd.id', 'i.dose_event_id')
    .where('p.clinic_id', clinicId)
    .andWhere('i.scheduled_at', '>=', dayStart)
    .andWhere('i.scheduled_at', '<', dayEnd)
    .orderBy('i.scheduled_at')
    .select(
      'i.id as intake_id',
      'i.status',
      'i.scheduled_at',
      'i.side_effect_flag',
      'p.id as patient_id',
      'p.name as patient_name',
      'pr.name as product_name',
      'd.dose_amount',
      'd.dose_unit',
    );
  const intakes = {
    pending_confirmation: todayIntakes.filter(
      (i) => i.status === 'pending' && new Date(i.scheduled_at) <= nowJs,
    ),
    taken: todayIntakes.filter((i) => i.status === 'taken').length,
    late: todayIntakes.filter((i) => i.status === 'late').length,
    skipped: todayIntakes.filter((i) => i.status === 'skipped').length,
    side_effects: todayIntakes.filter((i) => i.side_effect_flag),
    total: todayIntakes.length,
  };

  const state = await getSystemState(db);
  const lastCycle = state[STATE_KEYS.lastCycle] ? new Date(state[STATE_KEYS.lastCycle]) : null;
  const scheduler = {
    last_cycle_at: lastCycle,
    stale:
      !lastCycle || nowDT.diff(DateTime.fromJSDate(lastCycle), 'minutes').minutes > STALE_MINUTES,
    last_alerts_at: state[STATE_KEYS.lastAlerts] ? new Date(state[STATE_KEYS.lastAlerts]) : null,
  };

  return {
    date: nowDT.setZone(tz).toISODate(),
    timezone: tz,
    awaiting,
    missed_today,
    completed_today,
    not_sent_yet,
    open_alerts,
    upcoming,
    intakes,
    scheduler,
  };
}
