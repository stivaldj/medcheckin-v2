import type { ReactNode } from 'react';
import Link from 'next/link';
import { ThemeToggle } from '@/components/ThemeToggle';

export const metadata = {
  title: 'MedCheck-in',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'MedCheck-in', statusBarStyle: 'default' as const },
};
export const viewport = { themeColor: '#0f766e', width: 'device-width', initialScale: 1 };

export default function PwaLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col">
      <header className="sticky top-0 z-30 flex items-center justify-between border-b bg-card/90 px-4 py-3 backdrop-blur-sm">
        <Link href="/p/hoje" className="flex items-center gap-2 font-semibold tracking-tight">
          <span aria-hidden className="size-2.5 rounded-full bg-primary ring-3 ring-primary/15" />
          MedCheck-in
        </Link>
        {/* Alvos de 44 px: quem usa isso pode estar com dor, sono ou tremor. */}
        <nav className="flex items-center gap-1 text-sm">
          <Link
            href="/p/hoje"
            className="rounded-md px-3 py-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            Hoje
          </Link>
          <Link
            href="/p/historico"
            className="rounded-md px-3 py-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            Histórico
          </Link>
          <ThemeToggle />
        </nav>
      </header>
      <main className="flex-1 px-4 pt-5 pb-12">{children}</main>
    </div>
  );
}
