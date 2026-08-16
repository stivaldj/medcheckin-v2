import { DateTime } from 'luxon';

/**
 * Cálculo determinístico do próximo disparo (portado do v1 `scheduling/next-run.js`).
 * Formato único de plano (armadilha 3 do v1: snake_case vs camelCase):
 *   { timezone, daysOfWeek?, timesHm?, intervalDays?, intervalAnchorDate?, quietStart?, quietEnd? }
 */

const ALL_WEEK_DAYS = [1, 2, 3, 4, 5, 6, 7];

export function parseHm(value) {
  const [hour, minute] = String(value).split(':').map(Number);
  return { hour, minute };
}

/** Aceita '09:00', '09:00:00' (time do PG) → '09:00'. */
export function toHm(value) {
  const m = String(value ?? '')
    .trim()
    .match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}

export function inQuietHours(localDt, quietStart, quietEnd) {
  if (!quietStart || !quietEnd) return false;
  const s = parseHm(quietStart);
  const e = parseHm(quietEnd);
  const mins = localDt.hour * 60 + localDt.minute;
  const sm = s.hour * 60 + s.minute;
  const em = e.hour * 60 + e.minute;
  if (sm === em) return false;
  if (sm < em) return mins >= sm && mins < em;
  return mins >= sm || mins < em;
}

function normalizeDays(days) {
  if (!Array.isArray(days) || !days.length) return ALL_WEEK_DAYS;
  const n = [...new Set(days.map(Number).filter((d) => d >= 1 && d <= 7))];
  return n.length ? n : ALL_WEEK_DAYS;
}

function normalizeTimes(times) {
  if (!Array.isArray(times) || !times.length) return ['09:00'];
  const n = [...new Set(times.map(toHm).filter(Boolean))].sort();
  return n.length ? n : ['09:00'];
}

export function shiftOutOfQuietHours(localDt, quietStart, quietEnd) {
  if (!inQuietHours(localDt, quietStart, quietEnd)) return localDt;
  const s = parseHm(quietStart);
  const e = parseHm(quietEnd);
  const sm = s.hour * 60 + s.minute;
  const em = e.hour * 60 + e.minute;
  const nowM = localDt.hour * 60 + localDt.minute;
  const endToday = localDt.set({ hour: e.hour, minute: e.minute, second: 0, millisecond: 0 });
  if (sm < em) return nowM < em ? endToday : endToday.plus({ days: 1 });
  return nowM >= sm ? endToday.plus({ days: 1 }) : endToday;
}

/**
 * @param {DateTime} now  instante UTC (luxon)
 * @param {object} plan   ver formato acima
 * @returns {string} ISO UTC do próximo disparo
 */
export function computeNextAttemptAt(now, plan = {}) {
  const timezone = plan.timezone || 'UTC';
  const localNow = now.setZone(timezone);
  const days = normalizeDays(plan.daysOfWeek);
  const times = normalizeTimes(plan.timesHm);
  const quietStart = toHm(plan.quietStart);
  const quietEnd = toHm(plan.quietEnd);
  const intervalDays = Number(plan.intervalDays || 0) || null;
  const anchor = plan.intervalAnchorDate
    ? DateTime.fromISO(String(plan.intervalAnchorDate), { zone: timezone }).startOf('day')
    : localNow.startOf('day');

  for (let offset = 0; offset <= 8; offset += 1) {
    const day = localNow.startOf('day').plus({ days: offset });
    const eligible = intervalDays
      ? Math.abs(Math.floor(day.diff(anchor, 'days').days)) % intervalDays === 0
      : days.includes(day.weekday);
    if (!eligible) continue;
    for (const hm of times) {
      const { hour, minute } = parseHm(hm);
      const candidate = day.set({ hour, minute, second: 0, millisecond: 0 });
      if (candidate < localNow) continue;
      return shiftOutOfQuietHours(candidate, quietStart, quietEnd).toUTC().toISO();
    }
  }
  const fallback = shiftOutOfQuietHours(
    localNow.plus({ days: 1 }).startOf('day'),
    quietStart,
    quietEnd,
  );
  return fallback.toUTC().toISO();
}

const FREQ_INTERVAL = { daily: null, weekly: 7, biweekly: 14 };

/**
 * D5: plano de disparo a partir do episódio aberto + preferências do paciente.
 */
export function planFromEpisode(episode, patient) {
  const timezone = patient.timezone || 'America/Cuiaba';
  const plan = {
    timezone,
    timesHm: [toHm(patient.checkin_time) || '09:00'],
    quietStart: toHm(patient.quiet_start) || '21:00',
    quietEnd: toHm(patient.quiet_end) || '08:00',
  };
  const interval = FREQ_INTERVAL[episode.checkin_frequency] ?? null;
  if (interval) {
    plan.intervalDays = interval;
    plan.intervalAnchorDate = DateTime.fromJSDate(new Date(episode.started_at))
      .setZone(timezone)
      .toISODate();
  }
  return plan;
}
