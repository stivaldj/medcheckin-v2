import { DateTime } from 'luxon';
import { AuthError } from '../auth/tokens.js';
import { requirePatientInClinic, logAccess } from '../auth/access.js';
import { ValidationError } from '../errors.js';
import { localDate } from '../time.js';

const KINDS = new Set(['consulta', 'evolucao', 'contato', 'importada']);
const BODY_MAX = 20000;

function requireDoctor(session) {
  if (!session || session.kind !== 'user')
    throw new AuthError('unauthenticated', 'Sessão da clínica necessária.');
}

/** Dia civil (AAAA-MM-DD) de uma coluna `date` do Postgres, venha como Date ou string. */
export function noteDay(value) {
  if (value instanceof Date) return DateTime.fromJSDate(value).toISODate();
  return String(value).slice(0, 10);
}

function notePatch(input, { partial, patient, now }) {
  const has = (k) => Object.hasOwn(input ?? {}, k);
  const patch = {};
  if (!partial || has('kind')) {
    const kind = String(input?.kind ?? 'consulta');
    if (!KINDS.has(kind)) throw new ValidationError('Tipo de nota inválido.', 'kind');
    patch.kind = kind;
  }
  if (!partial || has('occurred_at')) {
    const today = localDate(now, patient.timezone || 'UTC');
    const raw = input?.occurred_at;
    const d = raw === undefined || raw === null || raw === '' ? today : String(raw).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !DateTime.fromISO(d).isValid)
      throw new ValidationError('Data da nota inválida (AAAA-MM-DD).', 'occurred_at');
    if (d > today) throw new ValidationError('A data da nota não pode ser futura.', 'occurred_at');
    patch.occurred_at = d;
  }
  if (!partial || has('body')) {
    const body = String(input?.body ?? '').trim();
    if (!body) throw new ValidationError('Escreva o texto da nota.', 'body');
    if (body.length > BODY_MAX)
      throw new ValidationError(`Nota muito longa (máx. ${BODY_MAX} caracteres).`, 'body');
    patch.body = body;
  }
  return patch;
}

/** Nota visível da clínica da sessão (join com patients); oculta ou de outra clínica → not_found. */
async function noteInClinic(db, session, noteId) {
  const n = await db('clinical_notes as n')
    .join('patients as p', 'p.id', 'n.patient_id')
    .where('n.id', noteId)
    .andWhere('p.clinic_id', session.clinicId)
    .whereNull('n.deleted_at')
    .select('n.*', 'p.timezone as patient_timezone')
    .first();
  if (!n) throw new AuthError('not_found', 'Nota não encontrada.');
  return n;
}

/** D35 — nota livre datada. `occurred_at` padrão = hoje no fuso do paciente. */
export async function createNote(db, session, patientId, input, now) {
  requireDoctor(session);
  const patient = await requirePatientInClinic(db, session, patientId);
  const patch = notePatch(input, { partial: false, patient, now });
  const [row] = await db('clinical_notes')
    .insert({ patient_id: patientId, ...patch, created_by: session.userId })
    .returning('*');
  await logAccess(db, { session, patientId, route: 'notes.create', action: 'create' }, now);
  return row;
}

export async function updateNote(db, session, noteId, input, now) {
  requireDoctor(session);
  const note = await noteInClinic(db, session, noteId);
  if (note.source)
    throw new ValidationError('Nota importada não se edita; escreva uma nova.', 'source');
  const patch = notePatch(input, {
    partial: true,
    patient: { timezone: note.patient_timezone },
    now,
  });
  if (!Object.keys(patch).length) throw new ValidationError('Nada para atualizar.');
  const [row] = await db('clinical_notes')
    .where({ id: noteId })
    .update({ ...patch, updated_at: db.fn.now() })
    .returning('*');
  await logAccess(
    db,
    { session, patientId: note.patient_id, route: 'notes.update', action: 'update' },
    now,
  );
  return row;
}

/** "Apagar" é ocultar: a nota fica no banco, no export e na auditoria (D35). */
export async function deleteNote(db, session, noteId, now) {
  requireDoctor(session);
  const note = await noteInClinic(db, session, noteId);
  const [row] = await db('clinical_notes')
    .where({ id: noteId })
    .update({ deleted_at: db.fn.now(), updated_at: db.fn.now() })
    .returning('*');
  await logAccess(
    db,
    { session, patientId: note.patient_id, route: 'notes.delete', action: 'delete' },
    now,
  );
  return row;
}

export async function listNotes(db, session, patientId, { includeDeleted = false } = {}) {
  requireDoctor(session);
  await requirePatientInClinic(db, session, patientId);
  let q = db('clinical_notes').where({ patient_id: patientId });
  if (!includeDeleted) q = q.whereNull('deleted_at');
  return q.orderBy('occurred_at', 'desc').orderBy('created_at', 'desc');
}
