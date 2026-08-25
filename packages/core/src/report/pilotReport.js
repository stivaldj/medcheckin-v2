import { DateTime } from 'luxon';
import { toDT } from '../time.js';
import { getSystemState, STATE_KEYS } from '../scheduler/cycle.js';
import { ADHERENCE_QUESTION_KEY } from '../routine/index.js';

/**
 * E10 — piloto real. Os critérios são ESCRITOS ANTES (aqui e em docs/PILOTO.md) e o relatório é
 * gerado do banco de produção. Diferente do shadow run (E9, que provava entrega), o piloto precisa
 * provar que o produto entrega a PROMESSA: a médica enxerga sintoma × dose e age quando precisa.
 *
 * O relatório é só CONTAGEM — nenhum nome, e-mail ou telefone sai daqui (D7/LGPD).
 */
export const PILOT_CRITERIA = Object.freeze([
  {
    metric: 'patients.still_engaged_rate',
    label: 'Pacientes ainda respondendo na última semana do piloto',
    op: '>=',
    threshold: 0.8,
    unit: '%',
  },
  {
    metric: 'engagement.response_rate',
    label: 'Check-ins respondidos / enviados',
    op: '>=',
    threshold: 0.6,
    unit: '%',
  },
  {
    metric: 'engagement.patients_responding_half_rate',
    label: 'Pacientes que responderam pelo menos metade dos check-ins',
    op: '>=',
    threshold: 0.7,
    unit: '%',
  },
  {
    metric: 'engagement.median_minutes_to_first_answer',
    label: 'Mediana até a 1ª resposta (min)',
    op: '<=',
    threshold: 240,
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
    metric: 'routine.coverage_rate',
    label: 'Dias-paciente cobertos por um período de rotina (alarme não parou sem querer)',
    op: '>=',
    threshold: 0.9,
    unit: '%',
  },
  {
    metric: 'clinical.conduct_rate',
    label: 'Alertas clínicos com conduta registrada',
    op: '>=',
    threshold: 0.9,
    unit: '%',
  },
  {
    metric: 'clinical.median_minutes_to_conduct',
    label: 'Mediana até a conduta em alerta clínico (min)',
    op: '<=',
    threshold: 24 * 60,
    unit: 'min',
  },
  {
    metric: 'clinical.series_rate',
    label: 'Pacientes com gráfico sintoma × dose utilizável (dias de resposta + ajuste no período)',
    op: '>=',
    threshold: 0.5,
    unit: '%',
  },
  {
    metric: 'noise.ratio',
    label: 'Ruído: alertas operacionais (no_response/delivery_failed) / total',
    op: '<=',
    threshold: 0.3,
    unit: '%',
  },
  {
    metric: 'reliability.push_delivery_rate',
    label: 'Entrega de push',
    op: '>=',
    threshold: 0.95,
    unit: '%',
  },
  {
    metric: 'reliability.scheduler_max_gap_min',
    label: 'Maior lacuna entre ciclos do scheduler',
    op: '<=',
    threshold: 10,
    unit: 'min',
  },
  {
    metric: 'false_success',
    label: 'Sucessos falsos observados (número na tela sem fonte, "enviado" sem push)',
    op: '==',
    threshold: 0,
    unit: '',
  },
]);

/** Qualquer uma → parar o piloto, corrigir, e só então retomar. Não são "notas baixas": são paradas. */
export const PILOT_ABORT_RULES = Object.freeze([
  'Dado de um paciente visível para outro paciente, outro respondente ou outra clínica.',
  'Decisão clínica tomada sobre número errado na tela (dose vigente, série ou adesão divergindo do banco).',
  'Alerta clínico que não chegou à médica por falha do sistema (não por escolha dela).',
  'Push parado em uma plataforma inteira por mais de 24 h, ou scheduler parado > 60 min sem alerta de uptime.',
  'Perda de dado clínico já registrado (resposta, ajuste de dose ou conduta que sumiu).',
  'Paciente ou responsável pedindo para sair e o acesso continuar funcionando.',
]);

const CLINICAL_EXCLUDED = new Set(['no_response', 'delivery_failed']);
const median = (arr) => {
  const a = arr.filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};
const ratio = (num, den) => (den > 0 ? Number((num / den).toFixed(3)) : null);
const isoDay = (v) =>
  v instanceof Date ? DateTime.fromJSDate(v).toISODate() : String(v).slice(0, 10);

/**
 * @param {object} opts
 * @param {number} [opts.seriesMinDays=10] dias com resposta para a série sintoma × dose ser lida.
 */
export async function pilotReport(
  db,
  { clinicId, from, to, now, seriesMinDays = 10, falseSuccess = 0 },
) {
  const nowDT = toDT(now);
  const clinic = await db('clinics').where({ id: clinicId }).first();
  const tz = clinic?.timezone || 'America/Cuiaba';
  const start = DateTime.fromISO(from, { zone: tz }).startOf('day');
  const end = DateTime.fromISO(to, { zone: tz }).endOf('day');
  const fromJs = start.toUTC().toJSDate();
  const toJs = end.toUTC().toJSDate();
  const days = [];
  for (let d = start; d <= end; d = d.plus({ days: 1 })) days.push(d.toISODate());

  const patientRows = await db('patients')
    .where({ clinic_id: clinicId })
    .andWhere('created_at', '<=', toJs)
    .select('id', 'status');
  const patientIds = patientRows.map((p) => p.id);

  /* --- engajamento ------------------------------------------------------ */
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

  const sentByPatient = new Map();
  const doneByPatient = new Map();
  for (const c of ckSent)
    sentByPatient.set(c.patient_id, (sentByPatient.get(c.patient_id) ?? 0) + 1);
  for (const c of ckCompleted)
    doneByPatient.set(c.patient_id, (doneByPatient.get(c.patient_id) ?? 0) + 1);
  const patientsWithSend = [...sentByPatient.keys()];
  const respondingHalf = patientsWithSend.filter(
    (id) => (doneByPatient.get(id) ?? 0) / sentByPatient.get(id) >= 0.5,
  );

  const lastWeekStart = end.minus({ days: 6 }).startOf('day').toUTC().toJSDate();
  const stillEngaged = ckCompleted.filter((c) => new Date(c.scheduled_for) >= lastWeekStart);
  const stillEngagedIds = new Set(stillEngaged.map((c) => c.patient_id));

  const engagement = {
    scheduled: cks.length,
    sent: ckSent.length,
    completed: ckCompleted.length,
    missed: cks.filter((c) => c.status === 'missed').length,
    response_rate: ratio(ckCompleted.length, ckSent.length),
    median_minutes_to_first_answer:
      median(minutesToFirst) === null ? null : Number(median(minutesToFirst).toFixed(1)),
    patients_responding_half: respondingHalf.length,
    patients_responding_half_rate: ratio(respondingHalf.length, patientsWithSend.length),
  };

  const patients = {
    enrolled: patientRows.length,
    active: patientRows.filter((p) => p.status === 'active').length,
    paused: patientRows.filter((p) => p.status === 'paused').length,
    discharged: patientRows.filter((p) => p.status === 'discharged').length,
    still_engaged: stillEngagedIds.size,
    still_engaged_rate: ratio(stillEngagedIds.size, patientsWithSend.length),
  };

  /* --- adesão (D15: vem da pergunta do check-in) ------------------------- */
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

  /* --- rotina: o alarme parou sozinho sem ninguém querer? ---------------- */
  const periods = patientIds.length
    ? await db('routine_periods').whereIn('patient_id', patientIds).select('*')
    : [];
  let covered = 0;
  const withoutPeriod = new Set();
  for (const p of patientRows) {
    const mine = periods.filter((x) => x.patient_id === p.id);
    let any = false;
    for (const day of days) {
      const hit = mine.some(
        (x) => isoDay(x.starts_on) <= day && (!x.ends_on || isoDay(x.ends_on) >= day),
      );
      if (hit) {
        covered += 1;
        any = true;
      }
    }
    if (!any) withoutPeriod.add(p.id);
  }
  const routine = {
    patient_days_total: patientRows.length * days.length,
    patient_days_covered: covered,
    coverage_rate: ratio(covered, patientRows.length * days.length),
    patients_without_period: withoutPeriod.size,
  };

  /* --- clínico: alerta → conduta, ajuste de dose, série utilizável ------- */
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
        .whereIn('action', ['ack', 'resolve', 'note'])
        .orderBy('at')
    : [];
  const firstActionBy = new Map();
  for (const a of actions) if (!firstActionBy.has(a.alert_id)) firstActionBy.set(a.alert_id, a.at);
  const clinicalAlerts = alertRows.filter((a) => !CLINICAL_EXCLUDED.has(a.code));
  const withConduct = clinicalAlerts.filter((a) => firstActionBy.has(a.id));
  const minutesToConduct = withConduct.map(
    (a) => (new Date(firstActionBy.get(a.id)) - new Date(a.first_seen_at)) / 60000,
  );

  const doses = patientIds.length
    ? await db('dose_events as de')
        .join('medications as m', 'm.id', 'de.medication_id')
        .whereIn('m.patient_id', patientIds)
        .andWhere('de.effective_from', '>=', start.toISODate())
        .andWhere('de.effective_from', '<=', end.toISODate())
        .select('m.patient_id')
    : [];
  const dosesByPatient = new Set(doses.map((d) => d.patient_id));

  const answerDays = patientIds.length
    ? await db('answers as a')
        .join('checkins as c', 'c.id', 'a.checkin_id')
        .whereIn('c.patient_id', patientIds)
        .andWhere('a.skipped', false)
        .andWhere('c.scheduled_for', '>=', fromJs)
        .andWhere('c.scheduled_for', '<=', toJs)
        .select('c.patient_id', 'c.scheduled_for')
    : [];
  const daysByPatient = new Map();
  for (const a of answerDays) {
    const key = a.patient_id;
    if (!daysByPatient.has(key)) daysByPatient.set(key, new Set());
    daysByPatient
      .get(key)
      .add(DateTime.fromJSDate(new Date(a.scheduled_for)).setZone(tz).toISODate());
  }
  const withSeries = patientRows.filter(
    (p) => (daysByPatient.get(p.id)?.size ?? 0) >= seriesMinDays && dosesByPatient.has(p.id),
  );

  const clinical = {
    alerts_total: alertRows.length,
    alerts_clinical: clinicalAlerts.length,
    alerts_with_conduct: withConduct.length,
    conduct_rate: ratio(withConduct.length, clinicalAlerts.length),
    median_minutes_to_conduct:
      median(minutesToConduct) === null ? null : Number(median(minutesToConduct).toFixed(1)),
    dose_adjustments: doses.length,
    patients_with_series: withSeries.length,
    series_rate: ratio(withSeries.length, patientRows.length),
    series_min_days: seriesMinDays,
  };

  const operational = alertRows.filter((a) => CLINICAL_EXCLUDED.has(a.code)).length;
  const noise = {
    operational,
    total: alertRows.length,
    ratio: ratio(operational, alertRows.length),
  };

  /* --- confiabilidade ---------------------------------------------------- */
  const notif = patientIds.length
    ? await db('notifications')
        .whereIn('patient_id', patientIds)
        .andWhere('created_at', '>=', fromJs)
        .andWhere('created_at', '<=', toJs)
        .select('sent_at', 'failed_at', 'attempts')
    : [];
  const pushSent = notif.filter((n) => n.sent_at).length;
  const pushFailed = notif.reduce(
    (acc, n) => acc + (Number(n.attempts || 1) - 1) + (n.failed_at && !n.sent_at ? 1 : 0),
    0,
  );
  const state = await getSystemState(db);
  const reliability = {
    push_total: notif.length,
    push_sent: pushSent,
    push_failed: pushFailed,
    push_delivery_rate: ratio(pushSent, pushSent + pushFailed),
    cycle_count: Number(state[STATE_KEYS.cycleCount] ?? 0),
    scheduler_max_gap_min: Number(state[STATE_KEYS.maxGapMin] ?? 0),
  };

  return {
    period: {
      from: start.toISODate(),
      to: end.toISODate(),
      days: days.length,
      timezone: tz,
      generated_at: nowDT.toISO(),
    },
    patients,
    engagement,
    adherence,
    routine,
    clinical,
    noise,
    reliability,
    /* preenchido pelo observador ao fim (docs/PILOTO.md) */
    false_success: falseSuccess,
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

/** Tabela critério × resultado × veredito + regras de aborto + espaço para a decisão. */
export function renderPilotReportMarkdown(report, criteria = PILOT_CRITERIA) {
  const lines = [
    `# Piloto real — relatório critério × resultado`,
    ``,
    `Período ${report.period.from} → ${report.period.to} (${report.period.days} dias, ${report.period.timezone}) · gerado ${report.period.generated_at}`,
    `Pacientes: ${report.patients.enrolled} inscritos · ${report.patients.active} ativos · ${report.patients.discharged} com alta`,
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
  const undecided = criteria.length - pass - fail;
  lines.push(
    ``,
    `**${pass} ✅ · ${fail} ❌ · ${undecided} ⚪**`,
    ``,
    `## Critérios de aborto`,
    ``,
    `Qualquer um destes durante o piloto **para** o piloto — não é nota baixa, é parada:`,
    ``,
    ...PILOT_ABORT_RULES.map((r) => `- [ ] ${r}`),
    ``,
    `## Decisão`,
    ``,
    `Regra escrita antes: **${Math.ceil(criteria.length * 0.8)} de ${criteria.length} critérios ✅ e nenhum aborto → ampliar**; caso contrário, corrigir e repetir, ou encerrar.`,
    ``,
    `- [ ] Ampliar (mais pacientes / mais médicos)`,
    `- [ ] Repetir o piloto após correções: _quais_`,
    `- [ ] Encerrar: _por quê_`,
    ``,
    `Assinado por: ______________________  Data: __________`,
    ``,
    `## Detalhes`,
    ``,
    '```json',
    JSON.stringify(
      {
        patients: report.patients,
        engagement: report.engagement,
        adherence: report.adherence,
        routine: report.routine,
        clinical: report.clinical,
        noise: report.noise,
        reliability: report.reliability,
      },
      null,
      2,
    ),
    '```',
  );
  return lines.join('\n');
}
