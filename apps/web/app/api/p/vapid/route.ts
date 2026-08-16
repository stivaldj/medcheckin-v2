import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
/** Chave pública VAPID (não é segredo). Sem chave configurada → 503 honesto. */
export async function GET() {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  if (!publicKey) return NextResponse.json({ error: 'push_unavailable' }, { status: 503 });
  return NextResponse.json({ publicKey });
}
