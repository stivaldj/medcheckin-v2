import { describe, it, expect, vi, afterEach } from 'vitest';
import { logger, redact } from '../src/logger.js';

// L10: conteúdo clínico e PII nunca vão para o log.
describe('logger (redação de PII)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('redige text, value, notes, name, email, phone (inclusive aninhados)', () => {
    const out = redact({
      patient_id: 'abc',
      text: 'minha dor está 8',
      value: 8,
      value_text: 'livre',
      notes: 'obs',
      note: 'obs2',
      answer: { value: 3, name: 'Fulano' },
      respondent: { email: 'x@y.test', phone: '+55...' },
      keys: { p256dh: 'k', auth: 'a' },
      endpoint: 'https://push',
    });
    expect(out.patient_id).toBe('abc');
    for (const k of ['text', 'value', 'value_text', 'notes', 'note', 'keys', 'endpoint']) {
      expect(out[k], k).toBe('[REDACTED]');
    }
    expect(out.answer).toEqual({ value: '[REDACTED]', name: '[REDACTED]' });
    expect(out.respondent).toEqual({ email: '[REDACTED]', phone: '[REDACTED]' });
  });

  it('redige qualquer chave com password/token/secret', () => {
    const out = redact({ auth_token: 'x', mySecretThing: 'y', db_password: 'z', ok: 1 });
    expect(out).toEqual({
      auth_token: '[REDACTED]',
      mySecretThing: '[REDACTED]',
      db_password: '[REDACTED]',
      ok: 1,
    });
  });

  it('emite JSON com ts/level/msg e campos do child', () => {
    const saved = process.env.LOG_LEVEL;
    process.env.LOG_LEVEL = 'info';
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    logger.child({ trace_id: 't1' }).info('hello', { checkin_id: 'c1', text: 'secreto' });
    expect(spy).toHaveBeenCalledTimes(1);
    const row = JSON.parse(spy.mock.calls[0][0]);
    expect(row).toMatchObject({
      level: 'info',
      msg: 'hello',
      trace_id: 't1',
      checkin_id: 'c1',
      text: '[REDACTED]',
    });
    expect(typeof row.ts).toBe('string');
    process.env.LOG_LEVEL = saved;
  });

  it('error vai para stderr', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    logger.error('boom', { code: 'X' });
    expect(err).toHaveBeenCalledTimes(1);
    expect(JSON.parse(err.mock.calls[0][0]).level).toBe('error');
  });
});
