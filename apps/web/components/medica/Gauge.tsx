import { cn } from '@/lib/utils';

const R = 17;
const CIRC = 2 * Math.PI * R;

/**
 * Medidor de arco para um número que tem denominador. Só existe para números com fonte: quem
 * não tem total (ex.: contagem aberta) usa `total={null}` e o arco some, restando o número.
 */
export function Gauge({
  value,
  total,
  label,
  sub,
  tone = 'accent',
  className,
}: {
  value: number;
  total: number | null;
  label: string;
  sub?: string;
  tone?: 'accent' | 'ok' | 'medium' | 'high' | 'critical';
  className?: string;
}) {
  const cor = {
    accent: 'var(--primary)',
    ok: 'var(--sev-low)',
    medium: 'var(--sev-medium)',
    high: 'var(--sev-high)',
    critical: 'var(--sev-critical)',
  }[tone];
  const frac = total && total > 0 ? Math.min(1, Math.max(0, value / total)) : value > 0 ? 1 : 0;
  return (
    <div
      className={cn(
        'flex items-center gap-3.5 rounded-xl bg-card p-4 shadow-sm ring-1 ring-foreground/5',
        className,
      )}
    >
      <svg viewBox="0 0 44 44" className="size-12 shrink-0" aria-hidden="true">
        <circle cx="22" cy="22" r={R} fill="none" stroke="var(--muted)" strokeWidth="5" />
        <circle
          cx="22"
          cy="22"
          r={R}
          fill="none"
          stroke={cor}
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={CIRC}
          strokeDashoffset={CIRC * (1 - frac)}
          transform="rotate(-90 22 22)"
        />
      </svg>
      <div className="min-w-0">
        <div className="font-mono text-2xl leading-none font-semibold tracking-tight">
          {value}
          {total !== null && <span className="text-base text-muted-foreground">/{total}</span>}
        </div>
        <div className="mt-1 text-[13px] leading-tight">{label}</div>
        {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
      </div>
    </div>
  );
}
