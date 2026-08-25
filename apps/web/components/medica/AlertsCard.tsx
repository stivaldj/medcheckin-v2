import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { fmtDateTime, SEVERITY_LABEL } from '@/lib/format';
import type { AlertRow } from '@medcheckin/core';
import { AlertActions } from './AlertActions';

type Alert = AlertRow;
type Conduct = {
  id: string;
  alert_id: string;
  action: string;
  note: string | null;
  at: string | Date;
  user_name: string | null;
  alert_title: string;
};
const SEV: Record<string, 'destructive' | 'default' | 'secondary' | 'outline'> = {
  critical: 'destructive',
  high: 'destructive',
  medium: 'default',
  low: 'secondary',
};

export function AlertsCard({ alerts, conducts }: { alerts: Alert[]; conducts: Conduct[] }) {
  return (
    <Card data-testid="alerts-card">
      <CardHeader>
        <CardTitle>Alertas abertos</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {alerts.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum alerta aberto.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {alerts.map((a) => (
              <li key={a.id} className="rounded-md border p-2" data-testid={`alert-${a.code}`}>
                <div className="flex items-center justify-between gap-2">
                  <span>
                    <Badge variant={SEV[a.severity] ?? 'outline'} className="mr-2">
                      {SEVERITY_LABEL[a.severity] ?? a.severity}
                    </Badge>
                    {a.title}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {fmtDateTime(a.last_seen_at)}
                  </span>
                </div>
                <AlertActions alertId={a.id} status={a.status} />
              </li>
            ))}
          </ul>
        )}
        <div data-testid="conducts">
          <h3 className="mb-1 text-sm font-medium">Condutas registradas</h3>
          {conducts.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nenhuma conduta ainda.</p>
          ) : (
            <ul className="space-y-1 text-xs">
              {conducts.map((c) => (
                <li key={c.id} className="rounded border p-2">
                  <span className="text-muted-foreground">{fmtDateTime(c.at)}</span> ·{' '}
                  {c.user_name ?? '—'} · <em>{c.alert_title}</em>
                  {c.note ? <div className="mt-0.5">{c.note}</div> : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
