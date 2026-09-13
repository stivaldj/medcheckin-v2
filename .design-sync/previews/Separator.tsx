import { Separator } from '@medcheckin/web';

export function Horizontal() {
  return (
    <div className="w-[360px] text-sm">
      <div className="pb-3 font-medium">Prescrição</div>
      <Separator />
      <div className="pt-3 text-muted-foreground">CBD 200mg/ml — 2 gotas, 2× ao dia</div>
    </div>
  );
}

export function Vertical() {
  return (
    <div className="flex h-5 items-center gap-3 text-sm text-muted-foreground">
      <span>Hoje</span>
      <Separator orientation="vertical" />
      <span>7 dias</span>
      <Separator orientation="vertical" />
      <span>30 dias</span>
    </div>
  );
}
