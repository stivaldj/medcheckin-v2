import Link from 'next/link';
import { dashboardToday } from '@medcheckin/core';
import { getDb } from '@/lib/db';
import { requireUserPage } from '@/lib/session';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { fmtDateTime, fmt, SEVERITY_LABEL } from '@/lib/format';
import { AlertActions } from '@/components/medica/AlertActions';

export const dynamic = 'force-dynamic';

const hm = (v: unknown) =>
  v ? new Date(String(v)).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—';

export default async function HojePage() {
  const session = await requireUserPage();
  const d = await dashboardToday(getDb(), { clinicId: session.clinicId }, new Date());
  const minutesAgo = d.scheduler.last_cycle_at
    ? Math.round((Date.now() - new Date(d.scheduler.last_cycle_at).getTime()) / 60000)
    : null;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Hoje · {d.date.split('-').reverse().join('/')}</h1>
        <div
          className={`rounded-md px-3 py-1 text-sm ${d.scheduler.stale ? 'bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground'}`}
          data-testid="scheduler-status"
        >
          {d.scheduler.last_cycle_at
            ? d.scheduler.stale
              ? `Scheduler parado: último ciclo há ${minutesAgo} min`
              : `Scheduler ativo · último ciclo há ${minutesAgo} min`
            : 'Scheduler nunca rodou'}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card data-testid="awaiting-card">
          <CardHeader>
            <CardTitle>
              Não respondeu <span className="text-muted-foreground">({d.awaiting.length})</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {d.awaiting.length === 0 &&
              d.missed_today.length === 0 &&
              d.pending_today.length === 0 && (
                <p className="text-muted-foreground">
                  Ninguém pendente. Concluídos hoje: {d.completed_today}.
                </p>
              )}
            {d.awaiting.map((a) => (
              <div
                key={a.checkin_id}
                className="flex items-center justify-between rounded-md border p-2"
              >
                <Link href={`/pacientes/${a.patient_id}`} className="font-medium hover:underline">
                  {a.patient_name}
                </Link>
                <span className="text-muted-foreground">
                  enviado {hm(a.sent_at)} · tentativa {a.attempt_count}
                  {a.status === 'in_progress' ? ' · em andamento' : ''}
                </span>
              </div>
            ))}
            {d.missed_today.map((m) => (
              <div
                key={m.checkin_id}
                className="flex items-center justify-between rounded-md border border-destructive/40 p-2"
              >
                <Link href={`/pacientes/${m.patient_id}`} className="font-medium hover:underline">
                  {m.patient_name}
                </Link>
                <Badge variant="destructive">perdido</Badge>
              </div>
            ))}
            {/* Auditoria P1-1: pendente com falha de entrega aparece nomeado, não só como número. */}
            {d.pending_today.map((p) => (
              <div
                key={p.checkin_id}
                className={`flex items-center justify-between rounded-md border p-2 ${p.delivery_failed ? 'border-destructive/40' : ''}`}
                data-testid={p.delivery_failed ? 'pending-failed' : 'pending-waiting'}
              >
                <Link href={`/pacientes/${p.patient_id}`} className="font-medium hover:underline">
                  {p.patient_name}
                </Link>
                {p.delivery_failed ? (
                  <span className="text-destructive">
                    falha na entrega — verifique as notificações do paciente
                  </span>
                ) : (
                  <span className="text-muted-foreground">
                    aguarda envio {hm(p.next_attempt_at)}
                  </span>
                )}
              </div>
            ))}
            {(d.awaiting.length > 0 || d.missed_today.length > 0) && (
              <p className="text-xs text-muted-foreground">Concluídos hoje: {d.completed_today}.</p>
            )}
          </CardContent>
        </Card>

        <Card data-testid="alerts-today">
          <CardHeader>
            <CardTitle>
              Alertas abertos{' '}
              <span className="text-muted-foreground">({d.open_alerts.length})</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {d.open_alerts.length === 0 && (
              <p className="text-muted-foreground">Nenhum alerta aberto.</p>
            )}
            {d.open_alerts.map((a) => (
              <div key={a.id} className="rounded-md border p-2" data-testid={`alert-${a.code}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    variant={
                      a.severity === 'critical' || a.severity === 'high' ? 'destructive' : 'default'
                    }
                  >
                    {SEVERITY_LABEL[a.severity] ?? a.severity}
                  </Badge>
                  <Link href={`/pacientes/${a.patient_id}`} className="font-medium hover:underline">
                    {a.patient_name}
                  </Link>
                  <span>{a.title}</span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {fmtDateTime(a.last_seen_at)}
                  </span>
                </div>
                <AlertActions alertId={a.id} status={a.status} />
              </div>
            ))}
          </CardContent>
        </Card>

        <Card data-testid="upcoming-card">
          <CardHeader>
            <CardTitle>
              Próximos envios (24 h){' '}
              <span className="text-muted-foreground">({d.upcoming.length})</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {d.upcoming.length === 0 && (
              <p className="text-muted-foreground">Nada agendado nas próximas 24 h.</p>
            )}
            {d.upcoming.slice(0, 20).map((u, i) => (
              <div key={i} className="flex justify-between">
                <span>
                  {fmtDateTime(u.at)} · {u.patient_name}
                </span>
                <span className="text-muted-foreground">
                  {u.kind === 'alarm' ? `alarme · ${u.detail}` : u.detail}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card data-testid="adherence-card">
          <CardHeader>
            <CardTitle>
              Adesão de hoje{' '}
              <span className="text-muted-foreground">
                ({d.adherence.yes}/{d.adherence.answered})
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="text-muted-foreground">
              Pela pergunta do check-in: tomou {fmt(d.adherence.yes)} · não tomou{' '}
              {fmt(d.adherence.no)} · sem resposta de adesão hoje{' '}
              {fmt(Math.max(0, d.completed_today - d.adherence.answered))}
            </p>
            {d.adherence.no_patients.map((p) => (
              <div
                key={p.patient_id}
                className="flex justify-between rounded-md border border-destructive/40 p-2"
              >
                <Link href={`/pacientes/${p.patient_id}`} className="font-medium hover:underline">
                  {p.patient_name}
                </Link>
                <span className="text-muted-foreground">não tomou as medicações hoje</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
