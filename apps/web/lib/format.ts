/** Sem dado → "—" (regra: nenhum número sem fonte). */
export function fmt(value: unknown, suffix = ''): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'number')
    return `${Number.isInteger(value) ? value : value.toFixed(1)}${suffix}`;
  return `${String(value)}${suffix}`;
}

export function fmtDate(
  value: unknown,
  opts: Intl.DateTimeFormatOptions = { day: '2-digit', month: '2-digit' },
): string {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('pt-BR', opts);
}

export function fmtDateTime(value: unknown): string {
  if (!value) return '—';
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function isoDay(value: unknown): string {
  if (!value) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

export const EPISODE_LABEL: Record<string, string> = {
  titration: 'Titulação',
  maintenance: 'Manutenção',
};
export const FREQ_LABEL: Record<string, string> = {
  daily: 'diário',
  weekly: 'semanal',
  biweekly: 'quinzenal',
};
export const STATUS_LABEL: Record<string, string> = {
  active: 'Ativo',
  paused: 'Pausado',
  discharged: 'Alta',
};
export const KIND_LABEL: Record<string, string> = {
  scale_0_10: 'Escala 0–10',
  yes_no: 'Sim/Não',
  choice: 'Escolha',
  number: 'Número',
  text: 'Texto',
};
