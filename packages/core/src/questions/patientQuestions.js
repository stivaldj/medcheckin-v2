import { AuthError } from '../auth/tokens.js';
import { ValidationError } from '../errors.js';
import { requirePatientInClinic, logAccess } from '../auth/access.js';
import { validateQuestion, slugify } from './index.js';
import { ADHERENCE_QUESTION_KEY } from '../routine/index.js';

const MAX_PER_PATIENT = 20;

function requireDoctor(session) {
  if (!session || session.kind !== 'user')
    throw new AuthError('unauthenticated', 'Sessão da clínica necessária.');
}

async function episodeQuestionSetId(db, patientId) {
  const ep = await db('episodes')
    .where({ patient_id: patientId })
    .orderByRaw('ended_at is null desc')
    .orderBy('started_at', 'desc')
    .first();
  return ep?.question_set_id ?? null;
}

/**
 * Perguntas que valem para um check-in do paciente: o pack do episódio (na ordem) e, DEPOIS,
 * as extras do paciente. `at` = `checkins.scheduled_for`: uma extra só entra em check-ins
 * agendados a partir do momento em que foi criada (E9.2: "a partir do próximo check-in").
 * Sem `at`, todas as extras ativas entram (grade, relatório, gráfico).
 */
export async function questionsForPatient(
  db,
  { patientId, questionSetId, at = null, includeInactive = false },
) {
  const q = db('questions').where((w) => {
    if (questionSetId) w.where('question_set_id', questionSetId);
    w.orWhere((x) => {
      x.where('patient_id', patientId);
      if (at) x.andWhere('created_at', '<=', at);
    });
  });
  if (!includeInactive) q.andWhere('active', true);
  // pack primeiro (patient_id null), extras depois; dentro de cada grupo, a ordem da médica
  return q.orderByRaw('(patient_id is not null), sort_order, key');
}

/** As extras do paciente (inclusive desativadas — a médica precisa poder reativar). */
export async function listPatientQuestions(db, session, patientId) {
  requireDoctor(session);
  await requirePatientInClinic(db, session, patientId);
  return db('questions').where({ patient_id: patientId }).orderBy('sort_order').orderBy('key');
}

/** Pergunta livre da médica na consulta. Default sim/não; tipo à escolha. */
export async function addPatientQuestion(db, session, patientId, input, now) {
  requireDoctor(session);
  await requirePatientInClinic(db, session, patientId);
  const v = validateQuestion({ kind: 'yes_no', ...input });
  if (!v.ok) throw new ValidationError(v.error);
  if (v.data.condition_json)
    throw new ValidationError('Perguntas extras não aceitam condição.', 'condition_json');

  const existing = await db('questions').where({ patient_id: patientId });
  if (existing.length >= MAX_PER_PATIENT)
    throw new ValidationError(`No máximo ${MAX_PER_PATIENT} perguntas extras por paciente.`);
  if (existing.some((q) => q.key === v.data.key))
    throw new ValidationError(`Já existe uma pergunta com a chave "${v.data.key}".`, 'label');
  const setId = await episodeQuestionSetId(db, patientId);
  if (setId) {
    const clash = await db('questions').where({ question_set_id: setId, key: v.data.key }).first();
    if (clash)
      throw new ValidationError(
        `Já existe uma pergunta com a chave "${v.data.key}" no conjunto do episódio.`,
        'label',
      );
  }
  const sortOrder = existing.reduce((m, q) => Math.max(m, q.sort_order), 0) + 1;
  const [row] = await db('questions')
    .insert({
      ...v.data,
      patient_id: patientId,
      question_set_id: null,
      sort_order: sortOrder,
      options: JSON.stringify(v.data.options),
      condition_json: null,
      alert_threshold_json: v.data.alert_threshold_json
        ? JSON.stringify(v.data.alert_threshold_json)
        : null,
      active: true,
      created_at: now ?? db.fn.now(),
      updated_at: now ?? db.fn.now(),
    })
    .returning('*');
  await logAccess(
    db,
    { session, patientId, route: 'patient_questions.create', action: 'create' },
    now,
  );
  return row;
}

/**
 * Edita rótulo/tipo/opções/obrigatoriedade ou (des)ativa. A CHAVE é estável: `answers` já
 * apontam para ela e renomear apagaria a série.
 */
export async function updatePatientQuestion(db, session, questionId, input, now) {
  requireDoctor(session);
  const q = await db('questions').where({ id: questionId }).whereNotNull('patient_id').first();
  if (!q) throw new AuthError('not_found', 'Pergunta não encontrada.');
  await requirePatientInClinic(db, session, q.patient_id);

  const has = (k) => Object.hasOwn(input ?? {}, k);
  const patch = {};
  if (has('active')) patch.active = !!input.active;
  if (has('label') || has('kind') || has('options') || has('required') || has('unit')) {
    const v = validateQuestion({
      key: q.key, // trava a chave
      label: has('label') ? input.label : q.label,
      kind: has('kind') ? input.kind : q.kind,
      options: has('options') ? input.options : q.options,
      required: has('required') ? input.required : q.required,
      unit: has('unit') ? input.unit : q.unit,
      alert_threshold_json: q.alert_threshold_json,
      is_side_effect: q.is_side_effect,
      score_direction: q.score_direction,
      score_weight: q.score_weight,
    });
    if (!v.ok) throw new ValidationError(v.error);
    if (v.data.key !== q.key)
      throw new ValidationError('A chave de uma pergunta já usada não pode mudar.', 'label');
    patch.label = v.data.label;
    patch.kind = v.data.kind;
    patch.options = JSON.stringify(v.data.options);
    patch.required = v.data.required;
    patch.unit = v.data.unit;
  }
  if (!Object.keys(patch).length) throw new ValidationError('Nada para atualizar.');
  const [row] = await db('questions')
    .where({ id: questionId })
    .update({ ...patch, updated_at: db.fn.now() })
    .returning('*');
  await logAccess(
    db,
    { session, patientId: q.patient_id, route: 'patient_questions.update', action: 'update' },
    now,
  );
  return row;
}

/**
 * Fecha o buraco registrado em ACHADOS: conjuntos criados antes de E9.1 não têm a pergunta de
 * adesão. Aqui ela entra como extra DO PACIENTE, com o mesmo limiar (não tomou → alerta medium).
 */
export async function addAdherenceQuestion(db, session, patientId, now) {
  return addPatientQuestion(
    db,
    session,
    patientId,
    {
      key: ADHERENCE_QUESTION_KEY,
      label: 'Tomou as medicações corretamente hoje?',
      kind: 'yes_no',
      alert_threshold_json: { op: '==', value: 0, severity: 'medium' },
    },
    now,
  );
}

/** true quando o pack do episódio já pergunta adesão (aí não faz sentido oferecer a extra). */
export async function packHasAdherence(db, patientId) {
  const setId = await episodeQuestionSetId(db, patientId);
  if (!setId) return false;
  const row = await db('questions')
    .where({ question_set_id: setId, key: ADHERENCE_QUESTION_KEY, active: true })
    .first();
  return !!row;
}

export { slugify };
