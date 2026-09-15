import Link from 'next/link';
import { UsersIcon } from 'lucide-react';
import { listPatients, listConditions } from '@medcheckin/core';

import { getDb } from '@/lib/db';
import { requireUserPage } from '@/lib/session';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ConditionsFilter } from '@/components/medica/ConditionsFilter';
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
import { fmt, fmtDateTime, EPISODE_LABEL, FREQ_LABEL, STATUS_LABEL, UUID_RE } from '@/lib/format';

export default async function PacientesPage({
  searchParams,
}: {
  searchParams: Promise<{ condition?: string }>;
}) {
  const { condition: rawCondition = '' } = await searchParams;
  const condition = UUID_RE.test(rawCondition) ? rawCondition : '';
  const session = await requireUserPage();
  const db = getDb();
  const [{ rows }, conds] = await Promise.all([
    listPatients(db, { clinicId: session.clinicId, condition: condition || null }, new Date()),
    listConditions(db, session.clinicId),
  ]);
  const ativos = rows.filter((p) => p.status === 'active').length;
  const comAlerta = rows.filter((p) => p.open_alerts > 0).length;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Pacientes</h1>
          {rows.length > 0 && (
            <p className="mt-1 text-sm text-muted-foreground">
              <span className="font-mono">{rows.length}</span>{' '}
              {condition ? 'com esta condição' : 'no total'} ·{' '}
              <span className="font-mono">{ativos}</span> em acompanhamento
              {comAlerta > 0 && (
                <>
                  {' '}
                  · <span className="font-mono text-sev-critical">{comAlerta}</span> com alerta
                  aberto
                </>
              )}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {conds.length > 0 && <ConditionsFilter options={conds} value={condition} />}
          <Button nativeButton={false} render={<Link href="/pacientes/novo" />}>
            Novo paciente
          </Button>
        </div>
      </div>
      {rows.length === 0 ? (
        <Empty className="rounded-xl border bg-card py-12">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <UsersIcon />
            </EmptyMedia>
            <EmptyTitle>
              {condition ? 'Nenhum paciente com essa condição.' : 'Nenhum paciente cadastrado'}
            </EmptyTitle>
            {!condition && (
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
                      <Badge variant={p.status === 'active' ? 'default' : 'secondary'}>
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
                      {p.medications.length === 0 ? (
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
        </div>
      )}
    </div>
  );
}
