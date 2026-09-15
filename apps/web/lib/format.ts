/** Formato de UUID (v4 ou não) — usado para validar `?condition=` antes de repassar ao filtro. */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  registered: 'Cadastrado',
};
export const ALERT_STATUS_LABEL: Record<string, string> = {
  open: 'aberto',
  acknowledged: 'reconhecido',
  resolved: 'resolvido',
};
/** Severidade → variante do Badge. Fonte única: crítico e alto são cores diferentes. */
export const SEVERITY_VARIANT: Record<string, 'critical' | 'high' | 'medium' | 'low'> = {
  critical: 'critical',
  high: 'high',
  medium: 'medium',
  low: 'low',
};
export const SEVERITY_LABEL: Record<string, string> = {
  critical: 'crítico',
  high: 'alto',
  medium: 'médio',
  low: 'baixo',
};
export const KIND_LABEL: Record<string, string> = {
  scale_0_10: 'Escala 0–10',
  yes_no: 'Sim/Não',
  choice: 'Escolha',
  number: 'Número',
  text: 'Texto',
};
