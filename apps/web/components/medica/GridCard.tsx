import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { fmt } from '@/lib/format';

import type { Grid } from '@medcheckin/core';

function cellText(v: unknown, kind: string) {
  if (v === null || v === undefined || v === '') return '—';
  if (kind === 'yes_no') return Number(v) === 1 ? 'sim' : 'não';
  return fmt(v);
}

export function GridCard({ grid }: { grid: Grid }) {
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
          <table className="w-full text-xs">
            <thead>
              <tr>
                <th className="sticky left-0 bg-card p-1 text-left">Pergunta</th>
                {grid.days.map((d) => (
                  <th
                    key={d}
                    className="p-1 text-center font-normal"
                    title={
                      doseByDay[d]
                        ? `Ajuste de dose: ${doseByDay[d].dose_amount} ${doseByDay[d].dose_unit}`
                        : undefined
                    }
                  >
                    {dd(d)}
                    {doseByDay[d] && (
                      <span className="ml-0.5 text-primary" aria-label="ajuste de dose">
                        ●
                      </span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grid.questions.map((q) => (
                <tr key={q.key} className="border-t">
                  <td className="sticky left-0 bg-card p-1 whitespace-nowrap" title={q.label}>
                    {q.key}
                    {q.is_side_effect ? ' ⚠' : ''}
                  </td>
                  {grid.days.map((d) => (
                    <td key={d} className="p-1 text-center tabular-nums">
                      {cellText(grid.cells[d]?.[q.key], q.kind)}
                    </td>
                  ))}
                </tr>
              ))}
              <tr className="border-t font-medium">
                <td className="sticky left-0 bg-card p-1">score</td>
                {grid.days.map((d) => (
                  <td
                    key={d}
                    className="p-1 text-center tabular-nums"
                    title={grid.risk[d] ?? undefined}
                  >
                    {fmt(grid.scores[d])}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        )}
        <p className="mt-2 text-xs text-muted-foreground">
          Célula = última resposta do dia; “—” = sem dado; ● = ajuste de dose. Gráfico sintoma ×
          dose: E6.
        </p>
      </CardContent>
    </Card>
  );
}
