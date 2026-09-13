import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@medcheckin/web';

// O rodapé alinha as ações do diálogo; sozinho não tem contexto nem altura.
export function NoDialogo() {
  return (
    <Dialog defaultOpen>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Encerrar período de rotina</DialogTitle>
          <DialogDescription>
            Os alarmes param hoje. Você pode criar um novo período depois.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="outline">Cancelar</Button>} />
          <Button variant="destructive">Encerrar hoje</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
