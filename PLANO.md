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

### E1 — Schema + migration 001 + seed sintético `[ ]`

Migration única PG-first (schema em `DECISOES.md` §Modelo de dados). Seed: 2 pacientes, 1 cuidador, 1 produto, doses, perguntas.
**Prova:** `npm run migrate && npm run seed` → contagens; testes de constraint (clinic scope, `answers` unique, `notifications.dedup_key` unique, `dose_events` vigente).

### E2 — Core portado `[ ]`

Engine (entrada estruturada `recordAnswer`), scheduler/next-run com episódios, alertas (regras + efeito adverso + `no_response` só com envio real), scoring (`null` sem dado), logger (redige `text`, `value`, `notes`).
**Prova:** ≥ 40 testes core verdes contra PG; teste "check-in não avança sem envio"; teste "lembrete só confirmado pelo respondente".

### E3 — Auth + tenancy + audit `[ ]`

Auth.js e-mail mágico (médica e respondente), middleware de tenancy, `access_audit`.
**Prova:** teste 401/404 cross-clinic; linha em `access_audit` ao abrir paciente.

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

| Data       | Etapa | Evento                                                                                                                                              |
| ---------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-08-16 | —     | Auditoria do v1 lida; `PLANO.md`, `ACHADOS.md`, `DECISOES.md` criados. Aguardando "ok" para E0.                                                     |
| 2026-08-16 | E0    | Scaffold concluído. RED→GREEN, `npm run check` verde, PR #1 com CI verde. Repo: github.com/stivaldj/medcheckin-v2. Aguardando "ok, avance" para E1. |
