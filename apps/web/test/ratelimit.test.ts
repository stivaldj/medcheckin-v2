import { describe, it, expect, beforeEach } from 'vitest';
import { rateLimit, resetRateLimits } from '../lib/ratelimit';

describe('rateLimit (janela deslizante por chave, em memória)', () => {
  beforeEach(() => resetRateLimits());

  it('permite até o limite e bloqueia depois; janela expira', () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 3; i += 1)
      expect(rateLimit('ip:1', { limit: 3, windowMs: 60_000, now: t0 + i }).ok).toBe(true);
    const blocked = rateLimit('ip:1', { limit: 3, windowMs: 60_000, now: t0 + 10 });
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
    expect(rateLimit('ip:2', { limit: 3, windowMs: 60_000, now: t0 + 10 }).ok).toBe(true); // outra chave
    expect(rateLimit('ip:1', { limit: 3, windowMs: 60_000, now: t0 + 60_001 }).ok).toBe(true); // janela expirou
  });

  it('rota magic-link devolve 429 após 5 pedidos do mesmo IP', async () => {
    const { POST } = await import('../app/api/auth/magic-link/route');
    const call = () =>
      POST(
        new Request('http://localhost:3000/api/auth/magic-link', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9' },
          body: JSON.stringify({ email: 'ninguem@x.test' }),
        }),
      );
    for (let i = 0; i < 5; i += 1) expect((await call()).status).toBe(202);
    const r = await call();
    expect(r.status).toBe(429);
    expect(r.headers.get('retry-after')).toBeTruthy();
  });

  it('rota accept devolve 429 após 10 tentativas do mesmo IP', async () => {
    const { POST } = await import('../app/api/p/accept/route');
    const call = () =>
      POST(
        new Request('http://localhost:3000/api/p/accept', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.10' },
          body: JSON.stringify({ token: 'nope', consentVersion: 'v1' }),
        }),
      );
    for (let i = 0; i < 10; i += 1) expect((await call()).status).toBe(404);
    expect((await call()).status).toBe(429);
  });
});
