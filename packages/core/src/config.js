/**
 * Config fail-closed (DECISOES.md L9): variável obrigatória ausente → lança.
 * Nunca loga valores. Recebe `env` explicitamente para ser testável.
 */
export function loadConfig(env = process.env) {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl || databaseUrl.trim() === '') {
    throw new Error('DATABASE_URL ausente: o processo não sobe sem banco configurado.');
  }
  return Object.freeze({ databaseUrl });
}
