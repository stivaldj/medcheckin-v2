/**
 * D34/D36 — chave de identidade de um item de catálogo da clínica (produto, condição).
 *
 * O nome exibido fica como a médica digitou; esta chave é o que o índice único compara.
 * Módulo puro (sem knex, sem imports) de propósito: migrations e o cliente web importam
 * daqui, e a normalização tem que ser idêntica em todos os lugares.
 */
export function catalogNameKey(name) {
  if (typeof name !== 'string') return '';
  return name
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Nome antigo (E4/D34). Mantido para a migration 012 e para quem já importava. */
export const productNameKey = catalogNameKey;
