---
category: formulario
---
# Label

Rótulo de campo. É um `<label>` em flex com `gap-2`, então um ícone ou `Badge` ao lado do
texto se alinha sozinho. Esmaece junto quando o campo irmão está desabilitado
(`peer-disabled`) ou dentro de um grupo `data-disabled`.

```jsx
<Label htmlFor="dose">Dose</Label>
<Input id="dose" />
```
