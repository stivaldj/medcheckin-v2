// Verifica HEALTH_URL e, se não for 200 (ou timeout), envia e-mail de alerta (SMTP do core).
// Uso (cron externo / GitHub Actions schedule): HEALTH_URL=https://app/api/health ALERT_EMAIL=... SMTP_*=... node scripts/uptime-check.mjs
import { createSmtpMailer } from '@medcheckin/core';

const url = process.env.HEALTH_URL;
const to = process.env.ALERT_EMAIL;
if (!url || !to) {
  console.error('HEALTH_URL e ALERT_EMAIL são obrigatórios.');
  process.exit(2);
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
