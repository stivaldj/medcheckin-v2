---
category: formulario
---
# Field

Andaime de formulário: rótulo, controle, descrição e erro com o espaçamento certo entre eles.

Composição: `FieldSet` > `FieldLegend` + `FieldGroup` > `Field` > `FieldLabel` +
controle + `FieldDescription` + `FieldError`. `FieldContent` agrupa rótulo e descrição
quando a orientação é horizontal; `FieldSeparator` divide blocos e aceita conteúdo no meio
da linha (por exemplo "ou").

`Field` tem `orientation`: `vertical` (padrão) · `horizontal` · `responsive`.
`FieldError` aceita `errors` (lista) ou filhos livres.

## Uso
```jsx
<FieldSet>
  <FieldLegend>Prescrição</FieldLegend>
  <FieldGroup>
    <Field>
      <FieldLabel htmlFor="mg">Concentração</FieldLabel>
      <Input id="mg" />
      <FieldDescription>Em mg/ml, como está no rótulo do frasco.</FieldDescription>
    </Field>
  </FieldGroup>
</FieldSet>
```
