import { NextResponse } from 'next/server';
import { requestMagicLink } from '@medcheckin/core';
import { getDb } from '@/lib/db';
import { getMailer } from '@/lib/mailer';
import { limitOr429 } from '@/lib/ratelimit';

export const dynamic = 'force-dynamic';

/** Sempre 202 (sem enumeração). E-mail só sai se o endereço for de um usuário da clínica. */
export async function POST(req: Request) {
  const limited = limitOr429(req, 'magic-link', 5, 15 * 60_000);
  if (limited) return limited;
  let email = '';
  try {
    const body = (await req.json()) as { email?: string };
    email = String(body?.email ?? '');
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const baseUrl = process.env.APP_BASE_URL;
  if (!baseUrl)
    return NextResponse.json(
      { error: 'server_misconfigured', message: 'APP_BASE_URL ausente' },
      { status: 500 },
    );
  try {
    await requestMagicLink(getDb(), { email, baseUrl, mailer: getMailer() }, new Date());
  } catch (err) {
    console.error('[auth] magic-link', { message: (err as Error).message });
    return NextResponse.json({ error: 'mail_failed' }, { status: 502 });
  }
  return NextResponse.json({ ok: true }, { status: 202 });
}
