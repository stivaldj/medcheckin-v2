import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldLabel,
  Input,
  SimpleSelect,
} from '@medcheckin/web';

export function Aberto() {
  return (
    <Dialog defaultOpen>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Registrar dose</DialogTitle>
          <DialogDescription>Confirme o horário e a quantidade administrada.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <Field>
            <FieldLabel htmlFor="hora">Horário</FieldLabel>
            <Input id="hora" type="time" defaultValue="20:00" />
          </Field>
          <Field>
            <FieldLabel htmlFor="qtd">Quantidade</FieldLabel>
            <SimpleSelect
              value="2"
              onValueChange={() => {}}
              options={[
                { value: '1', label: '1 gota' },
                { value: '2', label: '2 gotas' },
                { value: '3', label: '3 gotas' },
              ]}
            />
          </Field>
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="outline">Cancelar</Button>} />
          <Button>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
