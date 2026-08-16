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
cp .env.example .env            # preencha POSTGRES_PASSWORD e DATABASE_URL
docker compose up -d db         # Postgres 16
npm ci
npm run check                   # lint + prettier + tsc + testes (precisa do PG)
npm run dev:web                 # http://localhost:3000 — /api/health responde {ok,db}
```

`npm run check` é obrigatório verde em todo PR (CI roda com service Postgres).

## Regras

Postgres desde o primeiro commit; sem SQLite. Dados reais nunca entram no repo nem no dev. Nenhum número na UI sem fonte. Nenhum sucesso falso. Segredo ausente = processo não sobe.
