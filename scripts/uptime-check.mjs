// Verifica HEALTH_URL e, se não for 200 (ou timeout), envia e-mail de alerta (SMTP do core).
// Uso (cron externo / GitHub Actions schedule):
//   HEALTH_URL=https://app/api/health ALERT_EMAIL=... SMTP_*=... node scripts/uptime-check.mjs
//
// `--selftest` manda um alerta de mentira AGORA, sem esperar uma queda. Um alarme que só é
// exercitado no dia do incêndio não é alarme: se o SMTP de produção estiver errado, ninguém
// descobre até precisar. Rodar no deploy e antes do piloto (docs/DEPLOY.md, docs/PILOTO.md).
import { createSmtpMailer } from '@medcheckin/core';

const selftest = process.argv.includes('--selftest');
const url = process.env.HEALTH_URL;
const to = process.env.ALERT_EMAIL;
if (!url || !to) {
  console.error('HEALTH_URL e ALERT_EMAIL são obrigatórios.');
  process.exit(2);
}

if (selftest) {
  try {
    const mailer = createSmtpMailer(process.env); // lança se SMTP_HOST/EMAIL_FROM faltarem
    const at = new Date().toISOString();
    const res = await mailer.sendMail({
      to,
      subject: '[MedCheck-in] TESTE do alerta de uptime — nenhuma ação necessária',
      text:
        `Isto é um teste do caminho de alerta, disparado à mão em ${at}.\n` +
        `Se você recebeu esta mensagem, um alerta real de queda também chegaria.\n\n` +
        `URL monitorada: ${url}\nDestinatário: ${to}\n\n` +
        `Se NÃO chegar, o alerta de uptime está cego — corrija o SMTP antes de seguir ` +
        `(docs/RUNBOOK.md).`,
    });
    console.log(
      JSON.stringify({
        ts: at,
        msg: 'uptime.selftest_sent',
        url,
        to_domain: to.split('@')[1],
        messageId: res.messageId,
      }),
    );
    console.log('Confirme na caixa de entrada. Sem o e-mail, o alerta está cego.');
    process.exit(0);
  } catch (err) {
    // Falhar aqui é o ponto do teste: melhor descobrir agora que durante uma queda.
    console.error(
      `ALERTA DE UPTIME CEGO: não consegui enviar o e-mail de teste.\n` +
        `Motivo: ${err?.message ?? err}\n` +
        `Confira SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS/EMAIL_FROM no ambiente do serviço. ` +
        `Não siga para o piloto com o alerta cego (docs/RUNBOOK.md).`,
    );
    process.exit(1);
  }
}

const timeoutMs = Number(process.env.HEALTH_TIMEOUT_MS || 10000);
let status = 0;
let body = '';
try {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { 'user-agent': 'medcheckin-uptime' },
  });
  status = res.status;
  body = (await res.text()).slice(0, 500);
} catch (err) {
  body = `fetch falhou: ${err?.message ?? err}`;
}
const ok = status === 200;
console.log(
  JSON.stringify({
    ts: new Date().toISOString(),
    msg: ok ? 'uptime.ok' : 'uptime.down',
    url,
    status,
    body: ok ? undefined : body,
  }),
);
if (!ok) {
  const mailer = createSmtpMailer(process.env);
  await mailer.sendMail({
    to,
    subject: `[MedCheck-in] ALERTA: ${url} respondeu ${status || 'erro'}`,
    text: `Verificação de uptime falhou em ${new Date().toISOString()}.\nURL: ${url}\nStatus: ${status || 'sem resposta'}\nCorpo: ${body}\n\nVer docs/RUNBOOK.md → "Sinais de problema".`,
  });
  console.log(JSON.stringify({ msg: 'uptime.alert_sent', to_domain: to.split('@')[1] }));
  process.exit(1);
}
