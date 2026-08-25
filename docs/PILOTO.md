# Piloto real — E10

**Objetivo:** provar, com pacientes reais e consentimento, que o produto entrega a promessa da missão — a médica vê a evolução dos sintomas correlacionada aos ajustes de dose e é avisada quando algo exige ação — e decidir, contra critérios escritos **antes**, se amplia.

Diferença para o shadow run (E9): lá se provou **entrega** (push chega, ciclo roda, ninguém mente na tela) com a equipe. Aqui se prova **valor clínico** com paciente real. O shadow run é pré-requisito: só começa o piloto com ≥ 7 de 8 critérios ✅ e nenhum aborto.

## Antes de começar (não é opcional)

- [ ] Shadow run concluído e `docs/SHADOW_RUN_RESULTADO.md` arquivado com a decisão de seguir.
- [ ] Deploy remoto estável há ≥ 7 dias (`docs/DEPLOY.md`): `/api/health` 200, scheduler ativo, uptime-check apontado, backup diário rodando e **restore drill** feito com hash conferido.
- [ ] Alerta de uptime **provado**: `node scripts/uptime-check.mjs --selftest` saiu 0 e o e-mail chegou. "Scheduler parado > 60 min sem alerta" é critério de aborto — não dá para descobrir que o alarme estava cego durante o piloto.
- [ ] Termo de consentimento revisado com a médica e versionado (`patients.consent_version`); o texto do aceite no PWA bate com o termo assinado.
- [ ] `docs/LGPD.md` relido: base legal, retenção, direito de saída. Quem responde pedido de exclusão: **a médica**, pela própria tela (Exportar dados / Anonimizar).
- [ ] Combinado por escrito com a médica: **o sistema não substitui contato clínico**. Alerta é aviso, não conduta automática. Emergência continua sendo telefone.
- [ ] Definido quem é o **observador** (opera, roda o relatório, anota falha) e a janela do piloto (recomendado: 30 dias).

## Quem entra

| Papel      | Quantos             | Critério                                                                                        |
| ---------- | ------------------- | ----------------------------------------------------------------------------------------------- |
| Médica     | 1                   | A mesma do shadow run                                                                           |
| Pacientes  | 5 a 10              | Em titulação (é onde o gráfico sintoma × dose vale), com celular próprio ou cuidador disponível |
| Cuidadores | conforme o paciente | Quando o paciente não responde sozinho (criança, idoso)                                         |

**Quem NÃO entra no piloto:** paciente em crise aguda, gestante, quadro psiquiátrico instável, ou quem não tiver como receber notificação em nenhum aparelho. O piloto não é o lugar de descobrir isso.

## Preparação (dia 0)

1. Médica cadastra cada paciente com os respondentes e envia o link de convite.
2. Cada respondente aceita o termo, **ativa notificações** e (iOS) instala o PWA na tela inicial.
3. Médica monta a **rotina de alarmes** de cada paciente (período + horário + texto livre) e registra a **dose vigente** do óleo.
4. Médica confere o **questionário** de cada paciente: horário do check-in e perguntas extras, se houver. Se o conjunto não tiver a pergunta de adesão, adicionar pelo botão da tela.
5. Observador roda o relatório com o período do piloto — deve responder "sem dado" em tudo. Se já houver número, o período está errado.

## Critérios de sucesso (escritos antes — `PILOT_CRITERIA` em `core/report/pilotReport.js`)

| #   | Critério                                                | Limiar    | Fonte                                                                      |
| --- | ------------------------------------------------------- | --------- | -------------------------------------------------------------------------- |
| 1   | Pacientes ainda respondendo na última semana            | ≥ 80 %    | `checkins.completed` nos últimos 7 dias / pacientes que receberam check-in |
| 2   | Check-ins respondidos / enviados                        | ≥ 60 %    | `checkins.completed / checkins.sent_at`                                    |
| 3   | Pacientes que responderam ao menos metade dos check-ins | ≥ 70 %    | por paciente: concluídos / enviados ≥ 0,5                                  |
| 4   | Mediana até a 1ª resposta                               | ≤ 240 min | `min(answers.answered_at) − checkins.sent_at`                              |
| 5   | Adesão relatada no check-in                             | ≥ 70 %    | respostas "sim" da pergunta `adesao` / respostas de adesão                 |
| 6   | Dias-paciente cobertos por período de rotina            | ≥ 90 %    | `routine_periods` × dias do período (alarme não parou sem ninguém querer)  |
| 7   | Alertas clínicos com conduta registrada                 | ≥ 90 %    | `alert_actions` (ack/resolve/note) sobre alertas não operacionais          |
| 8   | Mediana até a conduta em alerta clínico                 | ≤ 24 h    | 1ª ação − `alerts.first_seen_at`                                           |
| 9   | Pacientes com gráfico sintoma × dose utilizável         | ≥ 50 %    | ≥ 10 dias com resposta **e** ≥ 1 ajuste de dose no período                 |
| 10  | Ruído: alertas operacionais / total                     | ≤ 30 %    | `no_response` + `delivery_failed` sobre todos                              |
| 11  | Entrega de push                                         | ≥ 95 %    | `notifications`: sent / (sent + falhas, contando reenvios)                 |
| 12  | Maior lacuna entre ciclos do scheduler                  | ≤ 10 min  | `system_state.scheduler.max_gap_min`                                       |
| 13  | Sucessos falsos observados                              | 0         | anotação do observador (`--false-success N` ao gerar o relatório)          |

**Decisão (escrita antes): ≥ 11 de 13 critérios ✅ e nenhum aborto → ampliar.** Caso contrário: corrigir e repetir, ou encerrar.

O critério 9 é o que separa "app de lembrete" de "produto clínico": se a médica não conseguir ler sintoma × dose em pelo menos metade dos pacientes, o piloto falhou mesmo com todos os outros verdes.

## Critérios de aborto (`PILOT_ABORT_RULES`)

Qualquer um destes **para** o piloto — não é nota baixa, é parada. Corrigir, registrar em `ACHADOS.md`, e só então retomar:

- Dado de um paciente visível para outro paciente, outro respondente ou outra clínica.
- Decisão clínica tomada sobre número errado na tela (dose vigente, série ou adesão divergindo do banco).
- Alerta clínico que não chegou à médica por falha do sistema (não por escolha dela).
- Push parado em uma plataforma inteira por mais de 24 h, ou scheduler parado > 60 min sem alerta de uptime.
- Perda de dado clínico já registrado (resposta, ajuste de dose ou conduta que sumiu).
- Paciente ou responsável pedindo para sair e o acesso continuar funcionando.

## Rotina

- **Médica, 1×/dia (5 min):** abrir `/hoje`; registrar conduta em cada alerta clínico; olhar "Não respondeu" e "Adesão de hoje". Ajustar dose e replicar o período de rotina quando for o caso.
- **Médica, 1×/semana:** abrir a página de 1–2 pacientes e olhar o gráfico sintoma × dose. Anotar se ele ajudou ou não na decisão — essa anotação vale mais que qualquer métrica deste documento.
- **Observador, 1×/dia:** `/api/health` 200, containers healthy, `notification.failed` nos logs, anotar qualquer sucesso falso.
- **Observador, 1×/semana:** rodar o relatório parcial e comparar com a semana anterior; abrir `ACHADOS.md` para o que aparecer.

## Ao fim

```bash
cd packages/core && node ../../scripts/pilot-report.mjs \
  --from YYYY-MM-DD --to YYYY-MM-DD --false-success 0 \
  > ../../docs/PILOTO_RESULTADO.md
```

Depois, à mão no arquivo gerado: marcar as caixas de aborto, preencher a **Decisão** e assinar. Anexar as anotações semanais da médica sobre o gráfico.

**Nada disto pode ser feito por quem escreveu o código:** depende do deploy remoto, de pacientes reais, de consentimento e de 30 dias de calendário. O que o repositório entrega é o instrumento — critérios congelados em código, relatório gerado do banco, sem PII.
