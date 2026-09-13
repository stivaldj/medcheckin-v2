---
category: layout
---
# Tabs

Abas sobre o Base UI. `Tabs` (`value`, `defaultValue`, `onValueChange`, `orientation`) >
`TabsList` > `TabsTrigger value`, mais um `TabsContent value` por painel.

`TabsList` tem `variant`: `default` · `line`.

```jsx
<Tabs defaultValue="hoje">
  <TabsList>
    <TabsTrigger value="hoje">Hoje</TabsTrigger>
    <TabsTrigger value="historico">Histórico</TabsTrigger>
  </TabsList>
  <TabsContent value="hoje">…</TabsContent>
  <TabsContent value="historico">…</TabsContent>
</Tabs>
```
