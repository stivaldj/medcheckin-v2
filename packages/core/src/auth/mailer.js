import nodemailer from 'nodemailer';
import { logger } from '../logger.js';

/**
 * Mailer SMTP (Nodemailer). Fail-closed: sem SMTP_HOST/EMAIL_FROM não sobe.
 * Dev: Mailpit (compose). Prod: provedor decidido em E3+ (D13).
 */
export function createSmtpMailer(env = process.env) {
  const host = env.SMTP_HOST;
  const from = env.EMAIL_FROM;
  if (!host || !from)
    throw new Error('SMTP_HOST e EMAIL_FROM são obrigatórios para enviar e-mail.');
  const port = Number(env.SMTP_PORT || 587);
  const secure = env.SMTP_SECURE === '1' || port === 465;
  const auth = env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined;
  const transport = nodemailer.createTransport({ host, port, secure, auth });
  return {
    async sendMail({ to, subject, text }) {
      const info = await transport.sendMail({ from, to, subject, text });
      logger.info('mail.sent', {
        to_domain: String(to).split('@')[1],
        subject,
        messageId: info.messageId,
      });
      return { ok: true, messageId: info.messageId };
    },
  };
}

/** Mailer de teste: guarda em memória. */
export function fakeMailer() {
  const sent = [];
  return {
    sent,
    async sendMail(msg) {
      sent.push(msg);
      return { ok: true, messageId: `fake-${sent.length}` };
    },
  };
}
