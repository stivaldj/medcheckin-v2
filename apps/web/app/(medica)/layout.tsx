import type { ReactNode } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentUserSession } from '@/lib/session';
import { Button } from '@/components/ui/button';
import { MedicaNav } from '@/components/medica/MedicaNav';
import { ThemeToggle } from '@/components/ThemeToggle';

export const dynamic = 'force-dynamic';

export default async function MedicaLayout({ children }: { children: ReactNode }) {
  const session = await currentUserSession();
  if (!session) redirect('/login');
  return (
    <div className="min-h-screen">
      {/* Fica grudado no topo: a médica passa o dia rolando listas longas. */}
      <header className="sticky top-0 z-40 border-b bg-card/85 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-2.5">
          <div className="flex items-center gap-6">
            <Link
              href="/hoje"
              className="flex items-center gap-2 font-semibold tracking-tight whitespace-nowrap"
            >
              <span aria-hidden className="size-3 rounded-full bg-primary ring-3 ring-primary/15" />
              MedCheck-in
            </Link>
            <MedicaNav />
          </div>
          <form action="/api/auth/logout" method="post" className="flex items-center gap-2">
            <ThemeToggle showLabel />
            <span className="hidden text-[13px] text-muted-foreground sm:inline">
              {session.name}
            </span>
            <Button type="submit" variant="ghost" size="sm">
              Sair
            </Button>
          </form>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-7">{children}</main>
    </div>
  );
}
