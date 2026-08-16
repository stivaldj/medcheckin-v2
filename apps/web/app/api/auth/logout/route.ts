import { NextResponse } from 'next/server';
import { revokeCookieSession, sessionCookie } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  await revokeCookieSession(req, 'user');
  await revokeCookieSession(req, 'respondent');
  const res = NextResponse.json({ ok: true });
  res.headers.append('set-cookie', sessionCookie('user', null));
  res.headers.append('set-cookie', sessionCookie('respondent', null));
  return res;
}
