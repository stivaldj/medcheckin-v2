import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@medcheckin/web';

const ITENS = [
  { value: 'full', label: 'Óleo full spectrum 200mg/ml' },
  { value: 'iso', label: 'Isolado 100mg/ml' },
  { value: 'cap25', label: 'Cápsula 25mg' },
];

// SelectGroup + SelectLabel são o motivo para usar o Select composto em vez do SimpleSelect:
// agrupar itens por categoria. Só aparece com o menu aberto.
export function MenuAberto() {
  return (
    <div className="w-[320px] pt-24">
      <Select value="cap25" onValueChange={() => {}} items={ITENS} defaultOpen>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectLabel>Óleos</SelectLabel>
            <SelectItem value="full">Óleo full spectrum 200mg/ml</SelectItem>
            <SelectItem value="iso">Isolado 100mg/ml</SelectItem>
          </SelectGroup>
          <SelectSeparator />
          <SelectGroup>
            <SelectLabel>Cápsulas</SelectLabel>
            <SelectItem value="cap25">Cápsula 25mg</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  );
}
