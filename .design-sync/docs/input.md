---
category: formulario
---
# Input

Campo de texto de uma linha (Base UI `Input`). Aceita todas as props de `<input>`, inclusive
`type`. Altura h-8, borda `--input`, anel de foco `--ring`; `aria-invalid` pinta a borda de
`--destructive` — é assim que o erro de formulário aparece.

```jsx
<Input placeholder="Nome da paciente" />
<Input type="number" aria-invalid defaultValue="999" />
```
