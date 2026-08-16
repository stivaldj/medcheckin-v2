import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { fmtDateTime } from '@/lib/format';

import type { AlertRow } from '@medcheckin/core';

type Alert = AlertRow;
const SEV: Record<string, 'destructive' | 'default' | 'secondary' | 'outline'> = {
  critical: 'destructive',
  high: 'destructive',
  medium: 'default',
  low: 'secondary',
};

export function AlertsCard({ alerts }: { alerts: Alert[] }) {
  return (
    <Card data-testid="alerts-card">
      <CardHeader>
        <CardTitle>Alertas abertos</CardTitle>
      </CardHeader>
      <CardContent>
        {alerts.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum alerta aberto.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {alerts.map((a) => (
              <li
                key={a.id}
                className="flex items-center justify-between gap-2 rounded-md border p-2"
              >
                <span>
                  <Badge variant={SEV[a.severity] ?? 'outline'} className="mr-2">
                    {a.severity}
                  </Badge>
                  {a.title}
                </span>
                <span className="text-xs text-muted-foreground">{fmtDateTime(a.last_seen_at)}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-muted-foreground">Registrar conduta e resolver: E6.</p>
      </CardContent>
    </Card>
  );
}
