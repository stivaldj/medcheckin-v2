import type { ReactNode } from 'react';
import Link from 'next/link';

export const metadata = {
  title: 'MedCheck-in',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'MedCheck-in', statusBarStyle: 'default' as const },
};
export const viewport = { themeColor: '#0f766e', width: 'device-width', initialScale: 1 };

export default function PwaLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto min-h-screen max-w-md">
      <header className="flex items-center justify-between border-b px-4 py-3">
        <Link href="/p/hoje" className="font-semibold text-primary">
          MedCheck-in
        </Link>
        <nav className="flex gap-4 text-sm">
          <Link href="/p/hoje">Hoje</Link>
          <Link href="/p/historico">Histórico</Link>
        </nav>
      </header>
      <main className="px-4 py-4">{children}</main>
    </div>
  );
}
