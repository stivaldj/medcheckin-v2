---
category: feedback
---
# Alert

Aviso em bloco dentro do fluxo da página. Composição: `Alert` > `AlertTitle` +
`AlertDescription`, com `AlertAction` opcional ancorado no canto superior direito.

`variant`: `default` · `destructive`.

Um ícone como **primeiro filho** de `Alert` liga o layout de duas colunas automaticamente
(ícone à esquerda, título e descrição à direita) — não é preciso classe nenhuma para isso.

## Uso
```jsx
<Alert>
  <TriangleAlertIcon />
  <AlertTitle>Três dias sem check-in</AlertTitle>
  <AlertDescription>A paciente não responde desde 12/03. Considere contato ativo.</AlertDescription>
  <AlertAction><Button size="xs" variant="ghost">Dispensar</Button></AlertAction>
</Alert>
```
