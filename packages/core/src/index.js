export { loadConfig } from './config.js';
export { createDb } from './db.js';
export { migrationConfig, migrateLatest, migrateRollbackAll } from './migrate.js';
export { logger, redact } from './logger.js';
export { toDT, localDate } from './time.js';
export { currentDose } from './doses/currentDose.js';
export { runSeed } from './seed/index.js';
export { computeNextAttemptAt, planFromEpisode, inQuietHours } from './scheduler/next-run.js';
export { planCheckins, expireCheckins } from './scheduler/planner.js';

export { dispatchDueRoutineAlarms } from './scheduler/routineAlarms.js';
export {
  createRoutinePeriod,
  updateRoutinePeriod,
  endRoutinePeriodToday,
  deleteRoutinePeriod,
  listRoutine,
  routineAlarmsForDay,
  ADHERENCE_QUESTION_KEY,
} from './routine/index.js';
export { runCycle } from './scheduler/cycle.js';
export {
  dispatchDueCheckins,
  recordAnswer,
  getNextQuestion,
  completeCheckin,
  enqueueAndSend,
  EngineError,
} from './checkin/engine.js';
export { evaluatePatientAlerts, evaluateAllAlerts } from './alerts/evaluate.js';
export {
  acknowledgeAlert,
  resolveAlert,
  addAlertNote,
  silenceAlerts,
  listOpenAlerts,
  listAlertActions,
} from './alerts/actions.js';
export { detectScoreRules, evaluateThreshold } from './alerts/rules.js';
export {
  computeDailyScore,
  normalizeToTen,
  computeTrend,
  aggregateScore,
  inferRiskLevel,
} from './scoring/computeDailyScore.js';
export { compareBeforeAfterByDose } from './analytics/beforeAfter.js';
export { mean, rollingWindow } from './analytics/rolling.js';
export { newToken, hashToken, AuthError } from './auth/tokens.js';
export { requestMagicLink, verifyMagicLink, normalizeEmail } from './auth/magic-link.js';
export { acceptInvite, rotateInviteToken } from './auth/invite.js';
export { createSession, getSession, revokeSession, revokeAllForPrincipal } from './auth/session.js';
export { requirePatientInClinic, logAccess } from './auth/access.js';
export { createSmtpMailer, fakeMailer } from './auth/mailer.js';
export { ValidationError } from './errors.js';
export {
  createPatient,
  updatePatient,
  listPatients,
  getPatientDetail,
  addRespondent,
  updateRespondent,
  patientGrid,
} from './patients/index.js';
export {
  listProducts,
  createProduct,
  findOrCreateProduct,
  addMedication,
  adjustDose,
  setEpisode,
} from './medications/index.js';
export { catalogNameKey, productNameKey } from './catalog/nameKey.js';
export {
  findOrCreateCondition,
  listConditions,
  updateCondition,
  mergeConditions,
  addPatientCondition,
  removePatientCondition,
  listPatientConditions,
} from './conditions/index.js';
export { createNote, updateNote, deleteNote, listNotes, noteDay } from './notes/index.js';
export { patientTimeline } from './patients/timeline.js';
export {
  listPatientQuestions,
  addPatientQuestion,
  updatePatientQuestion,
  addAdherenceQuestion,
  packHasAdherence,
  questionsForPatient,
} from './questions/patientQuestions.js';
export {
  listQuestionSets,
  createQuestionSet,
  saveQuestions,
  slugify,
  validateQuestion,
} from './questions/index.js';
export {
  createWebPushNotifier,
  savePushSubscription,
  removePushSubscription,
} from './push/index.js';
export { respondentToday, respondentHistory, answerFromRespondent } from './respondent/index.js';
export {
  requestPushTest,
  dispatchPushTests,
  pushTestStatus,
  confirmPushTest,
  markInstalled,
  setupStatus,
  PUSH_TEST_MAX_AGE_MIN,
} from './onboarding/index.js';
export { getSystemState, setSystemState, STATE_KEYS, resetCycleState } from './scheduler/cycle.js';
export { dashboardToday } from './dashboard/today.js';
export { symptomDoseSeries } from './analytics/series.js';
export { patientReport } from './report/patientReport.js';
export { exportPatientData, buildExportZip } from './lgpd/export.js';
export { anonymizePatient } from './lgpd/anonymize.js';
export { applyRetention, RETENTION_DEFAULTS } from './lgpd/retention.js';
export { startHealthServer } from './scheduler/health.js';
export {
  shadowReport,
  renderShadowReportMarkdown,
  SHADOW_CRITERIA,
} from './report/shadowReport.js';
export {
  pilotReport,
  renderPilotReportMarkdown,
  PILOT_CRITERIA,
  PILOT_ABORT_RULES,
} from './report/pilotReport.js';
export {
  ATTACHMENT_MAX_BYTES,
  sniffKind,
  storeAttachment,
  listAttachments,
  openAttachment,
  hideAttachment,
  attachmentAbsolutePath,
} from './attachments/index.js';
