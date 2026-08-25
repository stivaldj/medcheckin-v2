import { DateTime } from 'luxon';
import { toDT } from '../time.js';
import { getSystemState, STATE_KEYS } from '../scheduler/cycle.js';
import { ADHERENCE_QUESTION_KEY } from '../routine/index.js';

/** Critérios do shadow run — escritos ANTES da semana (docs/SHADOW_RUN.md). */
export const SHADOW_CRITERIA = Object.freeze([
  {
    metric: 'push.delivery_rate',
    label: 'Entrega de push (sent / (sent+failed))',
    op: '>=',
    threshold: 0.95,
    unit: '%',
  },
  {
    metric: 'checkins.response_rate',
    label: 'Check-ins respondidos / enviados',
    op: '>=',
    threshold: 0.7,
    unit: '%',
  },
  {
    metric: 'checkins.median_minutes_to_first_answer',
    label: 'Mediana até a 1ª resposta (min)',
    op: '<=',
    threshold: 120,
    unit: 'min',
  },
  {
    metric: 'adherence.rate',
    label: 'Adesão relatada no check-in (sim / respostas de adesão)',
    op: '>=',
    threshold: 0.7,
    unit: '%',
  },
  {
    metric: 'alerts.median_minutes_to_conduct',
    label: 'Mediana até a conduta em alertas clínicos (min)',
    op: '<=',
    threshold: 24 * 60,
    unit: 'min',
  },
  {
    metric: 'alerts.noise_ratio',
    label: 'Alertas operacionais (no_response/delivery_failed) / total',
    op: '<=',
    threshold: 0.5,
    unit: '%',
  },
  {
    metric: 'scheduler.max_gap_min',
    label: 'Maior lacuna entre ciclos do scheduler (min)',
    op: '<=',
    threshold: 10,
    unit: 'min',
  },
  {
    metric: 'false_success',
    label: 'Sucessos falsos observados (enviado sem push / confirmado sem ação)',
    op: '==',
    threshold: 0,
    unit: '',
  },
]);

const median = (arr) => {
  const a = arr.filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};
const ratio = (num, den) => (den > 0 ? Number((num / den).toFixed(3)) : null);

/** Métricas do período, cada uma com a consulta-fonte (ver docs/SHADOW_RUN.md). */
export async function shadowReport(db, { clinicId, from, to, now }) {
  const nowDT = toDT(now);
  const clinic = await db('clinics').where({ id: clinicId }).first();
  const tz = clinic?.timezone || 'America/Cuiaba';
  const fromJs = DateTime.fromISO(from, { zone: tz }).startOf('day').toUTC().toJSDate();
  const toJs = DateTime.fromISO(to, { zone: tz }).endOf('day').toUTC().toJSDate();
  const patientIds = await db('patients').where({ clinic_id: clinicId }).pluck('id');

  const notif = patientIds.length
    ? await db('notifications')
        .whereIn('patient_id', patientIds)
        .andWhere('created_at', '>=', fromJs)
        .andWhere('created_at', '<=', toJs)
        .select('kind', 'sent_at', 'failed_at', 'attempts')
    : [];
  const sent = notif.filter((n) => n.sent_at).length;
  // falhas = tentativas que falharam antes de um reenvio (attempts-1) + falhas sem sucesso final
  const failed = notif.reduce(
    (acc, n) => acc + (Number(n.attempts || 1) - 1) + (n.failed_at && !n.sent_at ? 1 : 0),
    0,
  );
  const push = {
    total: notif.length,
    sent,
    failed,
    delivery_rate: ratio(sent, sent + failed),
    by_kind: {},
  };
  for (const k of ['checkin', 'alarm', 'alert'])
    push.by_kind[k] = {
      sent: notif.filter((n) => n.kind === k && n.sent_at).length,
      failed: notif.filter((n) => n.kind === k && n.failed_at && !n.sent_at).length,
    };

  const cks = patientIds.length
    ? await db('checkins')
        .whereIn('patient_id', patientIds)
        .andWhere('scheduled_for', '>=', fromJs)
        .andWhere('scheduled_for', '<=', toJs)
    : [];
  const ckSent = cks.filter((c) => c.sent_at);
  const ckCompleted = cks.filter((c) => c.status === 'completed');
  const firstAnswers = ckSent.length
    ? await db('answers')
        .whereIn(
          'checkin_id',
          ckSent.map((c) => c.id),
        )
        .select('checkin_id')
        .min('answered_at as first')
        .groupBy('checkin_id')
    : [];
  const firstBy = Object.fromEntries(firstAnswers.map((a) => [a.checkin_id, new Date(a.first)]));
  const minutesToFirst = ckSent
    .filter((c) => firstBy[c.id])
    .map((c) => (firstBy[c.id] - new Date(c.sent_at)) / 60000);
  const checkins = {
    scheduled: cks.length,
    sent: ckSent.length,
    completed: ckCompleted.length,
    missed: cks.filter((c) => c.status === 'missed').length,
    response_rate: ratio(ckCompleted.length, ckSent.length),
    median_minutes_to_first_answer:
      median(minutesToFirst) === null ? null : Number(median(minutesToFirst).toFixed(1)),
  };

  // Adesão (D15): pela pergunta do check-in — o alarme virou lembrete puro, sem confirmação.
  const adherenceRows = patientIds.length
    ? await db('answers as a')
        .join('checkins as c', 'c.id', 'a.checkin_id')
        .join('questions as q', 'q.id', 'a.question_id')
        .whereIn('c.patient_id', patientIds)
        .andWhere('q.key', ADHERENCE_QUESTION_KEY)
        .andWhere('a.skipped', false)
        .andWhere('c.scheduled_for', '>=', fromJs)
        .andWhere('c.scheduled_for', '<=', toJs)
        .select('a.value_num')
    : [];
  const adherenceYes = adherenceRows.filter((r) => Number(r.value_num) === 1).length;
  const adherence = {
    answered: adherenceRows.length,
    yes: adherenceYes,
    no: adherenceRows.filter((r) => Number(r.value_num) === 0).length,
    rate: ratio(adherenceYes, adherenceRows.length),
  };

  const alertRows = patientIds.length
    ? await db('alerts')
        .whereIn('patient_id', patientIds)
        .andWhere('created_at', '>=', fromJs)
        .andWhere('created_at', '<=', toJs)
    : [];
  const actions = alertRows.length
    ? await db('alert_actions')
        .whereIn(
          'alert_id',
          alertRows.map((a) => a.id),
        )
        .orderBy('at')
    : [];
  const NOISE = ['no_response', 'delivery_failed'];
  const by_code = {};
  const toConduct = [];
  for (const a of alertRows) {
    const acts = actions.filter((x) => x.alert_id === a.id);
    const first = acts.find((x) => x.action === 'acknowledge' || x.action === 'resolve');
    if (!by_code[a.code])
      by_code[a.code] = { opened: 0, resolved_by_doctor: 0, auto_cleared: 0, open: 0 };
    by_code[a.code].opened += 1;
    if (a.status === 'resolved' && a.resolved_reason === 'doctor')
      by_code[a.code].resolved_by_doctor += 1;
    if (a.status === 'resolved' && a.resolved_reason === 'auto_cleared')
      by_code[a.code].auto_cleared += 1;
    if (a.status !== 'resolved') by_code[a.code].open += 1;
    if (!NOISE.includes(a.code) && first)
      toConduct.push((new Date(first.at) - new Date(a.first_seen_at)) / 60000);
  }
  const noise = alertRows.filter((a) => NOISE.includes(a.code)).length;
  const alerts = {
    total: alertRows.length,
    clinical: alertRows.length - noise,
    noise,
    noise_ratio: ratio(noise, alertRows.length),
    by_code,
    noise_codes: NOISE,
    median_minutes_to_conduct:
      median(toConduct) === null ? null : Number(median(toConduct).toFixed(1)),
  };

  const st = await getSystemState(db);
  const scheduler = {
    cycle_count: Number(st[STATE_KEYS.cycleCount] ?? 0),
    max_gap_min: Number(st[STATE_KEYS.maxGapMin] ?? 0),
    last_cycle_at: st[STATE_KEYS.lastCycle] ?? null,
  };

  const auth = {
    logins_user: (
      await db('sessions')
        .whereNotNull('user_id')
        .andWhere('created_at', '>=', fromJs)
        .andWhere('created_at', '<=', toJs)
        .count()
        .first()
    ).count,
    logins_respondent: (
      await db('sessions')
        .whereNotNull('respondent_id')
        .andWhere('created_at', '>=', fromJs)
        .andWhere('created_at', '<=', toJs)
        .count()
        .first()
    ).count,
  };
  const audit = patientIds.length
    ? await db('access_audit')
        .whereIn('patient_id', patientIds)
        .andWhere('at', '>=', fromJs)
        .andWhere('at', '<=', toJs)
        .select('action')
        .count('* as n')
        .groupBy('action')
    : [];

  return {
    period: { from, to, timezone: tz, generated_at: nowDT.toISO() },
    patients: patientIds.length,
    push,
    checkins,
    adherence,
    alerts,
    scheduler,
    auth,
    audit: Object.fromEntries(audit.map((a) => [a.action, Number(a.n)])),
    false_success: 0 /* preenchido manualmente pelo observador (docs/SHADOW_RUN.md) */,
  };
}

const get = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
const cmp = (op, v, t) =>
  v === null || v === undefined
    ? null
    : op === '>='
      ? v >= t
      : op === '<='
        ? v <= t
        : op === '=='
          ? v === t
          : false;
const fmtVal = (v, unit) =>
  v === null || v === undefined
    ? '—'
    : unit === '%'
      ? `${Math.round(v * 100)}%`
      : `${v}${unit ? ' ' + unit : ''}`;

/** Tabela critério × resultado × veredito. */
export function renderShadowReportMarkdown(report, criteria = SHADOW_CRITERIA) {
  const lines = [
    `# Shadow run — relatório critério × resultado`,
    ``,
    `Período ${report.period.from} → ${report.period.to} (${report.period.timezone}) · gerado ${report.period.generated_at} · pacientes: ${report.patients}`,
    ``,
    `| Critério | Limiar | Resultado | Veredito |`,
    `|---|---|---|---|`,
  ];
  let pass = 0;
  let fail = 0;
  for (const c of criteria) {
    const v = get(report, c.metric);
    const ok = cmp(c.op, v, c.threshold);
    const verdict = ok === null ? '⚪ sem dado' : ok ? '✅' : '❌';
    if (ok === true) pass += 1;
    if (ok === false) fail += 1;
    lines.push(
      `| ${c.label} | ${c.op} ${fmtVal(c.threshold, c.unit)} | ${fmtVal(v, c.unit)} | ${verdict} |`,
    );
  }
  lines.push(
    ``,
    `**${pass} ✅ · ${fail} ❌ · ${criteria.length - pass - fail} ⚪**`,
    ``,
    `## Detalhes`,
    ``,
    '```json',
    JSON.stringify(
      {
        push: report.push,
        checkins: report.checkins,
        adherence: report.adherence,
        alerts: report.alerts,
        scheduler: report.scheduler,
        auth: report.auth,
        audit: report.audit,
      },
      null,
      2,
    ),
    '```',
  );
  return lines.join('\n');
}
