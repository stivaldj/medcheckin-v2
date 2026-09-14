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

### E4 — API + telas da médica `[x]`

**Prova:** Playwright: cadastrar paciente → convidar cuidador → criar dose → ver dose vigente.

**Spec (antes do código):**

| Camada                                                                                                                            | Conteúdo                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core/patients/`                                                                                                                  | `createPatient(db, session, input)` (dados + respondentes; `invite_token` gerado por respondente; audit `create`) · `updatePatient` (campos, `status` pause/discharge) · `listPatients(db, {clinicId})` com resumo (episódio atual, último check-in, alertas abertos, dose vigente por medicação) · `getPatientDetail(db, session, id)` (paciente, respondentes **com link de convite** — D12, medicações + dose vigente + histórico, episódio aberto, alertas abertos, `grid`) · `addRespondent`, `updateRespondent` · `patientGrid(db, patientId, {days:14})` → datas × perguntas (última resposta do dia) + score/risco por dia |
| `core/medications/`                                                                                                               | `listProducts`/`createProduct` (por clínica) · `addMedication(patientId, productId)` · `adjustDose(db, session, {medicationId, effective_from, dose_amount, dose_unit, times_per_day, schedule_times, reason, note, open_titration?})` — valida, insere `dose_events`, e se `open_titration` fecha o episódio aberto e abre `titration/daily` ancorado no ajuste (D5) · `setEpisode(patientId, {kind, checkin_frequency, question_set_id})`                                                                                                                                                                                        |
| `core/questions/`                                                                                                                 | `listQuestionSets(clinicId)` · `createQuestionSet` · `saveQuestions(setId, questions[])` (upsert por `key`; slug automático de `label` quando `key` ausente; valida `kind`, `options` p/ choice, `condition_json.when` existente e anterior na ordem, `alert_threshold_json`, `score_direction`) · `deactivateQuestion` (nunca apaga: `answers` referenciam) — lógica portada do editor EJS do v1                                                                                                                                                                                                                                  |
| API (`requireUser` + tenancy + `access_audit` em toda rota de paciente; **`assertSameOrigin` em toda rota mutável** — ACHADOS E3) | `GET/POST /api/patients` · `GET/PATCH /api/patients/[id]` · `GET /api/patients/[id]/grid` · `POST /api/patients/[id]/respondents` · `PATCH /api/respondents/[id]` · `POST /api/respondents/[id]/rotate` · `POST /api/patients/[id]/medications` · `POST /api/medications/[id]/doses` · `POST /api/patients/[id]/episodes` · `GET/POST /api/products` · `GET/POST /api/question-sets` · `PUT /api/question-sets/[id]/questions`                                                                                                                                                                                                     |
| Telas (`app/(medica)/`, layout com nav + guard de sessão; shadcn/ui + Tailwind)                                                   | `/pacientes` (lista com resumo; "Novo paciente") · `/pacientes/novo` (dados + respondentes + consentimento **do responsável pelo cadastro** = `consent_version` do paciente) · `/pacientes/[id]` (cabeçalho + pausar/alta; respondentes com **link copiável** e rotate; medicações com **dose vigente** e "Ajustar dose" (dialog: dose, unidade, vezes/dia, horários, motivo, abrir titulação); episódio atual (trocar); grade 14 d × perguntas com "—" sem dado; alertas abertos) · `/perguntas` (conjuntos + editor: tipo, opções, obrigatória, condição, limiar, efeito adverso, score; slug automático)                        |
| Regras de UI                                                                                                                      | nenhum número sem fonte (grade/dose vêm da API); sem dado → "—"; toast só após 2xx; erros da API exibidos; sem `catch {}`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| E2E                                                                                                                               | Playwright (`apps/web/e2e/`), servidor `next dev` no `DATABASE_URL_TEST`; sessão criada via `createSession` do core (sem backdoor de dev) e injetada como cookie                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

**RED planejado:** `core/test/patients.test.js`, `medications.test.js`, `questions.test.js` (serviços) · `web/test/medica-api.test.ts` (rotas + Origin) · `web/e2e/medica.spec.ts` (fluxo da prova).

**RED:** `core/test/services.test.js` → "Failed to load url ../src/patients/index.js"; `web/test/medica-api.test.ts` → 7 falhando (rotas ausentes); E2E não rodava (sem páginas).

**GREEN — provas (2026-08-16):**

```
$ npm test -w @medcheckin/core → ✓ services.test.js (13): createPatient (respondentes com invite_token, audit,
  ≥1 can_answer), listPatients (escopo + episódio + alertas + dose vigente), getPatientDetail (invite_url,
  histórico de dose, grade 14d, not_found cross-clinic), updatePatient (pausar/alta), add/updateRespondent,
  patientGrid (última resposta do dia, null sem dado, score); products; adjustDose (validações, mesma data,
  open_titration fecha o anterior); setEpisode; slugify/validateQuestion; saveQuestions (upsert por key,
  ordem, condição só p/ anterior, desativa em vez de apagar); not_found  → 116 core
$ npm test -w @medcheckin/web  → ✓ medica-api.test.ts (7): CSRF Origin (403/201/201 sem Origin), lista+POST
  (400 validation), detalhe+audit+PATCH, respondentes+rotate, medications+doses+episodes, products,
  question-sets+PUT  → 17 web (133 total)
$ npm run check → verde
$ npx playwright test (apps/web, next dev no DATABASE_URL_TEST, sessão via createSession do core):
  ✓ fluxo completo (12 s): /pacientes → Novo paciente (dados + cuidadora + consentimento) → detalhe com
    link de convite "/p/convite/…" e "convite pendente" → Convidar cuidador (dialog) → Adicionar medicação
    ("Sem dose vigente") → Ajustar dose 3 gotas 2×/dia 08:00/20:00 → "Dose vigente: 3 gotas · 2×/dia
    (08:00, 20:00)" → episódio "Titulação · check-in diário" → grade → lista mostra "3 gotas · 2×/dia"
  ✓ perguntas: criar conjunto → adicionar pergunta → "chave: como_esta_a_ansiedade_hoje" → Salvo.
  ✓ sem sessão → /login
  3 passed (18 s) · screenshot test-results/paciente-e2e.png (enviado ao dono)
```

### E5 — PWA do respondente `[x]`

**Prova:** Playwright: cuidador aceita → recebe check-in → responde → `answers` gravadas → próxima pergunta/encerramento; push entregue em navegador de teste (log).

**Spec (antes do código):**

| Camada                                             | Conteúdo                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core/push/`                                       | `createWebPushNotifier({vapidPublicKey, vapidPrivateKey, subject}, db)` (lib `web-push`; **fail-closed** sem chaves): `send(notification)` → envia a todas as `push_subscriptions` ativas do `respondent_id` com payload `{title, body, url, kind, ...}`; ≥1 aceita → `{ok:true}`; nenhuma inscrição → `{ok:false, error:'no_subscription'}`; 404/410 do push service → `revoked_at` na inscrição; `savePushSubscription(db, session, {endpoint, keys, ua})` (upsert por endpoint, reativa), `removePushSubscription`                                                                                                                                                                                                                                                             |
| `core/respondent/`                                 | `respondentToday(db, session, now)` → `{respondent, patient, checkin: {id, status, total, answered, next, completed} \| null, alarms: [{intake_id, scheduled_at, status, product_name, dose_amount, dose_unit, taken_at, side_effect_flag}], push: {subscriptions}}` — check-in de hoje (fuso do paciente) ou o mais recente aberto (<24 h), só se `can_answer`; alarmes só se `receives_alarms`; `respondentHistory(db, session, {days:30})` → por dia: respostas (key→valor) + intakes; `answerFromRespondent(db, session, {checkinId, questionKey, value})` (valida que o check-in é do paciente da sessão → `recordAnswer`); `confirmFromRespondent(db, session, {intakeId, status, sideEffect, note})` → `confirmIntake`. Todas auditam (`access_audit` com `respondent_id`) |
| API (`respondentRoute`: cookie `mc_resp` + Origin) | `GET /api/p/today` · `POST /api/p/checkins/[id]/answers {questionKey, value}` → `{next, completed}` · `POST /api/p/intakes/[id]/confirm {status, sideEffect, note}` · `GET /api/p/history` · `GET /api/p/vapid` (chave pública) · `POST/DELETE /api/p/push`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| PWA (`app/p/`)                                     | `manifest.webmanifest` (start_url `/p/hoje`, standalone, ícones 192/512 gerados por script) · `public/sw.js` (push → `showNotification`; click → foca `/p/hoje`) · `/p/convite/[token]` (nome do paciente/clínica, termo de consentimento `v1`, aceite → `POST /api/p/accept` → `/p/hoje`) · `/p/hoje` (alarmes de dose com **Tomei / Não tomei / Tive efeito**; check-in do dia como formulário pergunta a pergunta com progresso; botão "Ativar notificações" que registra o SW e assina push) · `/p/historico` (últimos 30 dias) · sem cookie → mensagem "abra o link de convite"                                                                                                                                                                                              |
| `apps/scheduler`                                   | `runCycle` a cada `SCHEDULER_INTERVAL_MS` (60 s) com o notifier de Web Push; `--once` para rodar um ciclo e sair; SIGTERM limpo; fail-closed sem `VAPID_*`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Prova de push                                      | (a) teste do notifier contra um **push service local** (servidor HTTP no teste): payload cifrado chega, `sent_at` marcado, 410 → `revoked_at` e falha; (b) E2E: SW registrado (`navigator.serviceWorker.ready`) e fluxo do respondente. Chromium headless não tem push service (FCM) → a entrega real de push é provada em (a) e manualmente no Chrome do dono em E9                                                                                                                                                                                                                                                                                                                                                                                                              |

**RED planejado:** `core/test/respondent.test.js`, `core/test/push.test.js` · `web/test/pwa-api.test.ts` · `web/e2e/respondente.spec.ts`.

**RED:** `respondent.test.js`/`push.test.js` → "Failed to load url ../src/push/index.js / respondent/index.js"; `pwa-api.test.ts` → rotas ausentes; E2E sem páginas.

**GREEN — provas (2026-08-16):**

```
$ npm test -w @medcheckin/core
 ✓ push.test.js (4) — PROVA E5-a: fail-closed sem VAPID; sem inscrição → failed "no_subscription";
   savePushSubscription (upsert) + envio REAL: push service local recebe POST com
   content-encoding aes128gcm + authorization "vapid …" + corpo cifrado → sent_at marcado;
   410 → inscrição revoked_at, envio failed; removePushSubscription
 ✓ respondent.test.js (5) — today (check-in c/ progresso e próxima; alarmes com dose; can_answer /
   receives_alarms respeitados; audit); answer (ordem, condicional, encerra; not_found cross-paciente;
   invalid_value); confirm (tomei / não tomei+efeito; not_found; status inválido); history
 ✓ migrations.test.js (1) — latest → seed → rollback total (com respostas puladas) → latest
 Test Files 20 · Tests 126
$ npm test -w @medcheckin/web → ✓ pwa-api.test.ts (4): today 401/200; answers (403 Origin, 400 inválido,
   200 → next + progress + answers.respondent_id); confirm; vapid/push POST+DELETE/history  → 21 web (147)
$ npm run check → verde
$ node apps/scheduler/src/index.js --once  (Web Push real, sem inscrições)
 {"once":true,"summary":{"checkins":{"created":1},"dispatch":{"due":1,"sent":0,"failed":1},"intakes":{"created":5},
  "alarms":{"due":3,"sent":0,"failed":3}, …}}  ← honesto: sem inscrição = failed
$ (sem VAPID) → "VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY e VAPID_SUBJECT são obrigatórios" (não sobe)
$ npx playwright test → 5 passed
 ✓ respondente: sem sessão → "abra o link de convite"
 ✓ PROVA E5: /p/convite/seed-c2 (termo v1, aceite desabilitado até concordar) → aceite → /p/hoje "Olá,
   Cuidadora Sintética" · "Acompanhando Paciente Sintético Dois" · 3 alarmes · "1 de 6" → dor 4 → sono 6 →
   humor 6 → crises 0 → efeito sim → condicional efeito_qual aparece ("6 de 7") → tontura → obs "tudo bem"
   → "Check-in concluído" → DB: 7 answers com respondent_id da cuidadora, checkin completed, alerta
   side_effect aberto → alarme "Tomei" → "Tomou" → SW registrado em /p/ → PushToggle (denied no headless)
   → /p/historico mostra "dor: 4", "tontura", "tomou". Screenshot enviado ao dono.
```

Push em navegador real (Chrome/Android/iOS PWA): manual em E9 (shadow run) — Chromium headless não tem push service.

### E6 — Loop fechado `[x]`

**Prova:** E2E com clock falso (48 h): 1 ajuste de dose, 1 efeito adverso → alerta → conduta registrada; gráfico com marcador.

**Spec (antes do código):**

| Camada                     | Conteúdo                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Migration 004              | `system_state(key pk, value jsonb, updated_at)` — carimbos do scheduler (`scheduler.last_cycle_at`, `alerts.last_run_at`); fecha ACHADOS E2/E5                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `core/scheduler/cycle.js`  | relógio de alertas persistido em `system_state` (não mais em memória); heartbeat `scheduler.last_cycle_at` a cada ciclo; `getSystemState(db)`                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `core/dashboard/today.js`  | `dashboardToday(db, {clinicId}, now)` → `{awaiting: [{patient, checkin, sent_at, attempt_count}] (hoje local: sent/in_progress sem completed) , missed_today, open_alerts (listOpenAlerts), upcoming: [{patient, kind:'checkin'                                                                                                                                                                                                                                                                                                                                                     | 'alarm', at}] (próximas 24 h), intakes: {pending_confirmation:[…] (vencidos sem confirmação), taken, late, skipped}, scheduler: {last_cycle_at, stale:boolean (>10 min)}}` — **cada número com a consulta que o gera** |
| `core/analytics/series.js` | `symptomDoseSeries(db, patientId, {questionKey, days})` → `{question, points:[{date, value, score}], doseMarkers, beforeAfter: compareBeforeAfterByDose(...)}`; sem resposta no dia → `value null`                                                                                                                                                                                                                                                                                                                                                                                  |
| API                        | `GET /api/today` · `POST /api/alerts/[id]/ack` · `POST /api/alerts/[id]/resolve {note}` (**409 sem nota**) · `POST /api/alerts/[id]/note` · `GET /api/alerts/[id]/actions` · `GET /api/patients/[id]/series?question=&days=`                                                                                                                                                                                                                                                                                                                                                        |
| Telas                      | `/hoje` real: 4 blocos (Não respondeu · Alertas abertos → conduta inline · Próximos envios · Confirmações de dose pendentes) + faixa do scheduler ("último ciclo há N min" / **vermelho se parado**) · página do paciente: `AlertsCard` com **Reconhecer / Resolver com conduta** (dialog, nota obrigatória) e lista de condutas; `SymptomDoseChart` (Recharts): linha do sintoma escolhido + score, marcadores verticais nos ajustes de dose, tabela antes/depois por ajuste ("—" sem dado)                                                                                        |
| E2E (`e2e/loop.spec.ts`)   | **clock falso**: o teste chama o core com `now` explícito (T-1d 09:00 local → `runCycle` c/ fake notifier → check-in enviado; cuidadora responde dor 8 → `threshold:dor`; a médica **ajusta a dose** pela UI (vigente hoje, abre titulação); T0 09:00 → `runCycle` → 2º check-in; cuidadora responde **efeito adverso** → `side_effect`) → `/hoje` lista o alerta → **Resolver com conduta** ("Reduzi para 2 gotas…") → alerta resolvido, conduta na página do paciente → gráfico com **marcador** do ajuste e ponto de dor. Outro paciente sem resposta aparece em "Não respondeu" |

**RED planejado:** `core/test/dashboard.test.js`, `core/test/series.test.js`, `core/test/system-state.test.js` · `web/test/today-api.test.ts` · `web/e2e/loop.spec.ts`.

**RED:** `dashboard.test.js` (dashboard + series + system_state num arquivo) → "Failed to load url ../src/dashboard/today.js"; `today-api.test.ts` → rotas ausentes; `loop.spec.ts` sem telas.

**GREEN — provas (2026-08-16):**

```
$ npm test -w @medcheckin/core → ✓ dashboard.test.js (5): system_state (carimbos gravados; alertas 1×/h sobrevive a
  "reinício" — relógio no banco); Hoje: awaiting (sent) → responde → some + threshold aparece; confirmações
  vencidas × confirmadas; próximos envios 24 h (alarmes + reenvio); heartbeat stale (>10 min); missed separado;
  escopo por clínica; symptomDoseSeries (null sem resposta, marcador 6 gotas, antes/depois)  → 131 core
$ npm test -w @medcheckin/web  → ✓ today-api.test.ts (3): /api/today 401/200 escopado; ack → resolve sem nota 400 →
  com nota 200 + actions (user_name) → alerta de outra clínica 404; series 200/400  → 24 web (155)
$ npm run check → verde
$ npx playwright test → 8 passed (workers=1: specs compartilham o banco)
 ✓ PROVA E6 (loop.spec.ts, clock falso 48 h):
   T-1d 09:05 runCycle(fake notifier) → planner cria o check-in de "ontem" e envia (sent) → dor 8 → threshold:dor
   médica (UI) → Ajustar dose 6 gotas vigente hoje → "Dose vigente: 6 gotas" · episódio Titulação
   T0 09:05 runCycle → 2º check-in enviado (e P2, que ninguém responde) → efeito adverso (sonolência) → side_effect
   /hoje → "Não respondeu": Paciente Sintético Dois (P1 não) · alerta "Efeito adverso relatado" → Resolver sem nota
   bloqueado (required) → conduta "Reduzi para 4 gotas…" → alerta some; DB: resolved/doctor + alert_actions [resolve]
   · faixa do scheduler visível → /pacientes/P1: conduta listada; gráfico com ≥2 pontos (dor 8, 5) e ≥1 marcador
   (ajuste de hoje); tabela antes/depois com "6 gotas". Screenshot enviado ao dono.
```

### E7 — Relatório 30d, LGPD, retenção, RUNBOOK `[x]`

**Prova:** export.zip com contagens; anonimizar mantém séries; `docs/LGPD.md`.

**Spec (antes do código):**

| Peça                           | Conteúdo                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core/report/patientReport.js` | `patientReport(db, session, patientId, {days:30})` → `{patient, period, checkins:{sent, completed, missed, completion_rate}, adherence:{scheduled, taken, late, skipped, unconfirmed, rate (só confirmações — L4)}, symptoms:[{key,label,n,mean,min,max,last}], scores:{n, mean, last, risk_last}, doses:[…], alerts:[…com condutas], side_effects:[…]}`; **sem dado → null**; audit `report`                                                                                                                                                                                                                                                                                                        |
| `core/lgpd/export.js`          | `exportPatientData(db, session, patientId)` → `{manifest:{generated_at, patient_id, counts:{tabela:n}, consent}, files:{'patient.json',…}}` + `buildExportZip(...)` (jszip) → Buffer; audit `export`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `core/lgpd/anonymize.js`       | `anonymizePatient(db, session, patientId, {reason})` (transação): `patients.name`→"Paciente anonimizado <8 hex>", `birth_date`→null, `status`→discharged; `respondents.name`→"Respondente N", email/phone/relationship→null, `invite_token` rotacionado, sessões revogadas, `push_subscriptions` apagadas; `answers.value_text`→"[removido]"; `notifications.payload`→{}; `medication_intakes.note`/`dose_events.note`→null; **mantém**: `answers.value_num/value_choice`, `patient_scores_daily`, `dose_events` (valores), `alerts`/`alert_actions` (condutas), `episodes`, `access_audit`; grava audit `anonymize` com `reason`. Não há hard delete (prontuário tem guarda legal — `docs/LGPD.md`) |
| `core/lgpd/retention.js`       | `applyRetention(db, now, {notificationsDays:90, sessionsDays:30, authTokensDays:7, accessAuditDays:730})` → apaga notificações antigas, sessões expiradas/revogadas há >30 d, tokens usados/expirados >7 d, audit >2 anos; `runCycle` chama 1×/dia (carimbo em `system_state`)                                                                                                                                                                                                                                                                                                                                                                                                                       |
| API                            | `GET /api/patients/[id]/report` · `GET /api/patients/[id]/export` (zip, `Content-Disposition`) · `POST /api/patients/[id]/anonymize {reason, confirmName}` (nome deve bater) · `GET /api/settings`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Telas                          | `/pacientes/[id]/relatorio` (imprimível: `@media print`, botão Imprimir; números com n) · na página do paciente: botões "Relatório 30 d", "Exportar dados (LGPD)", "Anonimizar" (dialog: motivo + digitar o nome) · `/configuracoes` (perfil/clínica; respondentes convidados por paciente com status; sistema: scheduler heartbeat, retenção, push configurado)                                                                                                                                                                                                                                                                                                                                     |
| Docs                           | `docs/LGPD.md` (bases legais, dados tratados, direitos: acesso/portabilidade → export; eliminação → anonimização + retenção; consentimento por respondente; incidentes) · `docs/RUNBOOK.md` (subir, migrar, seed, scheduler, logs, export/anonimizar, retenção, incidentes; backup/restore apontam para E8)                                                                                                                                                                                                                                                                                                                                                                                          |

**RED planejado:** `core/test/lgpd.test.js`, `core/test/report.test.js` · `web/test/lgpd-api.test.ts` · `web/e2e/lgpd.spec.ts` (relatório imprimível + export download + anonimizar).

**RED:** `lgpd.test.js` (relatório + LGPD num arquivo) → "Failed to load url ../src/report/patientReport.js"; `lgpd-api.test.ts` → rotas ausentes; E2E sem telas.

**GREEN — provas (2026-08-16):**

```
$ npm test -w @medcheckin/core → ✓ lgpd.test.js (5): relatório (check-ins 3/3, adesão só por confirmação
  taken 3 · skipped 2 · sem confirmação 1 → 60 %, dor n=3 mín 3 máx 8 média 5,67, scores n=3, doses c/ 5 gotas,
  alerta side_effect resolvido c/ conduta, efeitos; paciente sem dado → nulls);
  PROVA export: manifest.counts {respondents 1, medications 1, dose_events 3, intakes 6, episodes 1, checkins 3,
  answers 19, …} + zip legível (manifest.json + 10 json; notifications só metadados) + audit `export`, cross-clinic
  not_found; PROVA anonimizar: nome → "Paciente anonimizado <hash>", nascimento null, alta, respondente
  "Respondente 1" sem e-mail/telefone, token rotacionado, sessões revogadas, push apagado, texto livre "[removido]",
  notes null, payload {} — e as SÉRIES iguais antes/depois (symptomDoseSeries, doses, scores, conduta mantida),
  audit `anonymize`, idempotente; retenção: notificações >90 d, sessões >30 d, tokens >7 d, audit >2 anos, 1×/dia
  via runCycle (carimbo system_state)  → 136 core
$ npm test -w @medcheckin/web → ✓ lgpd-api.test.ts (4): report; export zip (content-disposition, manifest);
  anonymize (nome errado 400, sem motivo 400, ok 200); settings  → 28 web (164)
$ npm run check → verde
$ npx playwright test → 9 passed
 ✓ lgpd.spec.ts: relatório imprimível → botão Exportar baixa medcheckin-export-…zip (manifest lido no teste)
   → Anonimizar (botão só habilita com o nome exato) → "Paciente anonimizado" → scores e doses idênticos, e-mail null
```

### E8 — Deploy `[x]` (local; remoto depende do dono — ver `docs/DEPLOY.md`)

**Prova:** `curl https://…/health` 200; restore drill com hash; alerta de uptime recebido.

**Spec (antes do código):**

| Peça                                       | Conteúdo                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/web/Dockerfile`                      | multi-stage (deps → build `next build` standalone → runner `node:22-alpine`, usuário não-root, `HEALTHCHECK` em `/api/health`)                                                                                                                                                                                                                                                       |
| `apps/scheduler/Dockerfile`                | `node:22-alpine`, só `@medcheckin/core` + `@medcheckin/scheduler`; expõe **`/health`** (porta `SCHEDULER_PORT`, 200 se último ciclo < 5 min, 503 caso contrário) — fecha ACHADOS E5/E6                                                                                                                                                                                               |
| `/api/health` (web)                        | `{ok, db, scheduler:{last_cycle_at, stale}}`; **503 se banco fora OU (em produção, `HEALTH_REQUIRE_SCHEDULER=1`) scheduler parado** — o monitor externo enxerga scheduler morto                                                                                                                                                                                                      |
| `docker-compose.prod.yml`                  | serviços `db` (sem porta publicada), `migrate` (one-shot, `npm run migrate`), `web` (depende de migrate ok), `scheduler`, `caddy` (TLS automático por `DOMAIN`; `tls internal` para `localhost`), `backup` (cron diário `scripts/backup.sh`) · **todo segredo com `:?`** (`POSTGRES_PASSWORD`, `VAPID_*`, `SMTP_*`, `BACKUP_PASSPHRASE`) · volumes `pgdata`, `caddy_data`, `backups` |
| `Caddyfile`                                | `{$DOMAIN}` → `reverse_proxy web:3000`; headers de segurança (HSTS, nosniff, referrer, permissions); rate limit não nativo → **ACHADOS** (E9: plugin ou middleware)                                                                                                                                                                                                                  |
| `scripts/backup.sh`                        | `pg_dump -Fc` → `openssl enc -aes-256-cbc -pbkdf2` com `BACKUP_PASSPHRASE` → `backups/medcheckin-<data>.dump.enc` + `.sha256`; retém 14 dias; off-site: apontar `BACKUP_RCLONE_REMOTE` (opcional, E9)                                                                                                                                                                                |
| `scripts/restore-drill.sh`                 | decifra o último backup → restaura em banco `medcheckin_drill` → compara **hash** (`count + md5(string_agg(id))` de todas as tabelas) entre origem e restaurado → imprime `RESTORE DRILL OK <hash>` ou falha; apaga o banco drill                                                                                                                                                    |
| `scripts/uptime-check.mjs`                 | `GET $HEALTH_URL`; se ≠ 200 (ou timeout) envia e-mail (SMTP do core) para `ALERT_EMAIL`; pensado para cron externo (VPS ou GitHub Actions `schedule`) até haver monitor externo (UptimeRobot etc.)                                                                                                                                                                                   |
| Docs                                       | `docs/DEPLOY.md` (VPS: Docker, `.env` de produção, DNS, `docker compose -f docker-compose.prod.yml up -d`, primeiro login, verificação), RUNBOOK ganha backup/restore/deploy; CI faz `docker build` das duas imagens                                                                                                                                                                 |
| **Depende do dono (não bloqueia o resto)** | provedor VPS + domínio (DNS A → IP), e-mail SMTP de produção (D13), destino off-site do backup, monitor externo (UptimeRobot/Better Stack) — registrados em `docs/DEPLOY.md` como checklist                                                                                                                                                                                          |

**Prova local (equivalente ao remoto):** `docker compose -f docker-compose.prod.yml up` com `DOMAIN=localhost` → `curl -k https://localhost/api/health` 200 (e 503 com scheduler parado); `backup.sh` + `restore-drill.sh` → hash igual; `uptime-check.mjs` com web derrubado → e-mail de alerta chega no Mailpit.

**RED:** `web/test/health.test.ts` (bloco scheduler + 503 com `HEALTH_REQUIRE_SCHEDULER=1`) e `core/test/scheduler-health.test.js` → falhando (`health.js` ausente; health sem bloco).

**GREEN — provas (2026-08-16, compose de produção LOCAL, project isolado `medcheckin-prod`):**

```
$ docker compose -p medcheckin-prod -f docker-compose.prod.yml --env-file .env.prod up -d --build
 migrate: batch 1 aplicado → 001…004 · db/web/scheduler healthy · caddy · backup (crond)
$ curl -k https://localhost/api/health
 {"ok":true,"db":"up","scheduler":{"last_cycle_at":"…","stale":false},"version":"e8-local"}  HTTP 200
 headers: strict-transport-security · x-content-type-options nosniff · x-frame-options DENY · referrer-policy
 http://localhost/api/health → 308 https://localhost/api/health
$ (dentro da rede) curl http://scheduler:3001/health → {"ok":true,"age_minutes":0.1,…} 200
$ carimbo antigo + scheduler parado → GET /api/health → {"ok":false,"scheduler":{"stale":true}} HTTP 503
$ scheduler religado → 200 (web e scheduler)
$ backup.sh → {"msg":"backup.ok","file":"medcheckin-20260816T214618Z.dump.enc","bytes":71616,"sha256":"9c8de0…"}
$ restore-drill.sh → RESTORE DRILL OK bb09d4d3962b15cc391b9e6255c04d87 (25 tabelas restauradas)
$ arquivo adulterado → RESTORE DRILL FAIL: sha256 do arquivo não confere (exit 3)
$ banco alterado após o backup → RESTORE DRILL FAIL: hash origem a301b9… ≠ restaurado bb09d4… (exit 4)
$ uptime-check.mjs (web no ar) → {"msg":"uptime.ok","status":200}
$ web derrubado → {"msg":"uptime.down","status":502} → mail.sent → {"msg":"uptime.alert_sent"} · Mailpit 0 → 1:
   oncall@medcheckin.test | "[MedCheck-in] ALERTA: https://localhost/api/health respondeu 502"
$ seed em NODE_ENV=production → "seed: recusado em produção (D7)"  ← fail-closed confirmado no container
$ npm run check → verde (166 testes) · CI agora faz docker build das duas imagens
```

**Pendente do dono para o deploy remoto** (checklist em `docs/DEPLOY.md`): VPS + domínio/DNS, SMTP de produção, off-site do backup, monitor externo de uptime, e-mail de alertas.

### E9 — Shadow run (1 semana, equipe) `[~]` (preparação pronta; a semana depende do dono)

Critérios escritos **antes**. **Prova:** relatório critério × resultado.

**Spec (antes do código):**

| Peça                                      | Conteúdo                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/SHADOW_RUN.md`                      | objetivo, participantes (equipe como pacientes/cuidadores, dados sintéticos), preparação (VPS de E8, contas, convites, push por plataforma), **critérios de sucesso com limiares numéricos escritos antes**, critérios de **aborto**, checklist diário da médica, checklist manual de push (Chrome desktop, Android Chrome, iOS Safari PWA instalado), o que anotar, template do relatório                                                                                                                                                                                                                                                                                                                                                                        |
| `core/report/shadowReport.js`             | `shadowReport(db, {clinicId, from, to})` → métricas por critério a partir do banco: entrega de push (notifications sent/failed por kind), taxa de resposta de check-in (completed/sent), tempo mediano até a 1ª resposta, adesão confirmada, alertas por código × condutas (tempo mediano até conduta), `no_response`/`delivery_failed` (ruído), heartbeat do scheduler (lacunas > 10 min via `notifications`/`system_state`… simplificado: maior lacuna entre ciclos registrados não é rastreada — usa `access_audit`? **não**: registra `scheduler.cycle_count` e `scheduler.max_gap_min` em `system_state`), erros de auth (audit) — cada número com a consulta-fonte; `renderShadowReportMarkdown(report, criteria)` → tabela critério × resultado × veredito |
| `scripts/shadow-report.mjs`               | CLI: `--from --to --clinic` → imprime o markdown (para colar em `docs/SHADOW_RUN_RESULTADO.md`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Antes de expor à internet (ACHADOS E3/E8) | `lib/ratelimit.ts` (janela deslizante por IP, em memória, `x-forwarded-for` do Caddy) em `POST /api/auth/magic-link` (5/15 min) e `POST /api/p/accept` (10/15 min) → 429; teste · compose: `./scripts` montado no serviço `backup` (drill sem `docker cp`) · `runCycle` grava `scheduler.cycle_count` e `scheduler.max_gap_min`                                                                                                                                                                                                                                                                                                                                                                                                                                   |

**RED planejado:** `core/test/shadow-report.test.js` · `web/test/ratelimit.test.ts`.

**RED:** `shadow-report.test.js` → "Failed to load url ../src/report/shadowReport.js"; `ratelimit.test.ts` → `../lib/ratelimit` ausente.

**GREEN — preparação provada (2026-08-16):**

```
$ npm test -w @medcheckin/core → ✓ shadow-report.test.js (2): métricas (push sent/failed com attempts, resposta,
  mediana 12 min até 1ª resposta, adesão, alertas por código c/ conduta em 30 min, ruído, cycle_count/max_gap) +
  markdown critério × resultado × veredito com SHADOW_CRITERIA (8 critérios numéricos)  → 139 core
$ npm test -w @medcheckin/web  → ✓ ratelimit.test.ts (3): janela deslizante; magic-link 429 após 5/15 min por IP;
  accept 429 após 10/15 min  → 32 web (171)
$ npm run check → verde · E2E 9/9
$ node scripts/shadow-report.mjs --from 2026-08-15 --to 2026-08-16  (banco de dev, sintético)
  | Entrega de push | >= 95% | 0% | ❌ |  ← honesto: sem inscrição push no dev
  | Maior lacuna entre ciclos | <= 10 min | 39.5 min | ❌ |  ← scheduler só rodou --once
  | Sucessos falsos | == 0 | 0 | ✅ |   … 1 ✅ · 3 ❌ · 4 ⚪
```

**A semana em si** (não pode ser feita por mim): precisa do deploy remoto (E8 checklist do dono), da equipe nos aparelhos e de 7 dias de calendário. Roteiro completo em `docs/SHADOW_RUN.md`; ao fim, `docs/SHADOW_RUN_RESULTADO.md` gerado pelo script + linha 8 e checklist de push preenchidos à mão. Decisão de seguir para E10: ≥ 7/8 ✅ e nenhum aborto.

### E9.1 — Rotina de alarmes por período (modelo da médica) `[x]`

Fonte: texto da Dra. (25/08, em ACHADOS.md). Substitui a spec anterior de E9.1/E9.2 (dose assimétrica/semanal viram TEXTO LIVRE).

**Modelo:** `routine_periods(id, patient_id, starts_on, ends_on null, note, created_by, replicated_from null)` + `routine_alarms(id, period_id, time, description text)` (migration 006). Períodos não se sobrepõem por paciente (constraint). Alarme do dia = alarms do período que cobre o dia local.

- **Página do paciente, PRIMEIRO card — "Rotina de alarmes":** período vigente (ex.: "24/08 → 28/08 · 5 alarmes") com a lista `08:00 — ômega 3 1cp / 4 gts óleo IBRACAN 10% / vitamina D`; botões **Novo período**, **Replicar período** (copia horários+descrições do atual para o próximo intervalo, tudo editável antes de salvar), **Encerrar hoje**; períodos futuros listados (editáveis — "edito os alarmes dos próximos ajustes"); quem recebe (respondentes receives_alarms + estado do push).
- **Scheduler:** intakes/alarme passam a nascer de `routine_alarms` (dia dentro do período); push body = description. Fora de período → nenhum alarme (param sozinhos no fim — requisito do dono).
- **PWA:** alarme vira LEMBRETE puro — sem botões Tomei/Não tomei/Tive efeito; "Medicação de hoje" mostra horários + descrição.
- **Adesão via check-in:** pack padrão ganha "Tomou as medicações corretamente hoje?" (sim/não, alerta `== 0` medium); relatório/shadow: adesão = essa pergunta; bloco "Confirmações de dose pendentes" do /hoje sai (entra "Adesão de hoje" pelas respostas); `medication_intakes`/`confirmIntake` saem da UI (tabela fica p/ histórico; marcar deprecated no core).
- **Dose estruturada do óleo (mantida — alimenta o gráfico sintoma × dose):** "Ajustar dose" continua; ao criar/replicar período, campo opcional "houve ajuste do óleo? registrar" abre o dialog. DECISOES D15.
- **Prova pedida:** core: período cobre dia → alarme com description; replicar copia e permite editar; fora do período → zero alarmes; adesão via pergunta; E2E: criar período com 2 alarmes → PWA mostra lembretes sem botões → replicar para o próximo intervalo editando texto → check-in responde adesão → /hoje mostra adesão do dia.

**RED (2026-08-25):**

```
$ npm test -w @medcheckin/core -- routine
 FAIL  test/routine.test.js [ test/routine.test.js ]
Error: Cannot find module '../src/routine/index.js' imported from .../packages/core/test/routine.test.js
 Test Files  1 failed (1) · Tests  no tests
```

**GREEN (2026-08-25):**

```
$ npm run migrate → migrate: batch 4 aplicado → 006_routine.js
$ npm test -w @medcheckin/core -- routine → ✓ test/routine.test.js (8 tests)
   cria período com alarmes ordenados por horário · recusa sem alarme / horário repetido / fim antes do
   início / SOBREPOSIÇÃO (encostar em fim+1 passa; outro paciente nas mesmas datas passa) · replicar copia
   e permite editar guardando replicated_from (original intacto) · editar período futuro + encerrar hoje ·
   alarmes do dia nascem do período que cobre o dia (fora → []) · dispatch só dos vencidos, push com a
   descrição no corpo, idempotente, dia seguinte fora do período → due 0 · PWA: alarms = {time, description}
   sem intake_id/status · adesão: pergunta no pack, "não" → alerta medium, relatório e /hoje pela resposta
$ npm run check → verde (lint · format · tsc · 146 core + 33 web = 179 testes)
$ npm run test:e2e → 10 passed (31.1s)
   ✓ rotina.spec: criar período (2 alarmes, texto livre) → replicar editando o texto (vigente intacto) →
     push com a descrição no corpo → encerrar hoje → amanhã fora do período: nenhum alarme novo
   ✓ respondente.spec: lembretes SEM Tomei/Não tomei/Tive efeito → responde adesão "não" → alerta medium
   ✓ loop.spec: /hoje mostra "Adesão de hoje" com o paciente que não tomou (bloco de confirmações saiu)
```

**Fora do escopo, registrado em ACHADOS.md:** `medication_intakes`/`confirmIntake` deprecated (código morto a decidir pós-E10); N+1 dos próximos alarmes em `dashboardToday`; conjuntos de perguntas pré-existentes não ganham a pergunta de adesão (vira parte de E9.2); E2E migrado de `next dev` para `next build && next start`.

### E9.2 — Questionário configurável na página do paciente `[x]`

- **Horário do disparo por paciente** na página do paciente (presets manhã 09:00 / noite 21:00 + livre; hoje `checkin_time` só no cadastro).
- **Perguntas extras por paciente** (intenção do v1 `patient_custom_questions`): na página do paciente, adicionar pergunta em texto livre (tipo à escolha, default sim/não ou texto), aplicada JUNTO ao pack do episódio a partir do próximo check-in; editável/desativável ali mesmo; grade/relatório as incluem.
- **Prova pedida:** core (merge pack+extras na ordem; validade por paciente); E2E: adicionar pergunta na consulta → próximo check-in a inclui → resposta na grade.

**RED (2026-08-25):**

```
$ npm test -w @medcheckin/core -- patient-questions
 FAIL  test/patient-questions.test.js [ test/patient-questions.test.js ]
Error: Failed to load url ../src/questions/patientQuestions.js. Does the file exist?
 Test Files  1 failed (1) · Tests  no tests
```

**GREEN (2026-08-25):**

```
$ npm run migrate → migrate: batch 5 aplicado → 007_patient_questions.js
$ npm test -w @medcheckin/core -- patient-questions → ✓ test/patient-questions.test.js (6 tests)
   chave derivada do label + validação + colisão com o pack e com outra extra + tenancy 404 ·
   merge pack (ordem) + extras depois, só ativas, isoladas por paciente ·
   vale só a partir do PRÓXIMO check-in (o já agendado não muda) ·
   engine: a extra fecha o check-in, aparece na grade e no relatório ·
   editar mantém a chave · desativar some dos próximos e MANTÉM a série respondida ·
   horário por paciente: 21:00 (dentro do silêncio) recusado, 20:00 agenda às 20:00
$ npm run check → verde (lint · format · tsc · 152 core + 36 web = 188 testes)
$ npm run test:e2e → 11 passed (34.5s)
   ✓ questionario.spec: 23:00 recusado com motivo ("silêncio") → preset Noite (20:00) →
     pergunta extra em texto livre → próximo check-in às 20:00 só fecha depois dela →
     resposta "sim" na grade → desativar mantém a série
```

**Fora do escopo, registrado em ACHADOS.md:** extras sempre no fim, sem condição nem peso de score; convivência do preset de adesão com um pack que ganhe a pergunta depois.

### E9.3 — Primeiro acesso guiado (wizard + guias) `[x]` (repositório; prova no aparelho = dia 0 do shadow run)

**Por quê (dono, 13/09):** 3 pessoas sem nenhuma familiaridade com tecnologia — 1 médica, 1 paciente, 1 cuidador que **mora junto e usa o mesmo celular**. Aparelho desconhecido → iPhone **e** Android. Convite chega por **QR na consulta + WhatsApp**. Erro de instalação = alarme que nunca chega = sucesso falso.

**Fatos do código hoje (verificados):**

- Convite = link reutilizável `/p/convite/{token}`; a médica só tem "Copiar link" (`RespondentsCard`). Sem QR, sem botão WhatsApp.
- Aceite cria sessão por cookie (180 dias). O manifest é estático com `start_url: /p/hoje`.
- **Risco iPhone:** o app da Tela de Início tem cookies separados do Safari → abre em `/p/hoje` **sem sessão** → `NoSession` ("abra o link de convite"). Beco sem saída para leigo.
- `PushToggle` pede permissão sem explicar antes; não há instrução de instalação, detecção de navegador embutido (Gmail/WhatsApp/Instagram) nem notificação de teste.
- `push_subscriptions.endpoint` é único e não troca de dono (P2-4) → **um celular = uma conta com push**. Paciente e cuidador no mesmo aparelho não recebem os dois.

**Spec:**

| Peça                            | Conteúdo                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Celular compartilhado (D29)     | Um aparelho = **uma conta ativa** no app. Na página do paciente, ao convidar, a médica marca "usa o celular de outra pessoa da casa" → esse respondente fica sem convite próprio (`can_answer`/`receives_alarms` desligados) e a tela explica quem responde. Qual conta vai no aparelho: **decisão do dono** (recomendado: cuidador).                                                                                                                                                                                                                                                                                                             |
| Convite (médica)                | Em `RespondentsCard`: **QR code** do link, botão **"Enviar por WhatsApp"** (`wa.me` com texto pronto, sem número salvo no servidor) e **"Imprimir guia com QR"** (1 página A4 com nome, QR, 4 passos com ilustração e o telefone da clínica).                                                                                                                                                                                                                                                                                                                                                                                                     |
| Wizard `/p/convite/{token}`     | Uma tela por passo, texto grande, um botão, barra "passo 2 de 6": **1** Boas-vindas · **2** Termo em linguagem simples (aceite atual) · **3** Navegador: detecta navegador embutido → "abra no Safari/Chrome" com ilustração e botão "copiar link" · **4** Instalar: iPhone (Compartilhar → Adicionar à Tela de Início, com imagens) / Android (botão `beforeinstallprompt`, ou menu ⋮) · **5** Notificações: explicação **antes** do pedido do sistema; negado → passo de conserto por plataforma · **6** Teste: servidor envia push de teste → "Chegou?" Sim grava confirmação / Não → conserto guiado. Fim: próximo alarme e próximo check-in. |
| Login no app instalado (iPhone) | Manifest **por convite** em `/p/convite/{token}/manifest.webmanifest` com `start_url` = página do convite; aberta em modo `standalone` com convite já aceito → entra direto (sem nova tela de termo). Troca de link ("Novo link") invalida → mensagem "peça um novo QR à clínica".                                                                                                                                                                                                                                                                                                                                                                |
| Estado de configuração          | Migration 011: `respondents.install_confirmed_at`, `push_test_sent_at`, `push_test_confirmed_at`. Página do paciente mostra por respondente: **Convite aceito · App instalado · Notificação ativa · Teste confirmado** (✓ ou "parou aqui"), nunca ✓ sem registro no servidor.                                                                                                                                                                                                                                                                                                                                                                     |
| Ajuda contínua                  | Em `/p/hoje`: **"Ativar os avisos"** / **"Testar agora"** quando falta algo e **"testar de novo"** quando completo — levam a `/p/ajuda`, que refaz o passo que falta (implementado assim no lugar de um botão "Preciso de ajuda" genérico). `NoSession` ganha instrução "abra o QR/WhatsApp da clínica de novo".                                                                                                                                                                                                                                                                                                                                  |
| Médica                          | Checklist do primeiro paciente em `/pacientes/{id}`: cadastrar → convidar → rotina de alarmes → perguntas e horário → **teste confirmado**. Some quando completo. Guia da médica imprimível (1 página) em `/configuracoes`.                                                                                                                                                                                                                                                                                                                                                                                                                       |

**Não faz:** tour animado, vídeo, chat de suporte, SMS, WhatsApp automático (E11), conta dupla no mesmo aparelho.

**RED planejado:**

- `core/test/onboarding.test.js`: registrar teste de push só com envio real (`notifier` falha → `push_test_sent_at` nulo); confirmar exige sessão do próprio respondente; status por respondente (`accepted/installed/push/test`) derivado do banco; respondente "sem aparelho próprio" não entra no envio.
- `web/test/manifest-invite.test.ts`: manifest por convite devolve `start_url` do convite; token inválido → 404.
- `web/test/browser-detect.test.ts`: user agents de Gmail, WhatsApp, Instagram (iOS/Android) → `embedded`; Safari iOS / Chrome Android → `ok`.
- E2E `onboarding.spec`: médica gera QR → abre o link → 6 passos → "Chegou? Sim" → página da médica mostra "Teste confirmado ✓"; e "Não" → tela de conserto.

**Prova que só o aparelho dá (fica no roteiro do shadow run, `docs/SHADOW_RUN.md`):** iPhone real — QR pela Câmera → instalar → abrir pela Tela de Início **já logado** → push de teste chega com a tela bloqueada. Idem Android. Playwright não emula o cookie separado do iOS; não vou declarar isso provado sem o aparelho.

**Decisão do dono (13/09):** no celular compartilhado, a conta que fica no aparelho é a do **cuidador** (D29).

**RED (13/09, antes do código):**

```
$ npx vitest run test/onboarding.test.js            (core)
Error: Cannot find module '../src/onboarding/index.js' imported from .../packages/core/test/onboarding.test.js
 Test Files  1 failed (1) · Tests  no tests
$ npx vitest run test/browser-detect.test.ts test/onboarding-api.test.ts   (web)
Error: Cannot find module '../lib/browser-detect'
Error: Cannot find module '../app/p/convite/[token]/manifest.webmanifest/route'
Error: Cannot find module '../app/api/p/push-test/route'
```

**GREEN (14/09):**

```
$ npm run migrate → 011_onboarding.js (respondents.install_confirmed_at / push_test_confirmed_at; notifications.kind + 'test')
$ npx vitest run test/onboarding.test.js → 11 passed
   sem inscrição → no_subscription, nada enfileirado · só sessão de respondente · pedir 2× enquanto espera = 1 notificação ·
   PROVA envio falhou → failed com motivo, confirmar recusado (not_sent), nada vira ✓ · falhou → pedido novo cria teste novo ·
   enviado → "não" não grava, "sim" grava; outro respondente → not_found · parado > 10 min → failed "expirou", não envia atrasado ·
   runCycle conta push_tests · markInstalled guarda a 1ª data · setupStatus (shared, inscrição revogada ≠ completo) ·
   página do paciente e tela Hoje trazem setup
$ npm run check → verde: eslint · prettier · tsc · core 183 (29 arquivos) · web 56 (11 arquivos)
   novos no web: browser-detect (11: Gmail/Instagram/Facebook/WhatsApp/webview genérico → embutido; app da tela inicial do
   iPhone NÃO é embutido; iOS < 16.4; Chrome no iPhone → Safari) · onboarding-api (manifest por convite 200/404,
   push-test 400/201/waiting/409, installed) · invite (wa.me com DDI; sem número → escolher contato — escrito depois do código)
$ npm run test:e2e → 16 passed (52.7s)
   ✓ onboarding: médica vê QR + WhatsApp + checklist → paciente Android faz os 5 passos (manifest do convite no <head>) →
     teste fica "enviando" até o scheduler rodar → "não chegou" mostra o conserto → "sim" → Tudo pronto → Hoje "Avisos
     funcionando" → card da médica: aceito ✓ avisos ✓ teste ✓ e instalado SEM ✓ (não abriu pelo ícone) → 2 testes com sent_at
   ✓ iPhone: link no Instagram → "Abra no Safari" → Tela de Início (Passo 3 de 5, sem botão continuar) → app pela start_url
     entra SEM termo, pede os avisos DESTE aparelho (Passo 4 de 5) → teste → Tudo pronto; install_confirmed_at gravado
   ✓ celular compartilhado: marcar → card "usa o celular de outra pessoa", sem QR → desfazer
   ✓ guias imprimíveis (respondente com QR; médica a partir de Configurações)
   ✓ respondente/medica specs ajustados ao wizard (aceite → "Configurar depois"; badge "configuração pendente")
```

Correções de raiz no caminho: o teste da migration 010 fazia `migrate.down` uma vez só (quebraria com qualquer migration nova) → agora desce até antes da 010; o termo v1 foi mantido **palavra por palavra** no wizard (mudar exige v2 + reaceite — ACHADOS).

**Ambiente (14/09):** o disco do Mac encheu durante o E2E (ENOSPC) e travou o Docker Desktop; reiniciado com autorização do dono. As falhas de `medica`/`questionario` daquela rodada eram do disco — na rodada limpa, 16/16.

**CI:** não roda — GitHub Actions bloqueado por cobrança da conta ("recent account payments have failed"), inclusive na `main`. Prova = local + hook de pre-push.

**Fora do escopo, registrado em ACHADOS.md:** CI bloqueada por cobrança; 3 vulnerabilidades novas fora das exceções; teste noturno da rotina (correção em `feat/deploy-casa`); relatórios contando o teste de aviso na entrega de push.

### E10 — Piloto real `[~]` (instrumento pronto; a rodada depende do dono)

Critério de sucesso e de aborto definidos antes. **Prova:** relatório final; decisão de ampliar.

**Instrumento (o que o repositório entrega):** `PILOT_CRITERIA` (13 critérios numéricos) e `PILOT_ABORT_RULES` (6 paradas) congelados em `core/report/pilotReport.js`; `pilotReport` gerado do banco **sem PII** (D7); `renderPilotReportMarkdown` com critério × resultado × veredito, caixas de aborto e bloco de decisão assinado; roteiro completo em `docs/PILOTO.md` (pré-requisitos, quem entra e quem NÃO entra, preparação, rotina, fim).

**RED (2026-08-25):**

```
$ npm test -w @medcheckin/core -- pilot-report
Error: Cannot find module '../src/report/pilotReport.js' imported from .../test/pilot-report.test.js
 Test Files  1 failed (1) · Tests  no tests
```

**GREEN (2026-08-25):**

```
$ npm test -w @medcheckin/core -- pilot-report → ✓ test/pilot-report.test.js (4 tests)
   critérios numéricos, congelados (Object.isFrozen) e com regras de aborto ·
   engajamento (resposta, mediana 12 min, pacientes que respondem ≥ metade) · adesão 2 sim / 1 não ·
   cobertura da rotina 6/6 dias-paciente · clínico: 2 alertas, 1 com conduta em 30 min, 1 ajuste,
   1 paciente com série utilizável · confiabilidade · SEM PII (nome/e-mail/telefone ausentes do JSON)
$ npm run check → verde (lint · format · tsc · 156 core + 36 web = 192 testes)
$ npm run test:e2e → 11 passed (37.7s)
$ cd packages/core && node ../../scripts/pilot-report.mjs --from 2026-08-18 --to 2026-08-25  (banco de dev)
  | Dias-paciente cobertos por um período de rotina | >= 90% | 0% | ❌ |   ← honesto: dev sem rotina
  | Entrega de push | >= 95% | 0% | ❌ |                                   ← sem inscrição push no dev
  | Maior lacuna entre ciclos do scheduler | <= 10 min | 8807.9 min | ❌ |  ← scheduler não roda no dev
  | Sucessos falsos | == 0 | 0 | ✅ |    … 1 ✅ · 6 ❌ · 6 ⚪
```

**A rodada em si (não pode ser feita por mim):** exige o shadow run de E9 concluído, o deploy remoto estável há 7 dias, consentimento revisado, 5–10 pacientes reais e 30 dias de calendário. Ao fim, `docs/PILOTO_RESULTADO.md` gerado pelo script + caixas de aborto e decisão preenchidas à mão. **Decisão escrita antes: ≥ 11 de 13 ✅ e nenhum aborto → ampliar.**

### E11 — WhatsApp "responda no app" (opcional, após E10) `[ ]`

### E12 — Prontuário da consulta + importação agêntica do histórico `[ ]`

Intenção registrada em 2026-09-14, ainda sem spec. A médica escreve o prontuário da consulta na página do paciente e pode **subir o histórico** (prontuários, pacientes, consultas antigas); um **agente** lê o material e já insere pacientes, medicações, doses e condutas no sistema, para revisão da médica antes de valer. Depende de decisões próprias: formato de entrada, LGPD do material subido, revisão humana obrigatória do que o agente inseriu. Pré-requisito já atendido pela feature "medicação por nome" (spec em `docs/superpowers/specs/2026-09-14-medicacao-por-nome-design.md`): find-or-create de produto no core, com dedupe por `name_key`, que o agente reaproveita.

## Log de progresso

| Data       | Etapa | Evento                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-09-14 | E4    | Medicação por nome (D34): migration 012 (`products.name_key` único por clínica, backfill que recusa colisão), `findOrCreateProduct` + `addMedication` por `name` ou `product_id` no core, campo "digite ou escolha" no card de medicações com sugestões do catálogo da clínica; E12 (prontuário + importação agêntica) registrada. Spec em `docs/superpowers/specs/2026-09-14-medicacao-por-nome-design.md`. 203 testes + 24 E2E.                                                                                                                        |
| 2026-08-16 | —     | Auditoria do v1 lida; `PLANO.md`, `ACHADOS.md`, `DECISOES.md` criados. Aguardando "ok" para E0.                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 2026-08-25 | —     | Prontidão de release: `uptime-check --selftest` (o alerta de queda passou a ser provado no deploy, não descoberto na queda — vira pré-requisito do piloto, já que "scheduler parado sem alerta" é critério de aborto); README conferido contra o que existe (rotina + adesão, índice de `docs/`, porta de dependências, E2E em build de produção); `.env.example` completo.                                                                                                                                                                              |
| 2026-08-25 | —     | Limpeza de ACHADOS: código morto de `medication_intakes` removido (tabela e export ficam, D17); N+1 dos próximos alarmes do `/hoje` virou uma consulta; porta de dependências no CI (`npm audit` high+ com exceções datadas) — que pegou 8 advisories high no `nodemailer` 6 (e-mail para domínio errado, injeção SMTP) → subido para 9 e o envio real por SMTP passou a ter teste contra o Mailpit no CI. 154 testes + 11 E2E.                                                                                                                          |
| 2026-08-25 | E10   | Instrumento do piloto real: 13 critérios de sucesso numéricos + 6 critérios de aborto congelados em código, `pilotReport` do banco sem PII (engajamento, adesão, cobertura da rotina, conduta clínica, série sintoma × dose, ruído, confiabilidade), markdown com veredito e decisão assinada, `scripts/pilot-report.mjs` e `docs/PILOTO.md`. 192 testes + 11 E2E. A rodada de 30 dias depende do dono (shadow run + deploy + pacientes reais).                                                                                                          |
| 2026-08-25 | E9.2  | Questionário configurável na página do paciente: migration 007 (`questions.patient_id`, CHECK de dono, unique por paciente), merge pack + extras num único carregador usado por engine/PWA/grade/relatório/gráfico, extras valem do próximo check-in (D22), chave imutável e desativação preserva a série (D23), horário do check-in por paciente com presets e recusa dentro do silêncio (D24), botão para adicionar a pergunta de adesão a conjuntos antigos. 188 testes + 11 E2E. Aguardando "ok, avance" para E10.                                   |
| 2026-08-25 | E9.1  | Rotina de alarmes por período: migration 006 (`routine_periods` sem sobreposição via EXCLUDE gist + `routine_alarms` horário/texto livre), card "Rotina de alarmes" 1º na página do paciente (novo/replicar/encerrar hoje, períodos futuros editáveis, quem recebe + push), scheduler dispara de `routine_alarms` (fora do período param sozinhos), PWA vira lembrete puro, adesão pela pergunta do check-in (relatório 30 d, shadow report e /hoje), `medication_intakes` deprecated (D17–D20). 179 testes + 10 E2E. Aguardando "ok, avance" para E9.2. |
| 2026-08-25 | —     | Feedback do 1º teste real (médica): rotina de avisos à primeira vista + dose por horário + instruções + período com fim. Etapas E9.1/E9.2 especificadas.                                                                                                                                                                                                                                                                                                                                                                                                 |
| 2026-08-16 | E9    | Preparação do shadow run: critérios (8, numéricos) escritos antes em docs/SHADOW_RUN.md + SHADOW_CRITERIA; gerador de relatório critério × resultado; rate limit por IP; scripts no backup; attempts em notifications; cycle_count/max_gap. 171 testes. A semana depende do dono (deploy + equipe).                                                                                                                                                                                                                                                      |
| 2026-08-16 | E8    | Deploy provado localmente: Dockerfiles, compose prod (segredos :?), Caddy TLS, /health web+scheduler (503 se scheduler parado), backup cifrado + restore drill com hash, uptime-check com alerta por e-mail, docs/DEPLOY.md. 166 testes. Remoto aguarda decisões do dono.                                                                                                                                                                                                                                                                                |
| 2026-08-16 | E7    | Relatório 30 d imprimível, export.zip LGPD, anonimização (mantém séries), retenção 1×/dia, /configuracoes, docs/LGPD.md e RUNBOOK.md. 164 testes + 9 E2E. Aguardando "ok, avance" para E8.                                                                                                                                                                                                                                                                                                                                                               |
| 2026-08-16 | E6    | Loop fechado: system_state (carimbos duráveis), Hoje da médica (4 blocos + heartbeat), alertas → conduta (UI), gráfico sintoma × dose com marcadores + antes/depois; E2E clock falso 48 h. 155 testes + 8 E2E. Aguardando "ok, avance" para E7.                                                                                                                                                                                                                                                                                                          |
| 2026-08-16 | E5    | PWA do respondente: convite/consentimento, Hoje (alarmes tomei/não tomei/efeito, check-in formulário), histórico, SW + manifest + Web Push (VAPID) com prova contra push service local; scheduler real. 147 testes + 5 E2E. Aguardando "ok, avance" para E6.                                                                                                                                                                                                                                                                                             |
| 2026-08-16 | E4    | API + telas da médica (Pacientes, Paciente com dose vigente/ajuste/episódio/grade, Perguntas & planos), shadcn+Tailwind, CSRF Origin, Playwright E2E verde. 133 testes + 3 E2E. Aguardando "ok, avance" para E5.                                                                                                                                                                                                                                                                                                                                         |
| 2026-08-16 | E3    | Auth próprio (D14): link mágico, convite/consentimento, sessões opacas, tenancy 404, access_audit; Mailpit no compose; DB de teste separado. 113 testes. Aguardando "ok, avance" para E4.                                                                                                                                                                                                                                                                                                                                                                |
| 2026-08-16 | E2    | Core portado: engine (entrada estruturada), planner/next-run com episódios, lembretes, alertas, scoring, analytics, logger, runCycle. 89 testes core. Aguardando "ok, avance" para E3.                                                                                                                                                                                                                                                                                                                                                                   |
| 2026-08-16 | E1    | Schema (migration 001, 20 tabelas), `currentDose`, seed sintético. 21 testes core verdes contra PG. Aguardando "ok, avance" para E2.                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 2026-08-16 | E0    | Scaffold concluído. RED→GREEN, `npm run check` verde, PR #1 com CI verde. Repo: github.com/stivaldj/medcheckin-v2. Aguardando "ok, avance" para E1.                                                                                                                                                                                                                                                                                                                                                                                                      |
