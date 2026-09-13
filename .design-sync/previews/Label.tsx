import { Badge, Checkbox, Input, Label } from '@medcheckin/web';

export function ComCampo() {
  return (
    <div className="flex w-[320px] flex-col gap-2">
      <Label htmlFor="dose">Dose por tomada</Label>
      <Input id="dose" defaultValue="2 gotas" />
    </div>
  );
}

export function ComBadge() {
  return (
    <div className="w-[320px]">
      <Label htmlFor="mono">
        Concentração <Badge variant="outline">mg/ml</Badge>
      </Label>
      <Input id="mono" className="mt-2" defaultValue="200" />
    </div>
  );
}

export function ComControle() {
  return (
    <div className="w-[320px]">
      <Label>
        <Checkbox defaultChecked /> Notificar por push
      </Label>
    </div>
  );
}
