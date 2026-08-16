import { NextResponse } from 'next/server';

/**
 * Rate limit por chave (IP), janela deslizante, em memória (por instância — 1 VPS no piloto).
 * Fecha ACHADOS E3/E8. Caddy passa o IP em x-forwarded-for.
 */
const buckets = new Map<string, number[]>();

export function rateLimit(
  key: string,
  { limit, windowMs, now = Date.now() }: { limit: number; windowMs: number; now?: number },
) {
  const arr = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (arr.length >= limit) {
    const retryAfterSec = Math.max(1, Math.ceil((arr[0] + windowMs - now) / 1000));
    buckets.set(key, arr);
    return { ok: false as const, retryAfterSec };
  }
  arr.push(now);
  buckets.set(key, arr);
  return { ok: true as const, remaining: limit - arr.length };
}

export function resetRateLimits() {
  buckets.clear();
}

export function clientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return req.headers.get('x-real-ip') ?? 'unknown';
}

/** Devolve 429 se estourou; null se pode seguir. */
export function limitOr429(
  req: Request,
  name: string,
  limit: number,
  windowMs: number,
): NextResponse | null {
  const r = rateLimit(`${name}:${clientIp(req)}`, { limit, windowMs });
  if (r.ok) return null;
  return NextResponse.json(
    { error: 'rate_limited', message: 'Muitas tentativas. Aguarde um pouco.' },
    { status: 429, headers: { 'retry-after': String(r.retryAfterSec) } },
  );
}
