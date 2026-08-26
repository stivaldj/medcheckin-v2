import Link from 'next/link';
import { AlertTriangleIcon, CheckIcon, ClockIcon, SendHorizonalIcon } from 'lucide-react';
import { dashboardToday } from '@medcheckin/core';

import { getDb } from '@/lib/db';
import { requireUserPage } from '@/lib/session';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemSeparator,
  ItemTitle,
} from '@/components/ui/item';
import { Button } from '@/components/ui/button';
import { fmtDateTime, fmt, SEVERITY_LABEL, SEVERITY_VARIANT } from '@/lib/format';
import { AlertActions } from '@/components/medica/AlertActions';
import { Gauge } from '@/components/medica/Gauge';

export const dynamic = 'force-dynamic';

const hm = (v: unknown) =>
  v ? new Date(String(v)).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—';

const DIA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

function Secao({
  titulo,
  contagem,
  children,
}: {
  titulo: string;
  contagem?: number;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-baseline gap-2.5">
        <h2 className="text-[13px] font-semibold tracking-tight">{titulo}</h2>
        {contagem !== undefined && (
          <span className="font-mono text-xs text-muted-foreground">{contagem}</span>
        )}
        <div className="h-px flex-1 bg-border" />
      </div>
      {children}
    </section>
  );
}

export default async function HojePage() {
  const session = await requireUserPage();
  const d = await dashboardToday(getDb(), { clinicId: session.clinicId }, new Date());
  const minutesAgo = d.scheduler.last_cycle_at
    ? Math.round((Date.now() - new Date(d.scheduler.last_cycle_at).getTime()) / 60000)
    : null;
  const [ano, mes, dia] = d.date.split('-').map(Number);
  const semana = DIA[new Date(Date.UTC(ano, mes - 1, dia)).getUTCDay()];
  const enviados = d.completed_today + d.awaiting.length + d.missed_today.length;
  const naoRespondeu = d.awaiting.length + d.missed_today.length + d.pending_today.length;
  const precisaDeVoce = d.open_alerts.length + d.adherence.no_patients.length;
  const semAdesao = Math.max(0, d.completed_today - d.adherence.answered);

  return (
    <div className="space-y-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">
          Hoje <span className="text-muted-foreground">· {semana},</span>{' '}
          <span className="font-mono">{`${String(dia).padStart(2, '0')}/${String(mes).padStart(2, '0')}`}</span>
        </h1>
        {/* Leitura de instrumento: o ponto pulsa enquanto o ciclo está vivo. */}
        <div
          className="flex items-center gap-2 rounded-full border bg-card py-1 pr-3.5 pl-2.5 text-xs text-muted-foreground"
          data-testid="scheduler-status"
        >
          <span className="relative flex size-2 shrink-0">
            <span
              className={`size-2 rounded-full ${d.scheduler.stale ? 'bg-sev-critical' : 'bg-sev-low'}`}
            />
            {!d.scheduler.stale && (
              <span className="absolute inset-0 animate-ping rounded-full bg-sev-low opacity-60" />
            )}
          </span>
          {d.scheduler.last_cycle_at
            ? d.scheduler.stale
              ? `Scheduler parado: último ciclo há ${minutesAgo} min`
              : `Scheduler ativo · último ciclo há ${minutesAgo} min`
            : 'Scheduler nunca rodou'}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Gauge
          value={d.adherence.yes}
          total={d.adherence.answered}
          label="tomaram a medicação"
          sub={
            d.adherence.answered === 0
              ? 'ninguém respondeu a adesão hoje'
              : `pela pergunta de adesão · ${semAdesao > 0 ? `${fmt(semAdesao)} sem resposta` : 'todos responderam'}`
          }
          tone={d.adherence.no > 0 ? 'high' : 'ok'}
        />
        <Gauge
          value={d.completed_today}
          total={enviados || null}
          label="check-ins concluídos"
          sub={`${d.awaiting.length} aguardando · ${d.missed_today.length} perdido${d.missed_today.length === 1 ? '' : 's'}`}
        />
        <Gauge
          value={d.open_alerts.length}
          total={null}
          label="alertas abertos"
          sub={
            d.open_alerts.length === 0
              ? 'nenhum'
              : `${d.open_alerts.filter((a) => a.severity === 'critical').length} crítico · ${d.open_alerts.filter((a) => a.severity === 'high').length} alto`
          }
          tone={d.open_alerts.length > 0 ? 'critical' : 'ok'}
        />
      </div>

      <Secao titulo="Precisa de você agora" contagem={precisaDeVoce}>
        {precisaDeVoce === 0 ? (
          <Empty className="rounded-xl border bg-card py-8">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <CheckIcon />
              </EmptyMedia>
              <EmptyTitle>Nada exige decisão sua</EmptyTitle>
              <EmptyDescription>
                Nenhum alerta aberto e ninguém deixou de tomar a medicação hoje.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="space-y-2">
            {d.open_alerts.length > 0 && (
              <ItemGroup className="rounded-xl border bg-card" data-testid="alerts-today">
                {d.open_alerts.map((a, i) => (
                  <div key={a.id}>
                    {i > 0 && <ItemSeparator />}
                    <Item size="sm" className="items-start" data-testid={`alert-${a.code}`}>
                      <ItemMedia variant="icon">
                        <AlertTriangleIcon
                          className={
                            a.severity === 'critical' || a.severity === 'high'
                              ? 'text-sev-critical'
                              : 'text-sev-medium'
                          }
                        />
                      </ItemMedia>
                      <ItemContent>
                        <ItemTitle className="flex-wrap">
                          <Badge variant={SEVERITY_VARIANT[a.severity] ?? 'outline'}>
                            {SEVERITY_LABEL[a.severity] ?? a.severity}
                          </Badge>
                          <Link href={`/pacientes/${a.patient_id}`} className="hover:underline">
                            {a.patient_name}
                          </Link>
                          <span className="font-normal text-muted-foreground">{a.title}</span>
                        </ItemTitle>
                        <AlertActions alertId={a.id} status={a.status} />
                      </ItemContent>
                      <ItemActions>
                        <span className="shrink-0 font-mono text-xs whitespace-nowrap text-muted-foreground">
                          {fmtDateTime(a.last_seen_at)}
                        </span>
                      </ItemActions>
                    </Item>
                  </div>
                ))}
              </ItemGroup>
            )}

            {/* A adesão só vira ação quando alguém disse "não" — o resto é número, e número mora no medidor. */}
            <div data-testid="adherence-card">
              {d.adherence.no_patients.length > 0 && (
                <ItemGroup className="rounded-xl border bg-card">
                  {d.adherence.no_patients.map((p, i) => (
                    <div key={p.patient_id}>
                      {i > 0 && <ItemSeparator />}
                      <Item size="sm">
                        <ItemMedia variant="icon">
                          <AlertTriangleIcon className="text-sev-high" />
                        </ItemMedia>
                        <ItemContent>
                          <ItemTitle>
                            <Link href={`/pacientes/${p.patient_id}`} className="hover:underline">
                              {p.patient_name}
                            </Link>
                          </ItemTitle>
                          <ItemDescription>não tomou as medicações hoje</ItemDescription>
                        </ItemContent>
                      </Item>
                    </div>
                  ))}
                </ItemGroup>
              )}
            </div>
          </div>
        )}
      </Secao>

      <Secao titulo="Não respondeu" contagem={naoRespondeu}>
        <div data-testid="awaiting-card">
          {naoRespondeu === 0 ? (
            <Empty className="rounded-xl border bg-card py-8">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <CheckIcon />
                </EmptyMedia>
                <EmptyTitle>Ninguém pendente</EmptyTitle>
                <EmptyDescription>
                  {d.completed_today === 0
                    ? 'Nenhum check-in enviado hoje ainda.'
                    : `Os ${d.completed_today} check-ins de hoje foram respondidos.`}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <ItemGroup className="rounded-xl border bg-card">
              {d.awaiting.map((a, i) => (
                <div key={a.checkin_id}>
                  {i > 0 && <ItemSeparator />}
                  <Item size="sm">
                    <ItemMedia variant="icon">
                      <SendHorizonalIcon />
                    </ItemMedia>
                    <ItemContent>
                      <ItemTitle>
                        <Link href={`/pacientes/${a.patient_id}`} className="hover:underline">
                          {a.patient_name}
                        </Link>
                        {a.status === 'in_progress' && (
                          <Badge variant="outline">em andamento</Badge>
                        )}
                      </ItemTitle>
                    </ItemContent>
                    <ItemActions>
                      <span className="font-mono text-xs whitespace-nowrap text-muted-foreground">
                        enviado {hm(a.sent_at)} · tentativa {a.attempt_count}
                      </span>
                    </ItemActions>
                  </Item>
                </div>
              ))}
              {d.missed_today.map((m) => (
                <div key={m.checkin_id}>
                  <ItemSeparator />
                  <Item size="sm">
                    <ItemMedia variant="icon">
                      <ClockIcon className="text-sev-critical" />
                    </ItemMedia>
                    <ItemContent>
                      <ItemTitle>
                        <Link href={`/pacientes/${m.patient_id}`} className="hover:underline">
                          {m.patient_name}
                        </Link>
                        <Badge variant="critical">perdido</Badge>
                      </ItemTitle>
                    </ItemContent>
                  </Item>
                </div>
              ))}
              {/* Auditoria P1-1: pendente com falha de entrega aparece nomeado, não só como número. */}
              {d.pending_today.map((p) => (
                <div key={p.checkin_id}>
                  <ItemSeparator />
                  <Item
                    size="sm"
                    data-testid={p.delivery_failed ? 'pending-failed' : 'pending-waiting'}
                  >
                    <ItemMedia variant="icon">
                      <ClockIcon className={p.delivery_failed ? 'text-sev-critical' : undefined} />
                    </ItemMedia>
                    <ItemContent>
                      <ItemTitle>
                        <Link href={`/pacientes/${p.patient_id}`} className="hover:underline">
                          {p.patient_name}
                        </Link>
                      </ItemTitle>
                      {p.delivery_failed && (
                        <ItemDescription className="text-sev-critical">
                          falha na entrega — verifique as notificações do paciente
                        </ItemDescription>
                      )}
                    </ItemContent>
                    <ItemActions>
                      {p.delivery_failed ? (
                        <Button
                          size="sm"
                          variant="outline"
                          nativeButton={false}
                          render={<Link href={`/pacientes/${p.patient_id}`} />}
                        >
                          Ver respondentes
                        </Button>
                      ) : (
                        <span className="font-mono text-xs whitespace-nowrap text-muted-foreground">
                          aguarda envio {hm(p.next_attempt_at)}
                        </span>
                      )}
                    </ItemActions>
                  </Item>
                </div>
              ))}
            </ItemGroup>
          )}
        </div>
      </Secao>

      <Secao titulo="Só informação">
        <Collapsible>
          <div className="rounded-xl border bg-card" data-testid="upcoming-card">
            <CollapsibleTrigger
              render={
                <Button variant="ghost" className="h-auto w-full justify-start gap-2.5 px-4 py-3">
                  <ClockIcon />
                  Próximos envios nas 24 h
                  <span className="font-mono text-xs text-muted-foreground">
                    {d.upcoming.length}
                  </span>
                </Button>
              }
            />
            <CollapsibleContent>
              <div className="border-t px-4 py-2">
                {d.upcoming.length === 0 ? (
                  <p className="py-2 text-sm text-muted-foreground">
                    Nada agendado nas próximas 24 h.
                  </p>
                ) : (
                  <ul className="divide-y divide-dashed">
                    {d.upcoming.slice(0, 20).map((u, i) => (
                      <li key={i} className="flex flex-wrap justify-between gap-2 py-2 text-sm">
                        <span>
                          <span className="font-mono text-muted-foreground">
                            {fmtDateTime(u.at)}
                          </span>{' '}
                          · {u.patient_name}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {u.kind === 'alarm' ? `alarme · ${u.detail}` : u.detail}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </CollapsibleContent>
          </div>
        </Collapsible>
      </Secao>
    </div>
  );
}
