'use client';

import { cn } from '@/lib/utils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export type Opcao = { value: string; label: string };

/**
 * Select de uma escolha só, que é a forma de todos os selects do app: valor, lista de opções,
 * callback. Existe para o call site caber numa linha — 14 blocos idênticos de oito linhas eram
 * o convite perfeito para eles divergirem entre si.
 */
export function SimpleSelect({
  value,
  onValueChange,
  options,
  className,
  placeholder,
  size,
  ...trigger
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: Opcao[];
  className?: string;
  placeholder?: string;
  size?: 'sm' | 'default';
} & Omit<React.ComponentProps<'button'>, 'value' | 'onChange' | 'size'>) {
  return (
    <Select value={value} onValueChange={(v) => onValueChange(String(v))} items={options}>
      <SelectTrigger size={size} className={cn('w-full', className)} {...trigger}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
