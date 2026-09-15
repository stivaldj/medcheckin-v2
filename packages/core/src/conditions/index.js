import { AuthError } from '../auth/tokens.js';
import { requirePatientInClinic, logAccess } from '../auth/access.js';
import { ValidationError } from '../errors.js';
import { catalogNameKey } from '../catalog/nameKey.js';

const NAME_MIN = 2;
const NAME_MAX = 120;
const CID10 = /^[A-Z][0-9]{2}(\.[0-9A-Z]{1,2})?$/;

function requireDoctor(session) {
  if (!session || session.kind !== 'user')
    throw new AuthError('unauthenticated', 'Sessão da clínica necessária.');
}

function cleanName(raw) {
  const name = String(raw ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (name.length < NAME_MIN) throw new ValidationError('Nome da condição é obrigatório.', 'name');
  if (name.length > NAME_MAX)
    throw new ValidationError(`Nome da condição muito longo (máx. ${NAME_MAX}).`, 'name');
  return name;
}

/** CID-10 é opcional; quando vem, só o formato é validado (ex.: F41.1, G40). */
function cleanCid10(raw) {
  if (raw === undefined || raw === null) return null;
  const cid = String(raw).trim().toUpperCase();
  if (!cid) return null;
  if (!CID10.test(cid)) throw new ValidationError('CID-10 inválido (ex.: F41.1).', 'cid10');
  return cid;
}

function cleanDay(raw, field) {
  if (raw === undefined || raw === null || raw === '') return null;
  const d = String(raw).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d))
    throw new ValidationError('Data inválida (AAAA-MM-DD).', field);
  return d;
}

async function conditionInClinic(db, session, conditionId) {
  const c = await db('conditions').where({ id: conditionId, clinic_id: session.clinicId }).first();
  if (!c) throw new AuthError('not_found', 'Condição não encontrada.');
  return c;
}

/**
 * D36 — acha ou cria a condição pela chave normalizada (mesmo padrão de findOrCreateProduct, D34).
 * Autocommit de propósito: um 23505 dentro de transação a abortaria. Quem perde a corrida relê.
 * `cid10` só é gravado na criação; para trocar, `updateCondition`.
 */
export async function findOrCreateCondition(db, session, input) {
  requireDoctor(session);
  const name = cleanName(input?.name);
  const cid10 = cleanCid10(input?.cid10);
  const where = { clinic_id: session.clinicId, name_key: catalogNameKey(name) };
  const existing = await db('conditions').where(where).first();
  if (existing) return { condition: existing, created: false };
  try {
    const [row] = await db('conditions')
      .insert({ ...where, name, cid10 })
      .returning('*');
    return { condition: row, created: true };
  } catch (err) {
    if (err?.code !== '23505') throw err;
    const again = await db('conditions').where(where).first();
    if (!again) throw err;
    return { condition: again, created: false };
  }
}

/** Catálogo da clínica com o nº de pacientes vinculados. */
export async function listConditions(db, clinicId) {
  const rows = await db('conditions as c')
    .leftJoin('patient_conditions as pc', 'pc.condition_id', 'c.id')
    .where('c.clinic_id', clinicId)
    .groupBy('c.id')
    .orderBy('c.name')
    .select('c.*')
    .count('pc.patient_id as patients');
  return rows.map((r) => ({ ...r, patients: Number(r.patients) }));
}

export async function updateCondition(db, session, conditionId, input, now) {
  requireDoctor(session);
  await conditionInClinic(db, session, conditionId);
  const patch = {};
  if (Object.hasOwn(input ?? {}, 'name')) {
    patch.name = cleanName(input.name);
    patch.name_key = catalogNameKey(patch.name);
  }
  if (Object.hasOwn(input ?? {}, 'cid10')) patch.cid10 = cleanCid10(input.cid10);
  if (!Object.keys(patch).length) throw new ValidationError('Nada para atualizar.');
  try {
    const [row] = await db('conditions')
      .where({ id: conditionId })
      .update({ ...patch, updated_at: db.fn.now() })
      .returning('*');
    await logAccess(db, { session, route: 'conditions.update', action: 'update' }, now);
    return row;
  } catch (err) {
    if (err?.code === '23505')
      throw new ValidationError('Já existe uma condição com esse nome. Use Fundir.', 'name');
    throw err;
  }
}

/**
 * Fundir `from` em `into`: vínculos migram (quem já tinha o destino não duplica), a origem some.
 * É o único jeito de corrigir duplicata que escapou da chave (ex.: "TEA" e "Autismo").
 */
export async function mergeConditions(db, session, { from_id, into_id }, now) {
  requireDoctor(session);
  if (!from_id || !into_id || from_id === into_id)
    throw new ValidationError('Escolha duas condições diferentes para fundir.', 'into_id');
  const from = await conditionInClinic(db, session, from_id);
  const into = await conditionInClinic(db, session, into_id);
  return db.transaction(async (trx) => {
    const jaTem = trx('patient_conditions').select('patient_id').where({ condition_id: into.id });
    const moved = await trx('patient_conditions')
      .where({ condition_id: from.id })
      .whereNotIn('patient_id', jaTem)
      .update({ condition_id: into.id });
    await trx('patient_conditions').where({ condition_id: from.id }).del();
    await trx('conditions').where({ id: from.id }).del();
    await logAccess(trx, { session, route: 'conditions.merge', action: 'update' }, now);
    return { into, moved };
  });
}

/** Vincula por `condition_id` (existente na clínica) ou por `name` (acha ou cria). Idempotente. */
export async function addPatientCondition(db, session, patientId, input, now) {
  requireDoctor(session);
  await requirePatientInClinic(db, session, patientId);
  let condition;
  if (input?.condition_id) condition = await conditionInClinic(db, session, input.condition_id);
  else ({ condition } = await findOrCreateCondition(db, session, { name: input?.name }));
  const noted_at = cleanDay(input?.noted_at, 'noted_at');
  await db('patient_conditions')
    .insert({ patient_id: patientId, condition_id: condition.id, noted_at })
    .onConflict(['patient_id', 'condition_id'])
    .ignore();
  await logAccess(db, { session, patientId, route: 'conditions.add', action: 'update' }, now);
  return condition;
}

export async function removePatientCondition(db, session, patientId, conditionId, now) {
  requireDoctor(session);
  await requirePatientInClinic(db, session, patientId);
  await db('patient_conditions').where({ patient_id: patientId, condition_id: conditionId }).del();
  await logAccess(db, { session, patientId, route: 'conditions.remove', action: 'update' }, now);
}

/** pg devolve `date` como Date (meia-noite UTC); normaliza para AAAA-MM-DD como o resto do core. */
function isoDay(v) {
  if (v === null || v === undefined) return null;
  return v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
}

/** Condições de um paciente, em ordem alfabética. Sem audit: é chamada por quem já auditou. */
export async function listPatientConditions(db, patientId) {
  const rows = await db('patient_conditions as pc')
    .join('conditions as c', 'c.id', 'pc.condition_id')
    .where('pc.patient_id', patientId)
    .orderBy('c.name')
    .select('c.id', 'c.name', 'c.cid10', 'pc.noted_at');
  return rows.map((r) => ({ ...r, noted_at: isoDay(r.noted_at) }));
}

/** Mapa patient_id → condições, para listas. */
export async function conditionsByPatient(db, patientIds) {
  const out = new Map();
  if (!patientIds.length) return out;
  const rows = await db('patient_conditions as pc')
    .join('conditions as c', 'c.id', 'pc.condition_id')
    .whereIn('pc.patient_id', patientIds)
    .orderBy('c.name')
    .select('pc.patient_id', 'c.id', 'c.name', 'c.cid10');
  for (const r of rows) {
    if (!out.has(r.patient_id)) out.set(r.patient_id, []);
    out.get(r.patient_id).push({ id: r.id, name: r.name, cid10: r.cid10 });
  }
  return out;
}
