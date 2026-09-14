# MedCheck-in v2

Monitorização de pacientes em tratamento com cannabis medicinal — piloto com 1 médica.
Uma frase: a médica monta a rotina de alarmes e o questionário; paciente **ou cuidador** recebe os lembretes e o check-in (PWA + push); responde de forma estruturada — inclusive a adesão; a médica vê sintoma × ajuste de dose e recebe alerta acionável.

Documentos de trabalho: [`PLANO.md`](PLANO.md) (etapas e provas) · [`DECISOES.md`](DECISOES.md) (decisões e lições do v1) · [`ACHADOS.md`](ACHADOS.md).

Operação: [`docs/DEPLOY.md`](docs/DEPLOY.md) (VPS) · [`docs/DEPLOY-CASA.md`](docs/DEPLOY-CASA.md) (PC de casa) · [`docs/RUNBOOK.md`](docs/RUNBOOK.md) · [`docs/LGPD.md`](docs/LGPD.md) · [`docs/SHADOW_RUN.md`](docs/SHADOW_RUN.md) (E9) · [`docs/PILOTO.md`](docs/PILOTO.md) (E10).

Uso: [`docs/MANUAL_MEDICA.md`](docs/MANUAL_MEDICA.md) (manual completo da médica) · no app, **Configurações → Guia da médica** (1 página, imprimível) e, por respondente, **Imprimir guia com QR** (paciente/cuidador).

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
npm run dev:web                 # http://localhost:3000 — /login pede link mágico (e-mail cai no Mailpit :8025)
npm run dev:scheduler           # em outro terminal: ciclo a cada 60 s (ou `npm run scheduler:once`)
```

Os scripts da raiz carregam o `.env` da raiz automaticamente (`node --env-file`); os testes também. Não é preciso `source .env`.

Login de dev: `medica@medcheckin.test` (seed). Convite de respondente (PWA): abra `http://localhost:3000/p/convite/seed-c2`.
Scheduler: `npm run dev:scheduler` (ciclo a cada 60 s; `node apps/scheduler/src/index.js --once` roda um ciclo). Web Push exige `VAPID_*` no `.env`.
E2E: `npm run test:e2e` (Playwright; usa `DATABASE_URL_TEST`). Roda contra **build de produção** (`next build && next start`), não `next dev` — em dev a primeira compilação de cada rota faz um full reload que aborta o `fetch` em voo. Primeira execução leva ~30 s a mais por causa do build.

`npm run check` é obrigatório verde em todo push e todo PR, em duas camadas: o hook de pre-push
(`.githooks/pre-push`, instalado automaticamente pelo `npm ci`/`npm install`) roda antes de o código
sair da máquina, e o CI do GitHub roda de novo com Postgres e Mailpit como services (o envio do link
mágico é testado por SMTP de verdade), mais E2E e build das imagens. O hook exige o Postgres no ar
(`docker compose up -d db mailpit`) e cancela o push se o check falhar. Numa emergência,
`git push --no-verify` pula a verificação local; o CI continua valendo.

`node scripts/audit-check.mjs` é a porta de dependências: `npm audit` high/critical com exceções **datadas** em [`docs/audit-excecoes.json`](docs/audit-excecoes.json). Vulnerabilidade nova fora da lista, ou exceção vencida, reprova o CI.

## Regras

Postgres desde o primeiro commit; sem SQLite. Dados reais nunca entram no repo nem no dev. Nenhum número na UI sem fonte. Nenhum sucesso falso. Segredo ausente = processo não sobe.
