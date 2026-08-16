# MedCheck-in v2

Monitorização de pacientes em tratamento com cannabis medicinal — piloto com 1 médica.
Uma frase: a médica cria perguntas e plano; paciente **ou cuidador** recebe alarmes de dose e check-ins (PWA + push); responde de forma estruturada; a médica vê sintoma × ajuste de dose e recebe alerta acionável.

Documentos de trabalho: [`PLANO.md`](PLANO.md) (etapas e provas) · [`DECISOES.md`](DECISOES.md) (decisões e lições do v1) · [`ACHADOS.md`](ACHADOS.md).

## Estrutura

- `apps/web` — Next.js (App Router): UI da médica, PWA do respondente (`/p/*`), API (`/api/*`).
- `apps/scheduler` — processo Node (cron) que roda planner/dispatcher do core.
- `packages/core` — motor de domínio (JS + Knex, Postgres-only), testes Vitest contra PG real.

## Subir em 5 comandos

```bash
cp .env.example .env            # preencha POSTGRES_PASSWORD, DATABASE_URL, DATABASE_URL_TEST, APP_BASE_URL, SMTP_*
docker compose up -d db mailpit # Postgres 16 + Mailpit (SMTP 1025, UI http://localhost:8025)
docker compose exec db createdb -U medcheckin medcheckin_test   # banco dos testes (uma vez)
npm ci && npm run migrate && npm run seed
npm run check                   # lint + prettier + tsc + testes (precisa do PG)
npm run dev:web                 # http://localhost:3000 — /login pede link mágico (e-mail cai no Mailpit)
```

Login de dev: `medica@medcheckin.test` (seed). Convite de respondente: `POST /api/p/accept {token:"seed-c2", consentVersion:"v1"}`.

`npm run check` é obrigatório verde em todo PR (CI roda com service Postgres).

## Regras

Postgres desde o primeiro commit; sem SQLite. Dados reais nunca entram no repo nem no dev. Nenhum número na UI sem fonte. Nenhum sucesso falso. Segredo ausente = processo não sobe.
