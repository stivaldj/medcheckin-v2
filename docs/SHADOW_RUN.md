# Shadow run — 1 semana com a equipe (E9)

**Objetivo:** provar, com pessoas reais em aparelhos reais e sem paciente real, que o loop funciona ponta a ponta todos os dias durante 7 dias — e medir contra critérios escritos **antes** de começar. Nenhum dado real de paciente entra: a equipe usa nomes/condições sintéticos.

## Participantes e papéis

| Papel             | Quem                                        | Faz                                                                        |
| ----------------- | ------------------------------------------- | -------------------------------------------------------------------------- |
| Médica            | Dra. Rafaela (ou alguém da equipe no papel) | Cadastra "pacientes", ajusta doses, olha `/hoje` 1×/dia, registra condutas |
| "Pacientes" (2–4) | membros da equipe                           | Aceitam convite no celular, recebem alarmes/check-ins, respondem           |
| "Cuidador" (1–2)  | membros da equipe                           | Aceitam convite, respondem pelo "paciente" que não responde sozinho        |
| Observador        | quem opera (José)                           | Roda o relatório, anota falhas, guarda os prints                           |

Aparelhos a cobrir (checklist de push abaixo): Android + Chrome, iPhone + Safari (PWA instalado), desktop Chrome.

## Preparação (dia 0)

1. Deploy remoto (`docs/DEPLOY.md`) concluído: `https://DOMAIN/api/health` 200; scheduler ativo; monitor de uptime apontado; backup rodou 1× e `restore-drill.sh` OK.
2. Médica entra por link mágico; cria os "pacientes" com respondentes; envia os links de convite (WhatsApp manual serve).
3. Cada participante abre o link, aceita o termo, **ativa notificações** e (iOS) instala o PWA na tela inicial. Marcar no checklist abaixo o resultado por aparelho.
4. Médica monta a rotina de alarmes (período + horário + texto livre) e registra a primeira dose de cada "paciente" (abre titulação diária); confere `/hoje` → "Próximos envios".
5. Observador zera o relatório: `node scripts/shadow-report.mjs --from <dia1> --to <dia7>` já responde (tudo "sem dado").

## Critérios de sucesso (escritos antes — `SHADOW_CRITERIA` em `core/report/shadowReport.js`)

| #   | Critério                                      | Limiar    | Como é medido                                                                                        |
| --- | --------------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------- |
| 1   | Entrega de push                               | ≥ 95 %    | `notifications`: sent / (sent + falhas), falhas contam reenvios (`attempts`)                         |
| 2   | Check-ins respondidos / enviados              | ≥ 70 %    | `checkins.completed / checkins.sent_at`                                                              |
| 3   | Mediana até a 1ª resposta                     | ≤ 120 min | `min(answers.answered_at) − checkins.sent_at`                                                        |
| 4   | Adesão relatada no check-in (sim / respostas) | ≥ 70 %    | `answers` da pergunta `adesao` (E9.1/D15: o alarme é lembrete puro, não confirma tomada)             |
| 5   | Mediana até a conduta em alerta clínico       | ≤ 24 h    | 1ª `alert_actions` (ack/resolve) − `alerts.first_seen_at`, excluindo `no_response`/`delivery_failed` |
| 6   | Ruído: alertas operacionais / total           | ≤ 50 %    | `no_response` + `delivery_failed` sobre todos                                                        |
| 7   | Maior lacuna entre ciclos do scheduler        | ≤ 10 min  | `system_state.scheduler.max_gap_min`                                                                 |
| 8   | Sucessos falsos observados                    | 0         | anotação manual do observador (algo marcado "enviado"/"confirmado" sem ter acontecido)               |

**Critérios de aborto (parar e corrigir antes de continuar):** push não chega em **nenhum** aparelho de uma plataforma por > 24 h; scheduler parado > 60 min sem alerta de uptime; qualquer dado de um participante visível para outro; qualquer sucesso falso.

## Checklist manual de push por plataforma (dia 0 e dia 3)

| Aparelho                                    | Ativou notificações? | Push de check-in chegou (hora)? | Push de alarme chegou? | Clique abre `/p/hoje`? | Observações |
| ------------------------------------------- | -------------------- | ------------------------------- | ---------------------- | ---------------------- | ----------- |
| Android · Chrome                            |                      |                                 |                        |                        |             |
| iPhone · Safari (PWA instalado, iOS ≥ 16.4) |                      |                                 |                        |                        |             |
| Desktop · Chrome                            |                      |                                 |                        |                        |             |
| Desktop · Firefox (opcional)                |                      |                                 |                        |                        |             |

Se iOS falhar sistematicamente: registrar em ACHADOS e priorizar E11 (WhatsApp "responda no app").

## Rotina diária

- **Médica (5 min):** abrir `/hoje`; para cada alerta clínico, registrar conduta; conferir "Não respondeu"; 1 ajuste de dose em algum "paciente" ao longo da semana (dia 3) para ver o gráfico com marcador.
- **Participantes:** responder o check-in quando o push chegar (ou abrir o app) — inclusive a pergunta de adesão; o alarme é lembrete puro, não tem o que confirmar (E9.1/D15); no dia 4 um deles relata "efeito adverso" de propósito.
- **Observador:** `docker compose … ps` (tudo healthy), olhar logs `notification.failed`, anotar qualquer sucesso falso; dia 7 rodar o relatório.

## Ao fim (dia 7)

```bash
cd packages/core && node ../../scripts/shadow-report.mjs --from YYYY-MM-DD --to YYYY-MM-DD > ../../docs/SHADOW_RUN_RESULTADO.md
```

Preencher no resultado: linha 8 (sucessos falsos observados) e o checklist de push. Decisão: **≥ 7 de 8 critérios ✅ e nenhum aborto** → segue para E10 (piloto real, `docs/PILOTO.md`). Senão: corrigir, repetir 3 dias, reavaliar.
