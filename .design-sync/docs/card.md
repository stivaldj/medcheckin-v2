---
category: layout
---
# Card

Superfície principal do painel médico. Todo bloco de conteúdo da área clínica é um Card.

Composição: `Card` > `CardHeader` (`CardTitle`, `CardDescription`, `CardAction`) +
`CardContent` + `CardFooter`.

`size`: `default` · `sm` — controla o token interno `--card-spacing` (spacing 4 vs 3) e o
tamanho do título; use `sm` em grades densas.

`CardAction` se posiciona sozinho na direita da `CardHeader` (o header vira grid de duas
colunas quando detecta a action). `CardFooter` ganha borda superior e fundo `muted`.

## Uso
```jsx
<Card>
  <CardHeader>
    <CardTitle>Alertas abertos</CardTitle>
    <CardDescription>Últimos 7 dias</CardDescription>
    <CardAction><Button size="xs" variant="ghost">Ver todos</Button></CardAction>
  </CardHeader>
  <CardContent>…</CardContent>
</Card>
```
