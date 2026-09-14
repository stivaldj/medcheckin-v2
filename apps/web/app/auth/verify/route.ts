import { NextResponse } from 'next/server';
import { verifyMagicLink } from '@medcheckin/core';
import { getDb } from '@/lib/db';
import { sessionCookie } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  // Atrás do Caddy/Funnel a origem vista pelo Next é a interna do container (0.0.0.0:3000);
  // o redirect precisa do endereço público, que é APP_BASE_URL (obrigatório em produção).
  const base = process.env.APP_BASE_URL ?? url.origin;
  const token = url.searchParams.get('token') ?? '';
  const ua = req.headers.get('user-agent');
  try {
    const { sessionToken } = await verifyMagicLink(getDb(), { token, ua }, new Date());
    const res = NextResponse.redirect(new URL('/hoje', base), 302);
    res.headers.set('set-cookie', sessionCookie('user', sessionToken));
    return res;
  } catch (err) {
    // Auditoria P1-4: link inválido/expirado é esperado (sem log); qualquer OUTRO erro
    // (ex.: banco fora) precisa deixar rastro — antes virava "link inválido" mudo.
    if ((err as { code?: string })?.code !== 'invalid_token') {
      console.error('[auth/verify] erro inesperado', {
        name: (err as Error)?.name,
        message: (err as Error)?.message,
      });
    }
    return NextResponse.redirect(new URL('/auth/invalido', base), 302);
  }
}
