import { DateTime } from 'luxon';
import { AuthError } from '../auth/tokens.js';
import { ValidationError } from '../errors.js';
import { requirePatientInClinic, logAccess } from '../auth/access.js';
import { localDate } from '../time.js';
import { noteDay } from '../notes/index.js';

function requireDoctor(session) {
  if (!session || session.kind !== 'user')
    throw new AuthError('unauthenticated', 'Sessão da clínica necessária.');
}

// `dose_amount` é `decimal` no Postgres e chega como string (ex.: "4.00"); normaliza para "4".
const num = (v) => String(Number(v));
const hm = (t) => String(t).slice(0, 5);

/**
 * Linha do tempo do paciente: notas (D35), ajustes de dose e condutas de alerta agrupados pelo
 * DIA CIVIL no fuso do paciente. A nota é o item principal do dia; ajuste e conduta do mesmo dia
 * aparecem sob ela sem a médica repetir no texto. Dia sem nota mostra o evento sozinho.
 *
 * `dose_events.effective_from` já é um dia (a vigência); `alert_actions.at` é instante e vira dia
 * pelo fuso do paciente — uma conduta às 22:30 de Cuiabá é do dia de Cuiabá, não do UTC.
 */
export async function patientTimeline(
  db,
  session,
  patientId,
  { now, before = null, limitDays = 60 } = {},
) {
  requireDoctor(session);
  if (
    before != null &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(String(before)) || !DateTime.fromISO(String(before)).isValid)
  ) {
    throw new ValidationError('Data inválida (AAAA-MM-DD).', 'before');
  }
  if (!Number.isInteger(limitDays) || limitDays < 1 || limitDays > 3660) {
    throw new ValidationError('limitDays inválido (1..3660).', 'limitDays');
  }
  const patient = await requirePatientInClinic(db, session, patientId);
  const tz = patient.timezone || 'UTC';

  const end = before ? String(before).slice(0, 10) : localDate(now, tz);
  const start = DateTime.fromISO(end)
    .minus({ days: limitDays - 1 })
    .toISODate();
  const startOfWindow = DateTime.fromISO(start, { zone: tz }).startOf('day').toJSDate();
  const endOfWindow = DateTime.fromISO(end, { zone: tz }).endOf('day').toJSDate();

  const notes = await db('clinical_notes')
    .where({ patient_id: patientId })
    .whereNull('deleted_at')
    .andWhere('occurred_at', '>=', start)
    .andWhere('occurred_at', '<=', end)
    .orderBy('occurred_at', 'desc')
    .orderBy('created_at', 'desc');
  const doses = await db('dose_events as d')
    .join('medications as m', 'm.id', 'd.medication_id')
    .join('products as p', 'p.id', 'm.product_id')
    .where('m.patient_id', patientId)
    .andWhere('d.effective_from', '>=', start)
    .andWhere('d.effective_from', '<=', end)
    .select('d.*', 'p.name as product_name');
  const conducts = await db('alert_actions as x')
    .join('alerts as a', 'a.id', 'x.alert_id')
    .leftJoin('users as u', 'u.id', 'x.user_id')
    .where('a.patient_id', patientId)
    .whereIn('x.action', ['resolve', 'note'])
    .andWhere('x.at', '>=', startOfWindow)
    .andWhere('x.at', '<=', endOfWindow)
    .select('x.id', 'x.at', 'x.note', 'u.name as user_name', 'a.title as alert_title');

  const days = new Map();
  const dayOf = (k) => {
    if (!days.has(k)) days.set(k, { day: k, notes: [], events: [] });
    return days.get(k);
  };
  for (const n of notes) dayOf(noteDay(n.occurred_at)).notes.push(n);
  for (const d of doses) {
    const times = (d.schedule_times ?? []).map(hm).join(', ');
    dayOf(noteDay(d.effective_from)).events.push({
      kind: 'dose',
      at: d.created_at,
      ref_id: d.id,
      summary:
        `${d.product_name}: ${num(d.dose_amount)} ${d.dose_unit} · ${d.times_per_day}×/dia (${times})` +
        (d.reason ? ` — ${d.reason}` : ''),
      by: null,
    });
  }
  for (const c of conducts) {
    dayOf(localDate(c.at, tz)).events.push({
      kind: 'conduct',
      at: c.at,
      ref_id: c.id,
      summary: `${c.alert_title}${c.note ? `: ${c.note}` : ''}`,
      by: c.user_name ?? null,
    });
  }
  const out = [...days.values()].sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0));
  for (const d of out) d.events.sort((a, b) => new Date(b.at) - new Date(a.at));

  const [olderNote, olderDose, olderConduct] = await Promise.all([
    db('clinical_notes')
      .where({ patient_id: patientId })
      .whereNull('deleted_at')
      .andWhere('occurred_at', '<', start)
      .first('id'),
    db('dose_events as d')
      .join('medications as m', 'm.id', 'd.medication_id')
      .where('m.patient_id', patientId)
      .andWhere('d.effective_from', '<', start)
      .first('d.id'),
    db('alert_actions as x')
      .join('alerts as a', 'a.id', 'x.alert_id')
      .where('a.patient_id', patientId)
      .whereIn('x.action', ['resolve', 'note'])
      .andWhere('x.at', '<', startOfWindow)
      .first('x.id'),
  ]);
  const hasMore = Boolean(olderNote || olderDose || olderConduct);

  await logAccess(db, { session, patientId, route: 'notes.read', action: 'view' }, now);
  return {
    days: out,
    hasMore,
    nextBefore: hasMore ? DateTime.fromISO(start).minus({ days: 1 }).toISODate() : null,
  };
}
