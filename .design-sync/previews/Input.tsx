import { Input } from '@medcheckin/web';

export function Estados() {
  return (
    <div className="flex w-[320px] flex-col gap-3">
      <Input placeholder="Nome da paciente" />
      <Input defaultValue="Maria Souza" />
      <Input defaultValue="999" aria-invalid />
      <Input defaultValue="Somente leitura" disabled />
    </div>
  );
}

export function Tipos() {
  return (
    <div className="flex w-[320px] flex-col gap-3">
      <Input type="email" placeholder="email@exemplo.com" />
      <Input type="number" defaultValue="2" />
      <Input type="date" defaultValue="2026-03-12" />
      <Input type="time" defaultValue="20:00" />
    </div>
  );
}
