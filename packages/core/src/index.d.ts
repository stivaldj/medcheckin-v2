import type { Knex } from 'knex';

export interface CoreConfig {
  readonly databaseUrl: string;
}

/** Fail-closed: lança se DATABASE_URL ausente. */
export function loadConfig(env?: Record<string, string | undefined>): CoreConfig;

/** Conexão Knex com Postgres (PG-only). numeric/int8 já convertidos para number. */
export function createDb(databaseUrl: string): Knex;

export const migrationConfig: Readonly<Knex.MigratorConfig>;
export function migrateLatest(db: Knex): Promise<{ batch: number; files: string[] }>;
export function migrateRollbackAll(db: Knex): Promise<unknown>;

export interface DoseEvent {
  id: string;
  medication_id: string;
  effective_from: Date;
  dose_amount: number;
  dose_unit: string;
  times_per_day: number;
  schedule_times: string[];
  reason: string | null;
  note: string | null;
  created_by: string;
  created_at: Date;
}
/** Dose vigente em `at` (default: agora). null quando não há ajuste vigente. */
export function currentDose(db: Knex, medicationId: string, at?: Date): Promise<DoseEvent | null>;

export interface SeedCounts {
  clinics: number;
  users: number;
  patients: number;
  respondents: number;
  products: number;
  medications: number;
  dose_events: number;
  question_sets: number;
  questions: number;
  episodes: number;
}
/** Seed sintético (D7). Recusa banco populado salvo reset. */
export function runSeed(db: Knex, opts?: { reset?: boolean }): Promise<SeedCounts>;

/* ---- E2: core portado ---------------------------------------------------- */
import type { DateTime } from 'luxon';

export type Instant = Date | string | DateTime;

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  child(fields: Record<string, unknown>): Logger;
}
export const logger: Logger;
export function redact<T>(value: T): T;
export function toDT(value?: Instant): DateTime;
export function localDate(value: Instant, timezone: string): string;

export interface SchedulePlan {
  timezone: string;
  daysOfWeek?: number[];
  timesHm?: string[];
  intervalDays?: number;
  intervalAnchorDate?: string;
  quietStart?: string;
  quietEnd?: string;
}
export function computeNextAttemptAt(now: DateTime, plan: SchedulePlan): string;
export function planFromEpisode(
  episode: { checkin_frequency: string; started_at: Date | string },
  patient: { timezone: string; checkin_time?: string; quiet_start?: string; quiet_end?: string },
): SchedulePlan;
export function inQuietHours(localDt: DateTime, quietStart: string, quietEnd: string): boolean;

export interface Notifier {
  send(notification: Record<string, unknown>): Promise<{ ok: boolean; error?: string }>;
}

export function planCheckins(
  db: Knex,
  now: Instant,
): Promise<{ candidates: number; created: number }>;
export function expireCheckins(db: Knex, now: Instant): Promise<{ missed: number }>;
export function dispatchDueCheckins(
  db: Knex,
  now: Instant,
  opts: { notifier: Notifier },
): Promise<{
  due: number;
  sent: number;
  failed: number;
  deferred: number;
  skipped_no_respondent: number;
  exhausted: number;
}>;

export interface Question {
  id: string;
  question_set_id: string;
  key: string;
  label: string;
  kind: 'scale_0_10' | 'yes_no' | 'choice' | 'number' | 'text';
  options: string[];
  unit: string | null;
  sort_order: number;
  required: boolean;
  active: boolean;
  condition_json: { when: string; op: string; value: unknown } | null;
  alert_threshold_json: { op: string; value: unknown; severity?: string } | null;
  is_side_effect: boolean;
  score_direction: 'higher_is_better' | 'lower_is_better' | null;
  score_weight: number;
}
export class EngineError extends Error {
  constructor(code: string, message: string);
  code: string;
}
export function recordAnswer(
  db: Knex,
  input: { checkinId: string; respondentId: string; questionKey: string; value: unknown },
  now?: Instant,
): Promise<{ answer: Record<string, unknown>; next: Question | null; completed: boolean }>;
export function getNextQuestion(db: Knex, checkinId: string): Promise<Question | null>;
export function completeCheckin(
  db: Knex,
  checkinId: string,
  now?: Instant,
): Promise<{ already: boolean }>;
export function enqueueAndSend(
  db: Knex,
  notifier: Notifier,
  row: Record<string, unknown>,
): Promise<{
  status: 'sent' | 'failed' | 'duplicate';
  notification?: Record<string, unknown>;
  error?: string;
}>;

export function planMedicationIntakes(
  db: Knex,
  now: Instant,
): Promise<{ medications: number; created: number }>;
export function dispatchDueIntakes(
  db: Knex,
  now: Instant,
  opts: { notifier: Notifier },
): Promise<{ due: number; sent: number; failed: number; duplicate: number; no_respondent: number }>;
export function confirmIntake(
  db: Knex,
  input: {
    intakeId: string;
    respondentId: string;
    status: 'taken' | 'skipped';
    sideEffect?: boolean;
    note?: string | null;
  },
  now?: Instant,
): Promise<Record<string, unknown>>;

export interface CycleSummary {
  at: string;
  ms: number;
  checkins: { candidates: number; created: number };
  expired: { missed: number };
  dispatch: {
    due: number;
    sent: number;
    failed: number;
    deferred: number;
    skipped_no_respondent: number;
    exhausted: number;
  };
  intakes: { medications: number; created: number };
  alarms: { due: number; sent: number; failed: number; duplicate: number; no_respondent: number };
  alerts: { patients: number; results: unknown[] } | null;
}
export function runCycle(
  db: Knex,
  now: Instant,
  opts: { notifier: Notifier; force?: boolean },
): Promise<CycleSummary>;

export function evaluatePatientAlerts(
  db: Knex,
  patientId: string,
  now?: Instant,
): Promise<{
  patientId: string;
  triggered: string[];
  created: number;
  touched: number;
  autoResolved: number;
}>;
export function evaluateAllAlerts(
  db: Knex,
  now?: Instant,
): Promise<{ patients: number; results: unknown[] }>;
export function acknowledgeAlert(
  db: Knex,
  input: { alertId: string; userId: string },
  now?: Instant,
): Promise<Record<string, unknown>>;
export function resolveAlert(
  db: Knex,
  input: { alertId: string; userId: string; note: string },
  now?: Instant,
): Promise<Record<string, unknown>>;
export function addAlertNote(
  db: Knex,
  input: { alertId: string; userId: string; note: string },
  now?: Instant,
): Promise<Record<string, unknown>>;
export function silenceAlerts(
  db: Knex,
  input: {
    patientId: string;
    code?: string | null;
    untilAt: Instant;
    reason?: string | null;
    userId: string;
  },
): Promise<Record<string, unknown>>;
export function listOpenAlerts(
  db: Knex,
  input: { clinicId: string; patientId?: string | null },
): Promise<Array<Record<string, unknown>>>;
export function listAlertActions(
  db: Knex,
  alertId: string,
): Promise<Array<Record<string, unknown>>>;
export function detectScoreRules(
  rows: Array<{ date: string; score: number | null; trend?: number | null }>,
): Array<{ code: string; severity: string; title: string; context: Record<string, unknown> }>;
export function evaluateThreshold(
  threshold: { op: string; value: unknown } | null,
  value: unknown,
): boolean;

export function computeDailyScore(
  db: Knex,
  checkinId: string,
): Promise<{
  patient_id: string;
  date: string;
  score: number | null;
  trend: number | null;
  risk_level: string | null;
  n: number;
} | null>;
export function normalizeToTen(
  value: number,
  min: number,
  max: number,
  direction?: string,
): number | null;
export function computeTrend(today: number, previous: Array<number | null>): number | null;
export function aggregateScore(
  items: Array<{ value: number | null; weight?: number }>,
): number | null;
export function inferRiskLevel(
  score: number | null,
  trend: number | null,
): 'low' | 'medium' | 'high' | null;

export function compareBeforeAfterByDose(input: {
  doseEvents: Array<{
    id: string;
    effective_from: Date | string;
    dose_amount?: number;
    dose_unit?: string;
  }>;
  series: Array<{ date: string; value: number }>;
  windowDays?: number;
}): Array<{
  dose_event_id: string | null;
  dose_amount: number | null;
  dose_unit: string | null;
  anchor_date: string | null;
  before_avg: number | null;
  after_avg: number | null;
  delta: number | null;
  n_before: number;
  n_after: number;
}>;
export function mean(values: unknown[]): number | null;
export function rollingWindow(
  rows: Array<Record<string, unknown>>,
  opts?: { valueField?: string; dateField?: string; windowDays?: number },
): Array<{ date: string; n: number; value: number | null }>;

/* ---- E3: auth ---------------------------------------------------------- */
export class AuthError extends Error {
  constructor(code: string, message: string);
  code: 'unauthenticated' | 'not_found' | 'invalid_token' | 'consent_required' | string;
}
export function newToken(): string;
export function hashToken(token: string): string;
export interface Mailer {
  sendMail(msg: {
    to: string;
    subject: string;
    text: string;
  }): Promise<{ ok: boolean; messageId?: string }>;
}
export function createSmtpMailer(env?: Record<string, string | undefined>): Mailer;
export function fakeMailer(): Mailer & {
  sent: Array<{ to: string; subject: string; text: string }>;
};
export function normalizeEmail(email: string): string;
export function requestMagicLink(
  db: Knex,
  input: { email: string; baseUrl: string; mailer: Mailer },
  now?: Instant,
): Promise<{ ok: true }>;
export type Session =
  | {
      kind: 'user';
      sessionId: string;
      userId: string;
      clinicId: string;
      role: string;
      name: string;
      email: string;
    }
  | {
      kind: 'respondent';
      sessionId: string;
      respondentId: string;
      respondentKind: string;
      patientId: string;
      clinicId: string;
      name: string;
      canAnswer: boolean;
      receivesAlarms: boolean;
    };
export function verifyMagicLink(
  db: Knex,
  input: { token: string; ua?: string | null },
  now?: Instant,
): Promise<{ sessionToken: string; session: Session }>;
export function acceptInvite(
  db: Knex,
  input: { inviteToken: string; consentVersion?: string | null; ua?: string | null },
  now?: Instant,
): Promise<{ sessionToken: string; session: Session }>;
export function rotateInviteToken(db: Knex, respondentId: string): Promise<string>;
export function createSession(
  db: Knex,
  input: {
    userId?: string | null;
    respondentId?: string | null;
    clinicId: string;
    ua?: string | null;
  },
  now?: Instant,
): Promise<{ sessionToken: string; session: Session }>;
export function getSession(db: Knex, sessionToken: string, now?: Instant): Promise<Session | null>;
export function revokeSession(db: Knex, sessionToken: string, now?: Instant): Promise<number>;
export function revokeAllForPrincipal(
  db: Knex,
  input: { userId?: string | null; respondentId?: string | null },
  now?: Instant,
): Promise<number>;
export function requirePatientInClinic(
  db: Knex,
  session: Session | null,
  patientId: string,
): Promise<
  Record<string, unknown> & { id: string; name: string; status: string; timezone: string }
>;
export function logAccess(
  db: Knex,
  input: { session: Session; patientId?: string | null; route: string; action?: string },
  now?: Instant,
): Promise<Record<string, unknown>>;

/* ---- E4: serviços da médica ------------------------------------------- */
export class ValidationError extends Error {
  code: 'validation';
  field: string | null;
}
export interface PatientRow {
  id: string;
  clinic_id: string;
  name: string;
  birth_date: string | Date | null;
  condition_tags: string[];
  timezone: string;
  status: 'active' | 'paused' | 'discharged';
  checkin_time: string;
  quiet_start: string;
  quiet_end: string;
  consent_version: string | null;
  consent_at: Date | string | null;
  created_by: string;
  created_at: Date | string;
  updated_at: Date | string;
}
export interface RespondentRow {
  id: string;
  patient_id: string;
  kind: 'patient' | 'caregiver';
  name: string;
  email: string | null;
  phone: string | null;
  relationship: string | null;
  can_answer: boolean;
  receives_alarms: boolean;
  invite_token: string;
  accepted_at: Date | string | null;
  consent_version: string | null;
  consent_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}
export interface ProductRow {
  id: string;
  clinic_id: string;
  name: string;
  cbd_mg_ml: number | null;
  thc_mg_ml: number | null;
  form: string;
}
export interface MedicationRow {
  id: string;
  patient_id: string;
  product_id: string;
  active: boolean;
  product_name: string;
  form: string;
  cbd_mg_ml: number | null;
  thc_mg_ml: number | null;
  current_dose: DoseEvent | null;
}
export interface EpisodeRow {
  id: string;
  patient_id: string;
  kind: 'titration' | 'maintenance';
  started_at: Date | string;
  ended_at: Date | string | null;
  checkin_frequency: 'daily' | 'weekly' | 'biweekly';
  question_set_id: string;
  dose_event_id: string | null;
}
export interface AlertRow {
  id: string;
  patient_id: string;
  code: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  context: Record<string, unknown>;
  status: 'open' | 'acknowledged' | 'resolved';
  resolved_reason: string | null;
  first_seen_at: Date | string;
  last_seen_at: Date | string;
  resolved_at: Date | string | null;
  created_at: Date | string;
}
export interface QuestionSetRow {
  id: string;
  clinic_id: string;
  name: string;
  active: boolean;
  created_at: Date | string;
}
export interface RespondentInput {
  kind?: 'patient' | 'caregiver';
  name: string;
  email?: string | null;
  phone?: string | null;
  relationship?: string | null;
  can_answer?: boolean;
  receives_alarms?: boolean;
}
export interface PatientInput {
  name?: string;
  birth_date?: string | null;
  condition_tags?: string[] | string;
  timezone?: string;
  checkin_time?: string;
  quiet_start?: string;
  quiet_end?: string;
  status?: 'active' | 'paused' | 'discharged';
  consent_version?: string | null;
  respondents?: RespondentInput[];
}
export function createPatient(
  db: Knex,
  session: Session,
  input: PatientInput | Record<string, unknown>,
  now?: Instant,
): Promise<{ patient: PatientRow; respondents: RespondentRow[] }>;
export function updatePatient(
  db: Knex,
  session: Session,
  patientId: string,
  input: Record<string, unknown>,
  now?: Instant,
): Promise<PatientRow>;
export interface PatientSummary extends PatientRow {
  episode: Pick<EpisodeRow, 'id' | 'kind' | 'checkin_frequency' | 'started_at'> | null;
  open_alerts: number;
  last_checkin_at: Date | string | null;
  respondents_count: number;
  medications: MedicationRow[];
}
export function listPatients(
  db: Knex,
  input: { clinicId: string },
  now?: Instant,
): Promise<PatientSummary[]>;
export interface Grid {
  days: string[];
  questions: Array<{
    key: string;
    label: string;
    kind: string;
    unit: string | null;
    is_side_effect: boolean;
  }>;
  cells: Record<string, Record<string, number | string | null>>;
  scores: Record<string, number | null>;
  risk: Record<string, string | null>;
  doseMarkers: Array<{
    date: string;
    dose_amount: number;
    dose_unit: string;
    reason: string | null;
  }>;
  timezone: string;
}
export function patientGrid(
  db: Knex,
  patientId: string,
  opts?: { days?: number; now?: Instant },
): Promise<Grid>;
export interface PatientDetail {
  patient: PatientRow;
  respondents: Array<RespondentRow & { invite_url: string }>;
  medications: Array<MedicationRow & { dose_history: DoseEvent[] }>;
  episode: (EpisodeRow & { question_set_name: string | null }) | null;
  alerts: AlertRow[];
  grid: Grid;
}
export function getPatientDetail(
  db: Knex,
  session: Session,
  patientId: string,
  opts?: { baseUrl?: string; now?: Instant },
): Promise<PatientDetail>;
export function addRespondent(
  db: Knex,
  session: Session,
  patientId: string,
  input: Record<string, unknown>,
  now?: Instant,
): Promise<RespondentRow>;
export function updateRespondent(
  db: Knex,
  session: Session,
  respondentId: string,
  input: Record<string, unknown>,
  now?: Instant,
): Promise<RespondentRow>;
export function listProducts(db: Knex, clinicId: string): Promise<ProductRow[]>;
export function createProduct(
  db: Knex,
  session: Session,
  input: Record<string, unknown>,
): Promise<ProductRow>;
export function addMedication(
  db: Knex,
  session: Session,
  patientId: string,
  input: { product_id: string },
  now?: Instant,
): Promise<{ id: string; patient_id: string; product_id: string; active: boolean }>;
export function adjustDose(
  db: Knex,
  session: Session,
  medicationId: string,
  input: Record<string, unknown>,
  now?: Instant,
): Promise<DoseEvent>;
export function setEpisode(
  db: Knex,
  session: Session,
  patientId: string,
  input: { kind: string; checkin_frequency: string; question_set_id: string },
  now?: Instant,
): Promise<EpisodeRow>;
export function listQuestionSets(
  db: Knex,
  clinicId: string,
): Promise<Array<QuestionSetRow & { questions: Question[] }>>;
export function createQuestionSet(
  db: Knex,
  session: Session,
  input: { name: string },
): Promise<QuestionSetRow>;
export function saveQuestions(
  db: Knex,
  session: Session,
  setId: string,
  list: unknown[],
): Promise<Question[]>;
export function slugify(text: string): string;
export function validateQuestion(
  input: Record<string, unknown>,
): { ok: true; data: Record<string, unknown> } | { ok: false; error: string };

/* ---- E5: push + respondente ------------------------------------------ */
export function createWebPushNotifier(
  cfg: { vapidPublicKey?: string; vapidPrivateKey?: string; subject?: string },
  db: Knex,
): Notifier & { kind: 'webpush' };
export function savePushSubscription(
  db: Knex,
  session: Session,
  input: { endpoint: string; keys: { p256dh: string; auth: string }; ua?: string | null },
): Promise<{ id: string; respondent_id: string; endpoint: string }>;
export function removePushSubscription(
  db: Knex,
  session: Session,
  input: { endpoint: string },
): Promise<number>;
export interface TodayQuestion {
  id: string;
  key: string;
  label: string;
  kind: Question['kind'];
  options: string[];
  unit: string | null;
  required: boolean;
}
export interface TodayCheckin {
  id: string;
  status: string;
  scheduled_for: string | Date;
  total: number;
  answered: number;
  next: TodayQuestion | null;
  completed: boolean;
}
export interface TodayAlarm {
  intake_id: string;
  scheduled_at: string | Date;
  status: 'pending' | 'taken' | 'skipped' | 'late';
  taken_at: string | Date | null;
  side_effect_flag: boolean;
  note: string | null;
  product_name: string;
  dose_amount: number | null;
  dose_unit: string | null;
}
export interface RespondentTodayView {
  respondent: {
    id: string;
    name: string;
    kind: string;
    can_answer: boolean;
    receives_alarms: boolean;
  };
  patient: { id: string; name: string; status: string; timezone: string; clinic_name: string };
  checkin: TodayCheckin | null;
  alarms: TodayAlarm[];
  push: { subscriptions: number };
  now: string;
}
export function respondentToday(
  db: Knex,
  session: Session,
  now?: Instant,
): Promise<RespondentTodayView>;
export function answerFromRespondent(
  db: Knex,
  session: Session,
  input: { checkinId: string; questionKey: string; value: unknown },
  now?: Instant,
): Promise<{
  answer: Record<string, unknown>;
  next: Question | null;
  completed: boolean;
  progress: TodayCheckin;
}>;
export function confirmFromRespondent(
  db: Knex,
  session: Session,
  input: {
    intakeId: string;
    status: 'taken' | 'skipped';
    sideEffect?: boolean;
    note?: string | null;
  },
  now?: Instant,
): Promise<Record<string, unknown> & { status: string }>;
export interface HistoryDay {
  date: string;
  answers: Record<string, number | string> | null;
  intakes: Array<{
    scheduled_at: string | Date;
    status: string;
    side_effect_flag: boolean;
    product_name: string;
    dose_amount: number | null;
    dose_unit: string | null;
  }>;
}
export function respondentHistory(
  db: Knex,
  session: Session,
  opts?: { days?: number; now?: Instant },
): Promise<{ days: HistoryDay[]; timezone: string }>;

/* ---- E6: hoje, séries, system_state ------------------------------------ */
export const STATE_KEYS: { lastCycle: string; lastAlerts: string };
export function resetCycleState(): void;
export function getSystemState(db: Knex): Promise<Record<string, unknown>>;
export function setSystemState(db: Knex, key: string, value: unknown): Promise<void>;
export interface TodayCheckinRow {
  checkin_id: string;
  status: string;
  attempt_count: number;
  sent_at: Date | string | null;
  next_attempt_at: Date | string | null;
  scheduled_for: Date | string;
  patient_id: string;
  patient_name: string;
}
export interface TodayIntakeRow {
  intake_id: string;
  status: string;
  scheduled_at: Date | string;
  side_effect_flag: boolean;
  patient_id: string;
  patient_name: string;
  product_name: string;
  dose_amount: number | null;
  dose_unit: string | null;
}
export interface DashboardToday {
  date: string;
  timezone: string;
  awaiting: TodayCheckinRow[];
  missed_today: TodayCheckinRow[];
  completed_today: number;
  not_sent_yet: number;
  open_alerts: Array<AlertRow & { patient_name: string }>;
  upcoming: Array<{
    kind: 'checkin' | 'alarm';
    patient_id: string;
    patient_name: string;
    at: Date | string;
    detail: string;
  }>;
  intakes: {
    pending_confirmation: TodayIntakeRow[];
    taken: number;
    late: number;
    skipped: number;
    side_effects: TodayIntakeRow[];
    total: number;
  };
  scheduler: { last_cycle_at: Date | null; stale: boolean; last_alerts_at: Date | null };
}
export function dashboardToday(
  db: Knex,
  input: { clinicId: string },
  now?: Instant,
): Promise<DashboardToday>;
export interface SeriesPoint {
  date: string;
  value: number | string | null;
  score: number | null;
}
export interface DoseMarker {
  id: string;
  date: string;
  dose_amount: number;
  dose_unit: string;
  times_per_day: number;
  reason: string | null;
  product_name: string;
}
export interface SymptomDoseSeries {
  question: { key: string; label: string; kind: string; unit: string | null };
  timezone: string;
  points: SeriesPoint[];
  doseMarkers: DoseMarker[];
  allDoseMarkers: DoseMarker[];
  beforeAfter: ReturnType<typeof compareBeforeAfterByDose>;
}
export function symptomDoseSeries(
  db: Knex,
  patientId: string,
  opts: { questionKey: string; days?: number; now?: Instant; windowDays?: number },
): Promise<SymptomDoseSeries>;
