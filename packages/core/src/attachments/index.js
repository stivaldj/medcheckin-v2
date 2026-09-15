import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile, rm, open } from 'node:fs/promises';
import path from 'node:path';
import { loadConfig } from '../config.js';
import { AuthError } from '../auth/tokens.js';
import { requirePatientInClinic, logAccess } from '../auth/access.js';
import { ValidationError } from '../errors.js';

export const ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;
const EXT = { pdf: 'pdf', jpeg: 'jpg', png: 'png' };
const MIME = { pdf: 'application/pdf', jpeg: 'image/jpeg', png: 'image/png' };

function requireDoctor(session) {
  if (!session || session.kind !== 'user')
    throw new AuthError('unauthenticated', 'Sessão da clínica necessária.');
}

/** Formato pelos primeiros bytes — extensão e Content-Type são o que o cliente disse, não o que é. */
function sniffFormat(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 8) return null;
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return 'png';
  return null;
}

export function sniffKind(buf) {
  const f = sniffFormat(buf);
  if (!f) return null;
  return f === 'pdf' ? 'pdf' : 'image';
}

/**
 * Higieniza o nome original antes de guardar/exibir: ele vira parte do nome do arquivo no export
 * (`anexos/<id>-<original_name>`) e do `Content-Disposition` na rota de download, então nunca pode
 * carregar separador de caminho, `..`, aspas ou caracteres de controle (zip slip / header injection).
 */
// eslint-disable-next-line no-control-regex -- remover caracteres de controle é o propósito daqui.
const CONTROL_CHARS_RE = /["\x00-\x1f\x7f]/g;

function sanitizeOriginalName(name, ext) {
  const cleaned = String(name ?? '')
    .replace(/[\\/]+/g, '_')
    .replace(/\.\.+/g, '_')
    .replace(CONTROL_CHARS_RE, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
  return cleaned || `arquivo.${ext}`;
}

function uploadsDir() {
  return path.resolve(loadConfig(process.env).uploadsDir);
}

export function attachmentAbsolutePath(row) {
  const abs = path.resolve(uploadsDir(), row.stored_path);
  // stored_path é nosso, mas o caminho final nunca pode sair do volume.
  if (!abs.startsWith(uploadsDir() + path.sep)) throw new Error('stored_path fora do volume');
  return abs;
}

/**
 * D38 — grava o arquivo no volume (nome opaco por clínica) e os metadados no banco. Ordem:
 * disco primeiro, banco depois; se o insert falhar, o arquivo sai. Mesmo sha256 no mesmo paciente
 * devolve o anexo existente (idempotente — a importação reexecuta sem duplicar).
 */
export async function storeAttachment(db, session, patientId, input, now) {
  requireDoctor(session);
  await requirePatientInClinic(db, session, patientId);
  const buf = input?.buffer;
  const format = sniffFormat(buf);
  if (!format)
    throw new ValidationError(
      'Arquivo não aceito: só PDF, JPG ou PNG (conferido pelo conteúdo).',
      'file',
      { status: 415 },
    );
  if (buf.length > ATTACHMENT_MAX_BYTES)
    throw new ValidationError('Arquivo acima de 25 MB.', 'file', { status: 413 });
  const originalName = sanitizeOriginalName(input?.originalName, EXT[format]);
  const sha256 = createHash('sha256').update(buf).digest('hex');
  const existing = await db('attachments').where({ patient_id: patientId, sha256 }).first();
  if (existing) {
    if (!existing.deleted_at) return existing;
    // Reenvio do mesmo arquivo depois de ocultado: reativa em vez de devolver a linha oculta
    // silenciosamente (senão a médica reenviaria achando que subiu e o anexo continuaria escondido).
    const [reactivated] = await db('attachments')
      .where({ id: existing.id })
      .update({ deleted_at: null, original_name: originalName })
      .returning('*');
    await logAccess(db, { session, patientId, route: 'attachments.create', action: 'create' }, now);
    return reactivated;
  }

  const rel = path.posix.join(session.clinicId, `${randomUUID()}.${EXT[format]}`);
  const abs = path.resolve(uploadsDir(), rel);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, buf, { flag: 'wx' });
  const fh = await open(abs, 'r');
  try {
    await fh.sync();
  } finally {
    await fh.close();
  }
  try {
    const [row] = await db('attachments')
      .insert({
        patient_id: patientId,
        kind: format === 'pdf' ? 'pdf' : 'image',
        original_name: originalName,
        mime: MIME[format],
        size_bytes: buf.length,
        sha256,
        stored_path: rel,
        source: input?.source === 'import' ? 'import' : 'upload',
        uploaded_by: input?.source === 'import' ? null : session.userId,
      })
      .returning('*');
    await logAccess(db, { session, patientId, route: 'attachments.create', action: 'create' }, now);
    return row;
  } catch (err) {
    await rm(abs, { force: true });
    if (err?.code === '23505') {
      const again = await db('attachments').where({ patient_id: patientId, sha256 }).first();
      if (again) return again;
    }
    throw err;
  }
}

export async function listAttachments(db, session, patientId) {
  requireDoctor(session);
  await requirePatientInClinic(db, session, patientId);
  return db('attachments')
    .where({ patient_id: patientId })
    .whereNull('deleted_at')
    .orderBy('created_at', 'desc');
}

async function attachmentInClinic(db, session, attachmentId, patientId) {
  const q = db('attachments as a')
    .join('patients as p', 'p.id', 'a.patient_id')
    .where('a.id', attachmentId)
    .andWhere('p.clinic_id', session.clinicId)
    .whereNull('a.deleted_at')
    .select('a.*')
    .first();
  if (patientId) q.andWhere('a.patient_id', patientId);
  const row = await q;
  if (!row) throw new AuthError('not_found', 'Anexo não encontrado.');
  return row;
}

/** Devolve a linha e o caminho absoluto; quem chama faz o stream. Audita a leitura. */
export async function openAttachment(db, session, attachmentId, now, opts = {}) {
  requireDoctor(session);
  const row = await attachmentInClinic(db, session, attachmentId, opts.patientId);
  await logAccess(
    db,
    { session, patientId: row.patient_id, route: 'attachments.read', action: 'view' },
    now,
  );
  return { row, path: attachmentAbsolutePath(row) };
}

/** Ocultar (D38): some da lista, fica no disco e no export. */
export async function hideAttachment(db, session, attachmentId, now, opts = {}) {
  requireDoctor(session);
  const row = await attachmentInClinic(db, session, attachmentId, opts.patientId);
  const [out] = await db('attachments')
    .where({ id: row.id })
    .update({ deleted_at: db.fn.now() })
    .returning('*');
  await logAccess(
    db,
    { session, patientId: row.patient_id, route: 'attachments.delete', action: 'delete' },
    now,
  );
  return out;
}

/**
 * Usado pela anonimização: anonimiza o nome dentro da transação e devolve os caminhos a apagar
 * do disco. NÃO toca o filesystem aqui — `rm` fora da transação (que pode ser desfeita) apagaria
 * bytes de forma irreversível mesmo se o `COMMIT` nunca acontecer. Quem chama apaga os arquivos
 * depois que a transação resolver.
 */
export async function purgeAttachmentFiles(trx, patientId) {
  const rows = await trx('attachments').where({ patient_id: patientId }).orderBy('created_at');
  const paths = rows.map(attachmentAbsolutePath);
  for (const [i, r] of rows.entries()) {
    await trx('attachments')
      .where({ id: r.id })
      .update({
        original_name: `anexo ${i + 1}`,
        deleted_at: r.deleted_at ?? trx.fn.now(),
      });
  }
  return { count: rows.length, paths };
}
