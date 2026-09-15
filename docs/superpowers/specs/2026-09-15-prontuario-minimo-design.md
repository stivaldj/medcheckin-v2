# E12.1 — Prontuário mínimo: nota clínica datada, condições em catálogo, linha do tempo

**Data:** 2026-09-15 · **Branch:** `feat/prontuario-minimo` (a partir de `main`) · **Etapa no PLANO:** E12.1, primeira das três da E12.

## 1. Contexto e problema

A v2 não tem prontuário. O que existe de texto clínico por paciente são as condutas presas a alertas (`alert_actions.note`) e o motivo de cada ajuste de dose. A médica não tem onde escrever o que aconteceu na consulta, e não há linha do tempo que junte o que ela escreveu com o que o sistema registrou.

`patients.condition_tags` (lista de texto por paciente) existe desde a migration 001, só é preenchida no formulário de novo paciente, não tem catálogo, não tem CID-10 e não filtra a lista. Na v1, 266 tags livres em 3.455 vínculos mostraram que a médica usa condições intensamente; a v1 também mostrou que tabelas de prontuário com templates ficam vazias (3 notas em 910 pacientes).

A E12 inteira (prontuário + importação agêntica do histórico do Versatilis, mais de 1.000 pacientes com 2 a 5 páginas cada) foi decomposta em três specs. Esta é a base: define as tabelas que a importação estruturada (E12.2) e o agente de extração (E12.3) vão preencher, e é usável na próxima consulta sem nenhuma das duas.

## 2. Decisões de produto

- **D35 — Nota clínica é texto livre datado, nunca apagada.** Um texto por consulta, com tipo e data da ocorrência (editável, distinta da data de criação). Sem seções obrigatórias nem templates. "Apagar" oculta (`deleted_at`); a nota segue no banco, no export LGPD e na auditoria. Por quê: a v1 provou que caixas obrigatórias ficam vazias; e prontuário não se apaga.
- **D36 — Condições em catálogo da clínica pelo padrão D34.** A médica digita, o sistema acha ou cria pela chave normalizada, sugere o que já existe. CID-10 é campo opcional da condição, validado só no formato. Duplicata que escapou da chave se corrige com **Fundir**, que move os vínculos. Por quê: "Ansiedade" e "ansiedade generalizada" não podem virar dois filtros; CID obrigatório faria o agente da E12.3 errar milhares de códigos.
- **Linha do tempo agrupa por dia civil do paciente.** Nota é o item principal do dia; ajuste de dose e conduta do mesmo dia aparecem sob ela sem a médica repetir no texto. Dia sem nota mostra o evento sozinho.

## 3. Fora de escopo

Anexos e upload de arquivos, importação de qualquer fonte, agente e pseudonimização (E12.2, E12.3); templates e seções de nota; transcrição de áudio; prescrição; permissão por autor da nota (multi-médico); prazo de retenção próprio para notas; mudança no termo de consentimento (a nota é registro do próprio atendimento; o termo muda na E12.3, quando texto sai da máquina).

## 4. Dados — migration `013_prontuario.js`

```
clinical_notes
  id uuid pk · patient_id → patients (cascade) · kind text CHECK IN (consulta, evolucao, contato, importada)
  occurred_at date NOT NULL · body text NOT NULL · source jsonb NULL
  created_by → users (restrict) · deleted_at timestamptz NULL · created_at/updated_at
  index (patient_id, occurred_at desc)

conditions
  id uuid pk · clinic_id → clinics (restrict) · name text NOT NULL · name_key text NOT NULL
  cid10 text NULL · created_at/updated_at
  unique (clinic_id, name_key)

patient_conditions
  patient_id → patients (cascade) · condition_id → conditions (restrict) · noted_at date NULL
  created_at · primary key (patient_id, condition_id)
```

- `occurred_at` é `date`, não timestamp: consulta tem dia, não hora, e o agrupamento da linha do tempo é por dia civil.
- `source` fica nulo nesta etapa; a E12.3 grava `{ file, page, excerpt }`. Nota com `source` não nulo é somente leitura na UI.
- **Backfill:** para cada paciente, cada tag de `condition_tags` vira `conditions` da clínica (find-or-create pela chave, `name` = tag como está, já minúscula) e um `patient_conditions`. Depois a coluna `patients.condition_tags` é removida. `down` recria a coluna, reconstrói a lista a partir dos vínculos e derruba as três tabelas.
- Chave: `productNameKey` vira `catalogNameKey` em `packages/core/src/catalog/nameKey.js` (mesma implementação); `products` e `conditions` usam a mesma função. O subpath export passa a ser `@medcheckin/core/name-key` apontando para o novo caminho; `productNameKey` continua exportada como alias para não quebrar a migration 012 nem o cliente.

## 5. Core

Módulos novos em `packages/core/src/`:

- `catalog/nameKey.js` — `catalogNameKey(name)` (+ alias `productNameKey`).
- `conditions/index.js` — `findOrCreateCondition(db, session, { name, cid10? })` (autocommit, releitura em 23505, como `findOrCreateProduct`); `listConditions(db, clinicId)` com contagem de pacientes; `updateCondition(id, { name?, cid10? })`; `mergeConditions(db, session, { from_id, into_id })` em transação: move vínculos (ignorando os que já existem no destino), apaga a origem, `logAccess` sem paciente (`conditions.merge`); `addPatientCondition(db, session, patientId, { name | condition_id, noted_at? })`; `removePatientCondition(db, session, patientId, conditionId)`.
- `notes/index.js` — `createNote(db, session, patientId, { kind, occurred_at, body })`; `updateNote(db, session, noteId, { kind?, occurred_at?, body? })` recusa nota com `source` ("Nota importada não se edita; escreva uma nova"); `deleteNote(db, session, noteId)` grava `deleted_at`; `listNotes(db, session, patientId, { includeDeleted = false })`.
- `patients/timeline.js` — `patientTimeline(db, session, patientId, { now })`: lê notas visíveis, `dose_events` (com nome do produto) e `alert_actions` com `note` (conduta), converte cada um para o dia civil no fuso do paciente, agrupa por dia, ordena do mais recente para o mais antigo. Cada item: `{ day, note?: Note, events: Array<{ kind: 'dose' | 'conduct', at, ref_id, summary }> }`. Registra `logAccess` `notes.read` com `action: 'view'`.

Validações: `kind` no conjunto; `occurred_at` `AAAA-MM-DD` e não futura no fuso do paciente; `body` de 1 a 20.000 caracteres após `trim`; `cid10` casa `^[A-Z][0-9]{2}(\.[0-9A-Z]{1,2})?$` (maiúsculo forçado); nome de condição de 2 a 120 caracteres. `requirePatientInClinic` em tudo que recebe paciente; nota e condição de outra clínica → `not_found`.

Auditoria (`access_audit.route`): `notes.create`, `notes.update`, `notes.delete`, `notes.read`, `conditions.add`, `conditions.remove`, `conditions.merge`.

Ajustes no que existe: `getPatientDetail` devolve `conditions: [{ id, name, cid10 }]` em vez de `condition_tags`; `listPatients(db, { clinicId, condition? })` filtra por `condition_id` e devolve `conditions` por paciente; `createPatient` aceita `conditions: string[]` (nomes) e chama `addPatientCondition` para cada; `patientReport` lista condições e as notas do período; `exportPatientData` inclui `clinical_notes` (com ocultas) e `patient_conditions`; `anonymizePatient` apaga o `body` das notas (mantém `kind`, `occurred_at`) e os vínculos de condição; `NewPatientForm` envia `conditions`.

`index.d.ts`: `ClinicalNoteRow`, `ConditionRow`, `PatientConditionRow`, `TimelineDay`, `TimelineEvent`, assinaturas acima; `PatientRow.condition_tags` sai, `PatientDetail.conditions` entra.

## 6. API (`apps/web/app/api`)

| Rota                                                                               | Core                                             |
| ---------------------------------------------------------------------------------- | ------------------------------------------------ |
| `GET /api/patients/:id/notes`                                                      | `listNotes`                                      |
| `POST /api/patients/:id/notes` → 201                                               | `createNote`                                     |
| `PATCH /api/patients/:id/notes/:noteId`                                            | `updateNote`                                     |
| `DELETE /api/patients/:id/notes/:noteId` → 204                                     | `deleteNote`                                     |
| `GET /api/patients/:id/timeline`                                                   | `patientTimeline`                                |
| `GET /api/patients/:id/conditions` · `POST` → 201 · `DELETE /:conditionId` → 204   | `addPatientCondition` / `removePatientCondition` |
| `GET /api/conditions` · `PATCH /api/conditions/:id` · `POST /api/conditions/merge` | catálogo                                         |
| `GET /api/patients?condition=<id>`                                                 | `listPatients` com filtro                        |

Todas via `doctorRoute`. Sem rota nova para o paciente/respondente: prontuário é só da médica.

## 7. Telas (`apps/web`)

- **`components/medica/ProntuarioCard.tsx`** — card **Prontuário** no topo da aba "O caso", antes do gráfico. Botão **Nova nota** abre editor inline (data padrão hoje, tipo padrão consulta, textarea); salva com botão ou `Ctrl+Enter`; erro na mesma linha dos outros cards. Abaixo, a linha do tempo: por dia, a nota (tipo, data, corpo, **Editar**, **Ocultar** com confirmação) e os eventos do dia em linhas menores reaproveitando os textos já existentes de dose e conduta. Nota com `source` mostra "importada de <arquivo>, p. <n>" e não tem Editar. `PrintButton` já existente imprime o card.
- **`components/medica/CatalogNameInput.tsx`** — `ProductNameInput` renomeado e generalizado (props iguais; `placeholder` vira prop). `MedicationsCard` passa a importá-lo.
- **Cabeçalho do paciente** — badges vêm de `detail.conditions`, com `cid10` em fonte mono ao lado quando houver; botão **Editar condições** alterna um `CatalogNameInput` com sugestões de `GET /api/conditions`; Enter adiciona; `×` na badge remove.
- **`app/(medica)/configuracoes/condicoes/page.tsx`** — tabela: nome, CID-10 (editável inline), nº de pacientes; ação **Fundir em…** que escolhe o destino e confirma mostrando quantos vínculos vão migrar. Link novo em Configurações.
- **Lista de pacientes** — select **Condição** (com contagens) ao lado do filtro de status; valor na URL (`?condition=`).
- **`NewPatientForm`** — campo de tags usa `CatalogNameInput`; envia `conditions`.
- `data-testid`: `prontuario-card`, `note-new`, `note-body`, `note-save`, `note-item`, `note-edit`, `note-hide`, `timeline-day`, `timeline-event`, `condition-badge`, `condition-input`, `condition-edit`, `conditions-filter`, `condition-merge`.

## 8. Erros

| Situação                         | Resposta                                             |
| -------------------------------- | ---------------------------------------------------- |
| Corpo vazio ou > 20.000 chars    | 400 `ValidationError` em `body`                      |
| `occurred_at` futura ou inválida | 400 em `occurred_at`                                 |
| Editar nota com `source`         | 400 "Nota importada não se edita; escreva uma nova." |
| Nota/condição de outra clínica   | 404 `not_found`                                      |
| `cid10` fora do formato          | 400 em `cid10`                                       |
| Fundir condição nela mesma       | 400                                                  |
| Corrida em `conditions`          | 23505 → relê e usa a existente                       |
| Paciente já tem a condição       | 200 idempotente, sem duplicar                        |

## 9. Testes

**Core (vitest, Postgres real):** migration 013 backfill de `condition_tags` → tabelas, e `down` reconstrói a lista; `catalogNameKey` = `productNameKey`; `findOrCreateCondition` acha/cria, corrida cria uma só, `cid10` aceita `F41.1` e `G40`, recusa `banana` e `f41`; `mergeConditions` move vínculos sem duplicar e apaga a origem; `addPatientCondition` idempotente; notas: validações da §8, `updateNote` recusa `source`, `deleteNote` oculta e `exportPatientData` ainda traz a nota, `anonymizePatient` apaga o corpo; `patientTimeline` agrupa nota + dose + conduta do mesmo dia civil (paciente em `America/Cuiaba`, evento às 23:30 UTC cai no dia anterior local), evento sem nota aparece sozinho, ordem decrescente; `listPatients` com `condition` filtra; `access_audit` recebe cada rota da §5; nota de outra clínica → `not_found`.

**E2E (Playwright):** (1) escrever nota hoje, ajustar dose hoje, ver a nota com o ajuste embaixo, editar a nota, ocultar e sumir da lista; (2) adicionar condição pelo cabeçalho, badge aparece, lista de pacientes filtra por ela; (3) em Configurações → Condições, editar CID-10 e fundir duas condições, contagem soma.

**Gate:** `npm run check` (lint, prettier, typecheck, vitest) + `npm run test:e2e`. Prova manual: nota escrita no browser em dev, impressa.

## 10. LGPD e docs

Nota clínica entra em `export.zip`, é anonimizada com o paciente, e a leitura da linha do tempo registra `notes.read`. `docs/LGPD.md` ganha a seção "Prontuário"; `docs/MANUAL_MEDICA.md` ganha "Prontuário" (nova nota, linha do tempo, ocultar) e "Condições" (cabeçalho, filtro, fundir). `DECISOES.md`: D35, D36. `PLANO.md`: E12 vira E12.1/E12.2/E12.3 com o escopo decidido; E12.1 `[~]`.

## 11. Arquivos

| Arquivo                                                                                                                   | Ação                                          |
| ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `packages/core/src/catalog/nameKey.js` (+ `.d.ts`)                                                                        | novo; `medications/nameKey.js` vira re-export |
| `packages/core/src/migrations/013_prontuario.js`                                                                          | novo                                          |
| `packages/core/src/conditions/index.js`, `notes/index.js`, `patients/timeline.js`                                         | novos                                         |
| `packages/core/src/patients/index.js`, `report/patientReport.js`, `lgpd/export.js`, `lgpd/anonymize.js`, `seed/index.js`  | ajustes                                       |
| `packages/core/src/index.js`, `index.d.ts`, `package.json`                                                                | exports                                       |
| `packages/core/test/{conditions,notes,timeline,migrations}.test.js`                                                       | novos/ajuste                                  |
| `apps/web/components/medica/{ProntuarioCard,CatalogNameInput}.tsx`; `MedicationsCard`, `NewPatientForm`, header da página | novos/ajustes                                 |
| `apps/web/app/api/patients/[id]/{notes,timeline,conditions}/...`, `app/api/conditions/...`                                | rotas                                         |
| `apps/web/app/(medica)/pacientes/page.tsx`, `pacientes/[id]/page.tsx`, `configuracoes/condicoes/page.tsx`                 | telas                                         |
| `apps/web/e2e/prontuario.spec.ts`, `condicoes.spec.ts`                                                                    | novos                                         |
| `docs/LGPD.md`, `docs/MANUAL_MEDICA.md`, `DECISOES.md`, `PLANO.md`                                                        | docs                                          |
