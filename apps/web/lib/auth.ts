import { NextResponse } from 'next/server';
import { getSession, revokeSession, AuthError } from '@medcheckin/core';
import { getDb } from './db';

export const COOKIE = { user: 'mc_user', respondent: 'mc_resp' } as const;
const MAX_AGE = { user: 30 * 24 * 3600, respondent: 180 * 24 * 3600 } as const;

export function readCookie(req: Request, name: string): string | null {
  const raw = req.headers.get('cookie') ?? '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

export function sessionCookie(kind: keyof typeof COOKIE, token: string | null): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  if (token === null) return `${COOKIE[kind]}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure}`;
  return `${COOKIE[kind]}=${encodeURIComponent(token)}; Path=/; Max-Age=${MAX_AGE[kind]}; HttpOnly; SameSite=Lax${secure}`;
}

export type UserSession = {
  kind: 'user';
  sessionId: string;
  userId: string;
  clinicId: string;
  role: string;
  name: string;
  email: string;
};
export type RespondentSession = {
  kind: 'respondent';
  sessionId: string;
  respondentId: string;
  respondentKind: string;
  patientId: string;
  clinicId: string;
  name: string;
  canAnswer: boolean;
  receivesAlarms: boolean;
};

export async function requireUser(req: Request): Promise<UserSession> {
  const token = readCookie(req, COOKIE.user);
  const s = (await getSession(getDb(), token ?? '', new Date())) as UserSession | null;
  if (!s || s.kind !== 'user') throw new AuthError('unauthenticated', 'Sessão necessária.');
  return s;
}

export async function requireRespondent(req: Request): Promise<RespondentSession> {
  const token = readCookie(req, COOKIE.respondent);
  const s = (await getSession(getDb(), token ?? '', new Date())) as RespondentSession | null;
  if (!s || s.kind !== 'respondent') throw new AuthError('unauthenticated', 'Sessão necessária.');
  return s;
}

export async function revokeCookieSession(req: Request, kind: keyof typeof COOKIE) {
  const token = readCookie(req, COOKIE[kind]);
  if (token) await revokeSession(getDb(), token, new Date());
}

/** Mapeia AuthError/EngineError → resposta JSON. Nunca 403 para not_found. */
export function errorResponse(err: unknown): NextResponse {
  const code = (err as { code?: string })?.code;
  const message = (err as Error)?.message ?? 'Erro';
  if (code === 'unauthenticated')
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  if (code === 'not_found') return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (code === 'invalid_token')
    return NextResponse.json({ error: 'invalid_token' }, { status: 404 });
  if (code === 'consent_required')
    return NextResponse.json({ error: 'consent_required', message }, { status: 400 });
  if (code === 'forbidden_origin')
    return NextResponse.json({ error: 'forbidden_origin' }, { status: 403 });
  if (
    code === 'invalid_value' ||
    code === 'required' ||
    code === 'condition' ||
    code === 'unknown_question' ||
    code === 'closed' ||
    code === 'forbidden' ||
    code === 'no_subscription'
  ) {
    return NextResponse.json({ error: code, message }, { status: 400 });
  }
  // E9.3: confirmar um teste de aviso que ainda não saiu — conflito de estado, não entrada inválida.
  if (code === 'not_sent') return NextResponse.json({ error: code, message }, { status: 409 });
  if (code === 'validation') {
    const field = (err as { field?: string | null }).field ?? null;
    return NextResponse.json({ error: 'validation', message, field }, { status: 400 });
  }
  // Auditoria P1-4: qualquer outro code é infraestrutura (ex.: '23505' do driver do Postgres)
  // ou código desconhecido — loga no servidor e NÃO vaza a mensagem interna para o cliente.
  console.error('[api] erro inesperado', {
    name: (err as Error)?.name,
    code: code ?? null,
    message,
  });
  return NextResponse.json({ error: 'internal' }, { status: 500 });
}

/**
 * CSRF (ACHADOS E3): rotas mutáveis só aceitam Origin da própria app (ou ausência de Origin —
 * clientes não-navegador como curl). Navegadores sempre mandam Origin em POST/PATCH/PUT/DELETE.
 */
export function assertSameOrigin(req: Request): void {
  const origin = req.headers.get('origin');
  if (!origin) return;
  const allowed = new Set<string>();
  if (process.env.APP_BASE_URL) allowed.add(new URL(process.env.APP_BASE_URL).origin);
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  if (host) {
    const proto =
      req.headers.get('x-forwarded-proto') ?? new URL(req.url).protocol.replace(':', '');
    allowed.add(`${proto}://${host}`);
  }
  allowed.add(new URL(req.url).origin);
  if (!allowed.has(origin)) throw new AuthError('forbidden_origin', 'Origem não permitida.');
}
