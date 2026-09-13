import { Badge } from '@medcheckin/web';

export function Severidade() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant="critical">Crítico</Badge>
      <Badge variant="high">Alto</Badge>
      <Badge variant="medium">Médio</Badge>
      <Badge variant="low">Baixo</Badge>
    </div>
  );
}

export function Variantes() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge>Ativo</Badge>
      <Badge variant="secondary">Em revisão</Badge>
      <Badge variant="outline">Rascunho</Badge>
      <Badge variant="destructive">Suspenso</Badge>
      <Badge variant="ghost">Arquivado</Badge>
    </div>
  );
}

export function NoContexto() {
  return (
    <div className="flex flex-col gap-2 text-sm">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">Dor lombar</span>
        <Badge variant="high">7/10</Badge>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">Sono</span>
        <Badge variant="low">2/10</Badge>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">Ansiedade</span>
        <Badge variant="critical">9/10</Badge>
      </div>
    </div>
  );
}
