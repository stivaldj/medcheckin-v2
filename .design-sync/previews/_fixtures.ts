// Dados de exemplo compartilhados pelos previews dos componentes de domínio.
// Refletem as formas reais de @medcheckin/core (AlertRow, RoutineView, Grid…) com conteúdo
// clínico plausível — nada de "foo"/"teste": estes cards são lidos por pessoas e imitados
// pelo agente de design.

export const QUESTION_SETS = [
  { id: 'qs-dor', clinic_id: 'c1', name: 'Dor crônica — padrão', active: true, created_at: '2026-01-10' },
  { id: 'qs-ansiedade', clinic_id: 'c1', name: 'Ansiedade', active: true, created_at: '2026-01-10' },
];

export const ALERTS = [
  {
    id: 'al-1',
    patient_id: 'p1',
    code: 'symptom_above_threshold',
    severity: 'critical' as const,
    title: 'Dor 9/10 por três dias seguidos',
    context: { question: 'dor', value: 9 },
    status: 'open' as const,
    resolved_reason: null,
    first_seen_at: '2026-03-10T08:14:00Z',
    last_seen_at: '2026-03-12T08:09:00Z',
    resolved_at: null,
    created_at: '2026-03-10T08:14:00Z',
  },
  {
    id: 'al-2',
    patient_id: 'p1',
    code: 'missed_checkins',
    severity: 'high' as const,
    title: 'Três check-ins seguidos sem resposta',
    context: { missed: 3 },
    status: 'open' as const,
    resolved_reason: null,
    first_seen_at: '2026-03-09T09:00:00Z',
    last_seen_at: '2026-03-12T09:00:00Z',
    resolved_at: null,
    created_at: '2026-03-09T09:00:00Z',
  },
  {
    id: 'al-3',
    patient_id: 'p1',
    code: 'side_effect',
    severity: 'medium' as const,
    title: 'Sonolência relatada após aumento de dose',
    context: { question: 'sonolencia' },
    status: 'open' as const,
    resolved_reason: null,
    first_seen_at: '2026-03-11T20:30:00Z',
    last_seen_at: '2026-03-11T20:30:00Z',
    resolved_at: null,
    created_at: '2026-03-11T20:30:00Z',
  },
];

export const CONDUCTS = [
  {
    id: 'cd-1',
    alert_id: 'al-9',
    action: 'resolved',
    note: 'Contato por telefone; paciente havia esquecido de registrar. Mantida a dose.',
    at: '2026-03-08T14:20:00Z',
    user_name: 'Dra. Helena Prado',
    alert_title: 'Dois check-ins sem resposta',
  },
];

export const RESPONDENTS = [
  {
    id: 'r-1',
    patient_id: 'p1',
    kind: 'patient' as const,
    name: 'Maria Souza',
    email: 'maria.souza@exemplo.com',
    phone: null,
    relationship: null,
    can_answer: true,
    receives_alarms: true,
    invite_token: 'tok-1',
    accepted_at: '2026-02-02T10:00:00Z',
    consent_version: 'v1',
    consent_at: '2026-02-02T10:00:00Z',
    created_at: '2026-02-01T10:00:00Z',
    updated_at: '2026-02-02T10:00:00Z',
  },
  {
    id: 'r-2',
    patient_id: 'p1',
    kind: 'caregiver' as const,
    name: 'João Souza',
    email: 'joao.souza@exemplo.com',
    phone: '+55 11 99999-0000',
    relationship: 'Filho',
    can_answer: true,
    receives_alarms: true,
    invite_token: 'tok-2',
    accepted_at: null,
    consent_version: null,
    consent_at: null,
    created_at: '2026-02-01T10:00:00Z',
    updated_at: '2026-02-01T10:00:00Z',
  },
];

export const PRODUCTS = [
  { id: 'pr-1', clinic_id: 'c1', name: 'Óleo full spectrum 200mg/ml', cbd_mg_ml: 200, thc_mg_ml: 2, form: 'oil' },
  { id: 'pr-2', clinic_id: 'c1', name: 'Isolado 100mg/ml', cbd_mg_ml: 100, thc_mg_ml: 0, form: 'oil' },
];

export const DOSE = {
  id: 'de-1',
  medication_id: 'm-1',
  effective_from: '2026-03-01',
  dose_amount: 2,
  dose_unit: 'gotas',
  times_per_day: 2,
  schedule_times: ['08:00', '20:00'],
  reason: 'Titulação semanal',
  note: null,
  created_by: 'u-1',
  created_at: '2026-03-01T09:00:00Z',
};

export const MEDICATIONS = [
  {
    id: 'm-1',
    patient_id: 'p1',
    product_id: 'pr-1',
    active: true,
    product_name: 'Óleo full spectrum 200mg/ml',
    form: 'oil',
    cbd_mg_ml: 200,
    thc_mg_ml: 2,
    current_dose: DOSE,
    // Med = MedicationRow & { dose_history: DoseEvent[] } — o histórico é obrigatório.
    dose_history: [
      DOSE,
      { ...DOSE, id: 'de-0', effective_from: '2026-02-15', dose_amount: 1, times_per_day: 2, reason: 'Início da titulação' },
    ],
  },
  {
    id: 'm-2',
    patient_id: 'p1',
    product_id: 'pr-2',
    active: true,
    product_name: 'Isolado 100mg/ml',
    form: 'oil',
    cbd_mg_ml: 100,
    thc_mg_ml: 0,
    current_dose: {
      ...DOSE,
      id: 'de-2',
      medication_id: 'm-2',
      dose_amount: 1,
      times_per_day: 1,
      schedule_times: ['22:00'],
      reason: null,
    },
    dose_history: [],
  },
];

export const EPISODE = {
  id: 'ep-1',
  patient_id: 'p1',
  kind: 'titration' as const,
  started_at: '2026-03-01T12:00:00Z',
  ended_at: null,
  checkin_frequency: 'daily' as const,
  question_set_id: 'qs-dor',
  // O card lê o nome já resolvido pela query, não o id.
  question_set_name: 'Dor crônica — padrão',
  dose_event_id: 'de-1',
};

export const PATIENT_QUESTIONS = [
  {
    id: 'q-1',
    question_set_id: null,
    patient_id: 'p1',
    key: 'dor',
    label: 'Como está sua dor hoje?',
    kind: 'scale_0_10' as const,
    options: [],
    unit: null,
    sort_order: 1,
    required: true,
    active: true,
    condition_json: null,
    alert_threshold_json: null,
    is_side_effect: false,
    score_direction: 'lower_is_better' as const,
    created_at: '2026-03-01',
  },
  {
    id: 'q-2',
    question_set_id: null,
    patient_id: 'p1',
    key: 'sono',
    label: 'Como você dormiu?',
    kind: 'scale_0_10' as const,
    options: [],
    unit: null,
    sort_order: 2,
    required: true,
    active: true,
    condition_json: null,
    alert_threshold_json: null,
    is_side_effect: false,
    score_direction: 'higher_is_better' as const,
    created_at: '2026-03-01',
  },
  {
    id: 'q-3',
    question_set_id: null,
    patient_id: 'p1',
    key: 'sonolencia',
    label: 'Sentiu sonolência durante o dia?',
    kind: 'yes_no' as const,
    options: [],
    unit: null,
    sort_order: 3,
    required: false,
    active: true,
    condition_json: null,
    alert_threshold_json: null,
    is_side_effect: true,
    score_direction: null,
    created_at: '2026-03-01',
  },
];

const DIAS = ['2026-03-06', '2026-03-07', '2026-03-08', '2026-03-09', '2026-03-10', '2026-03-11', '2026-03-12'];

export const GRID = {
  days: DIAS,
  timezone: 'America/Sao_Paulo',
  questions: [
    { key: 'dor', label: 'Dor', kind: 'scale_0_10', unit: null, is_side_effect: false },
    { key: 'sono', label: 'Sono', kind: 'scale_0_10', unit: null, is_side_effect: false },
    { key: 'sonolencia', label: 'Sonolência', kind: 'yes_no', unit: null, is_side_effect: true },
  ],
  // cells é indexado por DIA e depois por chave de pergunta (grid.cells[dia][pergunta]).
  cells: {
    '2026-03-06': { dor: 7, sono: 4, sonolencia: 0 },
    '2026-03-07': { dor: 6, sono: 5, sonolencia: 0 },
    '2026-03-08': { dor: 6, sono: 6, sonolencia: 1 },
    '2026-03-09': { dor: 5, sono: 6, sonolencia: 1 },
    '2026-03-10': { dor: 9, sono: 3, sonolencia: 1 },
    '2026-03-11': { dor: 4, sono: 8, sonolencia: 0 },
    '2026-03-12': { dor: 3, sono: 8, sonolencia: 0 },
  },
  scores: { '2026-03-06': 5, '2026-03-07': 5.5, '2026-03-08': 6, '2026-03-09': 5.5, '2026-03-10': 3, '2026-03-11': 8, '2026-03-12': 8.5 },
  risk: { '2026-03-06': null, '2026-03-07': null, '2026-03-08': null, '2026-03-09': null, '2026-03-10': 'critical', '2026-03-11': null, '2026-03-12': null },
  doseMarkers: [{ date: '2026-03-08', dose_amount: 2, dose_unit: 'gotas', reason: 'Titulação semanal' }],
};

export const DIRECOES = {
  dor: 'lower_is_better' as const,
  sono: 'higher_is_better' as const,
  sonolencia: null,
};

export const ROUTINE = {
  today: '2026-03-12',
  timezone: 'America/Sao_Paulo',
  current: {
    id: 'rp-1',
    patient_id: 'p1',
    starts_on: '2026-03-01',
    ends_on: null,
    note: 'Titulação — reavaliar em 30 dias.',
    max_late_min: 90,
    replicated_from: null,
    created_at: '2026-03-01T09:00:00Z',
    alarms: [
      { time: '08:00', description: 'Dose da manhã — 2 gotas sublinguais' },
      { time: '20:00', description: 'Dose da noite — 2 gotas sublinguais' },
    ],
  },
  upcoming: [
    {
      id: 'rp-2',
      patient_id: 'p1',
      starts_on: '2026-04-01',
      ends_on: '2026-04-30',
      note: 'Manutenção',
      max_late_min: null,
      replicated_from: 'rp-1',
      created_at: '2026-03-10T09:00:00Z',
      alarms: [{ time: '20:00', description: 'Dose única da noite' }],
    },
  ],
  past: [],
  recipients: [
    { id: 'r-1', name: 'Maria Souza', kind: 'patient', accepted: true },
    { id: 'r-2', name: 'João Souza', kind: 'caregiver', accepted: false },
  ],
};

export const QUESTION_SET_EDITOR_SETS = [
  {
    id: 'qs-dor',
    name: 'Dor crônica — padrão',
    active: true,
    questions: [
      { id: 'q-1', key: 'dor', label: 'Como está sua dor hoje?', kind: 'scale_0_10', options: [], unit: null, required: true, active: true, sort_order: 1, is_side_effect: false, score_direction: 'lower_is_better', score_weight: 2, alert_threshold_json: { op: '>=', value: 8, severity: 'high' }, condition_json: null },
      { id: 'q-2', key: 'sono', label: 'Como você dormiu?', kind: 'scale_0_10', options: [], unit: null, required: true, active: true, sort_order: 2, is_side_effect: false, score_direction: 'higher_is_better', score_weight: 1, alert_threshold_json: null, condition_json: null },
    ],
  },
];
