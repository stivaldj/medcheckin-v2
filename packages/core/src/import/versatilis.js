import { DateTime } from 'luxon';
import { toDT } from '../time.js';
import { AuthError } from '../auth/tokens.js';
import { logAccess } from '../auth/access.js';
import { ValidationError } from '../errors.js';
import { catalogNameKey } from '../catalog/nameKey.js';
import { findOrCreateCondition } from '../conditions/index.js';
import { storeAttachment } from '../attachments/index.js';
import { noteDay } from '../notes/index.js';

const SOURCE = 'versatilis';

function requireDoctor(session) {
  if (!session || session.kind !== 'user')
    throw new AuthError('unauthenticated', 'Sessão da clínica necessária.');
}

function parseDay(raw, formato) {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const fmt = (formato || 'DD/MM/AAAA')
    .replace('AAAA', 'yyyy')
    .replace('DD', 'dd')
    .replace('MM', 'MM');
  const d = DateTime.fromFormat(s, fmt);
  if (d.isValid) return d.toISODate();
  const iso = DateTime.fromISO(s);
  return iso.isValid ? iso.toISODate() : null;
}

function splitList(raw, sep) {
  return String(raw ?? '')
    .split(sep || ';')
    .map((s) => s.trim())
    .filter(Boolean);
}

// `existing.birth_date` chega do Postgres como Date (coluna `date`, sem type parser custom em
// db.js). `noteDay` (mesmo conversor canônico usado em notas: luxon fromJSDate().toISODate() no
// fuso do processo — o mesmo fuso que o driver pg usou para montar o Date) evita o deslocamento
// de dia que `toISOString()` (sempre UTC) causaria em hosts de fuso positivo.
function dateStr(v) {
  if (v == null) return null;
  return noteDay(v);
}

function fileFor(mapa, item) {
  const padrao = mapa?.pdf?.padrao || '{ref}.pdf';
  return padrao.replace('{ref}', item.ref).replace('{nome}', item.name);
}

/**
 * D39 — plano puro (sem I/O): classifica cada linha do CSV.
 * `existing`: pacientes da clínica `{ id, name_key, birth_date, external_ref }`.
 * Casa por external_ref; senão por name_key + birth_date (ambos presentes e iguais).
 * Mesmo name_key com nascimento diferente ou ausente em um dos lados → colisão. Duas linhas do
 * CSV com o mesmo name_key também colidem entre si.
 */
export function planImport({ rows, mapa, pdfFiles = [], existing = [] }) {
  const col = mapa?.colunas ?? {};
  if (!col.ref || !col.nome)
    throw new ValidationError('mapa.colunas precisa de ref e nome.', 'mapa');
  const byRef = new Map(
    existing.filter((e) => e.external_ref).map((e) => [String(e.external_ref), e]),
  );
  const byKey = new Map();
  for (const e of existing) {
    if (!byKey.has(e.name_key)) byKey.set(e.name_key, []);
    byKey.get(e.name_key).push(e);
  }
  const items = rows
    .map((r) => {
      const name = String(r[col.nome] ?? '')
        .replace(/\s+/g, ' ')
        .trim();
      return {
        ref: String(r[col.ref] ?? '').trim(),
        name,
        name_key: catalogNameKey(name),
        birth_date: col.nascimento ? parseDay(r[col.nascimento], mapa.formatoData) : null,
        phone: col.telefone ? String(r[col.telefone] ?? '').trim() || null : null,
        conditions: col.condicoes ? splitList(r[col.condicoes], mapa.separadorCondicoes) : [],
        consultas: col.consultas
          ? splitList(r[col.consultas], mapa.separadorConsultas || '|')
              .map((d) => parseDay(d, mapa.formatoData))
              .filter(Boolean)
          : [],
        pdf: null,
      };
    })
    .filter((i) => i.ref && i.name.length >= 2);
  const pdfSet = new Set(pdfFiles);
  const csvKeys = new Map();
  for (const i of items) csvKeys.set(i.name_key, (csvKeys.get(i.name_key) ?? 0) + 1);

  const plan = { criar: [], casar: [], colidir: [], pdfSemPaciente: [], pacienteSemPdf: [] };
  const usedPdf = new Set();
  for (const item of items) {
    const f = fileFor(mapa, item);
    if (pdfSet.has(f)) {
      item.pdf = f;
      usedPdf.add(f);
    } else plan.pacienteSemPdf.push(item.ref);

    const byRefHit = byRef.get(item.ref);
    if (byRefHit) {
      plan.casar.push({ ...item, existingId: byRefHit.id });
      continue;
    }
    const sameKey = byKey.get(item.name_key) ?? [];
    const exact = sameKey.filter(
      (e) => e.birth_date && item.birth_date && dateStr(e.birth_date) === item.birth_date,
    );
    if (
      (csvKeys.get(item.name_key) ?? 0) > 1 ||
      (sameKey.length && exact.length !== sameKey.length)
    ) {
      plan.colidir.push({
        ref: item.ref,
        name: item.name,
        birth_date: item.birth_date,
        motivo:
          (csvKeys.get(item.name_key) ?? 0) > 1
            ? 'mesmo nome em mais de uma linha do CSV'
            : `homônimo já cadastrado com nascimento ${sameKey.map((e) => dateStr(e.birth_date) ?? 'desconhecido').join(', ')}`,
      });
      continue;
    }
    if (exact.length === 1) plan.casar.push({ ...item, existingId: exact[0].id });
    else plan.criar.push(item);
  }
  plan.pdfSemPaciente = pdfFiles.filter((f) => !usedPdf.has(f));
  return plan;
}

/**
 * Executa o plano por paciente, em transação para o paciente + notas; condições via
 * find-or-create (autocommit, D34) e anexo via storeAttachment (idempotente por sha256) fora dela.
 * `readPdf(nomeArquivo) → Buffer | null`. Reexecutar não duplica: unique parcial em external_ref,
 * onConflict nos vínculos, sha256 nos anexos, e notas importadas checadas por (patient, source.ref).
 * D39: recusa gravar se `plan.colidir` não está vazio — defesa em profundidade além da UI, que já
 * deveria ter bloqueado o botão de executar com colisões pendentes.
 */
export async function executeImport(db, session, plan, { readPdf }, now) {
  requireDoctor(session);
  if (plan.colidir.length)
    throw new ValidationError(
      `Há ${plan.colidir.length} colisão(ões) não resolvida(s); ajuste o CSV ou o mapa antes de gravar.`,
      'colidir',
    );
  const nowJs = toDT(now).toJSDate();
  const out = { created: 0, matched: 0, attached: 0, notes: 0 };

  for (const item of [...plan.casar, ...plan.criar]) {
    const conditionIds = [];
    for (const name of item.conditions) {
      const { condition } = await findOrCreateCondition(db, session, { name });
      if (!conditionIds.includes(condition.id)) conditionIds.push(condition.id);
    }
    const patientId = await db.transaction(async (trx) => {
      let id = item.existingId ?? null;
      if (id) {
        await trx('patients')
          .where({ id })
          .update({
            external_source: SOURCE,
            external_ref: item.ref,
            imported_at: trx.raw('coalesce(imported_at, ?)', [nowJs]),
            birth_date: trx.raw('coalesce(birth_date, ?)', [item.birth_date]),
            updated_at: trx.fn.now(),
          });
        out.matched += 1;
      } else {
        const [p] = await trx('patients')
          .insert({
            clinic_id: session.clinicId,
            name: item.name,
            name_key: item.name_key,
            birth_date: item.birth_date,
            timezone: 'America/Cuiaba',
            status: 'registered',
            external_source: SOURCE,
            external_ref: item.ref,
            imported_at: nowJs,
            created_by: session.userId,
          })
          .returning('id');
        id = p.id;
        out.created += 1;
      }
      if (conditionIds.length)
        await trx('patient_conditions')
          .insert(conditionIds.map((condition_id) => ({ patient_id: id, condition_id })))
          .onConflict(['patient_id', 'condition_id'])
          .ignore();
      for (const day of item.consultas) {
        const ref = `${item.ref}:${day}`;
        const exists = await trx('clinical_notes')
          .where({ patient_id: id, kind: 'importada' })
          .whereRaw("source->>'system' = ? and source->>'ref' = ?", [SOURCE, ref])
          .first();
        if (exists) continue;
        await trx('clinical_notes').insert({
          patient_id: id,
          kind: 'importada',
          occurred_at: day,
          body: 'Consulta registrada no Versatilis',
          source: JSON.stringify({ system: SOURCE, ref }),
          created_by: session.userId,
        });
        out.notes += 1;
      }
      await logAccess(
        trx,
        {
          session,
          patientId: id,
          route: 'patients.import',
          action: item.existingId ? 'update' : 'create',
        },
        now,
      );
      return id;
    });
    if (item.pdf) {
      const buf = await readPdf(item.pdf);
      if (buf) {
        const before = await db('attachments').where({ patient_id: patientId }).count().first();
        await storeAttachment(
          db,
          session,
          patientId,
          { buffer: buf, originalName: item.pdf, mime: 'application/pdf', source: 'import' },
          now,
        );
        const after = await db('attachments').where({ patient_id: patientId }).count().first();
        if (Number(after.count) > Number(before.count)) out.attached += 1;
      }
    }
  }
  return out;
}
