/**
 * Parser CSV mínimo (RFC 4180): aspas duplas, aspas escapadas por duplicação, quebras de linha
 * dentro de campo, delimitador configurável. Sem dependência: o extrato do Versatilis é uma vez só.
 */
export function parseCsv(text, { delimiter = ';' } = {}) {
  const src = String(text ?? '').replace(/^﻿/, '');
  const records = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === delimiter) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i += 1;
      row.push(field);
      field = '';
      if (row.some((v) => v !== '')) records.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    if (row.some((v) => v !== '')) records.push(row);
  }
  if (!records.length) return { header: [], rows: [] };
  const header = records[0].map((h) => h.trim());
  const rows = records
    .slice(1)
    .map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()])));
  return { header, rows };
}
