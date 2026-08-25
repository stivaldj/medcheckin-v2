import { describe, it, expect, beforeAll } from 'vitest';
import { createSmtpMailer, fakeMailer } from '../src/auth/mailer.js';

/**
 * O link mágico é uma credencial: se o e-mail não sair (ou sair para o domínio errado), ninguém
 * entra — ou entra quem não devia. Este teste manda de verdade por SMTP contra o Mailpit do compose
 * e confere a mensagem pela API dele. Sem servidor SMTP → pula (não finge que passou).
 */
const SMTP_HOST = process.env.SMTP_HOST || '127.0.0.1';
const SMTP_PORT = Number(process.env.SMTP_PORT || 1025);
const UI = process.env.MAILPIT_UI_URL || `http://${SMTP_HOST}:8025`;

async function mailpitUp() {
  try {
    const r = await fetch(`${UI}/api/v1/messages`, { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch {
    return false;
  }
}

describe('createSmtpMailer — envio real por SMTP', () => {
  let up = false;
  beforeAll(async () => {
    up = await mailpitUp();
  });

  it('fail-closed: sem SMTP_HOST ou EMAIL_FROM não constrói o mailer', () => {
    expect(() => createSmtpMailer({ EMAIL_FROM: 'a@b.test' })).toThrow(/SMTP_HOST/);
    expect(() => createSmtpMailer({ SMTP_HOST: 'x' })).toThrow(/EMAIL_FROM/);
  });

  it('entrega no servidor SMTP com o destinatário e o corpo certos', async () => {
    if (!up) return void expect(up, `Mailpit indisponível em ${UI} — teste pulado`).toBe(false);
    const to = `destinatario-${Date.now()}@medcheckin.test`;
    const mailer = createSmtpMailer({
      SMTP_HOST,
      SMTP_PORT: String(SMTP_PORT),
      EMAIL_FROM: 'MedCheck-in <nao-responda@medcheckin.test>',
    });
    const link = 'https://app.medcheckin.test/auth/verify?token=abc123';
    const res = await mailer.sendMail({
      to,
      subject: 'Seu link de acesso',
      text: `Entre por aqui: ${link}`,
    });
    expect(res.ok).toBe(true);
    expect(res.messageId).toBeTruthy();

    const list = await (await fetch(`${UI}/api/v1/search?query=${encodeURIComponent(to)}`)).json();
    expect(list.messages_count ?? list.messages?.length ?? 0).toBeGreaterThanOrEqual(1);
    const id = list.messages[0].ID;
    const msg = await (await fetch(`${UI}/api/v1/message/${id}`)).json();
    // o link vai para QUEM foi pedido — e para mais ninguém
    expect(msg.To.map((t) => t.Address)).toEqual([to]);
    expect(msg.Cc ?? []).toHaveLength(0);
    expect(msg.Bcc ?? []).toHaveLength(0);
    expect(msg.From.Address).toBe('nao-responda@medcheckin.test');
    expect(msg.Subject).toBe('Seu link de acesso');
    expect(msg.Text).toContain(link);
  });

  it('fakeMailer guarda em memória (usado pelos testes que não precisam de SMTP)', async () => {
    const m = fakeMailer();
    await m.sendMail({ to: 'x@y.test', subject: 's', text: 't' });
    expect(m.sent).toEqual([{ to: 'x@y.test', subject: 's', text: 't' }]);
  });
});
