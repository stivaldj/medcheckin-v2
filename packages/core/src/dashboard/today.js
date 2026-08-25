import { DateTime } from 'luxon';
import { toDT } from '../time.js';
import { listOpenAlerts } from '../alerts/actions.js';
import { getSystemState, STATE_KEYS } from '../scheduler/cycle.js';
import { ADHERENCE_QUESTION_KEY } from '../routine/index.js';
import { toHm, parseHm } from '../scheduler/next-run.js';
import { isoDate as isoDay } from '../routine/index.js';

const STALE_MINUTES = 10;

/**
 * Tela "Hoje" da médica. Cada bloco vem de uma consulta explícita (fonte rastreável):
 * - awaiting: check-ins de HOJE (fuso da clínica) com envio real e sem conclusão (sent/in_progress)
 * - missed_today: check-ins de hoje marcados missed
 * - completed_today: check-ins de hoje concluídos
 * - open_alerts: alerts não resolvidos da clínica (listOpenAlerts)
 * - upcoming: próximos envios (check-ins pending com next_attempt_at ≤ +24h; alarmes da rotina ≤ +24h)
 * - adherence: respostas de HOJE à pergunta de adesão do check-in (D15; o alarme não confirma nada)
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
  // Alarmes da rotina (E9.1): hoje e amanhã, só dentro do período que cobre cada dia local.
  // Uma consulta só (o EXCLUDE de routine_periods garante no máximo um período por dia/paciente).
  const routineRows = await db('patients as p')
    .join('routine_periods as rp', 'rp.patient_id', 'p.id')
    .join('routine_alarms as ra', 'ra.period_id', 'rp.id')
    .where('p.clinic_id', clinicId)
    .andWhere('p.status', 'active')
    .select(
      'p.id as patient_id',
      'p.name as patient_name',
      'p.timezone',
      'rp.starts_on',
      'rp.ends_on',
      'ra.time',
      'ra.description',
    );
  const upcomingAlarms = [];
  for (const r of routineRows) {
    const ptz = r.timezone || tz;
    const { hour, minute } = parseHm(toHm(r.time));
    for (const offset of [0, 1]) {
      const local = nowDT.setZone(ptz).startOf('day').plus({ days: offset });
      const date = local.toISODate();
      if (isoDay(r.starts_on) > date) continue;
      if (r.ends_on && isoDay(r.ends_on) < date) continue;
      const at = local.set({ hour, minute }).toUTC().toJSDate();
      if (at > nowJs && at <= in24h)
        upcomingAlarms.push({
          patient_name: r.patient_name,
          patient_id: r.patient_id,
          at,
          product_name: r.description,
        });
    }
  }

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

  // Adesão de hoje: respostas à pergunta de adesão nos check-ins de hoje (D15).
  const adherenceRows = await db('answers as a')
    .join('checkins as c', 'c.id', 'a.checkin_id')
    .join('questions as q', 'q.id', 'a.question_id')
    .join('patients as p', 'p.id', 'c.patient_id')
    .where('p.clinic_id', clinicId)
    .andWhere('q.key', ADHERENCE_QUESTION_KEY)
    .andWhere('a.skipped', false)
    .andWhere('c.scheduled_for', '>=', dayStart)
    .andWhere('c.scheduled_for', '<', dayEnd)
    .select('p.id as patient_id', 'p.name as patient_name', 'a.value_num');
  const adherence = {
    answered: adherenceRows.length,
    yes: adherenceRows.filter((r) => Number(r.value_num) === 1).length,
    no: adherenceRows.filter((r) => Number(r.value_num) === 0).length,
    no_patients: adherenceRows
      .filter((r) => Number(r.value_num) === 0)
      .map((r) => ({ patient_id: r.patient_id, patient_name: r.patient_name })),
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
    adherence,
    scheduler,
  };
}
