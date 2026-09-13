---
category: layout
---
# Item

Linha de lista composta — a unidade de listagem quando o conteúdo é rico demais para uma
`Table` e leve demais para um `Card`.

Composição: `ItemGroup` > `Item` > `ItemMedia` (ícone/avatar) + `ItemContent`
(`ItemTitle`, `ItemDescription`) + `ItemActions`. `ItemSeparator` divide itens;
`ItemHeader`/`ItemFooter` acrescentam faixas acima e abaixo.

`variant` em `Item`: `default` · `outline` · `muted`.

## Uso
```jsx
<ItemGroup>
  <Item variant="outline">
    <ItemMedia><PillIcon /></ItemMedia>
    <ItemContent>
      <ItemTitle>CBD 200mg/ml</ItemTitle>
      <ItemDescription>2 gotas, 2× ao dia</ItemDescription>
    </ItemContent>
    <ItemActions><Button size="xs" variant="ghost">Editar</Button></ItemActions>
  </Item>
</ItemGroup>
```
