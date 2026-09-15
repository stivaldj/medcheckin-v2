'use client';
import { useId, useMemo, useState } from 'react';
import { catalogNameKey } from '@medcheckin/core/name-key';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * Campo "digite ou escolha" para itens de catálogo da clínica (produtos D34, condições D36).
 * A médica escreve o nome como quiser; enquanto digita, aparecem os itens que a clínica já
 * cadastrou. Escolher uma sugestão só preenche o campo — quem decide entre reaproveitar e
 * criar é o servidor, pela chave normalizada. Enter confirma (chama `onSubmit`) quando nenhuma
 * sugestão está realçada.
 */
export function CatalogNameInput({
  id,
  value,
  onChange,
  suggestions,
  onSubmit,
  disabled,
  placeholder,
  testId,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  suggestions: string[];
  onSubmit: () => void;
  disabled?: boolean;
  placeholder?: string;
  testId?: string;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

  const filtered = useMemo(() => {
    const key = catalogNameKey(value);
    if (!key) return [];
    return suggestions
      .filter((s) => {
        const k = catalogNameKey(s);
        return k !== key && k.includes(key);
      })
      .slice(0, 8);
  }, [value, suggestions]);

  const visible = open && filtered.length > 0;

  function pick(s: string) {
    onChange(s);
    setOpen(false);
    setActive(-1);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' && filtered.length) {
      e.preventDefault();
      setOpen(true);
      setActive((a) => (a + 1) % filtered.length);
    } else if (e.key === 'ArrowUp' && filtered.length) {
      e.preventDefault();
      setOpen(true);
      setActive((a) => (a <= 0 ? filtered.length - 1 : a - 1));
    } else if (e.key === 'Escape') {
      setOpen(false);
      setActive(-1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (visible && active >= 0) pick(filtered[active]);
      else onSubmit();
    }
  }

  return (
    <div className="relative">
      <Input
        id={id}
        value={value}
        disabled={disabled}
        autoComplete="off"
        role="combobox"
        aria-expanded={visible}
        aria-controls={visible ? listId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={visible && active >= 0 ? `${listId}-${active}` : undefined}
        placeholder={placeholder ?? 'Digite para buscar ou criar'}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={onKeyDown}
        data-testid={testId ? `${testId}-input` : 'catalog-input'}
      />
      {visible && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-lg border bg-popover p-1 text-sm shadow-md"
        >
          {filtered.map((s, i) => (
            <li
              key={s}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={cn(
                'cursor-pointer rounded-md px-2 py-1.5',
                i === active ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60',
              )}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(s)}
              data-testid={testId ? `${testId}-suggestion` : 'catalog-suggestion'}
            >
              {s}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
