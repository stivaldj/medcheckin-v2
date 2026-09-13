import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@medcheckin/web';
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts';

const DADOS = [
  { dia: '06/03', dor: 7, sono: 4 },
  { dia: '07/03', dor: 6, sono: 5 },
  { dia: '08/03', dor: 6, sono: 6 },
  { dia: '09/03', dor: 5, sono: 6 },
  { dia: '10/03', dor: 4, sono: 7 },
  { dia: '11/03', dor: 4, sono: 8 },
  { dia: '12/03', dor: 3, sono: 8 },
];

const CONFIG = {
  dor: { label: 'Dor', color: 'var(--chart-1)' },
  sono: { label: 'Sono', color: 'var(--chart-2)' },
};

export function SerieDiaria() {
  return (
    <div className="w-[520px]">
      <ChartContainer
        config={CONFIG}
        className="h-[240px] w-full"
        initialDimension={{ width: 520, height: 240 }}
      >
        <LineChart data={DADOS} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="dia" tickLine={false} axisLine={false} tickMargin={8} />
          <YAxis domain={[0, 10]} tickLine={false} axisLine={false} width={28} />
          <ChartTooltip content={<ChartTooltipContent />} />
          <Line dataKey="dor" stroke="var(--color-dor)" strokeWidth={2} dot={false} isAnimationActive={false} />
          <Line dataKey="sono" stroke="var(--color-sono)" strokeWidth={2} dot={false} isAnimationActive={false} />
        </LineChart>
      </ChartContainer>
    </div>
  );
}
