import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getSession } from '@medcheckin/core';
import { getDb } from './db';
import { COOKIE, readCookie, type UserSession, type RespondentSession } from './auth';

async function tokenFor(name: string) {
  const h = await headers();
  return readCookie(new Request('http://x', { headers: { cookie: h.get('cookie') ?? '' } }), name);
}

/** Sessão da médica a partir dos cookies da requisição (server components). */
export async function currentUserSession(): Promise<UserSession | null> {
  const token = await tokenFor(COOKIE.user);
  if (!token) return null;
  const s = await getSession(getDb(), token, new Date());
  return s && s.kind === 'user' ? (s as UserSession) : null;
}

export async function currentRespondentSession(): Promise<RespondentSession | null> {
  const token = await tokenFor(COOKIE.respondent);
  if (!token) return null;
  const s = await getSession(getDb(), token, new Date());
  return s && s.kind === 'respondent' ? (s as RespondentSession) : null;
}

/** Páginas renderizam em paralelo ao layout: cada página protege a si mesma. */
export async function requireUserPage(): Promise<UserSession> {
  const s = await currentUserSession();
  if (!s) redirect('/login');
  return s;
}
