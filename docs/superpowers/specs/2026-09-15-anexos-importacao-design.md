# E12.2 — Anexos e importação estruturada do Versatilis

**Data:** 2026-09-15 · **Branch:** `feat/anexos-importacao` (a partir de `main`, após E12.1 #44) · **Etapa no PLANO:** E12.2, segunda das três da E12.

## 1. Contexto e problema

A E12.1 deu à médica nota clínica, condições em catálogo e linha do tempo. Falta o que existe fora do sistema: mais de 1.000 pacientes com 2 a 5 páginas de histórico cada no **Versatilis**, cujo extrato ainda vai ser pedido. Sem um jeito de trazer esse cadastro e anexar os PDFs, a E12.3 (agente que lê o PDF e propõe a ficha) não tem sobre o que trabalhar, e a médica não tem onde guardar um exame ou um prontuário antigo hoje.

Decisões já tomadas nesta etapa (com o dono):

- **Versatilis é a fonte de verdade do cadastro.** O SQLite da v1 (910 pacientes com 3 tags automáticas por paciente, 21 medicações, texto clínico vazio) fica de fora; importar os dois duplicaria pacientes.
- **Paciente importado nasce com status novo `registered` ("Cadastrado")**: tem histórico, não está no acompanhamento do app, não tem consentimento v2 nem celular. Vira `active` pelo fluxo de convite que já existe.
- **Anexos ficam num volume Docker próprio**, com metadados no Postgres, e o backup passa a ter duas partes (dump + tar do volume).
- **Importação é um script de linha de comando com ensaio obrigatório**, não uma tela: operação única, formato ainda desconhecido, 1.000 PDFs não passam bem pelo navegador.

## 2. Decisões de produto

- **D37 — Status "Cadastrado" (`registered`)**: paciente com histórico e sem acompanhamento. Invisível para scheduler, alarmes e tela Hoje (que já filtram `active`). A lista de pacientes abre em "Em acompanhamento" (ativos + pausados), com seletor de status, busca por nome e paginação. Por quê: 1.000 linhas numa tabela não funciona, e misturar "nunca acompanhei" com "pausei" quebraria a tela Hoje e o relatório do piloto.
- **D38 — Anexo é arquivo no volume + metadados no banco, ocultado e nunca apagado pelo botão.** PDF, JPG e PNG, até 25 MB, tipo conferido pelos primeiros bytes. Servido só por rota autenticada da médica que confere a clínica. Anonimização apaga o arquivo do disco. Por quê: scans podem chegar a gigabytes e inflar o dump; volume com backup em duas partes mantém o restore drill honesto.
- **D39 — Importação por script com ensaio obrigatório e casamento conservador.** Casa por `external_ref` (id do Versatilis); senão por `name_key + birth_date`; nome igual com nascimento diferente é **colisão**, nunca fusão automática. Idempotente. Por quê: fusão errada de dois pacientes é o pior erro possível num prontuário, e ensaio antes de gravar é a única forma de a médica ver o que vai acontecer.

## 3. Fora de escopo

Ler o conteúdo dos PDFs, extração, pseudonimização, fila de revisão (E12.3); anexos enviados pelo paciente/cuidador; importar medicações/doses como `dose_events` (se vierem no CSV, entram como nota importada; dose vigente é decisão da médica na E12.3); migrar o SQLite da v1; tela de importação; storage externo.

## 4. Dados — migration `014_anexos_importacao.js`

```
patients (alterações)
  status CHECK passa a incluir 'registered'
  external_source text NULL        -- 'versatilis' | NULL
  external_ref    text NULL        -- id no sistema de origem
  imported_at     timestamptz NULL
  name_key        text NOT NULL    -- catalogNameKey(name); backfill; índice (clinic_id, name_key)
  unique parcial (clinic_id, external_source, external_ref) WHERE external_ref IS NOT NULL

attachments
  id uuid pk · patient_id → patients (cascade) · kind text CHECK IN (pdf, image)
  original_name text NOT NULL · mime text NOT NULL · size_bytes integer NOT NULL · sha256 text NOT NULL
  stored_path text NOT NULL        -- relativo a UPLOADS_DIR: '<clinic_id>/<uuid>.<ext>'
  source text CHECK IN (upload, import) · uploaded_by → users (restrict) NULL
  deleted_at timestamptz NULL · created_at
  index (patient_id, created_at) · unique (patient_id, sha256)
```

- `name_key` em `patients` usa a mesma `catalogNameKey` (busca sem acento e casamento da importação); `createPatient`/`updatePatient` mantêm a coluna.
- `down`: derruba `attachments`, remove as colunas, restaura o CHECK antigo (pacientes `registered` viram `paused` antes, com aviso no log).
- Consultas históricas que vierem no CSV viram `clinical_notes` (`kind = 'importada'`, `body = 'Consulta registrada no Versatilis'`, `source = { system: 'versatilis', ref: <id da consulta> }`), reaproveitando a tabela da E12.1.

## 5. Core

- `attachments/index.js`: `storeAttachment(db, session, patientId, { buffer, originalName, mime }, now)` → valida magic bytes (`%PDF-`, JPEG `FF D8 FF`, PNG `89 50 4E 47`), tamanho ≤ 25 MB (`ATTACHMENT_MAX_BYTES`), calcula sha256, grava em `UPLOADS_DIR/<clinic>/<uuid>.<ext>` com `fs.writeFile` + `fsync`, insere; se o insert falhar, apaga o arquivo; sha256 repetido no mesmo paciente devolve o existente (idempotente). `listAttachments(db, session, patientId)` (visíveis). `openAttachment(db, session, attachmentId)` → `{ row, stream }` após conferir clínica via join com `patients`. `hideAttachment` grava `deleted_at`. Auditoria `attachments.create`, `attachments.read`, `attachments.delete`. `UPLOADS_DIR` vem de `config.js`: obrigatória em produção, `./uploads` em dev/teste.
- `patients/index.js`: `listPatients(db, { clinicId, condition, q, status = 'following', page = 1, pageSize = 50 }, now)` → `{ rows, total, page, pageSize }`; `q` filtra `name_key ILIKE '%' || catalogNameKey(q) || '%'`; `status` ∈ `following` (active+paused) | `active` | `paused` | `discharged` | `registered` | `all`. `PATIENT_STATUS` ganha `registered`; `patientPatch` continua não aceitando `registered` por edição comum (só a importação grava). Transição `registered → active` acontece em `acceptInvite` (fluxo existente) quando o consentimento é aceito.
- `patients/timeline.js`: `patientTimeline(db, session, patientId, { now, before?, limitDays = 60 })` → `{ days, hasMore, nextBefore }`. (Pré-requisito que a E12.1 deixou.)
- `import/versatilis.js` (puro, sem I/O): `planImport({ rows, mapa, pdfFiles, existing })` → `{ criar[], casar[], colidir[], pdfSemPaciente[], pacienteSemPdf[] }`; `executeImport(db, session, plan, { readPdf }, now)` grava por paciente em transação (`patients` `registered` + `external_*` + `imported_at`; condições via `findOrCreateCondition` fora da transação como no D34; notas de consulta; anexo via `storeAttachment` com `source = 'import'`); segunda execução não cria nada (unique parcial + sha256).
  - `mapa.json`: `{ colunas: { ref, nome, nascimento, telefone, condicoes, consultas? }, formatoData: 'DD/MM/AAAA', separadorCondicoes: ';', pdf: { padrao: '{ref}.pdf' | '{nome}.pdf' } }`.
- LGPD: `exportPatientData` inclui `attachments.json` e os arquivos em `anexos/<original_name>` dentro do zip; `anonymizePatient` apaga os arquivos do disco (`fs.rm`, ignora ausente) e zera `original_name` para `anexo <n>`; `applyRetention` não muda.

## 6. API

| Rota                                                                                                        | Core              |
| ----------------------------------------------------------------------------------------------------------- | ----------------- |
| `GET /api/patients/:id/attachments`                                                                         | `listAttachments` |
| `POST /api/patients/:id/attachments` (multipart, campo `file`) → 201; 413 acima de 25 MB; 415 tipo recusado | `storeAttachment` |
| `GET /api/patients/:id/attachments/:attachmentId` → stream, `Content-Disposition: inline`                   | `openAttachment`  |
| `DELETE /api/patients/:id/attachments/:attachmentId` → 204                                                  | `hideAttachment`  |
| `GET /api/patients?q=&status=&condition=&page=` → `{ rows, total, page, pageSize }`                         | `listPatients`    |
| `GET /api/patients/:id/timeline?before=`                                                                    | `patientTimeline` |

Sem rota de importação. `POST` de anexo usa `req.formData()` do Next; corpo até 26 MB via `export const config`/route segment.

## 7. Script — `scripts/import-versatilis.mjs`

`node --env-file=.env scripts/import-versatilis.mjs --cadastro <csv> --pdfs <pasta> --mapa <json> --clinica <email da médica> [--gravar]`

- Sem `--gravar`: **ensaio** — lê tudo, monta o plano, escreve `import-ensaio-<data>.md` (contagens por categoria, lista de colisões com os dois nascimentos, PDFs órfãos, pacientes sem PDF), sai com código 0 se não houver colisão e 2 se houver. Nada gravado.
- Com `--gravar`: recusa se houver colisão não resolvida (o dono edita o CSV ou o mapa); executa; escreve `import-resultado-<data>.md` com o que criou, casou e anexou, e o tempo.
- Sessão do script: usuário da clínica pelo e-mail (`kind: 'user'`), para a auditoria registrar quem importou.
- Exemplo versionado: `docs/import/versatilis.exemplo.json` e `docs/import/VERSATILIS.md` (como pedir o extrato, preencher o mapa, ensaio, gravação, colisões).

## 8. Telas

- **Lista de pacientes**: barra com busca (`?q=`, 300 ms ou Enter), seletor de status (Em acompanhamento · Cadastrados · Alta · Todos; `?status=`), filtro de condição existente, paginação de 50 ("anterior / próxima", "N de M"); contagens do cabeçalho vêm de `total`. Linha `registered`: badge **Cadastrado** e "importado do Versatilis em dd/mm" no lugar da dose.
- **Página do paciente `registered`**: faixa "Cadastrado a partir do Versatilis. Sem acompanhamento no app." + **Iniciar acompanhamento** (abre o convite existente). `SetupChecklist` oculto.
- **Card Anexos** (aba "O caso", abaixo do Prontuário): lista (nome, tipo, tamanho, data, origem), **Anexar arquivo** (input `accept="application/pdf,image/jpeg,image/png"`, checagem de 25 MB no cliente antes de enviar, barra de progresso simples), PDF abre em `<iframe>` da rota autenticada com botão "abrir em nova aba", imagem abre ampliada, **Ocultar** com confirmação inline. Impressão esconde o visualizador.
- **Linha do tempo**: **Carregar mais** quando `hasMore`; notas `importada` mostram "importada · Versatilis".
- `data-testid`: `patients-search`, `patients-status`, `patients-pager`, `attachments-card`, `attachment-upload`, `attachment-item`, `attachment-open`, `attachment-hide`, `attachment-hide-confirm`, `attachment-viewer`, `registered-banner`, `start-followup`, `timeline-more`.

## 9. Erros

| Situação                                      | Resposta                            |
| --------------------------------------------- | ----------------------------------- |
| Arquivo > 25 MB                               | 413 `ValidationError` em `file`     |
| Tipo fora de PDF/JPG/PNG (por bytes)          | 415 `ValidationError` em `file`     |
| Mesmo sha256 no mesmo paciente                | 200 com o anexo existente           |
| Anexo de outra clínica                        | 404 `not_found`, sem tocar no disco |
| `UPLOADS_DIR` ausente em produção             | falha no boot com mensagem clara    |
| `q` com menos de 2 caracteres                 | ignorado (lista sem busca)          |
| Importação: nome igual + nascimento diferente | colisão listada; `--gravar` recusa  |
| Importação: `external_ref` já existe          | casa e atualiza só campos vazios    |

## 10. Testes

Core (Postgres real, `UPLOADS_DIR` temporário): migration 014 up/down com pacientes `registered` (viram `paused` no down); `storeAttachment` aceita PDF/JPG/PNG por bytes e recusa `.exe` renomeado, 25 MB + 1, duplicata por sha256, insert falho apaga o arquivo; `openAttachment` de outra clínica `not_found` sem `fs.open`; `listPatients` busca sem acento, pagina, `total`, `following`; `patientTimeline` com `limitDays`/`before`/`hasMore`; `planImport` nas cinco categorias; `executeImport` idempotente; consultas viram notas `importada`; export com arquivos; anonimização apaga do disco. Script: ensaio e gravação contra CSV sintético de 5 linhas e 3 PDFs falsos. E2E: anexar PDF pequeno, ver, abrir visualizador, ocultar; lista: `registered` só em Cadastrados, busca acha, paginação com 60 sintéticos. Gate: `npm run check` + E2E + `restore-drill.sh` local com um anexo.

## 11. Deploy e docs

- `docker-compose.prod.yml`/`.casa.yml`: volume `uploads` no web (`/data/uploads`) e read-only no backup; `UPLOADS_DIR=/data/uploads` no web. `backup.sh` gera também `uploads-<data>.tar.enc` + `.sha256` e envia por rclone; `restore-drill.sh` restaura ambos e confere que cada `attachments.stored_path` existe no tar.
- `docs/LGPD.md`: seção "Anexos e pacientes importados". Manual: "Anexos", "Pacientes cadastrados", "Buscar e filtrar". `docs/DEPLOY.md`/`DEPLOY-CASA.md`: `UPLOADS_DIR`, volume, backup em duas partes, drill. `DECISOES.md`: D37–D39. `PLANO.md`: E12.2 `[~]`, log.
- Migration 014 só adiciona: sem janela crítica.

## 12. Arquivos

| Arquivo                                                                                                                                                                           | Ação         |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| `packages/core/src/migrations/014_anexos_importacao.js`                                                                                                                           | novo         |
| `packages/core/src/attachments/index.js`, `import/versatilis.js`                                                                                                                  | novos        |
| `packages/core/src/patients/index.js`, `patients/timeline.js`, `auth/invite.js` (registered→active), `lgpd/export.js`, `lgpd/anonymize.js`, `config.js`, `index.js`, `index.d.ts` | ajustes      |
| `packages/core/test/{attachments,import-versatilis,patients-list,timeline}.test.js`, `migrations.test.js`                                                                         | novos/ajuste |
| `scripts/import-versatilis.mjs`, `docs/import/{VERSATILIS.md,versatilis.exemplo.json}`                                                                                            | novos        |
| `apps/web/app/api/patients/[id]/attachments/...`, `app/api/patients/route.ts`, `app/api/patients/[id]/timeline/route.ts`                                                          | rotas        |
| `apps/web/components/medica/{AttachmentsCard,PatientsToolbar,RegisteredBanner}.tsx`, `ProntuarioCard` (carregar mais)                                                             | novos/ajuste |
| `apps/web/app/(medica)/pacientes/page.tsx`, `pacientes/[id]/page.tsx`                                                                                                             | telas        |
| `apps/web/e2e/{anexos,lista-pacientes}.spec.ts`                                                                                                                                   | novos        |
| `docker-compose.prod.yml`, `docker-compose.casa.yml`, `scripts/backup.sh`, `scripts/restore-drill.sh`                                                                             | deploy       |
| `docs/LGPD.md`, `docs/MANUAL_MEDICA.md`, `docs/DEPLOY.md`, `docs/DEPLOY-CASA.md`, `DECISOES.md`, `PLANO.md`                                                                       | docs         |
