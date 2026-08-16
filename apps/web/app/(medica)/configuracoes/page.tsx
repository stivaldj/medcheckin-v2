import Link from 'next/link';
import { getSystemState, STATE_KEYS, RETENTION_DEFAULTS } from '@medcheckin/core';
import { getDb } from '@/lib/db';
import { requireUserPage } from '@/lib/session';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
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
      <h1 className="text-2xl font-semibold">Configurações</h1>
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
          <CardContent className="space-y-1 text-sm">
            <p>
              Scheduler:{' '}
              <Badge variant={stale ? 'destructive' : 'default'}>
                {stale ? 'parado' : 'ativo'}
              </Badge>{' '}
              último ciclo {fmtDateTime(state[STATE_KEYS.lastCycle])}
            </p>
            <p>Alertas avaliados: {fmtDateTime(state[STATE_KEYS.lastAlerts])}</p>
            <p>Retenção aplicada: {fmtDateTime(state[STATE_KEYS.lastRetention])}</p>
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
        <CardContent>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="p-1">Paciente</th>
                <th className="p-1">Respondente</th>
                <th className="p-1">Convite</th>
                <th className="p-1">Consentimento</th>
                <th className="p-1">Push</th>
              </tr>
            </thead>
            <tbody>
              {respondents.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="p-1">
                    <Link href={`/pacientes/${r.patient_id}`} className="hover:underline">
                      {r.patient_name}
                    </Link>
                  </td>
                  <td className="p-1">
                    {r.name}{' '}
                    <span className="text-muted-foreground">
                      ({r.kind === 'patient' ? 'paciente' : r.relationship || 'cuidador'})
                    </span>
                  </td>
                  <td className="p-1">
                    {r.accepted_at ? (
                      <Badge>aceito {fmtDateTime(r.accepted_at)}</Badge>
                    ) : (
                      <Badge variant="secondary">pendente</Badge>
                    )}
                  </td>
                  <td className="p-1">{r.consent_version ?? '—'}</td>
                  <td className="p-1">{subBy[r.id] ? `${subBy[r.id]} dispositivo(s)` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
