---
category: dados
---
# Chart

Casca do Recharts com os tokens do MedCheck-in. `ChartContainer` recebe um `config`
(`ChartConfig`: por série, `label`, `icon`, `color` ou `theme`) e injeta as variáveis
`--color-<serie>` que os elementos do Recharts consomem.

`ChartTooltip` = `Tooltip` do Recharts; o conteúdo bonito é `ChartTooltipContent`
(`indicator`: `dot` · `line` · `dashed`; `hideLabel`, `hideIndicator`, `nameKey`,
`labelKey`). Mesma ideia em `ChartLegend` / `ChartLegendContent`.

```jsx
<ChartContainer config={{ dor: { label: 'Dor', color: 'var(--chart-1)' } }}>
  <LineChart data={dados}>
    <ChartTooltip content={<ChartTooltipContent />} />
    <Line dataKey="dor" stroke="var(--color-dor)" />
  </LineChart>
</ChartContainer>
```
