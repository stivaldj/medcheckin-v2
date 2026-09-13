---
category: acoes
---
# Button

Botão único do sistema. Envolve o `Button` do Base UI e aplica as variantes do MedCheck-in.

## Variantes
`variant`: `default` (primária, teal da marca) · `outline` · `secondary` · `ghost` · `destructive` (fundo suave, texto vermelho — não é um bloco vermelho sólido) · `link`.
`size`: `xs` · `sm` · `default` (h-8) · `lg` · `icon` · `icon-xs` · `icon-sm` · `icon-lg`.

## Uso
```jsx
<Button variant="default" size="sm">Registrar dose</Button>
<Button variant="outline"><PlusIcon /> Nova pergunta</Button>
<Button variant="ghost" size="icon-sm" aria-label="Fechar"><XIcon /></Button>
```

Ícones do `lucide-react` entram como filhos diretos e são dimensionados automaticamente
(`size-4`, ou `size-3/3.5` nos tamanhos menores). Para botão só de ícone use um `size` `icon*`
e sempre um `aria-label`.
