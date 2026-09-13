---
category: formulario
---
# SimpleSelect

Select de uma escolha só — a forma de praticamente todo select do app. Existe para o call site
caber numa linha: eram 14 blocos idênticos de oito linhas, um convite a divergirem entre si.

Props: `value`, `onValueChange(value: string)`, `options: { value, label }[]`,
`placeholder`, `size` (`sm` · `default`), `className`, mais as props de `<button>` que
vão para o gatilho.

```jsx
<SimpleSelect
  value={periodo}
  onValueChange={setPeriodo}
  options={[
    { value: 'manha', label: 'Manhã' },
    { value: 'noite', label: 'Noite' },
  ]}
  placeholder="Período"
/>
```
