import Link from 'next/link';
import { redirect } from 'next/navigation';
import { UsersIcon } from 'lucide-react';
import { listPatients, listConditions, type PatientListStatus } from '@medcheckin/core';

import { getDb } from '@/lib/db';
import { requireUserPage } from '@/lib/session';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PatientsToolbar } from '@/components/medica/PatientsToolbar';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  fmt,
  fmtDate,
  fmtDateTime,
  EPISODE_LABEL,
  FREQ_LABEL,
  STATUS_LABEL,
  UUID_RE,
} from '@/lib/format';

const VALID_STATUS = new Set(['following', 'registered', 'discharged', 'all', 'active', 'paused']);

export default async function PacientesPage({
  searchParams,
}: {
  searchParams: Promise<{ condition?: string; q?: string; status?: string; page?: string }>;
}) {
  const {
    condition: rawCondition = '',
    q: rawQ = '',
    status: rawStatus = '',
    page: rawPage = '',
  } = await searchParams;
  const condition = UUID_RE.test(rawCondition) ? rawCondition : '';
  const q = rawQ.trim();
  const status = (VALID_STATUS.has(rawStatus) ? rawStatus : 'following') as PatientListStatus;
  const page = Math.max(1, Number(rawPage) || 1);
  const session = await requireUserPage();
  const db = getDb();
  const [{ rows, total, pageSize }, conds] = await Promise.all([
    listPatients(
      db,
      { clinicId: session.clinicId, condition: condition || null, q, status, page },
      new Date(),
    ),
    listConditions(db, session.clinicId),
  ]);

  if (rows.length === 0 && total > 0) {
    const last = Math.ceil(total / pageSize);
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (status !== 'following') params.set('status', status);
    if (condition) params.set('condition', condition);
    if (last > 1) params.set('page', String(last));
    const s = params.toString();
    redirect(s ? `/pacientes?${s}` : '/pacientes');
  }

  const countLabel = q
    ? `encontrado${total === 1 ? '' : 's'}`
    : status === 'following'
      ? 'em acompanhamento'
      : status === 'registered'
        ? 'cadastrado' + (total === 1 ? '' : 's')
        : status === 'discharged'
          ? 'com alta'
          : 'no total';

  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);
  const hasPrev = page > 1;
  const hasNext = end < total;

  function pagerHref(targetPage: number) {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (status !== 'following') params.set('status', status);
    if (condition) params.set('condition', condition);
    if (targetPage > 1) params.set('page', String(targetPage));
    const s = params.toString();
    return s ? `/pacientes?${s}` : '/pacientes';
  }

  const emptyMessage = q
    ? 'Nenhum paciente com esse nome.'
    : status === 'registered'
      ? 'Nenhum paciente cadastrado por importação.'
      : condition
        ? 'Nenhum paciente com essa condição.'
        : 'Nenhum paciente cadastrado';

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Pacientes</h1>
          {total > 0 && (
            <p className="mt-1 text-sm text-muted-foreground">
              <span className="font-mono">{total}</span> {countLabel}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PatientsToolbar q={q} status={status} condition={condition} conditions={conds} />
          <Button nativeButton={false} render={<Link href="/pacientes/novo" />}>
            Novo paciente
          </Button>
        </div>
      </div>
      {total === 0 ? (
        <Empty className="rounded-xl border bg-card py-12">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <UsersIcon />
            </EmptyMedia>
            <EmptyTitle>{emptyMessage}</EmptyTitle>
            {!q && !condition && status === 'following' && (
              <EmptyDescription>
                O acompanhamento começa aqui: cadastre o paciente, convide quem responde e defina a
                rotina de alarmes.
              </EmptyDescription>
            )}
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Condições</TableHead>
                  <TableHead>Episódio</TableHead>
                  <TableHead>Dose vigente</TableHead>
                  <TableHead>Último check-in</TableHead>
                  <TableHead className="text-right">Alertas</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>
                      <Link
                        href={`/pacientes/${p.id}`}
                        className="font-medium underline-offset-2 hover:underline"
                      >
                        {p.name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          p.status === 'active'
                            ? 'default'
                            : p.status === 'registered'
                              ? 'outline'
                              : 'secondary'
                        }
                      >
                        {STATUS_LABEL[p.status] ?? p.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-[13px]">
                      {p.conditions.map((c) => c.name).join(', ') || '—'}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {p.episode
                        ? `${EPISODE_LABEL[p.episode.kind as string] ?? p.episode.kind} · ${FREQ_LABEL[p.episode.checkin_frequency as string] ?? p.episode.checkin_frequency}`
                        : '—'}
                    </TableCell>
                    <TableCell>
                      {p.status === 'registered' ? (
                        <span className="text-muted-foreground text-[13px]">
                          importado do Versatilis em{' '}
                          {fmtDate(p.imported_at, {
                            day: '2-digit',
                            month: '2-digit',
                            year: 'numeric',
                          })}
                        </span>
                      ) : p.medications.length === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        p.medications.map((m) => (
                          <div key={m.id} className="text-[13px]">
                            <span className="text-muted-foreground">{m.product_name}: </span>
                            {m.current_dose ? (
                              <span className="font-mono">
                                {fmt(m.current_dose.dose_amount)} {m.current_dose.dose_unit} ·{' '}
                                {m.current_dose.times_per_day}×/dia
                              </span>
                            ) : (
                              <span className="text-muted-foreground italic">sem dose vigente</span>
                            )}
                          </div>
                        ))
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-[13px] whitespace-nowrap text-muted-foreground">
                      {fmtDateTime(p.last_checkin_at)}
                    </TableCell>
                    <TableCell className="text-right">
                      {p.open_alerts > 0 ? (
                        <Badge variant="critical">{p.open_alerts}</Badge>
                      ) : (
                        <span className="font-mono text-muted-foreground">0</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div
            className="flex items-center justify-between gap-3 border-t px-4 py-2.5"
            data-testid="patients-pager"
          >
            <p className="text-sm text-muted-foreground">
              {start}–{end} de {total}
            </p>
            <div className="flex items-center gap-2">
              {hasPrev ? (
                <Button
                  variant="outline"
                  size="sm"
                  nativeButton={false}
                  render={<Link href={pagerHref(page - 1)} />}
                  data-testid="patients-prev"
                >
                  Anterior
                </Button>
              ) : (
                <Button variant="outline" size="sm" disabled data-testid="patients-prev">
                  Anterior
                </Button>
              )}
              {hasNext ? (
                <Button
                  variant="outline"
                  size="sm"
                  nativeButton={false}
                  render={<Link href={pagerHref(page + 1)} />}
                  data-testid="patients-next"
                >
                  Próxima
                </Button>
              ) : (
                <Button variant="outline" size="sm" disabled data-testid="patients-next">
                  Próxima
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
