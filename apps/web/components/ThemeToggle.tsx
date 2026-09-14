'use client';
import { useEffect, useState } from 'react';
import { MonitorIcon, MoonIcon, SunIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';

type Pref = 'system' | 'light' | 'dark';

declare global {
  interface Window {
    __mcTheme?: { get: () => Pref; set: (p: Pref) => void };
  }
}

const NEXT: Record<Pref, Pref> = { system: 'light', light: 'dark', dark: 'system' };
const LABEL: Record<Pref, string> = { system: 'sistema', light: 'claro', dark: 'escuro' };
const ICON = { system: MonitorIcon, light: SunIcon, dark: MoonIcon };

/**
 * Tema em três estados: Sistema → Claro → Escuro. Quem aplica é o `theme-init.js` (antes da
 * pintura); este botão só troca a escolha. `showLabel` escreve o estado ao lado do ícone.
 */
export function ThemeToggle({ showLabel = false }: { showLabel?: boolean }) {
  // null até montar: no servidor não dá para saber a escolha deste aparelho.
  const [pref, setPref] = useState<Pref | null>(null);
  useEffect(() => {
    setPref(window.__mcTheme?.get() ?? 'system');
  }, []);

  const current = pref ?? 'system';
  const Icon = ICON[current];
  const name = `Tema: ${LABEL[current]}. Tocar muda para ${LABEL[NEXT[current]]}.`;
  return (
    <Button
      type="button"
      variant="ghost"
      size={showLabel ? 'sm' : 'icon'}
      className={showLabel ? 'gap-1.5' : 'size-11'}
      aria-label={name}
      title={name}
      data-testid="theme-toggle"
      data-theme-pref={pref ?? undefined}
      disabled={pref === null}
      onClick={() => {
        const next = NEXT[current];
        window.__mcTheme?.set(next);
        setPref(next);
      }}
    >
      <Icon className="size-4" />
      {showLabel && <span className="text-[13px]">{LABEL[current]}</span>}
    </Button>
  );
}
