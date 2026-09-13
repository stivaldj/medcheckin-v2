---
category: sobreposicao
---
# Dialog

Modal do Base UI. `Dialog` (`open`, `defaultOpen`, `onOpenChange`) > `DialogTrigger` +
`DialogContent` > `DialogHeader` (`DialogTitle`, `DialogDescription`) + conteúdo +
`DialogFooter`. `DialogContent` já traz overlay e botão de fechar; `DialogClose` fecha de
qualquer lugar.

`DialogFooter` tem `orientation`: `horizontal` · `vertical`.

```jsx
<Dialog>
  <DialogTrigger render={<Button size="sm">Registrar dose</Button>} />
  <DialogContent>
    <DialogHeader>
      <DialogTitle>Registrar dose</DialogTitle>
      <DialogDescription>Confirme o horário e a quantidade.</DialogDescription>
    </DialogHeader>
    <DialogFooter>
      <DialogClose render={<Button variant="outline">Cancelar</Button>} />
      <Button>Salvar</Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

Conteúdo em portal: no card de preview use `cardMode: "single"` e deixe o diálogo aberto por
`defaultOpen`.
