---
category: layout
---
# Collapsible

Seção que abre e fecha, sobre o Collapsible do Base UI. `Collapsible` (`open`,
`defaultOpen`, `onOpenChange`) > `CollapsibleTrigger` + `CollapsibleContent`.

Sem estilo próprio: é estrutura. Estilize o gatilho com `Button` e o painel com utilitários.

```jsx
<Collapsible defaultOpen>
  <CollapsibleTrigger render={<Button variant="ghost" size="sm">Detalhes</Button>} />
  <CollapsibleContent className="pt-2 text-sm text-muted-foreground">…</CollapsibleContent>
</Collapsible>
```
