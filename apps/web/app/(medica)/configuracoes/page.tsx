import Link from 'next/link';
import { getSystemState, STATE_KEYS, RETENTION_DEFAULTS } from '@medcheckin/core';
import { getDb } from '@/lib/db';
import { requireUserPage } from '@/lib/session';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
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
import { UserPlusIcon } from 'lucide-react';
import { fmtDateTime } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function ConfiguracoesPage() {
  const session = await requireUserPage();
  const db = getDb();
  const clinic = await db('clinics').where({ id: session.clinicId }).first();
  const respondents = await db('respondents as r')
    .join('patients as p', 'p.id', 'r.patient_id')
    .where('p.clinic_id', session.clinicId)
    .orderBy('p.name')
    .orderBy('r.created_at')
    .select(
      'r.id',
      'r.kind',
      'r.name',
      'r.relationship',
      'r.accepted_at',
      'r.consent_version',
      'p.id as patient_id',
      'p.name as patient_name',
    );
  const subs = await db('push_subscriptions as s')
    .join('respondents as r', 'r.id', 's.respondent_id')
    .join('patients as p', 'p.id', 'r.patient_id')
    .where('p.clinic_id', session.clinicId)
    .whereNull('s.revoked_at')
    .select('r.id as respondent_id')
    .count('* as n')
    .groupBy('r.id');
  const subBy = Object.fromEntries(subs.map((s) => [String(s.respondent_id), Number(s.n)]));
  const state = await getSystemState(db);
  const stale =
    !state[STATE_KEYS.lastCycle] ||
    Date.now() - new Date(String(state[STATE_KEYS.lastCycle])).getTime() > 10 * 60000;
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Configurações</h1>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Perfil</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <p>
              <strong>{session.name}</strong> · {session.email} · {session.role}
            </p>
            <p className="text-muted-foreground">
              Clínica: {clinic?.name} · fuso {clinic?.timezone}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              Acesso por link mágico no e-mail. Não há senha.
            </p>
          </CardContent>
        </Card>
        <Card data-testid="system-card">
          <CardHeader>
            <CardTitle>Sistema</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center gap-2">
              <span className="relative flex size-2 shrink-0">
                <span
                  className={`size-2 rounded-full ${stale ? 'bg-sev-critical' : 'bg-sev-low'}`}
                />
                {!stale && (
                  <span className="absolute inset-0 animate-ping rounded-full bg-sev-low opacity-60" />
                )}
              </span>
              <span className="font-medium">Scheduler {stale ? 'parado' : 'ativo'}</span>
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]">
              <dt className="text-muted-foreground">Último ciclo</dt>
              <dd className="font-mono">{fmtDateTime(state[STATE_KEYS.lastCycle])}</dd>
              <dt className="text-muted-foreground">Alertas avaliados</dt>
              <dd className="font-mono">{fmtDateTime(state[STATE_KEYS.lastAlerts])}</dd>
              <dt className="text-muted-foreground">Retenção aplicada</dt>
              <dd className="font-mono">{fmtDateTime(state[STATE_KEYS.lastRetention])}</dd>
            </dl>
            <p>
              Push:{' '}
              {process.env.VAPID_PUBLIC_KEY ? (
                <Badge>configurado</Badge>
              ) : (
                <Badge variant="destructive">sem VAPID</Badge>
              )}{' '}
              · E-mail:{' '}
              {process.env.MAIL_TRANSPORT === 'fake'
                ? 'fake (dev)'
                : process.env.SMTP_HOST
                  ? 'SMTP'
                  : 'não configurado'}
            </p>
            <p className="text-xs text-muted-foreground">
              Retenção: notificações {RETENTION_DEFAULTS.notificationsDays} d · sessões{' '}
              {RETENTION_DEFAULTS.sessionsDays} d · tokens {RETENTION_DEFAULTS.authTokensDays} d ·
              auditoria {RETENTION_DEFAULTS.accessAuditDays} d. Ver docs/LGPD.md.
            </p>
          </CardContent>
        </Card>
      </div>
      <Card data-testid="respondents-card">
        <CardHeader>
          <CardTitle>Respondentes convidados</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          {respondents.length === 0 ? (
            <Empty className="py-8">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <UserPlusIcon />
                </EmptyMedia>
                <EmptyTitle>Ninguém convidado ainda</EmptyTitle>
                <EmptyDescription>
                  Sem respondente aceito, nenhum check-in chega a lugar nenhum.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Paciente</TableHead>
                    <TableHead>Respondente</TableHead>
                    <TableHead>Convite</TableHead>
                    <TableHead>Consentimento</TableHead>
                    <TableHead>Push</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {respondents.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>
                        <Link
                          href={`/pacientes/${r.patient_id}`}
                          className="font-medium underline-offset-2 hover:underline"
                        >
                          {r.patient_name}
                        </Link>
                      </TableCell>
                      <TableCell>
                        {r.name}{' '}
                        <span className="text-muted-foreground">
                          ({r.kind === 'patient' ? 'paciente' : r.relationship || 'cuidador'})
                        </span>
                      </TableCell>
                      <TableCell>
                        {r.accepted_at ? (
                          <Badge variant="low">aceito {fmtDateTime(r.accepted_at)}</Badge>
                        ) : (
                          <Badge variant="secondary">pendente</Badge>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-[13px]">
                        {r.consent_version ?? '—'}
                      </TableCell>
                      <TableCell className="text-[13px] text-muted-foreground">
                        {subBy[r.id] ? `${subBy[r.id]} dispositivo(s)` : '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
