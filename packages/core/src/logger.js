/**
 * Logger JSON estruturado com redação de PII/conteúdo clínico (portado do v1; L10).
 * API: logger.debug/info/warn/error(msg, fields?) · logger.child(fields)
 * Sem middleware Express (o web é Next).
 */

const REDACT_KEYS = new Set([
  // conteúdo clínico / respostas
  'text',
  'value',
  'value_text',
  'value_choice',
  'value_num',
  'note',
  'notes',
  'payload',
  'context',
  // PII
  'name',
  'full_name',
  'fullName',
  'nickname',
  'birth_date',
  'birthDate',
  'email',
  'phone',
  'cpf',
  'address',
  'relationship',
  // push / segredos
  'endpoint',
  'keys',
  'password',
  'password_hash',
  'token',
  'invite_token',
  'api_key',
  'apiKey',
  'secret',
  'authorization',
  'cookie',
]);

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

function minLevel() {
  return LEVELS[String(process.env.LOG_LEVEL || 'info').toLowerCase()] ?? LEVELS.info;
}

function shouldRedact(key) {
  const lower = String(key).toLowerCase();
  if (REDACT_KEYS.has(key) || REDACT_KEYS.has(lower)) return true;
  return /password|token|secret|_jid$/i.test(lower);
}

export function redact(value, depth = 0) {
  if (value == null) return value;
  if (depth > 6) return '[DEEP]';
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return { name: value.name, message: value.message };
  if (typeof value !== 'object') return value;
  const out = {};
  for (const [key, inner] of Object.entries(value)) {
    out[key] = shouldRedact(key) ? '[REDACTED]' : redact(inner, depth + 1);
  }
  return out;
}

function emit(level, msg, fields = {}, baseFields = {}) {
  if ((LEVELS[level] ?? 0) < minLevel()) return;
  const row = {
    ts: new Date().toISOString(),
    level,
    msg: String(msg || ''),
    ...redact(baseFields),
    ...redact(fields),
  };
  const json = JSON.stringify(row);
  if (level === 'error') console.error(json);
  else console.log(json);
}

function buildLogger(baseFields = {}) {
  return {
    debug: (msg, fields) => emit('debug', msg, fields, baseFields),
    info: (msg, fields) => emit('info', msg, fields, baseFields),
    warn: (msg, fields) => emit('warn', msg, fields, baseFields),
    error: (msg, fields) => emit('error', msg, fields, baseFields),
    child: (extra = {}) => buildLogger({ ...baseFields, ...extra }),
  };
}

export const logger = buildLogger();
