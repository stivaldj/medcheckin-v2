import {
  Button,
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@medcheckin/web';
import { InboxIcon } from 'lucide-react';

export function SemAlertas() {
  return (
    <div className="w-[420px]">
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <InboxIcon />
          </EmptyMedia>
          <EmptyTitle>Nenhum alerta aberto</EmptyTitle>
          <EmptyDescription>
            Os alertas aparecem aqui quando um check-in cruza um dos limiares configurados para a
            paciente.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline" size="sm">
            Revisar limiares
          </Button>
        </EmptyContent>
      </Empty>
    </div>
  );
}

export function SemAcao() {
  return (
    <div className="w-[420px]">
      <Empty>
        <EmptyHeader>
          <EmptyTitle>Sem check-ins neste período</EmptyTitle>
          <EmptyDescription>Ajuste o intervalo de datas para ver o histórico.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  );
}
