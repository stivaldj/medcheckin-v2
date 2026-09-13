import { Checkbox, Label } from '@medcheckin/web';

export function Estados() {
  return (
    <div className="flex flex-col gap-3">
      <Label>
        <Checkbox /> Não marcado
      </Label>
      <Label>
        <Checkbox defaultChecked /> Marcado
      </Label>
      <Label>
        <Checkbox disabled /> Desabilitado
      </Label>
      <Label>
        <Checkbox defaultChecked disabled /> Marcado e desabilitado
      </Label>
    </div>
  );
}

export function Lista() {
  return (
    <div className="flex w-[320px] flex-col gap-2 text-sm">
      <Label>
        <Checkbox defaultChecked /> Dor
      </Label>
      <Label>
        <Checkbox defaultChecked /> Sono
      </Label>
      <Label>
        <Checkbox /> Apetite
      </Label>
      <Label>
        <Checkbox /> Ansiedade
      </Label>
    </div>
  );
}
