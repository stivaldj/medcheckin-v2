import { Gauge } from '@medcheckin/web';

export function Tons() {
  return (
    <div className="flex flex-wrap gap-4">
      <Gauge value={86} total={100} label="Adesão" sub="últimos 7 dias" tone="ok" />
      <Gauge value={54} total={100} label="Adesão" sub="últimos 7 dias" tone="medium" />
      <Gauge value={31} total={100} label="Adesão" sub="últimos 7 dias" tone="high" />
      <Gauge value={12} total={100} label="Adesão" sub="últimos 7 dias" tone="critical" />
    </div>
  );
}

export function Padrao() {
  return (
    <div className="flex gap-4">
      <Gauge value={12} total={14} label="Doses registradas" sub="na semana" />
      <Gauge value={7} total={null} label="Check-ins" sub="sem meta definida" />
    </div>
  );
}
