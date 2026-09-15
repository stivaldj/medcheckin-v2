import { NextResponse } from 'next/server';
import {
  requireUser,
  requireRespondent,
  assertSameOrigin,
  errorResponse,
  type UserSession,
  type RespondentSession,
} from './auth';
import { getDb } from './db';
import type { Knex } from 'knex';

type Ctx<P> = { params: Promise<P> };
type Handler<P> = (args: {
  req: Request;
  db: Knex;
  session: UserSession;
  params: P;
  body: unknown;
  baseUrl: string;
}) => Promise<Response>;

async function readBody(req: Request): Promise<unknown> {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined;
  const text = await req.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw Object.assign(new Error('JSON inválido'), { code: 'validation' });
  }
}

/** Envelope das rotas da médica: sessão + Origin (mutações) + erros mapeados. */
export function doctorRoute<P = Record<string, never>>(handler: Handler<P>) {
  return async (req: Request, ctx: Ctx<P>): Promise<Response> => {
    try {
      const session = await requireUser(req);
      if (req.method !== 'GET' && req.method !== 'HEAD') assertSameOrigin(req);
      const params = (ctx?.params ? await ctx.params : {}) as P;
      const body = await readBody(req);
      const baseUrl = process.env.APP_BASE_URL ?? new URL(req.url).origin;
      return await handler({ req, db: getDb(), session, params, body, baseUrl });
    } catch (err) {
      return errorResponse(err);
    }
  };
}

type UploadHandler<P> = (args: {
  req: Request;
  db: Knex;
  session: UserSession;
  params: P;
  baseUrl: string;
}) => Promise<Response>;

/**
 * Envelope para rotas com corpo binário/multipart: mesma sessão e checagem de Origin do
 * doctorRoute, mas o corpo fica intocado para o handler ler com `req.formData()` — o
 * `readBody` genérico faria `req.text()` + JSON.parse e corromperia o arquivo.
 */
export function doctorUploadRoute<P = Record<string, never>>(handler: UploadHandler<P>) {
  return async (req: Request, ctx: Ctx<P>): Promise<Response> => {
    try {
      const session = await requireUser(req);
      assertSameOrigin(req);
      const params = (ctx?.params ? await ctx.params : {}) as P;
      const baseUrl = process.env.APP_BASE_URL ?? new URL(req.url).origin;
      return await handler({ req, db: getDb(), session, params, baseUrl });
    } catch (err) {
      return errorResponse(err);
    }
  };
}

export const json = (data: unknown, status = 200) => NextResponse.json(data, { status });

type RHandler<P> = (args: {
  req: Request;
  db: Knex;
  session: RespondentSession;
  params: P;
  body: unknown;
}) => Promise<Response>;

/** Envelope das rotas do respondente (cookie mc_resp + Origin nas mutações). */
export function respondentRoute<P = Record<string, never>>(handler: RHandler<P>) {
  return async (req: Request, ctx: Ctx<P>): Promise<Response> => {
    try {
      const session = await requireRespondent(req);
      if (req.method !== 'GET' && req.method !== 'HEAD') assertSameOrigin(req);
      const params = (ctx?.params ? await ctx.params : {}) as P;
      const body = await readBody(req);
      return await handler({ req, db: getDb(), session, params, body });
    } catch (err) {
      return errorResponse(err);
    }
  };
}
