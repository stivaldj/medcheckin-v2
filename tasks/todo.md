# Deploy em casa — PC Windows 10 + WSL Ubuntu, sem VPS e sem domínio (13/09)

Piloto: 1 médica + 2 pacientes reais. Sem custo: Tailscale Funnel (HTTPS público em `*.ts.net`),
SMTP do Gmail (senha de app), backup cifrado sincronizado para o Mac via Syncthing, nobreak.

## Repositório (`feat/deploy-casa`)

- [x] 1. `docker-compose.casa.yml` (override do prod): serviço `tailscale` (Funnel → caddy:80);
      Caddy só HTTP interno, sem portas publicadas; `/backups` vira pasta do host
      (`BACKUP_HOST_DIR`, a pasta do Syncthing).
- [x] 2. `deploy/Caddyfile.casa`: mesmos cabeçalhos do prod + `trusted_proxies private_ranges`
      (sem isso o rate limit veria todo mundo com o IP do container do Tailscale).
- [x] 3. `deploy/tailscale-serve.json`: Funnel na 443 → `http://caddy:80`.
- [x] 4. Conserto do off-site no prod: o container de backup não tinha `rclone` nem recebia
      `BACKUP_RCLONE_REMOTE`, e o `backup.sh` pulava o envio calado — sucesso falso. Passa a
      falhar alto quando o remoto está configurado e o envio não acontece.
- [x] 5. `docs/DEPLOY-CASA.md`: Windows (energia, updates, criptografia), WSL (systemd, Docker,
      tarefa agendada que mantém o Ubuntu vivo), Tailscale, Gmail, Syncthing (Mac só recebe +
      versionamento), subir, verificar, UptimeRobot, atualizar, limites.
- [x] 6. Provas locais: `docker compose config` do merge; Caddy casa em HTTP com cabeçalhos;
      `backup.sh` com remoto rclone local (envia) e com remoto sem rclone (falha alto).

**Provas locais:** `backup.sh` — remoto sem rclone → exit 5; remoto local válido → arquivos chegam;
remoto inexistente → exit 6; sem remoto → só local, exit 0 (antes: `backup.ok`/exit 0 sem enviar nada).
Merge dos composes → nenhuma porta publicada, Caddyfile de casa, `/backups` como bind, Tailscale
presente; sem `TS_AUTHKEY`/`BACKUP_HOST_DIR` o compose recusa. Caddy casa → os 5 cabeçalhos, sem
`Server`, `X-Forwarded-For` do cliente preservado; **sem** `trusted_proxies` o app veria só o IP do
container (prova de que a linha é necessária).

## Só dá para provar no PC (roteiro no guia)

Funnel público · WSL vivo após reinício sem login · IP real do cliente chegando ao app.

---

# D28 — Anonimizar depois da alta + hook de pre-push (13/09)

**Bug:** a anonimização grava `status = 'discharged'`, e a tela esconde "Anonimizar" quando o
status é `discharged`. Como "Dar alta" grava o mesmo status, paciente com alta perde o botão —
justamente o perfil que mais pede exclusão (LGPD art. 18). O servidor aceitaria; só a UI bloqueia.

**Decisão (dono, 13/09):** opção A — registrar a anonimização num campo próprio.

## LGPD (`fix/lgpd-anonimizar-apos-alta`)

- [x] 1. Teste que falha: paciente com alta (não anonimizado) tem `anonymized_at` nulo; anonimizar
      grava a data; reanonimizar preserva a primeira data.
- [x] 2. Migration `010_patient_anonymized_at`: coluna `anonymized_at timestamptz null` + backfill
      dos já anonimizados (nome `Paciente anonimizado %` → `updated_at`).
- [x] 3. `anonymizePatient` grava `anonymized_at` com `coalesce` (idempotente).
- [x] 4. `PatientRow.anonymized_at` no `index.d.ts`.
- [x] 5. `LgpdActions`: prop `anonymizedAt` no lugar de `discharged`; mostra "Anonimizado em DD/MM/AAAA".
- [x] 6. Página do paciente passa `anonymizedAt={p.anonymized_at}`.
- [x] 7. Preview do design-sync atualizado (histórias: em acompanhamento / com alta / anonimizado).
- [x] 8. D28 no `DECISOES.md`.
- [x] 9. `npm run check` verde com Postgres local.
- [x] 10. Extra: teste de migration que prova o backfill (falha com o backfill desligado) e
      asserção no E2E `lgpd.spec.ts` (data aparece, botão some) — E2E rodado localmente, passou.

## Hook de pre-push (`chore/pre-push-hook`)

- [x] 1. `.githooks/pre-push` roda `npm run check`; se o Postgres dos testes não responder, para com
      a instrução de subir o container.
- [x] 2. `prepare` no `package.json` aponta `core.hooksPath` para `.githooks` (Dockerfiles usam
      `--ignore-scripts`, então o build não é afetado).
- [x] 3. README: como funciona e como pular (`--no-verify`).
- [x] 4. Provar: push com check verde passa; push com erro de lint é barrado.

Feito no PR #29. Provas (remoto local descartável): erro de lint → barrado · Postgres desligado →
barrado com `ECONNREFUSED` e o comando para subir · check verde → passa · push que só apaga
branch → não roda o check. Uma execução isolada falhou logo após religar o banco (suíte de 8
testes da web pulada); não reproduziu em 3 tentativas — o hook falhou para o lado seguro.

---

# Fatia 1 — Tokens e primitivos (design pass "Instrumento")

Direção aprovada no protótipo navegável (25/08). Aditiva: nenhum `data-testid` muda,
nenhuma rota muda, nenhum contrato de API muda. Rede de segurança = `npm run check`.

## Escopo

- [x] 1. `apps/web/app/layout.tsx` — Instrument Sans (humano) + IBM Plex Mono (medido) via
      `next/font/google`, expostos como `--font-sans` / `--font-mono`.
- [x] 2. `apps/web/app/globals.css` — paleta OKLCH com viés verde (claro + escuro),
      4 níveis de severidade (`--sev-*`), cores reais de gráfico (`--chart-symptom`,
      `--chart-dose`, `--chart-score`), tokens de movimento. Bloco `@media print` preservado.
- [x] 3. `apps/web/components/ui/badge.tsx` — variantes `critical | high | medium | low`.
- [x] 4. `apps/web/lib/format.ts` — `SEVERITY_VARIANT` (fonte única do mapa severidade → variante).
- [x] 5. Desfazer o colapso crítico/alto em `app/(medica)/hoje/page.tsx` e
      `components/medica/AlertsCard.tsx`.
- [x] 6. `components/medica/SymptomDoseChart.tsx` — trocar `#0f766e` / `#94a3b8` / `#dc2626`
      por tokens (hoje o gráfico não acompanha o tema escuro).
- [x] 7. `npm run check` verde.

## Fora do escopo (fatias seguintes)

Fatia 2 = PWA `/p/hoje` (uma pergunta por tela). Fatia 3 = `/hoje` como coluna de triagem.
Fatia 4 = paciente (caso × configuração + heatmap). Fatia 5 = entrada com WebGL.
Fatia 6 = relatório impresso.

## Revisão

Feito em 25/08. 7 arquivos, +196/−91. Nenhum `data-testid`, rota ou contrato de API mudou.

**Provas**

- `npm run check` verde (lint + prettier + tsc + 163 testes do core + 39 do web = 202).
- `npm run test:e2e` verde (11/11). Inclui `next build`, o que prova que o download das duas
  fontes do Google funciona em build — era o único risco novo introduzido nesta fatia.
- Contraste medido no navegador (WCAG, texto pequeno precisa de 4,5:1), tema claro e escuro:

  | par                     | claro | escuro |
  | ----------------------- | ----- | ------ |
  | badge crítico           | 6,41  | 5,07   |
  | badge alto              | 5,10  | 6,66   |
  | badge médio             | 4,74  | 8,07   |
  | badge baixo             | 5,52  | 7,73   |
  | texto / fundo           | 16,81 | 15,89  |
  | linha do sintoma / card | 6,85  | 9,64   |
  | marcador de dose / card | 6,20  | 8,39   |

  `--sev-high` saiu de `oklch(0.55 0.125 55)` para `oklch(0.52 0.13 52)`: media 4,48:1 no claro,
  logo abaixo do mínimo.

**Achado corrigido de passagem:** em `/hoje`, a linha de check-in pendente com falha de entrega
colava o nome do paciente na mensagem (`flex justify-between` sem `gap`). Ganhou `gap-3`.

**Ficou para a fatia 3 (não é regressão de token):** em `AlertActions`, "Resolver com conduta" usa
`variant="default"`. Com o primary agora saturado, uma lista de alertas vira uma coluna de botões
teal. A hierarquia entre "Reconhecer" e "Resolver" é decisão de tela, e `/hoje` é reescrita na
fatia 3.

**Nota de ambiente:** rodar `npm run test:e2e` faz `next build` no mesmo `.next` que o `next dev`
usa. O servidor de dev que estava na porta 3000 passou a devolver 404 no chunk de CSS depois disso
(páginas sem estilo). Não é defeito do código — o CSS compilado do build contém os tokens e os 11
E2E passaram. Basta reiniciar o `npm run dev:web`.

---

# Passada de design — todas as páginas (26/08)

Componentes shadcn instalados: `item`, `field`, `empty`, `chart`, `collapsible`, `tabs`,
`questionnaire` (+ dep `@shadcn/react`). Envoltório próprio: `SimpleSelect`.

## Feito

- [x] Tokens: paleta OKLCH, 4 níveis de severidade, escala de elevação `--elev-0..4`, fontes
      Instrument Sans (humano) + IBM Plex Mono (medido)
- [x] `/pacientes/[id]` — abas caso × configuração, gráfico em `ChartContainer`, grade virou
      heatmap que **só pinta o que sabe interpretar** (direção de score ou efeito adverso)
- [x] `/perguntas` — modo leitura por pergunta (`resumo(q)` mostra só as regras ativas) + edição
      uma por vez
- [x] `/hoje` — coluna de triagem: medidores → precisa de você agora → não respondeu → só informação
- [x] `/pacientes`, `/configuracoes`, `/pacientes/novo`, `/login`, cabeçalho com estado ativo
- [x] PWA: shell, `/p/hoje` (escala com altura+cor), `/p/historico`, sem-sessão
- [x] 14 `<select>` nativos → `SimpleSelect`
- [x] Histórico do paciente mostrava a **chave do banco** (`dor`, `efeito_qual`): core passou a
      devolver `answerLabels` (o rótulo já vinha na query, era descartado)
- [x] Inglês visível corrigido: `dialog` ("Close"), `questionnaire` ("Question X of Y",
      Previous/Skip/Next/Submit)
- [x] Galeria `/design` apagada

## Não feito (por decisão)

- `/pacientes/[id]/relatorio` — fica como está até o MVP fechar
- Aba do paciente não vive na URL: recarregar volta para "O caso"
- `data-testid="question-N"` não é único entre conjuntos
- Gráficos no nível da clínica (séries de 14 dias em `/hoje`) exigem agregação nova no core

## E2E tocados

`abrirCaso` / `abrirConfiguracao` / `escolher` em `e2e/helpers.ts`. Nenhuma asserção de dado
mudou, exceto a do histórico do PWA — que asseverava a chave crua, ou seja, fixava o defeito.
