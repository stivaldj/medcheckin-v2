'use client';
import { useEffect, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { SymptomDoseSeries } from '@medcheckin/core';
import { api, ApiError } from '@/lib/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { fmt } from '@/lib/format';

type Q = { key: string; label: string; kind: string };

/** Espelha `ADHERENCE_QUESTION_KEY` do core (literal: o core é server-only, não entra no bundle). */
const ADHERENCE_KEY = 'adesao';

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
  return (
    <Card data-testid="chart-card">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle>Sintoma × dose</CardTitle>
        <div className="flex gap-2 text-sm">
          <select
            className="h-8 rounded-md border bg-background px-2"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            data-testid="chart-question"
          >
            {numeric.map((q) => (
              <option key={q.key} value={q.key}>
                {q.label}
              </option>
            ))}
          </select>
          <select
            className="h-8 rounded-md border bg-background px-2"
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
          >
            {[14, 30, 60, 90].map((d) => (
              <option key={d} value={d}>
                {d} dias
              </option>
            ))}
          </select>
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
          <div className="h-64" data-testid="chart" data-points={n} data-markers={markers.length}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={rows} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} />
                <YAxis
                  domain={fixedScale ? [0, 10] : ['auto', 'auto']}
                  tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                />
                <Tooltip
                  formatter={(v) => (v === null || v === undefined ? '—' : String(v))}
                  contentStyle={{
                    background: 'var(--popover)',
                    borderColor: 'var(--border)',
                    color: 'var(--popover-foreground)',
                    fontSize: 12,
                  }}
                />
                {/* Dia sem resposta = lacuna de verdade, não linha interpolada (regra: sem dado → "—"). */}
                <Line
                  type="monotone"
                  dataKey="value"
                  name={data.question.label}
                  stroke="#0f766e"
                  connectNulls={false}
                  dot={{ r: 3 }}
                />
                {showScore && (
                  <Line
                    type="monotone"
                    dataKey="score"
                    name="Score"
                    stroke="#94a3b8"
                    strokeDasharray="4 4"
                    connectNulls={false}
                    dot={false}
                  />
                )}
                {/* Rótulos escalonados em duas alturas para não sobrepor com ajustes próximos. */}
                {markers.map((m, i) => (
                  <ReferenceLine
                    key={m.id}
                    x={m.date.slice(5).split('-').reverse().join('/')}
                    stroke="#dc2626"
                    strokeDasharray="2 2"
                    label={{
                      value: `${fmt(m.dose_amount)} ${m.dose_unit}`,
                      position: i % 2 === 0 ? 'top' : 'insideTop',
                      fontSize: 11,
                      fill: '#dc2626',
                    }}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
        {data && data.beforeAfter.length > 0 && (
          <table className="mt-3 w-full text-xs" data-testid="before-after">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="p-1">Ajuste</th>
                <th className="p-1">Antes (7 d)</th>
                <th className="p-1">Depois (7 d)</th>
                <th className="p-1">Δ</th>
              </tr>
            </thead>
            <tbody>
              {data.beforeAfter.map((b) => (
                <tr key={String(b.dose_event_id)} className="border-t">
                  <td className="p-1">
                    {b.anchor_date?.split('-').reverse().join('/')} · {fmt(b.dose_amount)}{' '}
                    {String(b.dose_unit ?? '')}
                  </td>
                  <td className="p-1">
                    {fmt(b.before_avg)} {b.n_before ? `(n=${b.n_before})` : ''}
                  </td>
                  <td className="p-1">
                    {fmt(b.after_avg)} {b.n_after ? `(n=${b.n_after})` : ''}
                  </td>
                  <td className="p-1">
                    {b.delta === null ? '—' : (b.delta > 0 ? '+' : '') + b.delta.toFixed(1)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="mt-2 text-xs text-muted-foreground">
          Linha cheia: {data?.question.label ?? 'sintoma'} (última resposta do dia)
          {showScore ? '; tracejada: score' : ''}; vermelho: ajuste de dose. Dia sem resposta
          aparece como lacuna.
        </p>
      </CardContent>
    </Card>
  );
}
