# Auditoria independente — MedCheck-in v2

**Data:** 2026-08-25 · **Auditor:** externo, sem envolvimento no desenvolvimento · **Branch:** `docs-prompt-auditoria` · **Commit base:** `e2626a9`

Método: leitura de `PLANO.md`, `DECISOES.md`, `ACHADOS.md`, `README.md` e `docs/`; leitura do código de produção (`packages/core/src`, `apps/web`, `apps/scheduler`); execução de `npm ci`, `npm run migrate/seed`, `npm run check`, `npm run test:e2e`, `node scripts/audit-check.mjs`; sondas escritas contra o banco de teste (`DATABASE_URL_TEST`, dados 100% sintéticos); navegação real do app logado como a médica e como respondente. Reproduções marcadas **CONFIRMADO**; raciocínio sem reprodução marcado **SUSPEITA**.

---

## 1. Veredito (5 linhas)

**Sim, com condições.** O núcleo clínico funciona ponta a ponta: provei que a resposta do paciente digitada na UI grava em `answers` e fecha o check-in pelo mesmo caminho da produção (POST `/api/p/checkins/.../answers` → 200, `value_text` no banco, status `completed`) — a lição L1 do v1 (worker que não chamava o engine) **não** se repete. Antes de tocar paciente, corrigir o **P0-1 (dose vigente calculada no dia UTC, não no dia local — a médica vê a dose errada nas horas da noite)** é obrigatório. Duas condições fortes (P1): tornar visível quando um paciente **não está recebendo nada** (hoje um push permanentemente quebrado é quase invisível — nem `no_response` nem `delivery_failed` disparam) e envolver `completeCheckin` em transação. `npm run check` (154 testes) e `npm run test:e2e` (11 specs) passam; a porta de dependências passa. As lacunas restantes são de endurecimento e dívida, não de bloqueio.

---

## 2. Mapa de funcionalidades (Frente A)

Método: cada promessa da missão, das etapas E0–E10, do README e das decisões D1–D24 vira uma linha. `✅` = exercitei pelo caminho real e vi o efeito; `🟡` = funciona em parte; `❌` = só no papel / código sem chamador; `⚪` = não verificável aqui.

Para cada `✅` do loop principal, a coluna "quem chama isto na produção" responde à armadilha L1.

| #   | Promessa (fonte)                                              | Status                     | Evidência / quem chama na produção                                                                                                                   |
| --- | ------------------------------------------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Médica cria questionário-pack (E4)                            | ✅                         | `/perguntas` navegado; `saveQuestions` chamada por `PUT /api/question-sets/[id]/questions`                                                           |
| 2   | Perguntas extras por paciente (E9.2/D21-23)                   | ✅                         | Card "Questionário" na página do paciente; `addPatientQuestion` via `POST /api/patients/[id]/questions`                                              |
| 3   | Episódio/frequência de check-in (D5)                          | ✅                         | Card "Episódio"; `setEpisode` via `POST /api/patients/[id]/episodes`                                                                                 |
| 4   | Ajuste de dose estruturado + histórico (D3)                   | ✅                         | "Dose vigente: 4 gotas · 2×/dia … desde 13/08" na tela; `adjustDose` via `POST /api/medications/[id]/doses`                                          |
| 5   | Dose vigente = último `dose_event ≤` data                     | 🟡                         | **P0-1**: `currentDose` usa o **dia UTC**, não o dia local do paciente (CONFIRMADO)                                                                  |
| 6   | Rotina de alarmes por período, texto livre (E9.1/D15)         | ✅                         | Card "Rotina de alarmes"; `createRoutinePeriod`; E2E `rotina.spec` verde                                                                             |
| 7   | Períodos sem sobreposição por constraint (D19)                | ✅                         | `EXCLUDE … gist`; sonda tentou inserir período sobreposto → `routine_periods_no_overlap` (CONFIRMADO)                                                |
| 8   | Replicar período                                              | ✅                         | `createRoutinePeriod` com `replicated_from`; E2E `rotina.spec`                                                                                       |
| 9   | Encerrar período hoje                                         | ✅                         | `endRoutinePeriodToday`; E2E `rotina.spec`                                                                                                           |
| 10  | Paciente/cuidador recebe **alarme** de medicação              | 🟡                         | Cria e despacha (`dispatchDueRoutineAlarms`, chamado por `runCycle`); entrega push real ⚪; **P2**: sem teto de idade (dispara em lote pós-downtime) |
| 11  | Paciente/cuidador recebe **check-in** periódico               | ✅                         | `planCheckins`+`dispatchDueCheckins` no `runCycle`; check-in de hoje apareceu no PWA                                                                 |
| 12  | Aceite de convite + consentimento (D12)                       | ✅                         | Cliquei "Entrar neste dispositivo" no `/p/convite/seed-p1` → `/p/hoje`                                                                               |
| 13  | Cuidador conta de 1ª classe (D4)                              | ✅                         | `seed-c2` (Cuidadora) aceita e vê "Acompanhando Paciente Sintético Dois"                                                                             |
| 14  | Resposta estruturada (5 tipos)                                | ✅                         | `normalizeValue` por tipo em `engine.js`                                                                                                             |
| 15  | Resposta grava em `answers` pelo caminho de produção          | ✅                         | **CONFIRMADO**: respondi na UI → `POST …/answers` 200 → `value_text` no banco → `completed`                                                          |
| 16  | Progresso "N de M" com condicionais                           | ✅                         | `checkinProgress`; PWA mostrou "1 de 1"                                                                                                              |
| 17  | Condicionais (pergunta depende de resposta)                   | ✅                         | `conditionSatisfied`; E2E `respondente.spec` (efeito→efeito_qual)                                                                                    |
| 18  | Opcional pulada = `skipped` (não 0)                           | ✅                         | `normalizeValue` → `{skipped:true}`                                                                                                                  |
| 19  | Score diário ponderado 0–10                                   | ✅                         | `computeDailyScore`/`aggregateScore`                                                                                                                 |
| 20  | Sem resposta pontuável → score `null` (nunca 0)               | ✅                         | `aggregateScore` devolve `null`; grade mostrou "—"                                                                                                   |
| 21  | Trend = hoje − média de 3 dias                                | ✅                         | `computeTrend`                                                                                                                                       |
| 22  | Risco low/medium/high                                         | ✅                         | `inferRiskLevel`                                                                                                                                     |
| 23  | Alerta por limiar de pergunta                                 | ✅                         | `thresholdTriggers`; vi alerta "Como foi seu sono?: 2"                                                                                               |
| 24  | Alerta de efeito adverso                                      | ✅                         | vi "Efeito adverso relatado (high)" no /hoje                                                                                                         |
| 25  | `no_response` só com envio real ≥48h (L3)                     | 🟡                         | Correto quando houve `sent_at`; **não cobre** paciente que nunca recebeu (ver P1-1)                                                                  |
| 26  | `delivery_failed` ≥3 falhas/24h                               | 🟡                         | **P1-1**: check-in preso reusa 1 linha → nunca atinge 3 (CONFIRMADO)                                                                                 |
| 27  | Alertas de score (streak/drop/low2d/trend)                    | ✅                         | `detectScoreRules`                                                                                                                                   |
| 28  | Alertas clínicos não se auto-resolvem (C7/L15)                | ✅                         | `AUTO_RESOLVE` = só no_response/delivery_failed                                                                                                      |
| 29  | Conduta obrigatória ao resolver (nota)                        | ✅                         | E2E `loop.spec`: resolver sem nota bloqueado                                                                                                         |
| 30  | Conduta visível na página do paciente                         | ✅                         | vi "Condutas registradas" com 2 condutas                                                                                                             |
| 31  | Silenciar alertas (`alert_silences`)                          | ❌                         | `silenceAlerts` **sem nenhuma UI nem rota**; `evaluate.js` lê silences mas nada os cria — feature inalcançável                                       |
| 32  | Gráfico sintoma × dose com marcadores                         | ✅                         | `SymptomDoseChart`; E2E `loop.spec` (`data-markers≥1`)                                                                                               |
| 33  | Antes/depois por ajuste                                       | ✅                         | `compareBeforeAfterByDose`; tabela no gráfico                                                                                                        |
| 34  | Grade 14 d × perguntas, "—" sem dado                          | ✅                         | vi a grade com "—" e "●" no ajuste                                                                                                                   |
| 35  | /hoje: não respondeu                                          | ✅                         | navegado                                                                                                                                             |
| 36  | /hoje: alertas + conduta inline                               | ✅                         | navegado (4 alertas)                                                                                                                                 |
| 37  | /hoje: próximos envios 24h                                    | ✅                         | navegado                                                                                                                                             |
| 38  | /hoje: adesão de hoje                                         | ✅                         | navegado                                                                                                                                             |
| 39  | /hoje: heartbeat scheduler (vermelho se parado)               | ✅                         | "Scheduler ativo · último ciclo há 1 min"; confirmei carimbo real no banco                                                                           |
| 40  | Adesão via pergunta do check-in (D15/D20)                     | ✅                         | `dashboardToday.adherence`; relatório usa a mesma pergunta                                                                                           |
| 41  | Login mágico da médica (e-mail)                               | ✅                         | **CONFIRMADO**: `/login` → Mailpit → `/auth/verify?token` → cookie `mc_user` → `/hoje`                                                               |
| 42  | Convite por link (respondente sem e-mail)                     | ✅                         | `invite_url` copiável na tela                                                                                                                        |
| 43  | Tenancy: cross-clinic → 404 (L9)                              | ✅                         | Rastreado até a query (`access.js:14 where{id, clinic_id}`); todas as 14 rotas com id amarram à sessão                                               |
| 44  | `access_audit` em toda rota de paciente                       | ✅                         | `logAccess` em cada serviço                                                                                                                          |
| 45  | CSRF `Origin` em rota mutável                                 | 🟡                         | Cobre as rotas da médica/respondente; `logout` e `p/accept` **fora** do check (mitigado por `SameSite=Lax`)                                          |
| 46  | Rate limit auth (memória, 1 instância)                        | 🟡                         | `magic-link` 5/15min, `accept` 10/15min; **`/auth/verify` sem limite** (mitigado por token single-use)                                               |
| 47  | Web Push VAPID fail-closed                                    | ✅ (código) / ⚪ (entrega) | `createWebPushNotifier` lança sem chave; entrega real em navegador não testável headless                                                             |
| 48  | Relatório 30 d imprimível                                     | ✅                         | rota `report` + E2E `lgpd.spec`                                                                                                                      |
| 49  | Export LGPD (zip por tabela)                                  | 🟡                         | **P2**: não inclui as **definições** das perguntas extras do paciente (`questions.json` ausente)                                                     |
| 50  | Anonimização mantém séries clínicas                           | 🟡                         | E2E confirma séries; **P2**: não redige o `label` de pergunta extra nem `alert_actions.note` (conhecido)                                             |
| 51  | Retenção automática 1×/dia                                    | ✅                         | `applyRetention` no `runCycle` com carimbo `system_state`                                                                                            |
| 52  | `/api/health` honesto (503 db/scheduler)                      | ✅                         | li a rota; 503 sem banco ou (em prod) scheduler parado                                                                                               |
| 53  | `/health` do scheduler + heartbeat                            | ✅                         | `startHealthServer`                                                                                                                                  |
| 54  | Fail-closed (segredo ausente = não sobe)                      | ✅                         | `config.js`/`mailer`/`vapid` lançam; web sem VAPID degrada explícito                                                                                 |
| 55  | Idempotência do ciclo (dedup_key única) — L8 "única barreira" | 🟡                         | **P1-2**: protege dupla-**linha**, não envio **concorrente** (CONFIRMADO)                                                                            |
| 56  | `runCycle` mesmo `now` em todas as fases                      | ✅                         | `cycle.js`                                                                                                                                           |
| 57  | Backup cifrado + restore drill com hash                       | ⚪                         | provado local por doc; drill real na VPS depende do dono                                                                                             |
| 58  | Deploy VPS/Caddy/compose prod                                 | ⚪                         | provado local; remoto depende do dono                                                                                                                |
| 59  | Shadow run (1 semana)                                         | ⚪                         | instrumento pronto; a semana depende do dono                                                                                                         |
| 60  | Piloto real (30 dias)                                         | ⚪                         | instrumento pronto; a rodada depende do dono                                                                                                         |
| 61  | WhatsApp "responda no app" (E11)                              | ⚪                         | não iniciado, declarado opcional pós-E10                                                                                                             |

**Contagem** — denominador = ✅ + 🟡 + ❌:

- ✅ = **44** · 🟡 = **9** (#5,10,25,26,45,46,49,50,55) · ❌ = **2** (#31, e #61 tratado como ⚪ abaixo)
- **⚪ (à parte) = 6**: #47(entrega), #57, #58, #59, #60, #61.

Considerando #61 como ⚪ (não iniciado por decisão, não "prometido e ausente"): **denominador = 54**, ✅=44, 🟡=9, ❌=1.

**% funcionantes = 44 / 54 = 81,5%** (✅ sobre ✅+🟡+❌). Os 6 itens ⚪ dependem de deploy remoto, navegador real, ou calendário — fora do que posso verificar nesta máquina.

Leitura honesta do número: o produto **faz o que promete no caminho feliz**; os 9 🟡 concentram-se em dois lugares — (a) a família "algo deu errado no envio/entrega" (5,10,25,26) é mais fraca do que a documentação sugere, e (b) LGPD/anonimização deixam pontas (49,50). O único ❌ real (silenciar alertas) é código morto, não um buraco de produto.

---

## 3. Achados, por severidade

### P0 — bloqueia o piloto

#### P0-1 · Dose vigente é calculada no dia **UTC**, não no dia local do paciente

**Confiança: CONFIRMADO.** `packages/core/src/doses/currentDose.js:9`

```js
const day = at.toISOString().slice(0, 10); // dia UTC do instante
```

`currentDose` alimenta o card "Dose vigente" e a lista de pacientes (via `medicationsWithDose`, `patients/index.js:171`). O corte do dia usa `at.toISOString()` (UTC), mas a vigência de uma dose é uma data **local** do paciente (`America/Cuiaba`, UTC-4).

**Cenário de falha (reproduzido):** paciente em Cuiabá; ajuste com `effective_from = amanhã (local)` cadastrado. Às **21:00 locais de hoje** (= 01:00 UTC de amanhã) chamei `currentDose`:

```
utc_instant: 2026-08-26T01:00:00.000Z
dia_local:   2026-08-25
dose_devolvida: { effective_from: "2026-08-26", amount: 99 }   ← dose de AMANHÃ
veredito: BUG CONFIRMADO
```

Toda noite, das ~20:00 à meia-noite local, o card "Dose vigente" e a lista mostram a dose que **só entra em vigor amanhã**. A médica que abre o painel à noite após agendar um ajuste para o dia seguinte vê a nova dose como se já valesse — exatamente a categoria "decisão clínica sobre número errado". (O marcador do gráfico **não** é afetado: `symptomDoseSeries` usa `dose_events.effective_from` direto, sem `currentDose`.)

**Correção sugerida:** passar o fuso do paciente e cortar o dia com `localDate(at, timezone)` (já existe em `time.js:14`, hoje sem chamador). `currentDose(db, medicationId, at, timezone)`. **Esforço: baixo** (1 função + call sites em `medicationsWithDose`). Escrever teste com fuso ≠ do processo cruzando a virada (hoje inexistente — ver Frente E).

---

### P1 — corrigir antes de ampliar

#### P1-1 · Um paciente que **nunca recebe nada** é quase invisível para a médica

**Confiança: CONFIRMADO.** `packages/core/src/alerts/evaluate.js:72-113` + `apps/web/app/(medica)/hoje/page.tsx:48`

Quando o push de um paciente está quebrado desde o início (nenhuma inscrição, ou revogada), o check-in do dia falha o envio a cada ciclo e fica `pending`. Sonda com 4 ciclos de falha:

```
ultimo_dispatch: { due:1, sent:0, failed:1 }
linhas_notifications_falhadas: 1      ← retry reusa a MESMA linha (attempts=4)
alertas_disparados: []                ← nem no_response nem delivery_failed
dashboard_not_sent_yet: 1
```

Dois alertas deveriam cobrir isso e nenhum cobre:

- `no_response` exige `sent_at` real (`evaluate.js:77`) — como nada foi enviado, nunca dispara.
- `delivery_failed` conta **≥3 linhas** com `failed_at` em 24 h (`evaluate.js:101`). O reenvio do check-in reusa o mesmo `dedup_key` (`checkin:{id}:{resp}:{attempt}`, e `attempt` não avança porque o check-in fica `pending`), então há **1 linha** só, com `attempts` incrementando. Nunca chega a 3 num único check-in preso.

No `/hoje`, esse paciente aparece **apenas** como o número em "ainda não enviados: 1" (`hoje/page.tsx:48`), dentro da frase "Ninguém pendente" — sem nome, sem destaque, indistinguível de um check-in que só ainda não chegou a hora.

**Consequência clínica:** um paciente pode passar dias sem receber check-in nem alarme, relatar nada, e a médica não é avisada de que ele está **fora do ar**. Categorias "alerta que não chega" + "lembrete ausente".

**Correção sugerida:** (a) um alerta "sem canal de entrega" quando um paciente ativo tem check-in não entregue e **zero** `push_subscriptions` ativas há N horas; e/ou (b) `delivery_failed` contar tentativas (`attempts`) além de linhas; e (c) separar no `/hoje` "aguardando horário" de "falhou a entrega", com nome do paciente. **Esforço: médio.**

#### P1-2 · Envio duplicado sob concorrência — `enqueueAndSend` envia fora de lock

**Confiança: CONFIRMADO.** `packages/core/src/checkin/engine.js:29-53`

A documentação (L8, C1) afirma que `notifications.dedup_key` unique é "a única barreira" e que a idempotência está resolvida. A barreira protege contra **linha duplicada**, mas o `notifier.send()` (`engine.js:41`) acontece **entre** o upsert e o `update sent_at` — sem lock. Duas execuções concorrentes leem `sent_at IS NULL`, ambas passam pelo `where` do merge e ambas enviam:

```
duas chamadas concorrentes, mesma dedup_key:
resultados: [sent, sent]
envios_reais: 2            ← notifier.send chamado 2× para a mesma chave
```

**Cenário de falha:** dois processos do scheduler (ou um cron duplo real, ou um `runCycle` reentrante entre instâncias) → o paciente recebe o **mesmo push duas vezes**. Na implantação declarada (1 VPS, 1 scheduler, flag `running` in-process em `apps/scheduler/src/index.js:31`) isso **não** ocorre — por isso P1, não P0. Mas contesta a afirmação de L8: a idempotência de **envio** depende de haver um único processo, não da constraint. Se o piloto escalar para 2 instâncias (como o próprio ACHADOS prevê para rate limit), isto vira P0 silenciosamente.

**Correção sugerida:** `SELECT … FOR UPDATE SKIP LOCKED` na seleção do dispatch, ou advisory lock por `dedup_key`, ou marcar `sent_at`/`sending_at` **antes** do send com o mesmo update condicional. **Esforço: médio.** Registrar em `DECISOES.md` que L8 vale para dupla-linha, não para envio concorrente.

#### P1-3 · `completeCheckin` fecha o check-in sem transação — score/alerta podem não rodar

**Confiança: SUSPEITA (leitura; não reproduzi crash).** `packages/core/src/checkin/engine.js:361-380`

```js
await db('checkins').where({ id }).update({ status:'completed', … });  // (1)
const score  = await computeDailyScore(db, checkinId);                  // (2)
const alerts = await evaluatePatientAlerts(db, checkin.patient_id, now);// (3)
```

As três operações não estão em transação. Se o processo cair entre (1) e (3) — por exemplo, logo após a última resposta ser um **efeito adverso** — o check-in fica `completed`, mas o alerta `side_effect` nunca é criado e não há reprocessamento (o check-in `completed` não volta ao dispatch). O `score` do dia fica órfão (`null`), sem recomputo.

Rede de segurança parcial: `evaluateAllAlerts` roda 1×/h no `runCycle` e `thresholdTriggers` lê o **último check-in completed**, então o alerta clínico seria recriado em até 1 h. Mas o `score` diário não é recalculado por ninguém. Por isso P1, não P0.

**Correção sugerida:** envolver (1)-(3) em `db.transaction`. `recordAnswer` (`engine.js:342-352`) tem a mesma ausência (insert answer + update status) — menos grave. **Esforço: baixo.**

#### P1-4 · `errorResponse` transforma erro de Postgres em HTTP 400, vaza a mensagem interna e não loga

**Confiança: CONFIRMADO (código); gatilho SUSPEITA.** `apps/web/lib/auth.ts:90-92`

```js
if (code) return NextResponse.json({ error: code, message }, { status: 400 });
console.error('[api] erro inesperado', …);   // só roda para erro SEM code
```

Todo throw das rotas passa por aqui (`api.ts:44,69`). Erros do driver PG têm `.code` (`'23505'`, `'42703'`, `'57P01'`…). Um erro de infraestrutura numa rota de mutação portanto: (a) vira **HTTP 400** ("erro do cliente"), (b) devolve a **mensagem crua do Postgres** ao browser, (c) **não gera log** — o `console.error` da linha 91 só cobre erro sem `code`. "Às 3 da manhã", uma falha de banco intermitente não deixa rastro e ainda vaza estrutura interna do schema.

Correlato: `apps/web/app/auth/verify/route.ts:17` engole **qualquer** erro como "link inválido" sem log (banco fora → usuário vê "link inválido"); `alerts/actions.js` lança `Error` puro (sem `code`), então "Alerta já resolvido" (duplo-clique em Resolver) cai no `console.error`+**500** em vez de 400.

**Correção sugerida:** só mapear para 400 os códigos de erro **conhecidos do domínio** (allowlist); qualquer outro → logar com o `code` real e devolver 500 genérico sem a mensagem. **Esforço: baixo.**

---

### P2 — dívida com custo claro

- **P2-1 · Export LGPD incompleto.** `lgpd/export.js:118-136` não inclui as **definições** das perguntas extras por paciente (não há `questions.json`; as respondidas aparecem só embutidas em `checkins.json`). Uma pergunta extra criada e **nunca respondida** — com limiar de alerta configurado — some do export. O direito de acesso (art. 18) fica incompleto. _Custo:_ um titular pede seus dados e a definição de uma pergunta clínica não sai. **Esforço: baixo.**

- **P2-2 · Anonimização deixa PII em campos de texto livre.** `lgpd/anonymize.js:51-61` redige `value_text` e `notes`, mas **não** toca o `label` de perguntas extras do paciente (a médica pode digitar um nome ali) nem `alert_actions.note`/`alerts.context` (já registrado em ACHADOS, decisão pendente com a médica). _Custo:_ "anonimizado" não é totalmente anônimo. **Esforço: baixo** (label) / **decisão** (conduta).

- **P2-3 · Alarme de rotina sem teto de idade dispara em lote pós-downtime.** `scheduler/routineAlarms.js:29-33` marca como `due` todo alarme cujo horário já passou hoje. Sonda: despachei às 23:30 e os 5 alarmes do dia (08:00…) foram enviados juntos (CONFIRMADO). Se o scheduler ficar horas fora do ar e voltar à noite, a paciente recebe de uma vez os lembretes de manhã/tarde — ruído inútil para um lembrete de medicação. No caminho feliz (ciclo 60 s) não acontece. **Esforço: baixo** (ignorar alarmes com mais de X min de atraso).

- **P2-4 · Sequestro de inscrição push por endpoint.** `push/index.js:96-102`: o upsert por `endpoint` reatribui `respondent_id` sem checar o dono anterior. Quem conhecer o `endpoint`+`keys` de outro (segredos do navegador da vítima) assume a inscrição. Exploração improvável, mas categoria "dado de saúde no dispositivo errado". **Esforço: baixo** (recusar merge quando `respondent_id` difere).

- **P2-5 · N+1 em rota do paciente.** `respondent/index.js:205-213` (`respondentHistory`): 2 queries por dia × 30 dias ≈ 60 queries por `GET /api/p/history`. Também `medicationsWithDose` (lista da médica) e `dispatchDueRoutineAlarms` (por paciente/ciclo — o repo já sabe fazer em JOIN, cf. `dashboard/today.js:70`). Irrelevante com poucos pacientes; dói ao crescer. **Esforço: médio.**

- **P2-6 · Testes com data fixa sobre seed de relógio-de-parede.** `auth.test.js:11` e `alerts.test.js:12` fixam `NOW = 2026-08-16` sobre `seedFixture` que cria dados relativos ao dia real; a distância cresce a cada dia e regras novas de "recente" passam **vazio** sem falhar. O próprio `services.test.js:29` tem o comentário "Data fixa aqui apodrece (falhou em 25/08)". **Esforço: baixo** (usar `now` relativo).

- **P2-7 · Login da médica sem E2E real.** `e2e/helpers.ts:9` injeta a sessão via `createSession` do core; nenhum E2E percorre `/login` → e-mail → `/auth/verify` → cookie. O único teste de SMTP real (`mailer.test.js:34`) vira no-op verde sem Mailpit. Provei esse fluxo **à mão** nesta auditoria, mas não há trava de regressão. **Esforço: médio.**

- **P2-8 · Rollback da migration 007 nunca exercitado com dados.** O `down` de `007_patient_questions.js` deleta `answers` de perguntas com `patient_id`, mas `migrations.test.js` roda o rollback sobre um seed que **não cria** pergunta por paciente. Um `down` em produção pode apagar respostas de extras sem que esse caminho tenha rodado uma vez. **Esforço: baixo** (seedar uma extra no teste de migração).

### P3 — melhoria

- **P3-1 ·** "Check-in concluído. Obrigado! (**1 respostas**)" — erro de plural visível ao paciente (`TodayView`). Trivial.
- **P3-2 ·** Código morto: `silenceAlerts`/`alert_silences` (lido a cada avaliação, criado por ninguém), `localDate`, `revokeAllForPrincipal`, `migrateRollbackAll`, `rollingWindow` — exports sem chamador de produção. Limpeza.
- **P3-3 ·** `index.d.ts` (à mão) mente em 3 pontos: `completeCheckin` declara `{already}` mas devolve `{already, score, alerts}`; `savePushSubscription` declara 3 campos mas faz `returning('*')` (devolve `keys`); `SeedCounts` não lista `routine_periods`/`routine_alarms`. Baixo risco, mas o `.d.ts` é o contrato do web.
- **P3-4 ·** `APP_BASE_URL ?? ''` (`pacientes/[id]/page.tsx:25`) gera link de convite quebrado em silêncio se a var faltar fora do compose. Fail-open pequeno.
- **P3-5 ·** Gráfico: rótulos dos marcadores de dose (`ReferenceLine label position:top`) sobrepõem em tela estreita e com muitos ajustes (confirmado por leitura; já em ACHADOS E6).
- **P3-6 ·** App é light-only: a classe `.dark` existe em `globals.css:85` mas **nunca** é aplicada (sem toggle nem `prefers-color-scheme`). Decisão legítima para piloto; é CSS morto, não defeito.

---

## 4. Qualidade de código

O código é consistente e legível; a fronteira core/web é respeitada (regra de negócio mora no `packages/core`, o web renderiza e chama). Sem import circular (verifiquei a cadeia `dashboard→cycle→engine→patientQuestions→routine`, unidirecional). Fail-closed real nos processos (`config.js`, `mailer`, `vapid` lançam sem segredo). Exemplos concretos do que destoa, além dos achados acima:

- **Nome que mente sobre segurança:** `auth/tokens.js:3` diz "Nunca vai ao banco em claro" — falso para `invite_token`, gravado em claro em `patients/index.js:128` e `invite.js:50`. O comentário induz a subestimar o impacto de um vazamento da tabela `respondents` (os tokens de convite viram sessões utilizáveis). Os tokens de **login** (magic link) e as **senhas** de sessão, esses sim, só vão como hash — a distinção deveria estar no comentário.
- **Efeito colateral escondido no nome:** `completeCheckin` também computa score e avalia alertas (documentado no corpo, ausente do nome e do `.d.ts`).
- **Classificação de erro por regex de mensagem:** `alerts/[id]/resolve/route.ts:15` (`/conduta|nota/i.test(err.message)`) e `series/route.ts:13` — frágil; a raiz é `alerts/actions.js` lançar `Error` puro em vez de `ValidationError`/`AuthError` como o resto do core.

A regra "sem dado → —, nunca 0" é bem cumprida na exibição (`format.ts`, `GridCard`, gráfico), com poucas exceções menores de máscara (`FREQ_LABEL[...] ?? ''`, `user_name ?? ''`).

---

## 5. Testes — o que a suíte garante e o que deixa passar

**Garante, com solidez:** o núcleo clínico contra **Postgres real** — idempotência do ciclo (dedup por chave), fail-closed de envio (L2: check-in não avança sem envio aceito, testado), tenancy nunca-403, scoring null-nunca-zero, anonimização preservando séries, e o loop dor→alerta→conduta→gráfico contra **build de produção** (E2E 11/11). Cobertura honesta na maioria (confere efeito no banco, não só "não lançou").

**Composição:** ~201 testes. Cerca de **⅓** toca caminho de produção (handlers de rota reais, `runCycle`, cliques Playwright); **⅔** chamam o core direto (dos quais ~25 arquivos são funções puras). Os 6 E2E são **híbridos**: o clique é produção, mas o disparo do tempo é feito chamando o core direto do processo de teste (`runCycle`/`planCheckins`/`dispatchDueRoutineAlarms`) — o daemon `apps/scheduler/src/index.js` **não é exercitado por nenhum teste**.

**Deixa passar (por risco clínico):**

1. **Fuso ≠ Cuiabá cruzando a meia-noite.** Nenhum teste de banco usa outro fuso; `helpers/db.js:36` e o seed fixam `America/Cuiaba`. Exatamente o cenário do **P0-1** — passaria em verde.
2. **Duas instâncias concorrentes do scheduler.** Sem lock no código e sem teste de corrida; a dedup só é testada sequencialmente. É o **P1-2**.
3. **`completeCheckin` interrompido** / anonymize com check-in em andamento — sem teste (**P1-3**).
4. **Rollback da 007 com respostas de extras** — o `down` que apaga `answers` nunca roda com dados (**P2-8**).
5. **Login real da médica** sem E2E; teste SMTP se auto-desliga sem Mailpit (**P2-7**).

**Asserções fracas** que eu apertaria (valores exatos eram conhecidos): `loop.spec.ts:137` `sent).toBeGreaterThanOrEqual(1)` com o comentário dizendo que o esperado é 2; `migrations.test.js:31` `files.length ≥ 3` com 7 migrations existentes; `shadowReport`/`pilotReport` que conferem `response_rate` contra o próprio denominador do relatório (se `sent` contar errado, os dois lados erram juntos).

**Rodei a suíte:** `npm run check` → 154 testes core verdes; `npm run test:e2e` → 11 passed (49,9 s). Não rodei duas vezes seguidas sem recriar o banco (o `freshDb` faz `drop schema` a cada arquivo, então a suíte core é imune; o E2E depende de `workers:1` e de cada spec limpar o que altera — frágil por desenho, mas hoje verde).

---

## 6. Design e UX

Contexto respeitado: a médica abre `/hoje` e vê o que exige ação (alertas) ao lado do que é informação; o paciente responde no celular com alvos grandes. Telas navegadas (capturei cada uma):

- **`/hoje` (médica, desktop):** hierarquia correta — "Alertas abertos (4)" com badge de severidade (`high` vermelho vs `medium` neutro) distinguível em menos de um segundo; heartbeat do scheduler no topo à direita. **Honesto:** confirmei que a faixa "Scheduler ativo · há 1 min" bate com o carimbo real em `system_state` (havia um scheduler do dono rodando, PID 2675). _Ponto fraco:_ o bloco "Não respondeu" esconde o paciente com **falha de entrega** dentro de "ainda não enviados: N" — ver P1-1.
- **`/pacientes` (lista):** escaneável; "Dose vigente" e "Alertas abertos" por linha. Um paciente sem dose mostra "sem dose vigente" (honesto, não "0").
- **Página do paciente:** "Rotina de alarmes" é o 1º card (atende ao feedback da médica de 25/08); "Dose vigente: 4 gotas · 2×/dia (08:00, 20:00) desde 13/08"; grade 14 d com "—" e "●" no ajuste; "Condutas registradas" logadas. Densa mas ordenada.
- **PWA (mobile 375 px):** convite com termo de consentimento legível e botão desabilitado até concordar; `/p/hoje` com "Medicação de hoje" e "Check-in de hoje" separados; estados vazios honestos ("Nenhum horário de medicação hoje."); aviso claro quando a permissão de notificação está bloqueada. Respondi um check-in inteiro pela UI e a resposta gravou.

**Problemas visuais:**

- **"1 respostas"** (plural) na conclusão do check-in — visível ao paciente (P3-1).
- **Marcadores de dose sobrepõem** em tela estreita no gráfico (P3-5) — a promessa central do produto degrada no celular; num paciente com muitos ajustes os rótulos vermelhos colidem.
- **Gráfico sintoma × dose não pôde ser exercitado com dados** no seed (P1 do dev tem só pergunta de texto; sem série numérica), então avaliei o componente por leitura: linha cheia (sintoma) vs tracejada (score) com cores distintas (`#0f766e` vs `#94a3b8`), `connectNulls` — "sem dado" vira **lacuna interpolada**, não zero (correto), mas a interpolação pode sugerir continuidade onde não há medição. Vale observar com a médica.

**Acessibilidade:** contraste dos textos ok; `prefers-reduced-motion` coberto pelo reset do Tailwind. Não auditei leitor de tela nos formulários do paciente a fundo (limite de tempo) — os `label`/`data-testid` estão presentes.

_(Screenshots capturados na sessão: `/hoje`, `/pacientes`, página do paciente, `/p/convite` e `/p/hoje` no mobile. Descritos acima; posso exportar os PNGs se quiser anexá-los.)_

---

## 7. Adições valiosas (máx. 10, cada uma com problema demonstrado)

1. **Fuso do paciente no `currentDose`** — resolve P0-1 (dose errada à noite). Esforço baixo.
2. **Alerta "paciente sem canal de entrega"** — resolve P1-1 (paciente fora do ar invisível). Esforço médio.
3. **Lock no dispatch (`FOR UPDATE SKIP LOCKED`)** — resolve P1-2 (envio duplicado concorrente) e torna a idempotência de L8 verdadeira sob >1 instância. Esforço médio.
4. **Transação em `completeCheckin`** — resolve P1-3 (alerta/score órfãos em crash). Esforço baixo.
5. **`errorResponse` com allowlist + log** — resolve P1-4 (erro de PG vira 400 mudo e vaza schema). Esforço baixo.
6. **`/hoje`: separar "aguardando horário" de "falhou entrega", com nome** — torna P1-1 visível na tela que a médica usa 5 min/dia. Esforço baixo.
7. **`questions.json` no export LGPD** — resolve P2-1 (direito de acesso incompleto). Esforço baixo.
8. **Teste de fuso ≠ processo cruzando meia-noite** — trava de regressão para o fix do P0-1 e para o cálculo de "hoje" em geral. Esforço baixo.
9. **Anonymize redigir `label` de pergunta extra** — resolve P2-2 (PII sobrevive). Esforço baixo.
10. **E2E do login real da médica** (Mailpit no CI) — resolve P2-7; hoje o elo e-mail→verify→cookie não tem trava. Esforço médio.

_(Nenhuma proposta sem problema demonstrado nesta auditoria. Deixei de fora: dark mode, refactor de N+1 além do dispatch, e endurecimento de rate limit do `/auth/verify` — todos P2/P3 com custo maior que benefício no piloto.)_

---

## 8. O que não consegui verificar (e o que seria preciso)

- **Entrega real de Web Push em navegador/aparelho** (Chrome desktop, Android, iOS PWA) — Chromium headless não tem push service (FCM). Preciso: aparelhos reais + o checklist manual de `docs/SHADOW_RUN.md`. O notifier é provado contra um push service local (`push.test.js`), mas isso não prova FCM/APNs nem iOS ≥16.4.
- **Duas instâncias concorrentes do scheduler em processos separados** — reproduzi a janela de corrida no nível de função (SONDA2), não montei 2 daemons reais. Preciso: subir dois `apps/scheduler` contra o mesmo banco.
- **Deploy remoto, restore drill e uptime externo na VPS** — provados só localmente por `docs/DEPLOY.md`/`PLANO.md` E8. Preciso: a VPS, o domínio, e rodar `restore-drill.sh` no container `backup`.
- **Shadow run (E9) e piloto (E10)** — instrumentos prontos e testados; as rodadas dependem de calendário, equipe e pacientes reais.
- **Leitor de tela nos formulários do paciente** e o gráfico com **série numérica real** — o seed do dev não tinha dados de sintoma numérico para exercitar o gráfico ponta a ponta na tela (avaliei por leitura + E2E).

---

_Fim do parecer. Nenhum arquivo do repositório foi modificado pela fase de diagnóstico (as sondas rodaram contra `DATABASE_URL_TEST` e foram removidas; `.claude/launch.json` foi restaurado ao original)._

---

## 9. Adendo (2026-08-25, pós-parecer): correções implementadas

Após autorização do dono, o P0 e os quatro P1 foram corrigidos na branch **`fix/auditoria-p0-p1`** (a partir de `main`), com RED antes de GREEN:

| Achado                                   | Correção                                                                                                                                                                                                                                     | Trava de regressão                                                     |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| **P0-1** dose no dia UTC                 | `currentDose(db, med, at, timezone)` corta o dia com `localDate` no fuso do paciente; `medicationsWithDose` passa o fuso de cada paciente                                                                                                    | `doses.test.js`: 2 testes (Cuiabá 21:00 locais; Tóquio de manhã cedo)  |
| **P1-1** paciente fora do ar invisível   | `delivery_failed` conta **tentativas** acumuladas (`attempts`), não linhas; `dashboardToday` ganhou `pending_today` (nome + `delivery_failed`); `/hoje` mostra o paciente nomeado com "falha na entrega" vs "aguarda envio HH:MM"            | `audit-fixes.test.js`: 3 testes                                        |
| **P1-2** envio duplicado concorrente     | migration 008 (`notifications.claimed_at`) + claim atômico antes do `notifier.send`; claim vencido (>2 min) pode ser tomado; falha limpa o claim                                                                                             | `audit-fixes.test.js`: 2 testes (concorrência real com notifier lento) |
| **P1-3** `completeCheckin` sem transação | status + score + alertas fecham na mesma `db.transaction`                                                                                                                                                                                    | `audit-fixes.test.js`: 1 teste (falha injetada no meio → tudo reverte) |
| **P1-4** erro de infra vira 400 mudo     | `errorResponse`: code desconhecido → log + 500 `internal` (sem vazar mensagem); `alerts/actions.js` passa a lançar `AuthError`/`ValidationError` tipados; rotas resolve/note perdem o regex/catch-all; `/auth/verify` loga erro não-esperado | `errors.test.ts` (3 testes) + `today-api.test.ts` (resolver 2× → 400)  |

**Prova (RED → GREEN):** antes das correções, os 9 testes novos falharam exatamente nos pontos previstos (`7 failed` no core, `2 failed` no web). Depois: `npm run check` → **162 testes core + 39 web verdes**; `npm run test:e2e` → **11 passed (59,7 s)**; migration 008 aplicada e coberta pelo teste de rollback total (`migrations.test.js`). O `index.d.ts` foi atualizado (`currentDose`, `completeCheckin`, `DashboardToday.pending_today`). As pendências P2/P3 ficaram registradas em `ACHADOS.md`._
