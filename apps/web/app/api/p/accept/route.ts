import { NextResponse } from 'next/server';
import { acceptInvite } from '@medcheckin/core';
import { getDb } from '@/lib/db';
import { sessionCookie, errorResponse } from '@/lib/auth';
import { limitOr429 } from '@/lib/ratelimit';

export const dynamic = 'force-dynamic';

/** D12: aceite do convite (token) + consentimento → sessão do respondente. */
export async function POST(req: Request) {
  const limited = limitOr429(req, 'accept', 10, 15 * 60_000);
  if (limited) return limited;
  let body: { token?: string; consentVersion?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  try {
    const { sessionToken, session } = await acceptInvite(
      getDb(),
      {
        inviteToken: String(body?.token ?? ''),
        consentVersion: body?.consentVersion ?? null,
        ua: req.headers.get('user-agent'),
      },
      new Date(),
    );
    const res = NextResponse.json({ ok: true, respondent: session });
    res.headers.set('set-cookie', sessionCookie('respondent', sessionToken));
    return res;
  } catch (err) {
    return errorResponse(err);
  }
}
