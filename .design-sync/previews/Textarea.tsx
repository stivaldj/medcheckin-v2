import { Textarea } from '@medcheckin/web';

export function Estados() {
  return (
    <div className="flex w-[380px] flex-col gap-3">
      <Textarea placeholder="Observações da consulta" />
      <Textarea defaultValue="Paciente relata melhora no sono a partir da segunda semana. Manter dose noturna e reavaliar em 15 dias." />
      <Textarea defaultValue="Campo bloqueado" disabled />
    </div>
  );
}
