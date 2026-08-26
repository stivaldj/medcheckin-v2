'use client';
import { useEffect, useState } from 'react';
import { Area, AreaChart, CartesianGrid, Line, ReferenceLine, XAxis, YAxis } from 'recharts';
import type { SymptomDoseSeries } from '@medcheckin/core';
import { api, ApiError } from '@/lib/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { SimpleSelect } from '@/components/ui/simple-select';
import { fmt } from '@/lib/format';

type Q = { key: string; label: string; kind: string };

/** Espelha `ADHERENCE_QUESTION_KEY` do core (literal: o core é server-only, não entra no bundle). */
const ADHERENCE_KEY = 'adesao';

const TICK = {
  fontSize: 11,
  fontFamily: 'var(--font-mono)',
  fill: 'var(--muted-foreground)',
} as const;

export function SymptomDoseChart({ patientId, questions }: { patientId: string; questions: Q[] }) {
  // D20: adesão não é sintoma — tem card próprio e não entra no gráfico sintoma × dose.
  const numeric = questions.filter(
    (q) =>
      q.key !== ADHERENCE_KEY &&
      (q.kind === 'scale_0_10' || q.kind === 'number' || q.kind === 'yes_no'),
  );
  const [key, setKey] = useState(numeric[0]?.key ?? '');
  const [days, setDays] = useState(30);
  const [data, setData] = useState<SymptomDoseSeries | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!key) return;
    setError(null);
    api<SymptomDoseSeries>(
      `/api/patients/${patientId}/series?question=${encodeURIComponent(key)}&days=${days}`,
    )
      .then(setData)
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Erro'));
  }, [patientId, key, days]);

  if (!numeric.length) return null;
  const rows =
    data?.points.map((p) => ({
      date: p.date.slice(5).split('-').reverse().join('/'),
      iso: p.date,
      value: p.value === null ? null : Number(p.value),
      score: p.score,
    })) ?? [];
  const markers = data?.doseMarkers ?? [];
  const n = rows.filter((r) => r.value !== null).length;
  // Escala honesta por tipo: 0–10 fixo para escala/sim-não; livre para "number" (um peso em kg
  // não cabe num eixo 0–10). Para "number" o score (0–10) sai do gráfico — escalas diferentes
  // na mesma linha enganam; ele continua na grade.
  const kind = data?.question.kind ?? 'scale_0_10';
  const fixedScale = kind === 'scale_0_10' || kind === 'yes_no';
  const showScore = fixedScale;
  const chartConfig = {
    value: { label: data?.question.label ?? 'Sintoma', color: 'var(--chart-symptom)' },
    score: { label: 'Score', color: 'var(--chart-score)' },
  } satisfies ChartConfig;
  return (
    <Card data-testid="chart-card">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle>Sintoma × dose</CardTitle>
        <div className="flex gap-2 text-sm">
          <SimpleSelect
            className="w-auto max-w-72"
            value={key}
            onValueChange={setKey}
            options={numeric.map((q) => ({ value: q.key, label: q.label }))}
            data-testid="chart-question"
            aria-label="Pergunta"
          />
          <SimpleSelect
            className="w-auto"
            value={String(days)}
            onValueChange={(v) => setDays(Number(v))}
            options={[14, 30, 60, 90].map((d) => ({ value: String(d), label: `${d} dias` }))}
            aria-label="Período"
          />
        </div>
      </CardHeader>
      <CardContent>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {data && n === 0 && (
          <p className="text-sm text-muted-foreground" data-testid="chart-empty">
            Sem respostas de “{data.question.label}” no período.
          </p>
        )}
        {data && n > 0 && (
          <div data-testid="chart" data-points={n} data-markers={markers.length}>
            <ChartContainer config={chartConfig} className="h-64 w-full">
              <AreaChart data={rows} margin={{ top: 14, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis dataKey="date" tickLine={false} axisLine={false} tick={TICK} />
                <YAxis
                  domain={fixedScale ? [0, 10] : ['auto', 'auto']}
                  tickLine={false}
                  axisLine={false}
                  width={30}
                  tick={TICK}
                />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      indicator="line"
                      formatter={(v, name) => [
                        v === null || v === undefined ? '—' : String(v),
                        ` ${chartConfig[name as keyof typeof chartConfig]?.label ?? name}`,
                      ]}
                    />
                  }
                />
                {/* Rótulos escalonados em duas alturas para não sobrepor com ajustes próximos. */}
                {markers.map((m, i) => (
                  <ReferenceLine
                    key={m.id}
                    x={m.date.slice(5).split('-').reverse().join('/')}
                    stroke="var(--chart-dose)"
                    strokeDasharray="3 3"
                    label={{
                      value: `${fmt(m.dose_amount)} ${m.dose_unit}`,
                      position: i % 2 === 0 ? 'top' : 'insideTop',
                      fontSize: 10,
                      fontFamily: 'var(--font-mono)',
                      fill: 'var(--chart-dose)',
                    }}
                  />
                ))}
                {/* Dia sem resposta = lacuna de verdade, não linha interpolada (regra: sem dado → "—"). */}
                <Area
                  type="monotone"
                  dataKey="value"
                  name="value"
                  stroke="var(--color-value)"
                  fill="var(--color-value)"
                  fillOpacity={0.16}
                  strokeWidth={2}
                  connectNulls={false}
                  dot={{ r: 2.5, strokeWidth: 0, fill: 'var(--color-value)' }}
                  activeDot={{ r: 4 }}
                />
                {showScore && (
                  <Line
                    type="monotone"
                    dataKey="score"
                    name="score"
                    stroke="var(--color-score)"
                    strokeDasharray="4 4"
                    strokeWidth={1.5}
                    connectNulls={false}
                    dot={false}
                  />
                )}
              </AreaChart>
            </ChartContainer>
          </div>
        )}
        {data && data.beforeAfter.length > 0 && (
          <table className="mt-4 w-full text-xs" data-testid="before-after">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="p-1 font-medium">Ajuste</th>
                <th className="p-1 font-medium">Antes (7 d)</th>
                <th className="p-1 font-medium">Depois (7 d)</th>
                <th className="p-1 font-medium">Δ</th>
              </tr>
            </thead>
            <tbody>
              {data.beforeAfter.map((b) => (
                <tr key={String(b.dose_event_id)} className="border-t">
                  <td className="p-1 font-mono">
                    {b.anchor_date?.split('-').reverse().join('/')} · {fmt(b.dose_amount)}{' '}
                    {String(b.dose_unit ?? '')}
                  </td>
                  <td className="p-1 font-mono">
                    {fmt(b.before_avg)} {b.n_before ? `(n=${b.n_before})` : ''}
                  </td>
                  <td className="p-1 font-mono">
                    {fmt(b.after_avg)} {b.n_after ? `(n=${b.n_after})` : ''}
                  </td>
                  <td className="p-1 font-mono">
                    {b.delta === null ? '—' : (b.delta > 0 ? '+' : '') + b.delta.toFixed(1)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="mt-3 max-w-[80ch] text-xs text-muted-foreground">
          Área: {data?.question.label ?? 'sintoma'} (última resposta do dia)
          {showScore ? '; tracejada: score' : ''}; tracejada em cobre: ajuste de dose. Dia sem
          resposta aparece como lacuna.
        </p>
      </CardContent>
    </Card>
  );
}
