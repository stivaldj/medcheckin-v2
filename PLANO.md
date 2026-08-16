# PLANO — MedCheck-in v2

> Único lugar onde o progresso é marcado. Uma janela = uma etapa. Nenhuma etapa é "feita" sem prova por comando colada aqui.
> Repositório antigo (só leitura): `../cbd-clinical-upgrade-v1`. Auditoria de referência: `../cbd-clinical-upgrade-v1/docs/AUDITORIA_COMPLETA_2026-08-16.md`.

## Missão (uma frase)

A médica cria perguntas e um plano de acompanhamento; o paciente **ou o cuidador** recebe alarmes de medicação com a dose vigente e check-ins periódicos; responde de forma estruturada; a médica vê a evolução dos sintomas **correlacionada aos ajustes de dose** e recebe alerta quando algo exige ação.

Fora do v2: consultas, agenda, faturamento, prescrição eletrônica, IA clínica, transcrição, procedimentos, post-its, parser de texto livre.

## Regras de trabalho (resumo — detalhes em `DECISOES.md`)

1. RED antes de GREEN. Prova = saída de comando colada, nunca "revisei".
2. Nenhum número na UI sem fonte; sem dado → "—". Nenhum toast de sucesso sem confirmação do servidor. Nenhum `catch {}` silencioso. Segredo ausente = processo não sobe.
3. Fora da etapa → `ACHADOS.md`. Não consertar de passagem.
4. Fim de etapa: RED/GREEN/provas + `npm run check` verde → **parar** e esperar "ok, avance".
5. Nunca ler/imprimir `.env`. Nunca dado real. Nunca commit em `main` (branch por etapa + PR + CI verde).

## Stack (decidida)

Monorepo npm workspaces · `apps/web` Next.js App Router (UI médica + PWA `/p/*` + API `/api/*`) · `apps/scheduler` (Node cron) · `packages/core` (JS + Knex, portado do v1, testes Vitest contra Postgres real) · Postgres 16 (docker-compose) · Auth.js e-mail mágico · Web Push VAPID · shadcn/ui + Tailwind + Recharts · ESLint + Prettier + tsc + Vitest + Playwright + GitHub Actions (PG service) · Deploy final: 1 VPS, Docker Compose + Caddy.

## Etapas

Legenda: `[ ]` não iniciada · `[~]` em andamento · `[x]` concluída com prova · `[!]` bloqueada

### E0 — Scaffold `[x]`

Monorepo, Next vazio, core vazio, Postgres compose, CI com PG, `npm run check`, README, `PLANO.md`, `ACHADOS.md`, `DECISOES.md`.

**RED planejado (escrito antes de qualquer código):**

- `packages/core/test/db.smoke.test.js`: abre conexão Knex com `DATABASE_URL`, executa `select 1`, espera `1`. Falha hoje porque não existe `packages/core`, nem Knex, nem PG rodando.
- `packages/core/test/env.test.js`: importar `packages/core/src/config.js` sem `DATABASE_URL` deve **lançar** (fail-closed). Falha hoje porque o arquivo não existe.
- `apps/web`: `GET /api/health` → `200 {"ok":true,"db":"up"}` (teste Vitest com `fetch` contra servidor de teste, ou Playwright mínimo). Falha hoje porque o app não existe.
- `npm run check` (raiz) deve encadear `lint`, `typecheck`, `test` — falha hoje porque o script não existe.

**Prova de saída:** `docker compose up -d db` sobe PG; `npm run check` verde local; CI verde no primeiro PR (branch `e0-scaffold`).

- [x] `package.json` raiz com workspaces `apps/*`, `packages/*`; scripts `check`, `lint`, `typecheck`, `test`, `migrate`, `seed`
- [x] `docker-compose.yml` com `db` (postgres:16) — senha via `POSTGRES_PASSWORD:?` (sem default)
- [x] `.env.example` (nomes, sem valores) · `.gitignore` (`.env`, `*.sqlite`, `node_modules`, `.next`)
- [x] `packages/core`: `src/config.js` (fail-closed), `src/db.js` (Knex PG), `test/` com os 2 testes acima, `vitest.config`
- [x] `apps/web`: Next App Router mínimo + `/api/health`
- [x] `apps/scheduler`: entrypoint que só loga "scheduler up" e sai (placeholder honesto, sem cron ainda)
- [x] ESLint + Prettier + `tsconfig` base
- [x] `.github/workflows/ci.yml` com service `postgres:16` → `npm ci && npm run check`
- [x] `README.md` (como subir em 5 comandos)
- [x] `git init`, branch `e0-scaffold`, PR, CI verde

Provas (2026-08-16):

```
$ npm run check   # ANTES (RED)
npm error Missing script: "check"
$ npx vitest run packages/core/test   # ANTES (RED)
Test Files  2 failed (2) · Tests  4 failed (4)  — "Failed to load url ../src/config.js"

$ docker compose up -d db && docker compose ps
cbd-checkin-db-1   Up 5 seconds (healthy)

$ npm run check   # DEPOIS (GREEN)
eslint .                         → 0 erros
prettier --check .               → All matched files use Prettier code style!
tsc --noEmit (apps/web)          → 0 erros
vitest (apps/web)                → ✓ test/health.test.ts (2 tests)
vitest (packages/core)           → ✓ env.test.js (2) · ✓ db.smoke.test.js (2)
Total: 6 testes verdes contra Postgres real

$ curl -s -w ' HTTP %{http_code}' localhost:3100/api/health
{"ok":true,"db":"up"} HTTP 200
$ docker compose stop db && curl ... /api/health
{"ok":false,"db":"down"} HTTP 503          # sem sucesso falso
$ docker compose start db && curl ... /api/health
{"ok":true,"db":"up"} HTTP 200

$ node apps/scheduler/src/index.js         # sem DATABASE_URL
Error: DATABASE_URL ausente: o processo não sobe sem banco configurado.

$ next build → ✓ Compiled successfully · ƒ /api/health

PR #1: https://github.com/stivaldj/medcheckin-v2/pull/1
CI:    https://github.com/stivaldj/medcheckin-v2/actions/runs/31963809494 → success
```

### E1 — Schema + migration 001 + seed sintético `[x]`

Migration única PG-first (schema em `DECISOES.md` §Modelo de dados). Seed: 2 pacientes, 1 cuidador, 1 produto, doses, perguntas.
**Prova:** `npm run migrate && npm run seed` → contagens; testes de constraint (clinic scope, `answers` unique, `notifications.dedup_key` unique, `dose_events` vigente).

**RED (antes de código):** `schema.test.js`, `doses.test.js`, `seed.test.js` + `helpers/db.js` → `3 failed | 2 passed` ("Failed to load url ../src/migrate.js / currentDose.js / seed/index.js").

**GREEN — provas (2026-08-16):**

```
$ npm test -w @medcheckin/core
 ✓ test/schema.test.js (8)  — 20 tabelas; clinic_id direto+índice em users/patients/products/question_sets/access_audit;
                              patients.clinic_id NOT NULL+FK (23502/23503); answers unique (23505);
                              notifications.dedup_key unique; respondents.invite_token unique + email opcional;
                              CHECK de enum (23514); só 1 alerta aberto por (patient, code) — reabre após resolved
 ✓ test/doses.test.js  (4)  — dose vigente = último effective_from <= data; ignora futuro; sem ajuste → null;
                              unique (medication_id, effective_from)
 ✓ test/seed.test.js   (5)  — contagens; 1 cuidador com relationship; e-mails .test / fones +55659100…;
                              recusa banco populado; --reset idempotente
 Test Files 5 passed · Tests 21 passed   (+2 no web = 23)

$ npm run migrate            → migrate: batch 1 aplicado → 001_init.js
$ npm run migrate            → migrate: já atualizado (nada a aplicar).
$ npm run seed               → seed: contagens {"clinics":1,"users":1,"patients":2,"respondents":3,"products":1,
                                "medications":2,"dose_events":3,"question_sets":1,"questions":7,"episodes":2}
$ npm run seed               → seed: o banco já contém dados; use { reset: true } (ou --reset) para recriar.
$ npm run seed -- --reset    → seed: contagens {…mesmas…}
$ NODE_ENV=production npm run seed → seed: recusado em produção (D7).
$ psql: 22 tabelas em public (20 + 2 do knex); dose vigente P1 = 4.00 gotas (2026-08-12), P2 = 0.50 ml
$ npm run check              → verde (lint, prettier, tsc, 23 testes)
```

Correção de raiz feita no caminho: `pg` devolvia `numeric`/`int8` como string (`'4.00'`); `db.js` agora registra type parsers — evita "4.00" virar string na API/UI (L5/L7).

### E2 — Core portado `[x]`

**Spec (escrita antes do código; API do `packages/core`):**

| Módulo                                     | API                                                                                                                                                                                         | Regras-chave                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `logger.js`                                | `logger.info/warn/error/debug(msg, fields)`, `logger.child(fields)`                                                                                                                         | JSON estruturado; redige chaves do v1 **+ `text`, `value`, `value_text`, `note`, `notes`, `name`, `email`, `phone`, `birth_date`, `endpoint`, `keys`**; sem middleware Express                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `scheduler/next-run.js`                    | `computeNextAttemptAt(nowDT, plan)`, `planFromEpisode(episode, patient)`                                                                                                                    | porta do v1 (luxon): dias da semana, horários, `intervalDays`+âncora, quiet hours (empurra p/ fim). Episódio: `daily`→todo dia; `weekly`→intervalo 7 ancorado em `started_at`; `biweekly`→14; horário = `patients.checkin_time`; quiet = `patients.quiet_*`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `scheduler/planner.js`                     | `planCheckins(db, now)`, `expireCheckins(db, now)`                                                                                                                                          | cria o check-in do dia local (`pending`, `next_attempt_at = scheduled_for`) para paciente `active` com episódio aberto, idempotente por `unique(patient_id, scheduled_for)`; `missed` quando `now > scheduled_for + 24h` sem `completed`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `checkin/engine.js`                        | `dispatchDueCheckins(db, now, {notifier})`, `recordAnswer(db, {checkinId, respondentId, questionKey, value}, now)`, `getNextQuestion(db, checkinId)`, `completeCheckin(db, checkinId, now)` | **L2:** estado só avança (`pending→sent`, `attempt_count+1`, `sent_at`) se `notifier.send` devolveu ok e a `notification` tem `sent_at`; falha → `failed_at`+`error`, check-in intocado. Sem respondente `can_answer` → nada muda. Quiet hours/pausa → `next_attempt_at` empurrado. `dedup_key = checkin:{id}:{respondentId}:{attempt}`. `recordAnswer` valida respondente (do paciente, `can_answer`, aceito), pergunta (do set do episódio, ativa, condição satisfeita), valor por tipo (0–10 inteiro; yes_no 0/1; choice ∈ options; number finito; text não vazio); grava/atualiza `answers`; `sent→in_progress`; devolve `{next, completed}`; sem próxima → `completeCheckin` (status, `completed_at`, score do dia, avaliação de alertas do paciente) |
| `scheduler/reminders.js`                   | `planMedicationIntakes(db, now)`, `dispatchDueIntakes(db, now, {notifier})`, `confirmIntake(db, {intakeId, respondentId, status, sideEffect, note}, now)`                                   | cria `medication_intakes` `pending` por `schedule_times` da **dose vigente** no dia local; alarme para respondentes `receives_alarms`, payload com dose vigente, `dedup_key = alarm:{intakeId}:{respondentId}`; **L4:** só `confirmIntake` muda `status` (`taken`/`skipped`; `late` se `taken` > 60 min após); envio nunca confirma                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `alerts/evaluate.js` + `alerts/actions.js` | `evaluatePatientAlerts(db, patientId, now)`, `evaluateAllAlerts(db, now)`, `acknowledgeAlert`, `resolveAlert({alertId, userId, note})`, `silenceAlerts`                                     | regras: `threshold:{key}` por `questions.alert_threshold_json` (nada hardcoded); `side_effect` (pergunta `is_side_effect` disparada) severidade `high` no mesmo dia; **L3:** `no_response` só se existe `checkins.sent_at` real e nenhum `completed` desde então há ≥ 48 h; `delivery_failed` ≥ 3 `notifications.failed_at` em 24 h; `low_score_streak`/`drop_fast`/`score_low_2d` sobre `patient_scores_daily` ignorando `score null`; silêncios suprimem; upsert = índice único parcial; auto-resolução (`resolved_reason=auto_cleared`) **só** para `no_response`/`delivery_failed`; **L15:** `resolveAlert` exige `note` e grava `alert_actions` na mesma transação                                                                                    |
| `scoring/computeDailyScore.js`             | `computeDailyScore(db, checkinId)`, `normalizeToTen`, `computeTrend`                                                                                                                        | migration 002 adiciona `questions.score_direction` (`higher_is_better`/`lower_is_better`/null=fora) e `score_weight`; score = média ponderada 0–10; **sem resposta pontuável → `score null`, `risk_level null`** (L5); trend = hoje − média dos 3 dias anteriores; risco `high` (≤3 ou trend ≤−2.5) / `medium` (≤4 ou ≤−1.5) / `low`; upsert `patient_scores_daily` na data local do check-in                                                                                                                                                                                                                                                                                                                                                              |
| `analytics/beforeAfter.js`, `rolling.js`   | `compareBeforeAfterByDose({doseEvents, series, windowDays})`, `rollingWindow`, `mean`                                                                                                       | base do gráfico sintoma × dose: para cada ajuste, média da série N dias antes/depois; sem dado → `null`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

Interface `notifier`: `{ send(notification) → Promise<{ok:boolean, error?:string}> }`. Em E2 só `fakeNotifier` de teste; Web Push real entra em E5.

**RED (antes de código):** `logger`, `next-run`, `scoring-utils`, `analytics`, `alerts-rules` → `5 failed` (arquivos ausentes); depois `engine`, `reminders`, `alerts`, `scoring`, `cycle` → `3 failed` (planner/engine/reminders/alerts ausentes).

**GREEN — provas (2026-08-16):**

```
$ npm test -w @medcheckin/core
 ✓ engine.test.js       (19) — planner daily/weekly/pausado; dispatch ok (sent, attempt 1, sent_at, dedup_key
                               checkin:{id}:{resp}:{n}); PROVA: envio falha → notification.failed_at+error, check-in
                               pending/0/null; sem duplicata; retry 60 min até max_attempts; quiet hours empurra
                               p/ 08:00; pausado adia; só can_answer recebe; sem respondente → intocado;
                               recordAnswer: ordem, in_progress, condicional (efeito_adverso→efeito_qual), pular
                               opcional, completar → score 4/medium + alertas threshold:dor + side_effect(high);
                               sem pontuável → null/null; validações (escala, choice, pergunta, respondente,
                               can_answer, encerrado, obrigatória, condição); reenvio atualiza; expire → missed
 ✓ reminders.test.js    (5)  — intakes pela dose vigente (5 = 2+3), idempotente; alarme só vencidos, só
                               receives_alarms, payload com dose; PROVA: envio NÃO confirma (pending);
                               falha → failed_at + retry; confirmIntake taken/late/skipped+efeito; rejeições
 ✓ alerts.test.js       (10) — L3 no_response só com sent_at real ≥48h, auto_cleared ao responder; 30h não;
                               delivery_failed ≥3/24h; threshold por pergunta + side_effect do último completed,
                               upsert toca last_seen; low_score_streak; silêncio; evaluateAll; ack; resolve sem
                               nota rejeitado / com nota grava alert_actions na mesma tx; listOpen por severidade
                               e clínica
 ✓ scoring.test.js      (3)  — ponderado 7 + trend 2 na data local; só dor → 1/high; nada → null/null
 ✓ cycle.test.js        (2)  — cron duplo não duplica; alertas 1×/h; sem notifier → lança
 ✓ next-run (10) · logger (4) · scoring-utils (5) · analytics (5) · alerts-rules (5) · schema (8) · doses (4)
   · seed (5) · db.smoke (2) · env (2)
 Test Files 15 passed · Tests 89 passed   (+2 web = 91)   [meta ≥ 40 ✔]

$ npm run check → verde (lint, prettier, tsc, 91 testes)

$ npm run seed -- --reset && node -e "runCycle(db, 09:05 local, { notifier: RECUSA })"
planner: {"candidates":2,"created":1} | dispatch: {"due":1,"sent":0,"failed":1,...} | alarms: {"due":2,"sent":0,"failed":2}
checkins: [{"name":"Paciente Sintético Um","status":"pending","attempt_count":0,"sent_at":null}]   ← L2
notifications: 3 | failed: 3 | sent: 0 | erro: "sem canal de push ainda (E5)"
intakes: 5 | todos pending: true                                                                    ← L4
```

Engine (entrada estruturada `recordAnswer`), scheduler/next-run com episódios, alertas (regras + efeito adverso + `no_response` só com envio real), scoring (`null` sem dado), logger (redige `text`, `value`, `notes`).
**Prova:** ≥ 40 testes core verdes contra PG; teste "check-in não avança sem envio"; teste "lembrete só confirmado pelo respondente".

### E3 — Auth + tenancy + audit `[x]`

**Prova:** teste 401/404 cross-clinic; linha em `access_audit` ao abrir paciente.

**Spec (escrita antes do código):**

| Peça                      | API / comportamento                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Migration 003             | `auth_tokens(id, kind[magic_link], email, user_id, token_hash unique, expires_at, used_at, created_at)`; `sessions(id, token_hash unique, user_id?, respondent_id?, clinic_id, expires_at, last_seen_at, revoked_at, ua, created_at)` com CHECK "exatamente um principal"; índices por `token_hash`, `expires_at`                                                                                                                                                        |
| `core/auth/tokens.js`     | `newToken()` (32 bytes aleatórios, base64url) · `hashToken(t)` (sha256) — só o hash vai ao banco                                                                                                                                                                                                                                                                                                                                                                         |
| `core/auth/magic-link.js` | `requestMagicLink(db, {email, baseUrl, mailer}, now)`: se existe `users.email` → cria token (validade 15 min), envia e-mail com `${baseUrl}/auth/verify?token=…`; se não existe → **mesma resposta** (sem enumeração), só `logger.warn`; throttle 3 pedidos/15 min por e-mail. `verifyMagicLink(db, {token, ua}, now)`: hash → token não usado e não expirado → marca `used_at`, cria sessão (30 d) → `{sessionToken, session}`; inválido → `AuthError('invalid_token')` |
| `core/auth/invite.js`     | `acceptInvite(db, {inviteToken, consentVersion, ua}, now)` (D12): respondente por `invite_token` → se `accepted_at` nulo, grava `accepted_at`, `consent_version`, `consent_at` (consentimento obrigatório: sem `consentVersion` → erro); cria sessão do respondente (180 d). Reuso do link cria nova sessão (dispositivo novo). `rotateInviteToken(db, respondentId)` para invalidar link vazado                                                                         |
| `core/auth/session.js`    | `getSession(db, sessionToken, now)` → `{kind:'user'                                                                                                                                                                                                                                                                                                                                                                                                                      | 'respondent', clinicId, userId?, role?, respondentId?, patientId?, name}`ou`null`(expirada/revogada);`last_seen_at`atualizado no máx. 1×/5 min.`revokeSession`, `revokeAllForPrincipal` |
| `core/auth/access.js`     | `requirePatientInClinic(db, session, patientId)` → paciente ou `AuthError('not_found')` (**404, nunca 403** — sem enumeração cross-clinic); respondente só acessa `session.patientId`. `logAccess(db, {session, patientId, route, action})` → `access_audit`                                                                                                                                                                                                             |
| `core/auth/mailer.js`     | interface `{ sendMail({to, subject, text}) }`; `createSmtpMailer(env)` (nodemailer; **fail-closed**: sem `SMTP_HOST`/`EMAIL_FROM` → lança); `fakeMailer()` nos testes                                                                                                                                                                                                                                                                                                    |
| `apps/web/lib/auth.ts`    | `readSessionCookie(req)`, `setSessionCookie(res, token, {kind})` (`HttpOnly; SameSite=Lax; Path=/; Secure` em produção), `requireUser(req)` / `requireRespondent(req)` → 401 JSON                                                                                                                                                                                                                                                                                        |
| Rotas                     | `POST /api/auth/magic-link {email}` → 202 sempre · `GET /auth/verify?token=` → seta cookie e redireciona `/hoje` (ou `/auth/invalido`) · `POST /api/auth/logout` · `POST /api/p/accept {token, consentVersion}` → cookie do respondente · `GET /api/patients/:id` (mínimo em E3: nome/status; **grava `access_audit`**)                                                                                                                                                  |
| Compose/env               | serviço `mailpit` (SMTP 1025, UI 8025) no compose de dev; `.env.example` ganha `APP_BASE_URL`; `DATABASE_URL_TEST` (banco `medcheckin_test`) para os testes — ACHADOS E2                                                                                                                                                                                                                                                                                                 |

**RED planejado:** `core/test/auth.test.js` (magic link: envia só p/ e-mail existente, mesma resposta p/ inexistente, token usado/expirado falha, sessão válida/expirada/revogada, throttle; invite: aceite grava consentimento, sem consentimento falha, reuso cria 2ª sessão, rotate invalida; access: paciente da clínica ok, de outra clínica → not_found, respondente só o próprio paciente, `logAccess` grava linha) · `web/test/auth-routes.test.ts` (`GET /api/patients/:id` sem cookie → 401; cookie da clínica A + paciente da clínica B → 404; próprio → 200 **e** linha em `access_audit`; `POST /api/auth/magic-link` → 202 e e-mail no fakeMailer; `GET /auth/verify` → `Set-Cookie` HttpOnly SameSite=Lax; `POST /api/p/accept` → cookie do respondente).

**RED:** `core/test/auth.test.js` → "Failed to load url ../src/auth/tokens.js"; `web/test/auth-routes.test.ts` → 8 falhando (rotas ausentes / alias `@`).

**GREEN — provas (2026-08-16):**

```
$ npm test -w @medcheckin/core → ✓ auth.test.js (14): tokens; link mágico só p/ e-mail existente,
  resposta neutra, normalização, throttle 3/15min, verify cria sessão 30d, uso único, expirado;
  convite exige consentimento, grava accepted/consent, reuso cria 2ª sessão sem sobrescrever,
  rotate invalida, getSession null p/ expirada/revogada + last_seen; tenancy not_found (nunca
  forbidden), respondente só o próprio paciente, unauthenticated, logAccess grava linha
  Test Files 16 · Tests 103
$ npm test -w @medcheckin/web  → ✓ auth-routes.test.ts (8): 401 sem cookie; 404 cross-clinic;
  200 + linha em access_audit; cookie de respondente não serve p/ rota da médica; 202 sempre;
  verify → 302 /hoje + Set-Cookie HttpOnly SameSite=Lax (inválido → /auth/invalido, sem cookie);
  accept → mc_resp / 400 sem consentimento / 404 token inválido; logout limpa cookie e revoga
  Tests 10   → total 113
$ npm run check → verde

$ next dev + Mailpit real (docker compose up -d mailpit):
POST /api/auth/magic-link {medica@…}   → 202     | {x@nao.test} → 202 (neutro)
Mailpit: total 1 → medica@medcheckin.test | "Seu acesso ao MedCheck-in" (token 43 chars)
GET /auth/verify?token=…               → 302 /hoje · set-cookie: mc_user=…; Path=/; Max-Age=2592000; HttpOnly; SameSite=Lax
GET /auth/verify (reuso do token)      → 302 /auth/invalido (uso único)
GET /api/patients/P1  sem cookie       → 401 {"error":"unauthenticated"}
GET /api/patients/P1  cookie médica    → 200 {"id","name":"Paciente Sintético Um","status":"active",…}
GET /api/patients/PB  (Clínica B)      → 404 {"error":"not_found"}   (id inexistente → 404 idêntico)
access_audit: /api/patients/[id] | view | medica@medcheckin.test | Paciente Sintético Um   (0 linhas p/ PB)
GET /hoje com cookie → "Olá, Dra. Sintética" · sem cookie → 307 /login
POST /api/p/accept {seed-c2, v1}       → 200 · set-cookie: mc_resp=…; Max-Age=15552000; HttpOnly; SameSite=Lax
POST /api/auth/logout                  → set-cookie: mc_user=; Max-Age=0 · depois GET P1 → 401
```

### E4 — API + telas da médica `[ ]`

Pacientes, Paciente (grade 14d, medicações, ajustar dose), Perguntas & planos.
**Prova:** Playwright: cadastrar paciente → convidar cuidador → criar dose → ver dose vigente.

### E5 — PWA do respondente `[ ]`

Aceite/consentimento, Hoje (alarmes + check-in), push VAPID + fila `notifications`, service worker.
**Prova:** Playwright: cuidador aceita → recebe check-in → responde → `answers` gravadas → próxima pergunta/encerramento; push entregue em navegador de teste (log).

### E6 — Loop fechado `[ ]`

Scheduler → notificação → resposta → alerta → conduta; tela Hoje da médica; gráfico sintoma × dose.
**Prova:** E2E com clock falso (48 h): 1 ajuste de dose, 1 efeito adverso → alerta → conduta registrada; gráfico com marcador.

### E7 — Relatório 30d, LGPD, retenção, RUNBOOK `[ ]`

**Prova:** export.zip com contagens; anonimizar mantém séries; `docs/LGPD.md`.

### E8 — Deploy `[ ]`

Dockerfile, compose prod (segredos `:?`), Caddy, backup diário + restore drill, uptime.
**Prova:** `curl https://…/health` 200; restore drill com hash; alerta de uptime recebido.

### E9 — Shadow run (1 semana, equipe) `[ ]`

Critérios escritos **antes**. **Prova:** relatório critério × resultado.

### E10 — Piloto real `[ ]`

Critério de sucesso e de aborto definidos antes. **Prova:** relatório final; decisão de ampliar.

### E11 — WhatsApp "responda no app" (opcional, após E10) `[ ]`

## Log de progresso

| Data       | Etapa | Evento                                                                                                                                                                                    |
| ---------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-08-16 | —     | Auditoria do v1 lida; `PLANO.md`, `ACHADOS.md`, `DECISOES.md` criados. Aguardando "ok" para E0.                                                                                           |
| 2026-08-16 | E3    | Auth próprio (D14): link mágico, convite/consentimento, sessões opacas, tenancy 404, access_audit; Mailpit no compose; DB de teste separado. 113 testes. Aguardando "ok, avance" para E4. |
| 2026-08-16 | E2    | Core portado: engine (entrada estruturada), planner/next-run com episódios, lembretes, alertas, scoring, analytics, logger, runCycle. 89 testes core. Aguardando "ok, avance" para E3.    |
| 2026-08-16 | E1    | Schema (migration 001, 20 tabelas), `currentDose`, seed sintético. 21 testes core verdes contra PG. Aguardando "ok, avance" para E2.                                                      |
| 2026-08-16 | E0    | Scaffold concluído. RED→GREEN, `npm run check` verde, PR #1 com CI verde. Repo: github.com/stivaldj/medcheckin-v2. Aguardando "ok, avance" para E1.                                       |
