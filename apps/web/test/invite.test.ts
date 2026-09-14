import { describe, it, expect } from 'vitest';
import { whatsappLink } from '../lib/invite';

const url = 'https://app.example.test/p/convite/abc';

describe('whatsappLink (E9.3)', () => {
  it('celular brasileiro com DDD ganha o 55 e a mensagem leva o link e a instrução do navegador', () => {
    const href = whatsappLink({ name: 'Maria', phone: '(65) 99123-4567', invite_url: url });
    expect(href.startsWith('https://wa.me/5565991234567?text=')).toBe(true);
    const text = decodeURIComponent(href.split('?text=')[1]);
    expect(text).toContain(url);
    expect(text).toContain('Olá, Maria!');
    expect(text).toMatch(/iPhone, abra no Safari.*Android, abra no Chrome/s);
  });

  it('número já com DDI é mantido; sem número (ou inválido) abre o WhatsApp para escolher o contato', () => {
    expect(whatsappLink({ name: 'A', phone: '+55 65 99123-4567', invite_url: url })).toMatch(
      /^https:\/\/wa\.me\/5565991234567\?/,
    );
    expect(whatsappLink({ name: 'A', phone: null, invite_url: url })).toMatch(
      /^https:\/\/wa\.me\/\?text=/,
    );
    expect(whatsappLink({ name: 'A', phone: '123', invite_url: url })).toMatch(
      /^https:\/\/wa\.me\/\?text=/,
    );
  });
});
