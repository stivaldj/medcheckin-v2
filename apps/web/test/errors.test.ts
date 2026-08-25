/**
 * Auditoria 2026-08-25, P1-4: erro de infraestrutura (ex.: driver PG, que também tem `.code`)
 * não pode virar 400 nem vazar a mensagem interna — é 500 `internal`, com log no servidor.
 */
import { describe, it, expect } from 'vitest';
import { errorResponse } from '../lib/auth';

describe('errorResponse — mapeamento de erros', () => {
  it('erro do Postgres (code 23505) → 500 internal, sem vazar a mensagem', async () => {
    const pgErr = Object.assign(
      new Error('duplicate key value violates unique constraint "notifications_dedup_key_unique"'),
      { code: '23505' },
    );
    const res = errorResponse(pgErr);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: 'internal' });
  });

  it('erro de domínio conhecido (invalid_value) continua 400 com mensagem', async () => {
    const err = Object.assign(new Error('Valor inválido para "dor".'), { code: 'invalid_value' });
    const res = errorResponse(err);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_value');
  });

  it('erro sem code → 500 internal', async () => {
    const res = errorResponse(new Error('boom'));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('internal');
  });
});
