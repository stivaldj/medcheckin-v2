---
category: feedback
---
# Badge

Etiqueta compacta para estado, contagem e — principalmente — **severidade de alerta**.

## Variantes
`default` · `secondary` · `destructive` · `outline` · `ghost` · `link`, mais a escala de
severidade em quatro níveis: `critical` · `high` · `medium` · `low`.

A escala de severidade é uma decisão de produto: crítico e alto **não** compartilham a mesma cor,
porque é exatamente aí que a diferença decide a conduta clínica. Cada nível lê os tokens
`--sev-*` e `--sev-*-soft` (fundo suave + texto saturado), então funciona em tema claro e escuro.

## Uso
```jsx
<Badge variant="critical">Crítico</Badge>
<Badge variant="high">Alto</Badge>
<Badge variant="medium">Médio</Badge>
<Badge variant="low">Baixo</Badge>
<Badge variant="outline">Rascunho</Badge>
```

Aceita `render` (padrão `useRender` do Base UI) para trocar a tag raiz, por exemplo por um `<a>`.
