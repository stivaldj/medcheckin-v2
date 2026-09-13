import { SimpleSelect } from '@medcheckin/web';

const PERIODOS = [
  { value: 'manha', label: 'Manhã' },
  { value: 'tarde', label: 'Tarde' },
  { value: 'noite', label: 'Noite' },
];

const JANELAS = [
  { value: '7', label: 'Últimos 7 dias' },
  { value: '30', label: 'Últimos 30 dias' },
  { value: '90', label: 'Últimos 90 dias' },
];

export function Padrao() {
  return (
    <div className="w-[260px]">
      <SimpleSelect value="noite" onValueChange={() => {}} options={PERIODOS} />
    </div>
  );
}

export function ComPlaceholder() {
  return (
    <div className="w-[260px]">
      <SimpleSelect
        value=""
        onValueChange={() => {}}
        options={PERIODOS}
        placeholder="Selecione o período"
      />
    </div>
  );
}

export function Pequeno() {
  return (
    <div className="w-[220px]">
      <SimpleSelect value="30" onValueChange={() => {}} options={JANELAS} size="sm" />
    </div>
  );
}
