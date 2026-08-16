import { NextResponse } from 'next/server';
import { verifyMagicLink } from '@medcheckin/core';
import { getDb } from '@/lib/db';
import { sessionCookie } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get('token') ?? '';
  const ua = req.headers.get('user-agent');
  try {
    const { sessionToken } = await verifyMagicLink(getDb(), { token, ua }, new Date());
    const res = NextResponse.redirect(new URL('/hoje', url.origin), 302);
    res.headers.set('set-cookie', sessionCookie('user', sessionToken));
    return res;
  } catch {
    return NextResponse.redirect(new URL('/auth/invalido', url.origin), 302);
  }
}
