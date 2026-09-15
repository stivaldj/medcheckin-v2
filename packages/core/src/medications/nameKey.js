/**
 * D34 — chave de identidade de um produto dentro da clínica.
 *
 * O nome exibido fica como a médica digitou; esta chave é o que o índice único compara.
 * Módulo puro (sem knex, sem imports) de propósito: a migration 012 e o cliente web
 * importam daqui, e a normalização tem que ser idêntica nos três lugares.
 */
export function productNameKey(name) {
  if (typeof name !== 'string') return '';
  return name
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}
