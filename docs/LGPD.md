# LGPD — MedCheck-in v2

Documento de referência para a operação do piloto. Não substitui parecer jurídico.

## Papéis

- **Controladora:** a clínica (Dra. Rafaela Trevisan) — decide finalidade e meios.
- **Operador:** quem hospeda/opera o software (VPS, backups) — trata dados só sob instrução da controladora.
- **Titulares:** pacientes e respondentes (cuidadores).

## Dados tratados e finalidade

| Dado                                                                       | Tabelas                                                                          | Finalidade                                              | Base legal (LGPD)                                                                                                                                         |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identificação do paciente (nome, nascimento, condições)                    | `patients`                                                                       | Acompanhamento clínico                                  | Tutela da saúde (art. 11, II, f) + consentimento (art. 11, I) registrado em `patients.consent_version/consent_at`                                         |
| Contato do respondente (nome, e-mail, telefone, relação)                   | `respondents`                                                                    | Enviar alarmes/check-ins e permitir resposta            | Consentimento **do próprio respondente** no aceite do convite (`respondents.consent_version/consent_at`, versão do termo exibido em `/p/convite/[token]`) |
| Respostas de check-in (inclui adesão), rotina de alarmes, efeitos adversos | `answers`, `routine_periods`, `routine_alarms`, `medication_intakes` (histórico) | Monitorização e ajuste terapêutico                      | Tutela da saúde                                                                                                                                           |
| Doses e episódios                                                          | `dose_events`, `episodes`                                                        | Correlacionar sintoma × dose                            | Tutela da saúde                                                                                                                                           |
| Alertas e condutas                                                         | `alerts`, `alert_actions`                                                        | Segurança do paciente; registro da conduta              | Tutela da saúde / obrigação regulatória                                                                                                                   |
| Inscrições push (endpoint, chaves)                                         | `push_subscriptions`                                                             | Entregar notificações ao dispositivo                    | Consentimento (permissão do navegador + aceite)                                                                                                           |
| Metadados de notificação (kind, sent/failed)                               | `notifications`                                                                  | Prova de envio (regra: estado só avança com envio real) | Interesse legítimo (operação); **sem conteúdo após retenção**                                                                                             |
| Auditoria de acesso                                                        | `access_audit`                                                                   | Rastreabilidade de quem viu o quê                       | Obrigação legal/segurança (art. 46)                                                                                                                       |
| Sessões, tokens de login (só hash)                                         | `sessions`, `auth_tokens`                                                        | Autenticação                                            | Necessidade técnica                                                                                                                                       |

**Nunca tratados:** CPF, endereço, dados financeiros, mensagens de texto livre por WhatsApp (o v2 não tem parser de texto; o campo livre `obs` é opcional e é o único texto livre do respondente).

## Direitos dos titulares (art. 18) — como atender

| Direito                             | Como                                                                                                                                        | Onde                                                                                  |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Confirmação e acesso; portabilidade | **Exportar dados (LGPD)** na página do paciente → `export.zip` (manifest com contagens + um JSON por tabela; notificações só com metadados) | `GET /api/patients/[id]/export`, audit `export`                                       |
| Correção                            | Editar paciente/respondentes na UI (audit `update`)                                                                                         | `/pacientes/[id]`                                                                     |
| Eliminação                          | **Anonimização** (não há apagamento físico do prontuário — ver Guarda)                                                                      | `POST /api/patients/[id]/anonymize` (motivo + confirmação do nome), audit `anonymize` |
| Revogação do consentimento          | Anonimizar o respondente/paciente ou pausar envios ("Pausar envios"); revogar push no dispositivo                                           | UI                                                                                    |
| Informação sobre compartilhamento   | Não há compartilhamento com terceiros além do provedor de push (endpoint do navegador) e do provedor de e-mail (link mágico)                | este documento                                                                        |

### Anonimização — o que muda e o que fica

Remove: nome do paciente, data de nascimento, nomes/e-mails/telefones/relação dos respondentes, tokens de convite (rotacionados), sessões e inscrições push (revogadas), textos livres (`answers.value_text` → "[removido]", `notes` de dose/tomada), conteúdo de notificações.
Mantém (sem identificação): respostas numéricas e de escolha, scores diários, histórico de doses, episódios, alertas e condutas, auditoria. Motivo: obrigação de guarda do prontuário (CFM Res. 1.821/2007 — 20 anos) e utilidade estatística anonimizada. O paciente vira `Paciente anonimizado <hash>` e status `discharged`.

## Prontuário (notas clínicas e condições) — E12.1

- **Nota clínica** (`clinical_notes`) é texto livre da médica sobre a consulta: dado de saúde do titular, base legal = tutela da saúde e obrigação de guarda do prontuário (CFM 1.821/2007). Nunca é apagada pelo botão: **Ocultar** grava `deleted_at`; a nota segue no banco, entra no `export.zip` (`clinical_notes.json`, inclusive ocultas) e na auditoria.
- **Anonimização** troca o corpo de toda nota por `[removido]` e mantém tipo e data (série clínica sem identidade). Os vínculos com condições (`patient_conditions`) são removidos; o catálogo de condições da clínica fica.
- **Condições** (`conditions`, `patient_conditions`) são catálogo da clínica; entram no export como `conditions.json`.
- **Auditoria**: `notes.create`, `notes.update`, `notes.delete`, `notes.read` (cada abertura da linha do tempo), `conditions.add`, `conditions.remove`, `conditions.merge`.
- Nada de texto clínico sai da máquina nesta etapa. A E12.3 (importação por agente) exigirá termo de consentimento próprio e pseudonimização antes de qualquer envio.

## Anexos e pacientes importados — E12.2

- **Anexos** (`attachments` + arquivos em `UPLOADS_DIR`) são dado de saúde do titular (exames, prontuários antigos): base legal = tutela da saúde e guarda do prontuário. Só PDF, JPG e PNG, tipo conferido pelo conteúdo, até 25 MB. Servidos só à médica da clínica, com auditoria `attachments.read` a cada abertura. **Ocultar** grava `deleted_at`; o arquivo fica.
- **Export** (`export.zip`): `attachments.json` com metadados de todos (inclusive ocultos) e os arquivos em `anexos/`. **Anonimização**: os arquivos são apagados do disco e `original_name` vira `anexo N`.
- **Backup**: o volume de anexos entra no backup diário como segunda parte (`uploads-*.tar.enc`), cifrada com a mesma frase; o restore drill confere que cada anexo do banco existe no tar.
- **Pacientes importados** (status **Cadastrado**) vêm do sistema anterior da clínica (Versatilis), com cadastro, condições, datas de consulta e o PDF do prontuário. Não têm consentimento v2 e **não recebem nada**; a base legal é a continuidade do cuidado e a guarda do prontuário. O termo v2 é pedido em **Iniciar acompanhamento**, e só então o paciente passa a ativo. A importação registra `patients.import` na auditoria.

## Retenção automática (`applyRetention`, 1×/dia no scheduler)

| Dado                                                     | Prazo                      | Motivo                        |
| -------------------------------------------------------- | -------------------------- | ----------------------------- |
| `notifications`                                          | 90 dias                    | só prova de envio operacional |
| `sessions` expiradas/revogadas                           | 30 dias                    | segurança                     |
| `auth_tokens`                                            | 7 dias                     | uso único, 15 min de validade |
| `access_audit`                                           | 2 anos                     | rastreabilidade               |
| Prontuário (respostas, doses, alertas, condutas, scores) | não expira automaticamente | guarda legal                  |

## Segurança (medidas técnicas)

- Postgres com `clinic_id` em todo dado de paciente; acesso cross-clinic devolve 404 (sem enumeração).
- Sessões opacas em cookie `HttpOnly; SameSite=Lax; Secure` (produção); tokens só como hash; link mágico de uso único (15 min); throttle por e-mail.
- Checagem de `Origin` em toda rota mutável (CSRF).
- Logs estruturados com redação de PII e conteúdo clínico (`text`, `value`, `notes`, nome, e-mail, telefone, endpoint/keys de push).
- Auditoria de acesso a prontuário desde a primeira rota (`access_audit`).
- Nada é "enviado"/"confirmado" sem prova (estado só avança com notificação aceita; adesão só por confirmação do respondente).
- Segredos só em variáveis de ambiente; processo não sobe sem eles (fail-closed).
- Backups cifrados e restore testado: **E8**.

## Incidentes

1. Conter (revogar sessões: `revokeAllForPrincipal`; rotacionar convites; desligar scheduler).
2. Avaliar dados afetados via `access_audit` e logs.
3. Comunicar controladora → ANPD/titulares conforme art. 48 (prazo razoável; registrar decisão).
4. Registrar em `docs/INCIDENTES.md` (criar no primeiro incidente).

## Termo de consentimento — versão vigente `v1`

Exibido em `/p/convite/[token]` (respondente) e confirmado pela médica no cadastro (paciente). Alterar o texto ⇒ nova versão (`v2`) e novo aceite dos respondentes (a UI mostra a versão aceita em Configurações).
