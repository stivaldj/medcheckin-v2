import { Button } from '@medcheckin/web';
import { PlusIcon, TrashIcon, PrinterIcon } from 'lucide-react';

export function Variantes() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button>Registrar dose</Button>
      <Button variant="outline">Editar rotina</Button>
      <Button variant="secondary">Duplicar</Button>
      <Button variant="ghost">Cancelar</Button>
      <Button variant="destructive">Anonimizar paciente</Button>
      <Button variant="link">Ver histórico</Button>
    </div>
  );
}

export function Tamanhos() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="xs">xs</Button>
      <Button size="sm">sm</Button>
      <Button size="default">default</Button>
      <Button size="lg">lg</Button>
    </div>
  );
}

export function ComIcone() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button>
        <PlusIcon /> Nova pergunta
      </Button>
      <Button variant="outline">
        <PrinterIcon /> Imprimir resumo
      </Button>
      <Button variant="destructive">
        <TrashIcon /> Excluir
      </Button>
    </div>
  );
}

export function SomenteIcone() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="icon-xs" variant="ghost" aria-label="Adicionar">
        <PlusIcon />
      </Button>
      <Button size="icon-sm" variant="outline" aria-label="Imprimir">
        <PrinterIcon />
      </Button>
      <Button size="icon" aria-label="Adicionar">
        <PlusIcon />
      </Button>
    </div>
  );
}

export function Desabilitado() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button disabled>Salvar</Button>
      <Button variant="outline" disabled>
        Editar
      </Button>
      <Button variant="destructive" disabled>
        Excluir
      </Button>
    </div>
  );
}
