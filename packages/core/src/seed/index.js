/**
 * Seed 100% sintético (D7). Nomes, e-mails (.test) e telefones (+55659100xxxx) obviamente falsos.
 * Recusa rodar sobre banco populado, salvo { reset: true } (apaga tudo e recria).
 * Devolve contagens — a prova de E1.
 */
import { productNameKey } from '../medications/nameKey.js';

const TABLES_IN_DELETE_ORDER = [
  'access_audit',
  'patient_scores_daily',
  'alert_silences',
  'alert_actions',
  'alerts',
  'notifications',
  'answers',
  'checkins',
  'episodes',
  'questions',
  'question_sets',
  'medication_intakes',
  'dose_events',
  'medications',
  'products',
  'push_subscriptions',
  'routine_alarms',
  'routine_periods',
  'respondents',
  'patients',
  'users',
  'clinics',
];

const QUESTIONS = [
  {
    // D15: a adesão passou a ser confirmada AQUI (o alarme virou lembrete puro, sem botões).
    key: 'adesao',
    label: 'Tomou as medicações corretamente hoje?',
    kind: 'yes_no',
    sort_order: 1,
    alert_threshold_json: { op: '==', value: 0, severity: 'medium' },
  },
  {
    key: 'dor',
    label: 'Como está sua dor hoje? (0 = nenhuma, 10 = pior possível)',
    kind: 'scale_0_10',
    sort_order: 2,
    alert_threshold_json: { op: '>=', value: 7 },
    score_direction: 'lower_is_better',
    score_weight: 2,
  },
  {
    key: 'sono',
    label: 'Como foi seu sono?',
    kind: 'scale_0_10',
    sort_order: 3,
    alert_threshold_json: { op: '<=', value: 3 },
    score_direction: 'higher_is_better',
  },
  {
    key: 'humor',
    label: 'Como está seu humor?',
    kind: 'scale_0_10',
    sort_order: 4,
    alert_threshold_json: { op: '<=', value: 3 },
    score_direction: 'higher_is_better',
  },
  {
    key: 'crises',
    label: 'Quantas crises nas últimas 24h?',
    kind: 'number',
    unit: 'crises',
    sort_order: 5,
    alert_threshold_json: { op: '>=', value: 3 },
  },
  {
    key: 'efeito_adverso',
    label: 'Sentiu algum efeito indesejado (sonolência, tontura, náusea)?',
    kind: 'yes_no',
    sort_order: 6,
    is_side_effect: true,
    alert_threshold_json: { op: '==', value: 1 },
  },
  {
    key: 'efeito_qual',
    label: 'Qual efeito?',
    kind: 'choice',
    options: ['sonolência', 'tontura', 'náusea', 'boca seca', 'outro'],
    sort_order: 7,
    required: false,
    is_side_effect: true,
    condition_json: { when: 'efeito_adverso', op: '==', value: 1 },
  },
  {
    key: 'obs',
    label: 'Quer registrar mais alguma coisa?',
    kind: 'text',
    sort_order: 8,
    required: false,
  },
];

export async function runSeed(db, { reset = false } = {}) {
  const [{ count }] = await db('clinics').count();
  if (Number(count) > 0) {
    if (!reset) {
      throw new Error(
        'seed: o banco já contém dados; use { reset: true } (ou --reset) para recriar.',
      );
    }
    for (const t of TABLES_IN_DELETE_ORDER) await db(t).del();
  }

  return db.transaction(async (trx) => {
    const [clinic] = await trx('clinics')
      .insert({ name: 'Clínica Sintética', timezone: 'America/Cuiaba' })
      .returning('id');
    const [doctor] = await trx('users')
      .insert({
        clinic_id: clinic.id,
        role: 'doctor',
        email: 'medica@medcheckin.test',
        name: 'Dra. Sintética',
      })
      .returning('id');

    const [product] = await trx('products')
      .insert({
        clinic_id: clinic.id,
        name: 'Óleo Full Spectrum CBD 50mg/ml',
        name_key: productNameKey('Óleo Full Spectrum CBD 50mg/ml'),
        cbd_mg_ml: 50,
        thc_mg_ml: 0.5,
        form: 'oil',
      })
      .returning('id');

    const [qs] = await trx('question_sets')
      .insert({ clinic_id: clinic.id, name: 'Padrão — titulação' })
      .returning('id');
    await trx('questions').insert(
      QUESTIONS.map((q) => ({
        ...q,
        question_set_id: qs.id,
        options: JSON.stringify(q.options ?? []),
        condition_json: q.condition_json ? JSON.stringify(q.condition_json) : null,
        alert_threshold_json: q.alert_threshold_json
          ? JSON.stringify(q.alert_threshold_json)
          : null,
      })),
    );

    // Paciente 1: adulto, responde sozinho, em titulação (2 ajustes de dose).
    const [p1] = await trx('patients')
      .insert({
        clinic_id: clinic.id,
        name: 'Paciente Sintético Um',
        birth_date: '1980-01-01',
        condition_tags: ['dor_cronica'],
        timezone: 'America/Cuiaba',
        consent_version: 'v1',
        consent_at: trx.fn.now(),
        created_by: doctor.id,
      })
      .returning('id');
    await trx('respondents').insert({
      patient_id: p1.id,
      kind: 'patient',
      name: 'Paciente Sintético Um',
      email: 'paciente1@medcheckin.test',
      phone: '+556591000001',
      invite_token: 'seed-p1',
      accepted_at: trx.fn.now(),
      consent_version: 'v1',
      consent_at: trx.fn.now(),
    });
    const [m1] = await trx('medications')
      .insert({ patient_id: p1.id, product_id: product.id })
      .returning('id');
    const doseBase = {
      medication_id: m1.id,
      dose_unit: 'gotas',
      times_per_day: 2,
      schedule_times: ['08:00', '20:00'],
      created_by: doctor.id,
    };
    const [d1a] = await trx('dose_events')
      .insert({ ...doseBase, effective_from: daysAgo(14), dose_amount: 2, reason: 'início' })
      .returning('id');
    await trx('dose_events').insert({
      ...doseBase,
      effective_from: daysAgo(4),
      dose_amount: 4,
      reason: 'titulação: dor persistente',
    });
    // Rotina de alarmes (E9.1): período vigente com fim previsto, um texto livre por horário.
    const [rp1] = await trx('routine_periods')
      .insert({
        patient_id: p1.id,
        starts_on: daysAgo(4),
        ends_on: daysAhead(3),
        note: 'ciclo atual',
        created_by: doctor.id,
      })
      .returning('id');
    await trx('routine_alarms').insert([
      {
        period_id: rp1.id,
        time: '08:00',
        description: 'ômega 3 1cp / 4 gts óleo IBRACAN 10% sublingual (segurar 1–3 min)',
      },
      { period_id: rp1.id, time: '20:00', description: '4 gts óleo IBRACAN 10% sublingual' },
    ]);
    await trx('episodes').insert({
      patient_id: p1.id,
      kind: 'titration',
      started_at: trx.raw(`now() - interval '14 days'`),
      checkin_frequency: 'daily',
      question_set_id: qs.id,
      dose_event_id: d1a.id,
    });

    // Paciente 2: criança, respondida pela cuidadora (mãe), em manutenção.
    const [p2] = await trx('patients')
      .insert({
        clinic_id: clinic.id,
        name: 'Paciente Sintético Dois',
        birth_date: '2018-06-15',
        condition_tags: ['epilepsia'],
        timezone: 'America/Cuiaba',
        consent_version: 'v1',
        consent_at: trx.fn.now(),
        created_by: doctor.id,
      })
      .returning('id');
    await trx('respondents').insert([
      {
        patient_id: p2.id,
        kind: 'patient',
        name: 'Paciente Sintético Dois',
        can_answer: false,
        receives_alarms: false,
        invite_token: 'seed-p2',
      },
      {
        patient_id: p2.id,
        kind: 'caregiver',
        name: 'Cuidadora Sintética',
        relationship: 'mãe',
        email: 'cuidadora@medcheckin.test',
        phone: '+556591000002',
        invite_token: 'seed-c2',
        accepted_at: trx.fn.now(),
        consent_version: 'v1',
        consent_at: trx.fn.now(),
      },
    ]);
    const [m2] = await trx('medications')
      .insert({ patient_id: p2.id, product_id: product.id })
      .returning('id');
    const [d2] = await trx('dose_events')
      .insert({
        medication_id: m2.id,
        effective_from: daysAgo(40),
        dose_amount: 0.5,
        dose_unit: 'ml',
        times_per_day: 3,
        schedule_times: ['07:00', '13:00', '21:00'],
        reason: 'início',
        created_by: doctor.id,
      })
      .returning('id');
    const [rp2] = await trx('routine_periods')
      .insert({ patient_id: p2.id, starts_on: daysAgo(40), created_by: doctor.id })
      .returning('id');
    await trx('routine_alarms').insert([
      { period_id: rp2.id, time: '07:00', description: '0,5 ml óleo + vitamina D' },
      { period_id: rp2.id, time: '13:00', description: '0,5 ml óleo' },
      { period_id: rp2.id, time: '21:00', description: '0,5 ml óleo antes de dormir' },
    ]);
    await trx('episodes').insert({
      patient_id: p2.id,
      kind: 'maintenance',
      started_at: trx.raw(`now() - interval '10 days'`),
      checkin_frequency: 'weekly',
      question_set_id: qs.id,
      dose_event_id: d2.id,
    });

    return counts(trx);
  });
}

function daysAgo(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function daysAhead(n) {
  return daysAgo(-n);
}

async function counts(trx) {
  const out = {};
  for (const t of [
    'clinics',
    'users',
    'patients',
    'respondents',
    'products',
    'medications',
    'dose_events',
    'question_sets',
    'questions',
    'episodes',
    'routine_periods',
    'routine_alarms',
  ]) {
    const [{ count }] = await trx(t).count();
    out[t] = Number(count);
  }
  return out;
}
