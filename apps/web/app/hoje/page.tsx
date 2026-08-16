import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getSession } from '@medcheckin/core';
import { getDb } from '@/lib/db';
import { readCookie, COOKIE } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/** E3: placeholder honesto. A tela "Hoje" de verdade é E6. */
export default async function HojePage() {
  const h = await headers();
  const token = readCookie(
    new Request('http://x', { headers: { cookie: h.get('cookie') ?? '' } }),
    COOKIE.user,
  );
  const session = token ? await getSession(getDb(), token, new Date()) : null;
  if (!session || session.kind !== 'user') redirect('/login');
  return (
    <main style={{ maxWidth: 720, margin: '4rem auto', fontFamily: 'system-ui' }}>
      <h1>Hoje</h1>
      <p>Olá, {session.name}. Sessão ativa (E3). Painel entra em E6.</p>
      <form action="/api/auth/logout" method="post">
        <button type="submit">Sair</button>
      </form>
    </main>
  );
}
