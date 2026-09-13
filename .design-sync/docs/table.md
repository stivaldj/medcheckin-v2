---
category: dados
---
# Table

Tabela de dados. `Table` já vem embrulhada num container com rolagem horizontal, então não
precisa de wrapper próprio.

Composição HTML padrão: `Table` > `TableHeader` > `TableRow` > `TableHead`, e
`TableBody` > `TableRow` > `TableCell`. `TableFooter` para totais, `TableCaption` para
a legenda abaixo.

```jsx
<Table>
  <TableHeader>
    <TableRow><TableHead>Data</TableHead><TableHead>Sintoma</TableHead></TableRow>
  </TableHeader>
  <TableBody>
    <TableRow><TableCell>12/03</TableCell><TableCell>Dor 7/10</TableCell></TableRow>
  </TableBody>
</Table>
```

Em card de preview, tabelas são largas: use `cardMode: "column"`.
