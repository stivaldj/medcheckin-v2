import { BellOffIcon } from 'lucide-react';

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
  Item,
  ItemContent,
  ItemFooter,
  ItemGroup,
  ItemHeader,
  ItemSeparator,
  ItemTitle,
} from '@/components/ui/item';
import { fmtDateTime, SEVERITY_LABEL, SEVERITY_VARIANT } from '@/lib/format';
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

export function AlertsCard({ alerts, conducts }: { alerts: Alert[]; conducts: Conduct[] }) {
  return (
    <Card data-testid="alerts-card">
      <CardHeader>
        <CardTitle>
          Alertas abertos <span className="text-muted-foreground">({alerts.length})</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {alerts.length === 0 ? (
          <Empty className="py-6">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <BellOffIcon />
              </EmptyMedia>
              <EmptyTitle>Nenhum alerta aberto</EmptyTitle>
              <EmptyDescription>Nada exige decisão sua neste paciente agora.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ItemGroup>
            {alerts.map((a, i) => (
              <Item key={a.id} size="sm" data-testid={`alert-${a.code}`}>
                {i > 0 && <ItemSeparator />}
                <ItemContent>
                  <ItemHeader>
                    <ItemTitle className="flex-1 flex-wrap">
                      <Badge variant={SEVERITY_VARIANT[a.severity] ?? 'outline'}>
                        {SEVERITY_LABEL[a.severity] ?? a.severity}
                      </Badge>
                      {a.title}
                    </ItemTitle>
                    <span className="shrink-0 font-mono text-xs whitespace-nowrap text-muted-foreground">
                      {fmtDateTime(a.last_seen_at)}
                    </span>
                  </ItemHeader>
                  <ItemFooter>
                    <AlertActions alertId={a.id} status={a.status} />
                  </ItemFooter>
                </ItemContent>
              </Item>
            ))}
          </ItemGroup>
        )}

        <div data-testid="conducts">
          <h3 className="mb-2 text-sm font-medium">Condutas registradas</h3>
          {conducts.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nenhuma conduta ainda.</p>
          ) : (
            <ol className="space-y-0">
              {conducts.map((c, i) => (
                <li
                  key={c.id}
                  className={`grid grid-cols-[7.5rem_1fr] gap-3 py-2 text-xs ${i > 0 ? 'border-t border-dashed' : ''}`}
                >
                  <span className="font-mono text-muted-foreground">{fmtDateTime(c.at)}</span>
                  <span>
                    <span className="text-muted-foreground">{c.user_name ?? '—'} · </span>
                    <em>{c.alert_title}</em>
                    {c.note ? <span className="mt-0.5 block text-foreground">{c.note}</span> : null}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
