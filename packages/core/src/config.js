/**
 * Config fail-closed (DECISOES.md L9): variável obrigatória ausente → lança.
 * Nunca loga valores. Recebe `env` explicitamente para ser testável.
 */
export function loadConfig(env = process.env) {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl || databaseUrl.trim() === '') {
    throw new Error('DATABASE_URL ausente: o processo não sobe sem banco configurado.');
  }
  // D38: anexos vivem num volume próprio. Em produção o caminho tem que ser explícito (é o que o
  // backup em duas partes tar-eia); fora dela, ./uploads relativo ao cwd serve para dev e testes.
  const uploadsDir = (env.UPLOADS_DIR ?? '').trim();
  if (!uploadsDir && env.NODE_ENV === 'production') {
    throw new Error('UPLOADS_DIR ausente: em produção o volume de anexos é obrigatório.');
  }
  return Object.freeze({ databaseUrl, uploadsDir: uploadsDir || './uploads' });
}
