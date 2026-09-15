# DEPLOY — MedCheck-in v2 (1 VPS, Docker Compose + Caddy)

## Checklist que depende do dono (fase E8/E9)

| Item                                                                                                                                                   | Decisão | Onde entra                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------- | ------------------------------------------------------------------ |
| Provedor da VPS (2 vCPU / 4 GB / 40 GB SSD é suficiente para o piloto) e região (BR)                                                                   | —       | `ssh`, Docker                                                      |
| Domínio e DNS `A` → IP da VPS (ex.: `app.clinica.com.br`)                                                                                              | —       | `DOMAIN`, `APP_BASE_URL`                                           |
| SMTP de produção (D13: Resend / SMTP da clínica)                                                                                                       | —       | `SMTP_*`, `EMAIL_FROM`                                             |
| Destino off-site do backup (S3/B2/Drive via `rclone`)                                                                                                  | —       | `BACKUP_RCLONE_REMOTE` (opcional; sem ele o backup fica só na VPS) |
| Monitor externo de uptime (UptimeRobot / Better Stack) apontando para `https://DOMAIN/api/health` (200 = ok; **503 = banco fora ou scheduler parado**) | —       | substitui/complementa `scripts/uptime-check.mjs`                   |
| E-mail que recebe alertas operacionais                                                                                                                 | —       | `ALERT_EMAIL` do uptime-check                                      |

## Passo a passo

1. **VPS**: Ubuntu 22.04+, `apt update && apt install -y docker.io docker-compose-plugin ufw`; `ufw allow 22,80,443/tcp && ufw enable`. Usuário não-root com `docker` group.
2. **Código**: `git clone <repo> /opt/medcheckin && cd /opt/medcheckin` (ou copie só `docker-compose.prod.yml`, `deploy/`, `scripts/` e use imagens publicadas — ver "Imagens").
3. **Segredos**: `cp .env.example .env.prod` e preencha **tudo** que o compose marca com `:?`:
   `POSTGRES_PASSWORD`, `DOMAIN`, `APP_BASE_URL=https://DOMAIN`, `SMTP_HOST/PORT/USER/PASS`, `EMAIL_FROM`, `VAPID_PUBLIC_KEY/PRIVATE_KEY/SUBJECT`, `BACKUP_PASSPHRASE` (guarde fora da VPS — sem ela o backup é inútil), `APP_VERSION` (git sha). `chmod 600 .env.prod`.
   Gerar VAPID: `docker run --rm node:22-alpine sh -c "npm i -g web-push >/dev/null && web-push generate-vapid-keys"`.
4. **Subir**: `docker compose -p medcheckin -f docker-compose.prod.yml --env-file .env.prod up -d --build`
   (`migrate` roda uma vez e o `web`/`scheduler` só sobem depois dele terminar bem).
5. **Verificar**:
   - `curl -s https://DOMAIN/api/health` → `{"ok":true,"db":"up","scheduler":{"stale":false}}` (200)
   - `docker compose -p medcheckin -f docker-compose.prod.yml --env-file .env.prod ps` → todos `healthy`
   - `/hoje` (após login) mostra "Scheduler ativo".
6. **Primeiro acesso**: crie a clínica e a médica **sem seed** (D7 — seed é recusado em produção):
   `docker compose -p medcheckin -f docker-compose.prod.yml --env-file .env.prod exec db psql -U medcheckin -d medcheckin -c "insert into clinics(name) values('Clínica X') returning id"` e depois `insert into users(clinic_id, role, email, name) values('<id>','doctor','medica@…','Dra. …')`. Ela entra em `/login` pelo link mágico.
7. **Backup**: automático (cron `BACKUP_CRON`, default 03:15 UTC) → volume `backups`. Gera **dois** arquivos
   cifrados: `medcheckin-*.dump.enc` (banco) e `uploads-*.tar.enc` (anexos, D38 — o serviço `backup` monta o
   volume `uploads` como somente leitura e `UPLOADS_DIR=/data/uploads` já vem fixado no compose). **Restore
   drill mensal**:
   `docker compose … exec backup sh -c 'apk add --no-cache openssl >/dev/null; /usr/local/bin/restore-drill.sh'` → esperar `RESTORE DRILL OK <hash>` seguido de `RESTORE DRILL anexos OK` (confere que cada `stored_path` do banco restaurado existe no tar de uploads mais recente). Copie o script para o container se a imagem não o tiver (`docker cp scripts/restore-drill.sh <container>:/usr/local/bin/`).
   Off-site: monte `rclone` no container ou copie `/backups` (os dois arquivos) por `rsync` para outra máquina.
8. **Uptime**: monitor externo → `https://DOMAIN/api/health` a cada 1–5 min, alerta em ≠200. Alternativa sem serviço externo: cron em outra máquina/GitHub Actions rodando `scripts/uptime-check.mjs` (`HEALTH_URL`, `ALERT_EMAIL`, `SMTP_*`).
9. **Prove o alerta antes de precisar dele** — um alarme só exercitado no dia do incêndio não é alarme:

   ```bash
   HEALTH_URL=https://DOMAIN/api/health ALERT_EMAIL=... SMTP_HOST=... EMAIL_FROM=... \
     node scripts/uptime-check.mjs --selftest
   ```

   Sai 0 e manda um e-mail de teste; **confirme na caixa de entrada**. Se sair 1 ("ALERTA DE UPTIME CEGO"), o SMTP de produção está errado e nenhuma queda seria avisada — corrija antes de seguir. Repetir sempre que trocar provedor de e-mail.

10. **Atualizar**: `git pull && docker compose … up -d --build` (migrations rodam de novo, idempotentes). Rollback: `git checkout <sha>` + mesmo comando; banco: restaurar backup (RUNBOOK).

## Imagens

`apps/web/Dockerfile` (Next standalone, ~350 MB) e `apps/scheduler/Dockerfile` (~260 MB), build no contexto da raiz. O CI faz `docker build` das duas (sem push). Publicar em registry é opcional (`WEB_IMAGE`/`SCHEDULER_IMAGE` no `.env.prod`).

## O que foi provado localmente (E8)

Compose de produção com `DOMAIN=localhost` + `CADDY_TLS_DIRECTIVE="tls internal"`: `curl -k https://localhost/api/health` 200 (HSTS/nosniff/DENY, HTTP→HTTPS 308); scheduler `/health` 200; scheduler parado → web 503 → religado 200; `backup.sh` cifrado + `restore-drill.sh` **hash igual** (e falha com arquivo adulterado ou banco divergente); `uptime-check.mjs` com web derrubado → e-mail de alerta recebido (Mailpit). Ver PLANO.md → E8.
