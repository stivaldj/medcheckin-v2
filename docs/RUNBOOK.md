# RUNBOOK — MedCheck-in v2

## Componentes

| Processo                      | Comando                                                      | Precisa de                                                                |
| ----------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------- |
| Web (UI médica + PWA + API)   | `npm run dev:web` / `next start`                             | `DATABASE_URL`, `APP_BASE_URL`, `SMTP_*`/`EMAIL_FROM`, `VAPID_PUBLIC_KEY` |
| Scheduler (ciclo a cada 60 s) | `npm run dev:scheduler` / `node apps/scheduler/src/index.js` | `DATABASE_URL`, `VAPID_*` (fail-closed)                                   |
| Postgres 16                   | `docker compose up -d db`                                    | `POSTGRES_PASSWORD`                                                       |
| Mailpit (dev)                 | `docker compose up -d mailpit`                               | —                                                                         |

Sem uma variável obrigatória o processo **não sobe** (é proposital).

## Subir do zero (dev)

```bash
cp .env.example .env               # preencha
docker compose up -d db mailpit
docker compose exec db createdb -U medcheckin medcheckin_test
npm ci && npm run migrate && npm run seed
npm run check && npm run test:e2e
npm run dev:web   # + npm run dev:scheduler em outro terminal
```

## Operações comuns

| Tarefa                               | Como                                                                                                                                                                                                                                                  |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Aplicar migrations                   | `npm run migrate` (idempotente; roda também no boot? **não** — rode antes do deploy)                                                                                                                                                                  |
| Um ciclo do scheduler à mão          | `node apps/scheduler/src/index.js --once`                                                                                                                                                                                                             |
| Ver saúde                            | `GET /api/health` (web + banco); `/hoje` mostra heartbeat do scheduler (vermelho > 10 min); `/configuracoes` mostra carimbos                                                                                                                          |
| Reenviar link mágico                 | a médica pede em `/login`; e-mail em Mailpit (dev)                                                                                                                                                                                                    |
| Convite do respondente               | página do paciente → "Copiar link" / "Novo link" (invalida o anterior)                                                                                                                                                                                |
| Exportar dados de um paciente (LGPD) | página do paciente → "Exportar dados" (zip)                                                                                                                                                                                                           |
| Anonimizar paciente                  | página do paciente → "Anonimizar" (motivo + nome) — irreversível                                                                                                                                                                                      |
| Retenção                             | automática 1×/dia no scheduler; manual: `node -e "import('@medcheckin/core').then(async m=>{const db=m.createDb(process.env.DATABASE_URL);console.log(await m.applyRetention(db, new Date()));await db.destroy()})"` (rode dentro de `packages/core`) |
| Ver logs                             | stdout JSON (redigido); `LOG_LEVEL=debug                                                                                                                                                                                                              | info | warn | error` |

## Sinais de problema e o que fazer

| Sinal                                         | Causa provável                                                                                      | Ação                                                                                                     |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `/hoje` faixa vermelha "Scheduler parado"     | processo do scheduler caiu / sem VAPID / sem banco                                                  | ver logs do scheduler; `--once` para diagnosticar; reiniciar                                             |
| Alertas `delivery_failed` em vários pacientes | push service indisponível ou inscrições revogadas                                                   | verificar VAPID, `push_subscriptions.revoked_at`; pedir ao respondente para reativar notificações no app |
| Muitos "Não respondeu"                        | check-ins enviados mas sem push entregue (ver `notifications.failed_at`) ou pacientes sem inscrição | Configurações → coluna Push por respondente                                                              |
| E-mail de login não chega                     | SMTP mal configurado (`mail.sent` no log?)                                                          | testar SMTP; em dev abrir Mailpit :8025                                                                  |
| `403 forbidden_origin`                        | `APP_BASE_URL` diferente do domínio real                                                            | corrigir `APP_BASE_URL`                                                                                  |

## Backup / restore

Definido em **E8** (compose prod, `pg_dump` diário cifrado, restore drill com hash). Até lá: `docker compose exec db pg_dump -U medcheckin medcheckin > backup.sql`.

## Incidente de segurança

Ver `docs/LGPD.md` → Incidentes. Primeiro passo: revogar sessões (`revokeAllForPrincipal`) e rotacionar convites.
