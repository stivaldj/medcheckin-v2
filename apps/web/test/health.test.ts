import { describe, it, expect } from 'vitest';

// Route handler do Next é uma função pura: testável sem servidor.
describe('GET /api/health', () => {
  it('responde 200 com ok:true e db:"up" quando o Postgres está acessível', async () => {
    const { GET } = await import('../app/api/health/route');
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, db: 'up' });
  });

  it('responde 503 com db:"down" quando a conexão falha (sem sucesso falso)', async () => {
    const saved = process.env.DATABASE_URL;
    process.env.DATABASE_URL = 'postgres://x:x@127.0.0.1:1/nope';
    try {
      const { GET } = await import('../app/api/health/route');
      const res = await GET();
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.ok).toBe(false);
      expect(body.db).toBe('down');
    } finally {
      process.env.DATABASE_URL = saved;
    }
  });
});
