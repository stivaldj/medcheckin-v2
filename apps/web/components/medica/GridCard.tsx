import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { fmt } from '@/lib/format';

import type { Grid } from '@medcheckin/core';

type Direcao = 'higher_is_better' | 'lower_is_better' | null;

function cellText(v: unknown, kind: string) {
  if (v === null || v === undefined || v === '') return '—';
  if (kind === 'yes_no') return Number(v) === 1 ? 'sim' : 'não';
  return fmt(v);
}

/**
 * Quanto esta célula preocupa, de 0 a 1 — ou `null` quando não dá para afirmar.
 *
 * Colorir sem saber a direção enganaria: "8" de dor e "8" de sono são opostos. Só pinta o que
 * tem direção de score declarada ou o que é efeito adverso, onde qualquer presença já é ruim.
 * Número solto não tem escala conhecida (um peso em kg não cabe em 0–10) e fica sem cor — o
 * valor continua legível, que é o que importa.
 */
function preocupacao(
  v: unknown,
  kind: string,
  direcao: Direcao,
  efeitoAdverso: boolean,
): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (kind === 'yes_no') {
    if (Number.isNaN(n)) return null;
    if (efeitoAdverso) return n === 1 ? 1 : 0;
    if (!direcao) return null;
    const bom = direcao === 'higher_is_better' ? 1 : 0;
    return n === bom ? 0 : 1;
  }
  if (kind !== 'scale_0_10' || Number.isNaN(n)) return null;
  const alto = Math.min(1, Math.max(0, n / 10));
  if (efeitoAdverso) return alto;
  if (!direcao) return null;
  return direcao === 'lower_is_better' ? alto : 1 - alto;
}

/** Rampa fria → quente sobre a superfície do cartão, sem virar semáforo. */
function fundo(p: number | null): string | undefined {
  if (p === null) return undefined;
  if (p < 0.35) return `color-mix(in oklab, var(--sev-low) ${Math.round(p * 34)}%, transparent)`;
  if (p < 0.6) return `color-mix(in oklab, var(--sev-medium) ${Math.round(p * 40)}%, transparent)`;
  if (p < 0.8) return `color-mix(in oklab, var(--sev-high) ${Math.round(p * 45)}%, transparent)`;
  return `color-mix(in oklab, var(--sev-critical) ${Math.round(p * 48)}%, transparent)`;
}

export function GridCard({
  grid,
  direcoes = {},
}: {
  grid: Grid;
  direcoes?: Record<string, Direcao>;
}) {
  const dd = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
  const doseByDay = Object.fromEntries(grid.doseMarkers.map((m) => [m.date, m]));
  return (
    <Card data-testid="grid-card">
      <CardHeader>
        <CardTitle>Últimos 14 dias × perguntas</CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {grid.questions.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sem perguntas no episódio.</p>
        ) : (
          <table className="w-full border-separate border-spacing-0.5 text-xs">
            <thead>
              <tr>
                <th className="sticky left-0 bg-card p-1 text-left font-medium">Pergunta</th>
                {grid.days.map((d) => (
                  <th
                    key={d}
                    className="p-1 text-center font-mono text-[10px] font-normal text-muted-foreground"
                    title={
                      doseByDay[d]
                        ? `Ajuste de dose: ${doseByDay[d].dose_amount} ${doseByDay[d].dose_unit}`
                        : undefined
                    }
                  >
                    {dd(d)}
                    {doseByDay[d] && (
                      <span className="ml-0.5 text-[var(--chart-dose)]" aria-label="ajuste de dose">
                        ●
                      </span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grid.questions.map((q) => (
                <tr key={q.key}>
                  {/* rótulo da médica, não a chave do banco; a chave fica no title */}
                  <td
                    className="sticky left-0 max-w-44 truncate bg-card p-1 pr-3 whitespace-nowrap"
                    title={`${q.label} (${q.key})`}
                  >
                    {q.label}
                    {q.is_side_effect ? ' ⚠' : ''}
                  </td>
                  {grid.days.map((d) => {
                    const v = grid.cells[d]?.[q.key];
                    const p = preocupacao(v, q.kind, direcoes[q.key] ?? null, q.is_side_effect);
                    const texto = cellText(v, q.kind);
                    return (
                      <td
                        key={d}
                        className="rounded-sm p-1 text-center font-mono tabular-nums"
                        style={{ background: fundo(p) }}
                      >
                        {/* Resposta livre não pode esticar a coluna e desalinhar a grade toda. */}
                        <span
                          className="mx-auto block max-w-24 truncate"
                          title={texto === '—' ? undefined : texto}
                        >
                          {texto}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr className="font-medium">
                <td className="sticky left-0 bg-card p-1 pr-3">Score</td>
                {grid.days.map((d) => (
                  <td
                    key={d}
                    className="rounded-sm p-1 text-center font-mono tabular-nums"
                    title={grid.risk[d] ?? undefined}
                    style={{
                      background: fundo(
                        grid.scores[d] === null || grid.scores[d] === undefined
                          ? null
                          : Math.min(1, Math.max(0, Number(grid.scores[d]) / 10)),
                      ),
                    }}
                  >
                    {fmt(grid.scores[d])}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        )}
        <p className="mt-3 max-w-[80ch] text-xs text-muted-foreground">
          Célula = última resposta do dia; “—” = sem dado; ● = ajuste de dose. O fundo mostra o
          quanto o valor preocupa — só é pintado quando a pergunta tem direção de score declarada ou
          é efeito adverso. Sem isso fica sem cor: “8” de dor e “8” de sono são opostos.
        </p>
      </CardContent>
    </Card>
  );
}
