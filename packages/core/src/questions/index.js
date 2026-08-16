import { AuthError } from '../auth/tokens.js';
import { ValidationError } from '../patients/index.js';

const KINDS = new Set(['scale_0_10', 'yes_no', 'choice', 'number', 'text']);
const OPS = new Set(['>=', '>', '<=', '<', '==', '!=', 'in']);
const DIRECTIONS = new Set(['higher_is_better', 'lower_is_better']);
const SCORABLE = new Set(['scale_0_10', 'yes_no']);

function requireDoctor(session) {
  if (!session || session.kind !== 'user')
    throw new AuthError('unauthenticated', 'Sessão da clínica necessária.');
}

/** Slug estável a partir do label (v1: chave 2–40, [a-z][a-z0-9_]). */
export function slugify(text) {
  let s = String(text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
    .replace(/_+$/g, '');
  if (!s) return '';
  if (!/^[a-z]/.test(s)) s = `q_${s}`.slice(0, 40);
  return s;
}

function normalizeOptions(raw) {
  const arr = Array.isArray(raw) ? raw : String(raw ?? '').split('\n');
  return [...new Set(arr.map((o) => String(o).trim()).filter(Boolean))].slice(0, 12);
}

function validateThreshold(t) {
  if (t == null || t === '') return null;
  if (typeof t !== 'object' || !OPS.has(t.op)) return false;
  if (t.op === 'in')
    return Array.isArray(t.value) && t.value.length > 0
      ? { op: 'in', value: t.value.map(String) }
      : false;
  if (t.value === undefined || t.value === null || t.value === '') return false;
  const out = {
    op: t.op,
    value: Number.isFinite(Number(t.value)) ? Number(t.value) : String(t.value),
  };
  if (t.severity) out.severity = String(t.severity);
  return out;
}

/** Validação de uma pergunta (regras portadas do v1 + campos do v2). */
export function validateQuestion(input) {
  const label = String(input?.label ?? '').trim();
  if (label.length < 6 || label.length > 280)
    return { ok: false, error: 'A pergunta deve ter entre 6 e 280 caracteres.' };
  const key = input?.key ? slugify(input.key) : slugify(label);
  if (!/^[a-z][a-z0-9_]{1,39}$/.test(key))
    return {
      ok: false,
      error: 'A chave deve ter 2–40 caracteres, começar com letra e usar a-z, 0-9 e _.',
    };
  const kind = String(input?.kind ?? '');
  if (!KINDS.has(kind)) return { ok: false, error: 'Tipo de pergunta inválido.' };
  let options = [];
  if (kind === 'choice') {
    options = normalizeOptions(input?.options);
    if (options.length < 2) return { ok: false, error: 'Escolha exige ao menos 2 opções.' };
  }
  const threshold = validateThreshold(input?.alert_threshold_json);
  if (threshold === false) return { ok: false, error: 'Limiar de alerta inválido (op/value).' };
  let condition = null;
  if (
    input?.condition_json &&
    typeof input.condition_json === 'object' &&
    input.condition_json.when
  ) {
    const c = input.condition_json;
    if (!OPS.has(c.op)) return { ok: false, error: 'Condição inválida (op).' };
    condition = {
      when: slugify(c.when),
      op: c.op,
      value: Number.isFinite(Number(c.value)) && c.op !== 'in' ? Number(c.value) : c.value,
    };
  }
  let direction = input?.score_direction ? String(input.score_direction) : null;
  if (direction && !DIRECTIONS.has(direction))
    return { ok: false, error: 'Direção do score inválida.' };
  if (direction && !SCORABLE.has(kind))
    return { ok: false, error: 'Só perguntas de escala 0–10 ou sim/não entram no score.' };
  const weight =
    input?.score_weight === undefined || input?.score_weight === null || input?.score_weight === ''
      ? 1
      : Number(input.score_weight);
  if (!(weight > 0)) return { ok: false, error: 'Peso do score deve ser > 0.' };
  return {
    ok: true,
    data: {
      key,
      label,
      kind,
      options,
      unit: input?.unit ? String(input.unit).trim().slice(0, 30) : null,
      required: input?.required === undefined ? true : !!input.required,
      condition_json: condition,
      alert_threshold_json: threshold,
      is_side_effect: !!input?.is_side_effect,
      score_direction: direction,
      score_weight: weight,
    },
  };
}

export async function listQuestionSets(db, clinicId) {
  const sets = await db('question_sets').where({ clinic_id: clinicId }).orderBy('created_at');
  const ids = sets.map((s) => s.id);
  const qs = ids.length
    ? await db('questions')
        .whereIn('question_set_id', ids)
        .andWhere('active', true)
        .orderBy('sort_order')
    : [];
  return sets.map((s) => ({ ...s, questions: qs.filter((q) => q.question_set_id === s.id) }));
}

export async function createQuestionSet(db, session, { name }) {
  requireDoctor(session);
  const n = String(name ?? '').trim();
  if (n.length < 2) throw new ValidationError('Nome do conjunto é obrigatório.', 'name');
  const [row] = await db('question_sets')
    .insert({ clinic_id: session.clinicId, name: n })
    .returning('*');
  return row;
}

/**
 * Salva a lista completa (ordem = posição). Upsert por key; ausentes viram inativas (nunca apaga —
 * `answers` referenciam). Condições só podem apontar para pergunta ANTERIOR na lista.
 */
export async function saveQuestions(db, session, setId, list) {
  requireDoctor(session);
  const set = await db('question_sets').where({ id: setId, clinic_id: session.clinicId }).first();
  if (!set) throw new AuthError('not_found', 'Conjunto não encontrado.');
  const validated = [];
  const seen = new Set();
  for (const [i, raw] of (list ?? []).entries()) {
    const v = validateQuestion(raw);
    if (!v.ok) throw new ValidationError(`Pergunta ${i + 1}: ${v.error}`);
    if (seen.has(v.data.key)) throw new ValidationError(`Chave repetida: ${v.data.key}.`);
    if (v.data.condition_json && !seen.has(v.data.condition_json.when)) {
      throw new ValidationError(
        `Pergunta ${i + 1}: a condição precisa apontar para uma pergunta anterior na lista (${v.data.condition_json.when}).`,
      );
    }
    seen.add(v.data.key);
    validated.push({ ...v.data, sort_order: i + 1 });
  }
  return db.transaction(async (trx) => {
    for (const q of validated) {
      await trx('questions')
        .insert({
          question_set_id: setId,
          ...q,
          options: JSON.stringify(q.options),
          condition_json: q.condition_json ? JSON.stringify(q.condition_json) : null,
          alert_threshold_json: q.alert_threshold_json
            ? JSON.stringify(q.alert_threshold_json)
            : null,
          active: true,
        })
        .onConflict(['question_set_id', 'key'])
        .merge();
    }
    const keys = validated.map((q) => q.key);
    const q = trx('questions').where({ question_set_id: setId });
    if (keys.length) q.whereNotIn('key', keys);
    await q.update({ active: false, updated_at: trx.fn.now() });
    return trx('questions').where({ question_set_id: setId, active: true }).orderBy('sort_order');
  });
}
