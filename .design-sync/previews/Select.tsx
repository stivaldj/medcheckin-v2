import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@medcheckin/web';

const PRODUTOS = [
  { value: 'full', label: 'Óleo full spectrum 200mg/ml' },
  { value: 'iso', label: 'Isolado 100mg/ml' },
  { value: 'broad', label: 'Broad spectrum 50mg/ml' },
];

export function Fechado() {
  return (
    <div className="w-[320px]">
      <Select value="full" onValueChange={() => {}} items={PRODUTOS}>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PRODUTOS.map((p) => (
            <SelectItem key={p.value} value={p.value}>
              {p.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function Tamanhos() {
  return (
    <div className="flex w-[320px] flex-col gap-3">
      <Select value="iso" onValueChange={() => {}} items={PRODUTOS}>
        <SelectTrigger size="sm" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PRODUTOS.map((p) => (
            <SelectItem key={p.value} value={p.value}>
              {p.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value="broad" onValueChange={() => {}} items={PRODUTOS}>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PRODUTOS.map((p) => (
            <SelectItem key={p.value} value={p.value}>
              {p.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
