import type { ReactNode } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentUserSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

const NAV = [
  { href: '/hoje', label: 'Hoje' },
  { href: '/pacientes', label: 'Pacientes' },
  { href: '/perguntas', label: 'Perguntas & planos' },
  { href: '/configuracoes', label: 'Configurações' },
];

export default async function MedicaLayout({ children }: { children: ReactNode }) {
  const session = await currentUserSession();
  if (!session) redirect('/login');
  return (
    <div className="min-h-screen">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-6">
            <Link href="/hoje" className="font-semibold">
              MedCheck-in
            </Link>
            <nav className="flex gap-4 text-sm">
              {NAV.map((n) => (
                <Link
                  key={n.href}
                  href={n.href}
                  className="text-muted-foreground hover:text-foreground"
                >
                  {n.label}
                </Link>
              ))}
            </nav>
          </div>
          <form action="/api/auth/logout" method="post" className="flex items-center gap-3 text-sm">
            <span className="text-muted-foreground">{session.name}</span>
            <button type="submit" className="underline">
              Sair
            </button>
          </form>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
