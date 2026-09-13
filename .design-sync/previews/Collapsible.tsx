import { Button, Collapsible, CollapsibleContent, CollapsibleTrigger } from '@medcheckin/web';

export function Aberto() {
  return (
    <div className="w-[420px]">
      <Collapsible defaultOpen>
        <CollapsibleTrigger render={<Button variant="ghost" size="sm">Detalhes da prescrição</Button>} />
        <CollapsibleContent className="pt-2 text-sm text-muted-foreground">
          Início em 02/03. Titulação semanal até 4 gotas. Reavaliar adesão em 30 dias.
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

export function Fechado() {
  return (
    <div className="w-[420px]">
      <Collapsible>
        <CollapsibleTrigger render={<Button variant="ghost" size="sm">Histórico de doses</Button>} />
        <CollapsibleContent className="pt-2 text-sm text-muted-foreground">
          Conteúdo oculto até o gatilho ser acionado.
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
