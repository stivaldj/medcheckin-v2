'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV = [
  { href: '/hoje', label: 'Hoje' },
  { href: '/pacientes', label: 'Pacientes' },
  { href: '/perguntas', label: 'Perguntas & planos' },
  { href: '/configuracoes', label: 'Configurações' },
];

/** Navegação com estado ativo — antes não havia como saber em que página se está. */
export function MedicaNav() {
  const pathname = usePathname();
  return (
    <nav className="flex gap-0.5">
      {NAV.map((n) => {
        const ativo = pathname === n.href || pathname.startsWith(n.href + '/');
        return (
          <Link
            key={n.href}
            href={n.href}
            aria-current={ativo ? 'page' : undefined}
            className={`rounded-md px-2.5 py-1.5 text-[13px] transition-colors ${
              ativo
                ? 'bg-muted font-medium text-foreground'
                : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
            }`}
          >
            {n.label}
          </Link>
        );
      })}
    </nav>
  );
}
