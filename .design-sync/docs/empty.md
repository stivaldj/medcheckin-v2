---
category: layout
---
# Empty

Estado vazio. Use sempre que uma lista, card ou tabela puder vir sem dados — o app não deixa
área em branco sem explicação.

Composição: `Empty` > `EmptyHeader` (`EmptyMedia`, `EmptyTitle`, `EmptyDescription`) +
`EmptyContent` (ação de saída).

`EmptyMedia` tem `variant`: `default` · `icon` (círculo com o ícone dentro).

## Uso
```jsx
<Empty>
  <EmptyHeader>
    <EmptyMedia variant="icon"><InboxIcon /></EmptyMedia>
    <EmptyTitle>Nenhum alerta aberto</EmptyTitle>
    <EmptyDescription>Os alertas aparecem aqui quando um check-in cruza um limiar.</EmptyDescription>
  </EmptyHeader>
  <EmptyContent><Button variant="outline" size="sm">Revisar limiares</Button></EmptyContent>
</Empty>
```
