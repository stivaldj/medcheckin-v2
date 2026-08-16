import { notFound } from 'next/navigation';
import { patientReport, AuthError } from '@medcheckin/core';
import { getDb } from '@/lib/db';
import { requireUserPage } from '@/lib/session';
import { fmt, fmtDate, fmtDateTime, isoDay } from '@/lib/format';
import { PrintButton } from '@/components/medica/PrintButton';

export const dynamic = 'force-dynamic';
const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`);

export default async function RelatorioPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ days?: string }>;
}) {
  const { id } = await params;
  const { days } = await searchParams;
  const session = await requireUserPage();
  let r;
  try {
    r = await patientReport(getDb(), session, id, { days: Number(days ?? 30), now: new Date() });
  } catch (err) {
    if (err instanceof AuthError && err.code === 'not_found') notFound();
    throw err;
  }
  return (
    <div className="mx-auto max-w-3xl space-y-6 print:max-w-none" data-testid="report">
      <style>{`@media print { header, nav, .no-print { display: none !important; } main { padding: 0 } body { font-size: 12px } }`}</style>
      <div className="flex items-start justify-between no-print">
        <a href={`/pacientes/${id}`} className="text-sm underline">
          ← voltar ao paciente
        </a>
        <PrintButton />
      </div>
      <header>
        <h1 className="text-2xl font-semibold">Relatório de acompanhamento — {r.patient.name}</h1>
        <p className="text-sm text-muted-foreground">
          Período {r.period.from.split('-').reverse().join('/')} a{' '}
          {r.period.to.split('-').reverse().join('/')} ({r.period.days} dias) · gerado em{' '}
          {fmtDateTime(r.period.generated_at)} · nasc.{' '}
          {fmtDate(r.patient.birth_date, { day: '2-digit', month: '2-digit', year: 'numeric' })}
          {r.patient.condition_tags?.length ? ` · ${r.patient.condition_tags.join(', ')}` : ''}
        </p>
      </header>

      <section className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat
          label="Check-ins respondidos"
          value={`${r.checkins.completed}/${r.checkins.sent}`}
          sub={`taxa ${pct(r.checkins.completion_rate)} · perdidos ${r.checkins.missed}`}
          testid="stat-checkins"
        />
        <Stat
          label="Adesão (confirmações)"
          value={pct(r.adherence.rate)}
          sub={`tomou ${r.adherence.taken + r.adherence.late} · não tomou ${r.adherence.skipped} · sem confirmação ${r.adherence.unconfirmed} de ${r.adherence.scheduled}`}
          testid="stat-adherence"
        />
        <Stat
          label="Score médio"
          value={fmt(r.scores.mean)}
          sub={`n=${r.scores.n} · último ${fmt(r.scores.last)}${r.scores.risk_last ? ` (${r.scores.risk_last})` : ''}`}
          testid="stat-score"
        />
        <Stat
          label="Efeitos adversos"
          value={String(r.side_effects.length)}
          sub={
            r.side_effects.length
              ? r.side_effects
                  .map((s) => s.detail)
                  .slice(0, 3)
                  .join(', ')
              : 'nenhum relatado'
          }
          testid="stat-side"
        />
      </section>

      <section>
        <h2 className="mb-2 text-lg font-medium">Sintomas (última resposta do dia)</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="p-1">Pergunta</th>
              <th className="p-1">n</th>
              <th className="p-1">média</th>
              <th className="p-1">mín</th>
              <th className="p-1">máx</th>
              <th className="p-1">última</th>
            </tr>
          </thead>
          <tbody>
            {r.symptoms.map((s) => (
              <tr key={s.key} className="border-t">
                <td className="p-1">{s.label}</td>
                <td className="p-1">{s.n}</td>
                <td className="p-1">{fmt(s.mean)}</td>
                <td className="p-1">{fmt(s.min)}</td>
                <td className="p-1">{fmt(s.max)}</td>
                <td className="p-1">{fmt(s.last)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2 className="mb-2 text-lg font-medium">Doses (histórico completo)</h2>
        <ul className="text-sm">
          {r.doses.length === 0 && (
            <li className="text-muted-foreground">Nenhum ajuste registrado.</li>
          )}
          {r.doses.map((d, i) => (
            <li key={i}>
              {d.effective_from.split('-').reverse().join('/')} · {d.product_name}:{' '}
              {fmt(d.dose_amount)} {d.dose_unit} · {d.times_per_day}×/dia (
              {d.schedule_times.map((t) => String(t).slice(0, 5)).join(', ')})
              {d.reason ? ` — ${d.reason}` : ''}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="mb-2 text-lg font-medium">Alertas e condutas no período</h2>
        {r.alerts.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum alerta no período.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {r.alerts.map((a) => (
              <li key={a.id} className="border-t pt-1">
                <span className="font-medium">{fmtDate(a.created_at)}</span> · {a.severity} ·{' '}
                {a.title} · <em>{a.status}</em>
                {a.actions
                  .filter((x) => x.note)
                  .map((x) => (
                    <div key={x.id} className="ml-4 text-muted-foreground">
                      ↳ {fmtDateTime(x.at)} {x.user_name ?? ''}: {x.note}
                    </div>
                  ))}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-lg font-medium">Score diário</h2>
        {r.scores.series.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sem scores no período.</p>
        ) : (
          <p className="text-sm">
            {r.scores.series
              .map(
                (s) =>
                  `${isoDay(s.date).slice(8, 10)}/${isoDay(s.date).slice(5, 7)}: ${fmt(s.score)}`,
              )
              .join(' · ')}
          </p>
        )}
      </section>
      <p className="text-xs text-muted-foreground">
        “—” = sem dado. Adesão considera apenas confirmações feitas pelo respondente (envio de
        alarme não conta como tomada).
      </p>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  testid,
}: {
  label: string;
  value: string;
  sub: string;
  testid: string;
}) {
  return (
    <div className="rounded-md border p-3" data-testid={testid}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-semibold">{value}</div>
      <div className="text-xs text-muted-foreground">{sub}</div>
    </div>
  );
}
