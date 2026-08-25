import { toDT } from '../time.js';
import { AuthError } from '../auth/tokens.js';
import { requirePatientInClinic, logAccess } from '../auth/access.js';
import { toHm } from '../scheduler/next-run.js';
import { ValidationError } from '../errors.js';

const FORMS = new Set(['oil', 'capsule', 'flower', 'other']);
const UNITS = new Set(['gotas', 'ml', 'mg', 'cápsulas', 'capsulas']);
const EPISODE_KINDS = new Set(['titration', 'maintenance']);
const FREQS = new Set(['daily', 'weekly', 'biweekly']);

function requireDoctor(session) {
  if (!session || session.kind !== 'user')
    throw new AuthError('unauthenticated', 'Sessão da clínica necessária.');
}

export async function listProducts(db, clinicId) {
  return db('products').where({ clinic_id: clinicId }).orderBy('name');
}

export async function createProduct(db, session, input) {
  requireDoctor(session);
  const name = String(input?.name ?? '').trim();
  if (name.length < 2) throw new ValidationError('Nome do produto é obrigatório.', 'name');
  const form = String(input?.form ?? 'oil');
  if (!FORMS.has(form)) throw new ValidationError('Forma farmacêutica inválida.', 'form');
  const num = (v) => (v === undefined || v === null || v === '' ? null : Number(v));
  const cbd = num(input?.cbd_mg_ml);
  const thc = num(input?.thc_mg_ml);
  if ((cbd !== null && !(cbd >= 0)) || (thc !== null && !(thc >= 0)))
    throw new ValidationError('Concentração inválida.');
  const [row] = await db('products')
    .insert({ clinic_id: session.clinicId, name, form, cbd_mg_ml: cbd, thc_mg_ml: thc })
    .returning('*');
  return row;
}

export async function addMedication(db, session, patientId, { product_id }, now) {
  requireDoctor(session);
  await requirePatientInClinic(db, session, patientId);
  const product = await db('products')
    .where({ id: product_id, clinic_id: session.clinicId })
    .first();
  if (!product) throw new AuthError('not_found', 'Produto não encontrado.');
  const [row] = await db('medications')
    .insert({ patient_id: patientId, product_id })
    .returning('*');
  await logAccess(db, { session, patientId, route: 'medications.create', action: 'update' }, now);
  return row;
}

async function medicationInClinic(db, session, medicationId) {
  const m = await db('medications as m')
    .join('patients as p', 'p.id', 'm.patient_id')
    .where('m.id', medicationId)
    .andWhere('p.clinic_id', session.clinicId)
    .select('m.*')
    .first();
  if (!m) throw new AuthError('not_found', 'Medicação não encontrada.');
  return m;
}

/**
 * D3: novo dose_event. Valida; opcionalmente abre episódio de titulação (D5) fechando o anterior.
 */
export async function adjustDose(db, session, medicationId, input, now) {
  requireDoctor(session);
  const med = await medicationInClinic(db, session, medicationId);
  const nowJs = toDT(now).toJSDate();
  const effective = String(input?.effective_from ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effective))
    throw new ValidationError('Data de vigência inválida (AAAA-MM-DD).', 'effective_from');
  const amount = Number(input?.dose_amount);
  if (!(amount > 0)) throw new ValidationError('Dose deve ser maior que zero.', 'dose_amount');
  const unit = String(input?.dose_unit ?? '')
    .trim()
    .toLowerCase();
  if (!UNITS.has(unit))
    throw new ValidationError('Unidade de dose inválida (gotas, ml, mg, cápsulas).', 'dose_unit');
  const tpd = Number(input?.times_per_day);
  if (!Number.isInteger(tpd) || tpd < 1 || tpd > 12)
    throw new ValidationError('Vezes por dia deve ser 1–12.', 'times_per_day');
  const times = [...new Set((input?.schedule_times ?? []).map(toHm).filter(Boolean))].sort();
  if (times.length !== tpd)
    throw new ValidationError(
      `Informe ${tpd} horários válidos (HH:MM), um por tomada.`,
      'schedule_times',
    );

  return db.transaction(async (trx) => {
    let de;
    try {
      [de] = await trx('dose_events')
        .insert({
          medication_id: med.id,
          effective_from: effective,
          dose_amount: amount,
          dose_unit: unit,
          times_per_day: tpd,
          schedule_times: times,
          reason: input?.reason ? String(input.reason).slice(0, 200) : null,
          note: input?.note ? String(input.note).slice(0, 2000) : null,
          created_by: session.userId,
        })
        .returning('*');
    } catch (err) {
      if (err?.code === '23505')
        throw new ValidationError(
          'Já existe um ajuste nesta mesma data para esta medicação.',
          'effective_from',
        );
      throw err;
    }
    if (input?.open_titration) {
      const qsId = input.question_set_id ?? (await defaultQuestionSetId(trx, session.clinicId));
      await trx('episodes')
        .where({ patient_id: med.patient_id })
        .whereNull('ended_at')
        .update({ ended_at: nowJs, updated_at: trx.fn.now() });
      await trx('episodes').insert({
        patient_id: med.patient_id,
        kind: 'titration',
        started_at: nowJs,
        checkin_frequency: 'daily',
        question_set_id: qsId,
        dose_event_id: de.id,
      });
    }
    await logAccess(
      trx,
      { session, patientId: med.patient_id, route: 'doses.create', action: 'update' },
      now,
    );
    return de;
  });
}

async function defaultQuestionSetId(db, clinicId) {
  const qs = await db('question_sets')
    .where({ clinic_id: clinicId, active: true })
    .orderBy('created_at')
    .first();
  if (!qs) throw new ValidationError('Crie um conjunto de perguntas antes de abrir um episódio.');
  return qs.id;
}

export async function setEpisode(
  db,
  session,
  patientId,
  { kind, checkin_frequency, question_set_id },
  now,
) {
  requireDoctor(session);
  await requirePatientInClinic(db, session, patientId);
  if (!EPISODE_KINDS.has(kind)) throw new ValidationError('Tipo de episódio inválido.', 'kind');
  if (!FREQS.has(checkin_frequency))
    throw new ValidationError(
      'Frequência inválida (daily, weekly, biweekly).',
      'checkin_frequency',
    );
  const qs = await db('question_sets')
    .where({ id: question_set_id, clinic_id: session.clinicId })
    .first();
  if (!qs) throw new AuthError('not_found', 'Conjunto de perguntas não encontrado.');
  const nowJs = toDT(now).toJSDate();
  return db.transaction(async (trx) => {
    await trx('episodes')
      .where({ patient_id: patientId })
      .whereNull('ended_at')
      .update({ ended_at: nowJs, updated_at: trx.fn.now() });
    const [ep] = await trx('episodes')
      .insert({
        patient_id: patientId,
        kind,
        started_at: nowJs,
        checkin_frequency,
        question_set_id,
      })
      .returning('*');
    await logAccess(trx, { session, patientId, route: 'episodes.create', action: 'update' }, now);
    return ep;
  });
}
