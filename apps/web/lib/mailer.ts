import { createSmtpMailer, fakeMailer } from '@medcheckin/core';

type Mailer = ReturnType<typeof createSmtpMailer>;
const g = globalThis as unknown as { __medcheckinMailer?: Mailer };

/**
 * Fail-closed: sem SMTP configurado, a rota que precisa de e-mail falha (não finge sucesso).
 * MAIL_TRANSPORT=fake só fora de produção (testes/dev sem Mailpit) — em produção é recusado.
 */
export function getMailer(): Mailer {
  if (!g.__medcheckinMailer) {
    if (process.env.MAIL_TRANSPORT === 'fake') {
      if (process.env.NODE_ENV === 'production')
        throw new Error('MAIL_TRANSPORT=fake é proibido em produção.');
      g.__medcheckinMailer = fakeMailer();
    } else {
      g.__medcheckinMailer = createSmtpMailer(process.env);
    }
  }
  return g.__medcheckinMailer;
}
