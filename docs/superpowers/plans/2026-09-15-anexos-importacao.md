# E12.2 Anexos e importação do Versatilis — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A médica anexa PDFs e imagens ao paciente (guardados num volume com backup), a lista de pacientes ganha busca, status e paginação para aguentar 1.000+ cadastros, e um script com ensaio importa o cadastro do Versatilis criando pacientes "Cadastrados" com histórico e PDF anexado.

**Architecture:** Migration 014 adiciona o status `registered`, colunas de origem e `name_key` em `patients`, e a tabela `attachments` (metadados; bytes no disco em `UPLOADS_DIR`). Core ganha `attachments/` (validação por magic bytes, sha256, escrita atômica), `listPatients` paginada com busca, `patientTimeline` com janela, e `import/` (parser CSV + motor plano/execução puro). Upload passa por um envelope novo (`doctorUploadRoute`) porque `doctorRoute` lê o corpo como JSON. Backup passa a ter duas partes (dump + tar do volume), e o restore drill confere que cada `stored_path` existe no tar.

**Tech Stack:** Node 22 ESM, Knex + Postgres (sem SQLite, D6), luxon, vitest (`packages/core`), Next.js 15 App Router + base-ui + Tailwind (`apps/web`), Playwright E2E, Docker Compose, `openssl`/`tar` (busybox) no container de backup.

**Spec:** `docs/superpowers/specs/2026-09-15-anexos-importacao-design.md`

## Global Constraints

- Postgres real em todos os testes (`DATABASE_URL_TEST` ou `DATABASE_URL`; porta 5434 local). Testes de arquivo usam `UPLOADS_DIR` apontando para um diretório temporário (`fs.mkdtemp`), nunca `./uploads` do repo.
- **Gate do repo:** `npm run check` (lint, `prettier --check .`, typecheck, vitest core + web) e `npm run test:e2e`. Rodar `npx prettier --write <arquivos>` antes de cada commit. `docs/INVENTARIO_V1.md` (untracked, de outra sessão) fica fora de todo `git add`.
- Textos, mensagens de erro, comentários e commits em **português do Brasil**. Commits `tipo(escopo): mensagem`, terminando com `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Anexos: tipos aceitos **só** PDF, JPEG, PNG, decididos pelos primeiros bytes (`%PDF-`, `FF D8 FF`, `89 50 4E 47`), não pela extensão nem pelo `Content-Type`; tamanho máximo **25 MB** (`ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024`); `stored_path = '<clinic_id>/<uuid>.<ext>'` relativo a `UPLOADS_DIR`; sha256 repetido no mesmo paciente devolve o existente.
- `UPLOADS_DIR`: obrigatória quando `NODE_ENV === 'production'` (fail-closed em `loadConfig`); default `./uploads` fora de produção.
- Status de paciente: `active | paused | discharged | registered`. `registered` só nasce pela importação; vira `active` em `acceptInvite` no primeiro aceite de consentimento. Scheduler, alarmes, alertas e tela Hoje já filtram `active` e **não mudam**.
- `listPatients` passa a devolver `{ rows, total, page, pageSize }`; `status` aceita `following` (active + paused, **padrão**), `active`, `paused`, `discharged`, `registered`, `all`; `q` com menos de 2 caracteres é ignorado; `pageSize` padrão 50, máximo 200.
- `patientTimeline` passa a devolver `{ days, hasMore, nextBefore }`; janela padrão 60 dias a partir de `before` (padrão: hoje no fuso do paciente).
- Importação: casa por `external_ref`; senão por `name_key + birth_date`; nome igual com nascimento diferente (ou um dos dois sem nascimento) é **colisão**; `--gravar` recusa com colisão pendente; idempotente.
- Tenancy: `requirePatientInClinic` em tudo que recebe paciente; anexo de outra clínica → `not_found` **sem** abrir o arquivo. Auditoria: `attachments.create`, `attachments.read`, `attachments.delete`, `patients.import`.
- Nunca `git push`/PR sem o dono pedir. Branch `feat/anexos-importacao` (já existe, spec commitada).

---

## Estrutura de arquivos

| Arquivo                                                                                                                                                        | Responsabilidade                                                                         |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `packages/core/src/config.js`                                                                                                                                  | `loadConfig` ganha `uploadsDir` (fail-closed em produção)                                |
| `packages/core/src/migrations/014_anexos_importacao.js`                                                                                                        | status `registered`, `external_*`, `imported_at`, `name_key` (+ backfill), `attachments` |
| `packages/core/src/attachments/index.js`                                                                                                                       | magic bytes, sha256, escrita atômica, listar/abrir/ocultar                               |
| `packages/core/src/import/csv.js`                                                                                                                              | parser CSV (RFC 4180, delimitador configurável), sem dependência                         |
| `packages/core/src/import/versatilis.js`                                                                                                                       | `planImport` (puro) e `executeImport`                                                    |
| `packages/core/src/patients/index.js`                                                                                                                          | `PATIENT_STATUS`, `name_key` no patch, `listPatients` paginada                           |
| `packages/core/src/patients/timeline.js`                                                                                                                       | janela `before`/`limitDays`, `hasMore`                                                   |
| `packages/core/src/auth/invite.js`                                                                                                                             | `registered → active` no primeiro aceite                                                 |
| `packages/core/src/lgpd/export.js`, `lgpd/anonymize.js`                                                                                                        | anexos no zip; arquivos apagados na anonimização                                         |
| `packages/core/src/index.js`, `index.d.ts`                                                                                                                     | exports e tipos                                                                          |
| `packages/core/test/{attachments,import-versatilis,patients-list,timeline-window,migrations}.test.js`, ajustes em `services`, `conditions`, `lgpd`, `timeline` | testes                                                                                   |
| `scripts/import-versatilis.mjs`, `docs/import/VERSATILIS.md`, `docs/import/versatilis.exemplo.json`, `packages/core/test/fixtures/versatilis/*`                | script, docs, fixtures                                                                   |
| `apps/web/lib/api.ts`                                                                                                                                          | `doctorUploadRoute` (não lê o corpo)                                                     |
| `apps/web/app/api/patients/[id]/attachments/route.ts`, `.../[attachmentId]/route.ts`, `app/api/patients/route.ts`, `app/api/patients/[id]/timeline/route.ts`   | rotas                                                                                    |
| `apps/web/components/medica/{AttachmentsCard,PatientsToolbar,RegisteredBanner}.tsx`, `ProntuarioCard.tsx`                                                      | UI                                                                                       |
| `apps/web/app/(medica)/pacientes/page.tsx`, `pacientes/[id]/page.tsx`, `apps/web/lib/format.ts`                                                                | telas                                                                                    |
| `apps/web/e2e/{anexos,lista-pacientes}.spec.ts`                                                                                                                | E2E                                                                                      |
| `docker-compose.prod.yml`, `docker-compose.casa.yml`, `docker-compose.yml`, `scripts/backup.sh`, `scripts/restore-drill.sh`, `.env.example`, `.gitignore`      | deploy                                                                                   |
| `docs/LGPD.md`, `docs/MANUAL_MEDICA.md`, `docs/DEPLOY.md`, `docs/DEPLOY-CASA.md`, `DECISOES.md`, `PLANO.md`, `tasks/todo.md`                                   | docs                                                                                     |

---

### Task 1: Config `uploadsDir` + migration 014 + status `registered`

**Files:**

- Modify: `packages/core/src/config.js`
- Create: `packages/core/src/migrations/014_anexos_importacao.js`
- Modify: `packages/core/src/patients/index.js` (`PATIENT_STATUS`, `patientPatch` grava `name_key`, `createPatient`), `packages/core/src/index.d.ts` (`PatientRow.status`, campos novos, `AttachmentRow`), `apps/web/lib/format.ts` (`STATUS_LABEL.registered`)
- Test: `packages/core/test/migrations.test.js` (novo `it`), `packages/core/test/env.test.js` (caso de `uploadsDir`)

**Interfaces:**

- Produces: `loadConfig(env).uploadsDir: string`; coluna `patients.name_key`, `patients.status` aceita `registered`, `patients.external_source/external_ref/imported_at`; tabela `attachments`; `PATIENT_STATUS` com `registered`.

- [ ] **Step 1: Testes que falham**

Acrescentar em `packages/core/test/env.test.js` (ver como o arquivo importa `loadConfig`):

```js
it('uploadsDir: default ./uploads fora de produção; obrigatório em produção', () => {
  const base = { DATABASE_URL: 'postgres://x' };
  expect(loadConfig(base).uploadsDir).toBe('./uploads');
  expect(loadConfig({ ...base, UPLOADS_DIR: '/data/up' }).uploadsDir).toBe('/data/up');
  expect(() => loadConfig({ ...base, NODE_ENV: 'production' })).toThrow(/UPLOADS_DIR/);
  expect(loadConfig({ ...base, NODE_ENV: 'production', UPLOADS_DIR: '/data/up' }).uploadsDir).toBe(
    '/data/up',
  );
});
```

Acrescentar ao fim do `describe` em `packages/core/test/migrations.test.js`:

```js
/**
 * D37/D38 — a 014 adiciona status `registered`, colunas de origem, `name_key` com backfill e a
 * tabela `attachments`; o `down` leva `registered` para `paused` antes de restaurar o CHECK.
 */
it('014: registered, name_key com backfill, attachments; down rebaixa registered para paused', async () => {
  await db.raw('drop schema public cascade; create schema public');
  const [, pendentes] = await db.migrate.list(migrationConfig);
  const idx = pendentes.findIndex((m) => m.file.startsWith('014_'));
  for (let i = 0; i < idx; i += 1) await db.migrate.up(migrationConfig);
  expect(await db.schema.hasColumn('patients', 'name_key')).toBe(false);

  const [clinic] = await db('clinics').insert({ name: 'Clínica 014' }).returning('id');
  const [user] = await db('users')
    .insert({ clinic_id: clinic.id, role: 'doctor', email: 'dra-014@example.test', name: 'Dra.' })
    .returning('id');
  const [p] = await db('patients')
    .insert({
      clinic_id: clinic.id,
      name: '  José  da Silva ',
      timezone: 'America/Cuiaba',
      created_by: user.id,
    })
    .returning('id');

  await db.migrate.up(migrationConfig);
  const row = await db('patients').where({ id: p.id }).first();
  expect(row.name_key).toBe('jose da silva');
  expect(row.status).toBe('active');
  await db('patients')
    .where({ id: p.id })
    .update({ status: 'registered', external_source: 'versatilis', external_ref: '42' });
  await expect(
    db('patients').insert({
      clinic_id: clinic.id,
      name: 'Outro',
      name_key: 'outro',
      timezone: 'America/Cuiaba',
      created_by: user.id,
      external_source: 'versatilis',
      external_ref: '42',
    }),
  ).rejects.toMatchObject({ code: '23505' });
  expect(await db.schema.hasTable('attachments')).toBe(true);

  await db.migrate.down(migrationConfig);
  expect(await db.schema.hasTable('attachments')).toBe(false);
  expect(await db.schema.hasColumn('patients', 'name_key')).toBe(false);
  expect((await db('patients').where({ id: p.id }).first()).status).toBe('paused');
  await expect(
    db('patients').where({ id: p.id }).update({ status: 'registered' }),
  ).rejects.toMatchObject({ code: '23514' });
  await db.migrate.up(migrationConfig);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -w @medcheckin/core -- test/env.test.js test/migrations.test.js`
Expected: FAIL — `uploadsDir` é `undefined`; `findIndex('014_')` dá `-1` e `hasColumn('patients','name_key')` segue `false` após o `up`.

- [ ] **Step 3: Config**

```js
// packages/core/src/config.js
/**
 * Config fail-closed (DECISOES.md L9): variável obrigatória ausente → lança.
 * Nunca loga valores. Recebe `env` explicitamente para ser testável.
 */
export function loadConfig(env = process.env) {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl || databaseUrl.trim() === '') {
    throw new Error('DATABASE_URL ausente: o processo não sobe sem banco configurado.');
  }
  // D38: anexos vivem num volume próprio. Em produção o caminho tem que ser explícito (é o que o
  // backup em duas partes tar-eia); fora dela, ./uploads relativo ao cwd serve para dev e testes.
  const uploadsDir = (env.UPLOADS_DIR ?? '').trim();
  if (!uploadsDir && env.NODE_ENV === 'production') {
    throw new Error('UPLOADS_DIR ausente: em produção o volume de anexos é obrigatório.');
  }
  return Object.freeze({ databaseUrl, uploadsDir: uploadsDir || './uploads' });
}
```

- [ ] **Step 4: Migration**

```js
// packages/core/src/migrations/014_anexos_importacao.js
import { catalogNameKey } from '../catalog/nameKey.js';

/**
 * E12.2 — anexos e importação estruturada.
 *
 * D37: status `registered` ("Cadastrado"): paciente com histórico e sem acompanhamento. Só a
 * importação grava; vira `active` no primeiro aceite de consentimento. Scheduler/alarmes/Hoje já
 * filtram `active`, então nada dispara para ele.
 *
 * `name_key` em patients: a mesma chave dos catálogos (D34/D36), para busca sem acento e para a
 * importação casar por nome + nascimento. Backfill em JS com a função do runtime.
 *
 * D38: `attachments` guarda metadados; os bytes ficam em UPLOADS_DIR/<stored_path>. `deleted_at`
 * oculta sem apagar; a anonimização é quem remove do disco.
 */
const ID = (t, knex) => t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));

export async function up(knex) {
  await knex.schema.alterTable('patients', (t) => {
    t.dropChecks(['chk_status']);
    t.check("status in ('active', 'paused', 'discharged', 'registered')", [], 'chk_status');
    t.text('external_source');
    t.text('external_ref');
    t.timestamp('imported_at', { useTz: true });
    t.text('name_key');
  });
  const rows = await knex('patients').select('id', 'name');
  for (const r of rows) {
    await knex('patients')
      .where({ id: r.id })
      .update({ name_key: catalogNameKey(r.name) });
  }
  await knex.schema.alterTable('patients', (t) => {
    t.text('name_key').notNullable().alter();
    t.index(['clinic_id', 'name_key']);
  });
  await knex.raw(
    `create unique index patients_external_ref_unique on patients (clinic_id, external_source, external_ref)
       where external_ref is not null`,
  );

  await knex.schema.createTable('attachments', (t) => {
    ID(t, knex);
    t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
    t.text('kind').notNullable();
    t.check("kind in ('pdf', 'image')", [], 'chk_attachment_kind');
    t.text('original_name').notNullable();
    t.text('mime').notNullable();
    t.integer('size_bytes').notNullable();
    t.text('sha256').notNullable();
    t.text('stored_path').notNullable();
    t.text('source').notNullable().defaultTo('upload');
    t.check("source in ('upload', 'import')", [], 'chk_attachment_source');
    t.uuid('uploaded_by').references('id').inTable('users').onDelete('RESTRICT');
    t.timestamp('deleted_at', { useTz: true });
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['patient_id', 'created_at']);
    t.unique(['patient_id', 'sha256']);
  });
}

export async function down(knex) {
  await knex.schema.dropTable('attachments');
  // Sem `registered` no CHECK antigo: quem estava cadastrado vira pausado (não perde dado, e não
  // volta a receber envio sozinho). O log avisa quantos.
  const n = await knex('patients').where({ status: 'registered' }).update({ status: 'paused' });
  if (n)
    console.warn(`migration 014 down: ${n} paciente(s) 'registered' rebaixado(s) para 'paused'.`);
  await knex.raw('drop index if exists patients_external_ref_unique');
  await knex.schema.alterTable('patients', (t) => {
    t.dropChecks(['chk_status']);
    t.check("status in ('active', 'paused', 'discharged')", [], 'chk_status');
    t.dropIndex(['clinic_id', 'name_key']);
    t.dropColumn('name_key');
    t.dropColumn('imported_at');
    t.dropColumn('external_ref');
    t.dropColumn('external_source');
  });
}
```

Se `t.dropChecks` não existir na versão do knex do repo, usar `await knex.raw('alter table patients drop constraint chk_status')` e `knex.raw("alter table patients add constraint chk_status check (status in (...))")`.

- [ ] **Step 5: `patients/index.js`, tipos e label**

Em `packages/core/src/patients/index.js`: importar `catalogNameKey` de `../catalog/nameKey.js`; `PATIENT_STATUS = new Set(['active', 'paused', 'discharged', 'registered'])`; em `patientPatch`, logo após `patch.name = name;`, acrescentar `patch.name_key = catalogNameKey(name);`; em `patientPatch`, no bloco de `status`, recusar `registered` vindo de edição: `if (input.status === 'registered') throw new ValidationError('Cadastrado só nasce pela importação.', 'status');` (antes do `PATIENT_STATUS.has`). `seedPatient` em `test/helpers/db.js` e o seed em `src/seed/index.js` inserem `patients` direto: acrescentar `name_key: catalogNameKey(name)` nesses inserts (grep `db('patients').insert\|trx('patients').insert` em `packages/core` e `apps/web/test` e corrigir todos).

`packages/core/src/index.d.ts`: `PatientRow.status: 'active' | 'paused' | 'discharged' | 'registered'`; acrescentar a `PatientRow`: `name_key: string; external_source: string | null; external_ref: string | null; imported_at: Date | string | null;`; acrescentar:

```ts
export type AttachmentKind = 'pdf' | 'image';
export interface AttachmentRow {
  id: string;
  patient_id: string;
  kind: AttachmentKind;
  original_name: string;
  mime: string;
  size_bytes: number;
  sha256: string;
  stored_path: string;
  source: 'upload' | 'import';
  uploaded_by: string | null;
  deleted_at: Date | string | null;
  created_at: Date | string;
}
export function loadConfig(
  env?: NodeJS.ProcessEnv,
): Readonly<{ databaseUrl: string; uploadsDir: string }>;
```

(substituindo a declaração atual de `loadConfig`).

`apps/web/lib/format.ts`: `STATUS_LABEL` ganha `registered: 'Cadastrado'`.

- [ ] **Step 6: Rodar a suíte do core**

Run: `npm test -w @medcheckin/core`
Expected: tudo verde. Se algum teste inserir `patients` sem `name_key` e falhar por NOT NULL, corrigir o insert (Step 5).

- [ ] **Step 7: Prettier + commit**

```bash
npx prettier --write packages/core/src/config.js packages/core/src/migrations/014_anexos_importacao.js packages/core/src/patients/index.js packages/core/src/seed/index.js packages/core/src/index.d.ts packages/core/test apps/web/lib/format.ts
git add packages/core/src/config.js packages/core/src/migrations/014_anexos_importacao.js packages/core/src/patients/index.js packages/core/src/seed/index.js packages/core/src/index.d.ts packages/core/test apps/web/lib/format.ts
git commit -m "feat(core): migration 014 — status Cadastrado, origem da importação, name_key e tabela attachments; UPLOADS_DIR fail-closed (D37, D38)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Core — módulo `attachments` (+ export e anonimização)

**Files:**

- Create: `packages/core/src/attachments/index.js`
- Modify: `packages/core/src/lgpd/export.js`, `packages/core/src/lgpd/anonymize.js`, `packages/core/src/index.js`, `packages/core/src/index.d.ts`
- Test: `packages/core/test/attachments.test.js`

**Interfaces:**

- Consumes: `loadConfig().uploadsDir`; tabela `attachments`.
- Produces: `sniffKind(buffer) → 'pdf' | 'image' | null`; `storeAttachment(db, session, patientId, { buffer, originalName, mime, source = 'upload' }, now) → AttachmentRow`; `listAttachments(db, session, patientId) → AttachmentRow[]`; `openAttachment(db, session, attachmentId, now) → { row, path }`; `hideAttachment(db, session, attachmentId, now) → AttachmentRow`; `attachmentAbsolutePath(row) → string`; constante `ATTACHMENT_MAX_BYTES`.

- [ ] **Step 1: Teste que falha**

```js
// packages/core/test/attachments.test.js
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, readFile, stat, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { freshDb, seedClinic, seedPatient } from './helpers/db.js';
import {
  ATTACHMENT_MAX_BYTES,
  sniffKind,
  storeAttachment,
  listAttachments,
  openAttachment,
  hideAttachment,
  attachmentAbsolutePath,
} from '../src/attachments/index.js';
import { exportPatientData } from '../src/lgpd/export.js';
import { anonymizePatient } from '../src/lgpd/anonymize.js';

const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n');
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(32),
]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32)]);
const EXE = Buffer.from('MZ��isto nao e um pdf');

// D38: anexo = arquivo no volume + metadados no banco; tipo pelos bytes; ocultar sem apagar.
describe('anexos', () => {
  let db, ctx, session, patientId, dir;
  const NOW = new Date('2026-09-15T12:00:00Z');
  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'mc-uploads-'));
    process.env.UPLOADS_DIR = dir;
    db = await freshDb();
    ctx = await seedClinic(db, 'anexo');
    session = {
      kind: 'user',
      sessionId: 't',
      userId: ctx.userId,
      clinicId: ctx.clinicId,
      role: 'doctor',
      name: 'Dra.',
      email: 'dra-anexo@example.test',
    };
    patientId = await seedPatient(db, ctx);
  });
  afterAll(async () => {
    await db.destroy();
    await rm(dir, { recursive: true, force: true });
    delete process.env.UPLOADS_DIR;
  });

  it('sniffKind decide pelos bytes', () => {
    expect(sniffKind(PDF)).toBe('pdf');
    expect(sniffKind(PNG)).toBe('image');
    expect(sniffKind(JPG)).toBe('image');
    expect(sniffKind(EXE)).toBeNull();
    expect(sniffKind(Buffer.alloc(2))).toBeNull();
  });

  it('grava PDF no volume com nome opaco, metadados e auditoria; duplicata devolve o existente', async () => {
    const a = await storeAttachment(
      db,
      session,
      patientId,
      { buffer: PDF, originalName: 'Prontuário antigo.pdf', mime: 'application/pdf' },
      NOW,
    );
    expect(a.kind).toBe('pdf');
    expect(a.size_bytes).toBe(PDF.length);
    expect(a.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(a.stored_path).toMatch(new RegExp(`^${ctx.clinicId}/[0-9a-f-]{36}\\.pdf$`));
    expect(a.source).toBe('upload');
    expect(a.uploaded_by).toBe(ctx.userId);
    const abs = attachmentAbsolutePath(a);
    expect(abs.startsWith(dir)).toBe(true);
    expect((await readFile(abs)).equals(PDF)).toBe(true);
    const again = await storeAttachment(
      db,
      session,
      patientId,
      { buffer: PDF, originalName: 'copia.pdf', mime: 'application/pdf' },
      NOW,
    );
    expect(again.id).toBe(a.id);
    expect(await db('attachments').where({ patient_id: patientId }).count().first()).toMatchObject({
      count: '1',
    });
    const audit = await db('access_audit').where({
      patient_id: patientId,
      route: 'attachments.create',
    });
    expect(audit).toHaveLength(1);
  });

  it('recusa tipo pelos bytes (mesmo com extensão .pdf), tamanho acima do limite e não deixa lixo no disco', async () => {
    await expect(
      storeAttachment(
        db,
        session,
        patientId,
        { buffer: EXE, originalName: 'virus.pdf', mime: 'application/pdf' },
        NOW,
      ),
    ).rejects.toMatchObject({ code: 'validation', field: 'file' });
    const big = Buffer.concat([PDF, Buffer.alloc(ATTACHMENT_MAX_BYTES + 1 - PDF.length)]);
    await expect(
      storeAttachment(
        db,
        session,
        patientId,
        { buffer: big, originalName: 'grande.pdf', mime: 'application/pdf' },
        NOW,
      ),
    ).rejects.toMatchObject({ code: 'validation', field: 'file' });
    const files = await import('node:fs/promises').then((fs) =>
      fs.readdir(path.join(dir, ctx.clinicId)),
    );
    expect(files).toHaveLength(1); // só o PDF válido do teste anterior
  });

  it('insert falho apaga o arquivo recém-escrito', async () => {
    // patient_id inexistente passa pelo requirePatientInClinic? não — então força o erro no insert com um
    // uploaded_by inválido via sessão de outro usuário inexistente.
    const bad = { ...session, userId: '00000000-0000-0000-0000-000000000000' };
    await expect(
      storeAttachment(
        db,
        bad,
        patientId,
        { buffer: PNG, originalName: 'x.png', mime: 'image/png' },
        NOW,
      ),
    ).rejects.toBeTruthy();
    const files = await import('node:fs/promises').then((fs) =>
      fs.readdir(path.join(dir, ctx.clinicId)),
    );
    expect(files.filter((f) => f.endsWith('.png'))).toHaveLength(0);
  });

  it('lista visíveis, abre conferindo clínica, oculta sem apagar', async () => {
    const img = await storeAttachment(
      db,
      session,
      patientId,
      { buffer: JPG, originalName: 'exame.jpg', mime: 'image/jpeg' },
      NOW,
    );
    expect((await listAttachments(db, session, patientId)).map((x) => x.id).sort()).toHaveLength(2);
    const opened = await openAttachment(db, session, img.id, NOW);
    expect(opened.row.id).toBe(img.id);
    expect(existsSync(opened.path)).toBe(true);
    const outra = await seedClinic(db, 'outra-anexo');
    await expect(
      openAttachment(
        db,
        { ...session, clinicId: outra.clinicId, userId: outra.userId },
        img.id,
        NOW,
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
    const hidden = await hideAttachment(db, session, img.id, NOW);
    expect(hidden.deleted_at).not.toBeNull();
    expect((await listAttachments(db, session, patientId)).map((x) => x.id)).not.toContain(img.id);
    expect(existsSync(attachmentAbsolutePath(hidden))).toBe(true); // ocultar não apaga
    await expect(openAttachment(db, session, img.id, NOW)).rejects.toMatchObject({
      code: 'not_found',
    });
    const audit = await db('access_audit')
      .where({ patient_id: patientId })
      .whereIn('route', ['attachments.read', 'attachments.delete']);
    expect(audit.map((a) => a.route).sort()).toEqual(['attachments.delete', 'attachments.read']);
  });

  it('export traz metadados e bytes; anonimização apaga do disco e o nome original', async () => {
    const { files, manifest } = await exportPatientData(db, session, patientId, NOW);
    expect(files['attachments.json']).toHaveLength(2); // inclui a oculta
    expect(manifest.counts.attachments).toBe(2);
    expect(Object.keys(files).some((k) => k.startsWith('anexos/'))).toBe(true);
    const paths = (await db('attachments').where({ patient_id: patientId })).map(
      attachmentAbsolutePath,
    );
    await anonymizePatient(db, session, patientId, { reason: 'pedido do titular' }, NOW);
    for (const p of paths) expect(existsSync(p)).toBe(false);
    const rows = await db('attachments').where({ patient_id: patientId }).orderBy('created_at');
    expect(rows.map((r) => r.original_name)).toEqual(['anexo 1', 'anexo 2']);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -w @medcheckin/core -- test/attachments.test.js`
Expected: FAIL — `Cannot find module '../src/attachments/index.js'`.

- [ ] **Step 3: Módulo**

```js
// packages/core/src/attachments/index.js
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile, rm, open } from 'node:fs/promises';
import path from 'node:path';
import { loadConfig } from '../config.js';
import { AuthError } from '../auth/tokens.js';
import { requirePatientInClinic, logAccess } from '../auth/access.js';
import { ValidationError } from '../errors.js';

export const ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;
const EXT = { pdf: 'pdf', jpeg: 'jpg', png: 'png' };
const MIME = { pdf: 'application/pdf', jpeg: 'image/jpeg', png: 'image/png' };

function requireDoctor(session) {
  if (!session || session.kind !== 'user')
    throw new AuthError('unauthenticated', 'Sessão da clínica necessária.');
}

/** Formato pelos primeiros bytes — extensão e Content-Type são o que o cliente disse, não o que é. */
function sniffFormat(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 8) return null;
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return 'png';
  return null;
}

export function sniffKind(buf) {
  const f = sniffFormat(buf);
  if (!f) return null;
  return f === 'pdf' ? 'pdf' : 'image';
}

function uploadsDir() {
  return path.resolve(loadConfig(process.env).uploadsDir);
}

export function attachmentAbsolutePath(row) {
  const abs = path.resolve(uploadsDir(), row.stored_path);
  // stored_path é nosso, mas o caminho final nunca pode sair do volume.
  if (!abs.startsWith(uploadsDir() + path.sep)) throw new Error('stored_path fora do volume');
  return abs;
}

/**
 * D38 — grava o arquivo no volume (nome opaco por clínica) e os metadados no banco. Ordem:
 * disco primeiro, banco depois; se o insert falhar, o arquivo sai. Mesmo sha256 no mesmo paciente
 * devolve o anexo existente (idempotente — a importação reexecuta sem duplicar).
 */
export async function storeAttachment(db, session, patientId, input, now) {
  requireDoctor(session);
  await requirePatientInClinic(db, session, patientId);
  const buf = input?.buffer;
  const format = sniffFormat(buf);
  if (!format)
    throw new ValidationError(
      'Arquivo não aceito: só PDF, JPG ou PNG (conferido pelo conteúdo).',
      'file',
    );
  if (buf.length > ATTACHMENT_MAX_BYTES)
    throw new ValidationError('Arquivo acima de 25 MB.', 'file');
  const originalName =
    String(input?.originalName ?? '')
      .trim()
      .slice(0, 200) || `arquivo.${EXT[format]}`;
  const sha256 = createHash('sha256').update(buf).digest('hex');
  const existing = await db('attachments').where({ patient_id: patientId, sha256 }).first();
  if (existing) return existing;

  const rel = path.posix.join(session.clinicId, `${randomUUID()}.${EXT[format]}`);
  const abs = path.resolve(uploadsDir(), rel);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, buf, { flag: 'wx' });
  const fh = await open(abs, 'r');
  try {
    await fh.sync();
  } finally {
    await fh.close();
  }
  try {
    const [row] = await db('attachments')
      .insert({
        patient_id: patientId,
        kind: format === 'pdf' ? 'pdf' : 'image',
        original_name: originalName,
        mime: MIME[format],
        size_bytes: buf.length,
        sha256,
        stored_path: rel,
        source: input?.source === 'import' ? 'import' : 'upload',
        uploaded_by: input?.source === 'import' ? null : session.userId,
      })
      .returning('*');
    await logAccess(db, { session, patientId, route: 'attachments.create', action: 'create' }, now);
    return row;
  } catch (err) {
    await rm(abs, { force: true });
    if (err?.code === '23505') {
      const again = await db('attachments').where({ patient_id: patientId, sha256 }).first();
      if (again) return again;
    }
    throw err;
  }
}

export async function listAttachments(db, session, patientId) {
  requireDoctor(session);
  await requirePatientInClinic(db, session, patientId);
  return db('attachments')
    .where({ patient_id: patientId })
    .whereNull('deleted_at')
    .orderBy('created_at', 'desc');
}

async function attachmentInClinic(db, session, attachmentId) {
  const row = await db('attachments as a')
    .join('patients as p', 'p.id', 'a.patient_id')
    .where('a.id', attachmentId)
    .andWhere('p.clinic_id', session.clinicId)
    .whereNull('a.deleted_at')
    .select('a.*')
    .first();
  if (!row) throw new AuthError('not_found', 'Anexo não encontrado.');
  return row;
}

/** Devolve a linha e o caminho absoluto; quem chama faz o stream. Audita a leitura. */
export async function openAttachment(db, session, attachmentId, now) {
  requireDoctor(session);
  const row = await attachmentInClinic(db, session, attachmentId);
  await logAccess(
    db,
    { session, patientId: row.patient_id, route: 'attachments.read', action: 'view' },
    now,
  );
  return { row, path: attachmentAbsolutePath(row) };
}

/** Ocultar (D38): some da lista, fica no disco e no export. */
export async function hideAttachment(db, session, attachmentId, now) {
  requireDoctor(session);
  const row = await attachmentInClinic(db, session, attachmentId);
  const [out] = await db('attachments')
    .where({ id: row.id })
    .update({ deleted_at: db.fn.now() })
    .returning('*');
  await logAccess(
    db,
    { session, patientId: row.patient_id, route: 'attachments.delete', action: 'delete' },
    now,
  );
  return out;
}

/** Usado pela anonimização: remove os bytes do disco (ignora ausente) e anonimiza o nome. */
export async function purgeAttachmentFiles(trx, patientId) {
  const rows = await trx('attachments').where({ patient_id: patientId }).orderBy('created_at');
  for (const [i, r] of rows.entries()) {
    await rm(attachmentAbsolutePath(r), { force: true });
    await trx('attachments')
      .where({ id: r.id })
      .update({ original_name: `anexo ${i + 1}` });
  }
  return rows.length;
}
```

- [ ] **Step 4: Export e anonimização**

`packages/core/src/lgpd/export.js`: importar `readFile` de `node:fs/promises` e `attachmentAbsolutePath` de `../attachments/index.js`. Após a consulta de `clinicalNotes`:

```js
// D38: metadados de todos os anexos (inclusive ocultos) e os bytes dos que ainda existem no disco.
const attachments = await db('attachments').where({ patient_id: patientId }).orderBy('created_at');
const attachmentFiles = {};
for (const a of attachments) {
  try {
    attachmentFiles[`anexos/${a.id}-${a.original_name}`] = await readFile(
      attachmentAbsolutePath(a),
    );
  } catch {
    // arquivo já removido (anonimização anterior) — só os metadados vão
  }
}
```

Em `files`: `'attachments.json': attachments,` e espalhar `...attachmentFiles`; em `counts`: `attachments: attachments.length,`. Em `buildExportZip`, distinguir buffers: `for (const [name, data] of Object.entries(files)) zip.file(name, Buffer.isBuffer(data) ? data : JSON.stringify(data, null, 2));`.

`packages/core/src/lgpd/anonymize.js`: importar `purgeAttachmentFiles`; após o update de `clinical_notes`: `await purgeAttachmentFiles(trx, patientId);`.

`packages/core/src/index.js`:

```js
export {
  ATTACHMENT_MAX_BYTES,
  sniffKind,
  storeAttachment,
  listAttachments,
  openAttachment,
  hideAttachment,
  attachmentAbsolutePath,
} from './attachments/index.js';
```

`index.d.ts`:

```ts
export const ATTACHMENT_MAX_BYTES: number;
export function sniffKind(buf: Buffer): AttachmentKind | null;
export function storeAttachment(
  db: Knex,
  session: Session,
  patientId: string,
  input: { buffer: Buffer; originalName: string; mime?: string; source?: 'upload' | 'import' },
  now?: Instant,
): Promise<AttachmentRow>;
export function listAttachments(
  db: Knex,
  session: Session,
  patientId: string,
): Promise<AttachmentRow[]>;
export function openAttachment(
  db: Knex,
  session: Session,
  attachmentId: string,
  now?: Instant,
): Promise<{ row: AttachmentRow; path: string }>;
export function hideAttachment(
  db: Knex,
  session: Session,
  attachmentId: string,
  now?: Instant,
): Promise<AttachmentRow>;
export function attachmentAbsolutePath(row: Pick<AttachmentRow, 'stored_path'>): string;
```

- [ ] **Step 5: Rodar**

Run: `npm test -w @medcheckin/core`
Expected: verde. Se `lgpd.test.js` afirma a lista exata de arquivos do zip, acrescentar `attachments.json` (e nada de `anexos/` para o paciente sem anexos).

- [ ] **Step 6: Prettier + commit**

```bash
npx prettier --write packages/core/src/attachments packages/core/src/lgpd packages/core/src/index.js packages/core/src/index.d.ts packages/core/test
git add packages/core/src/attachments packages/core/src/lgpd packages/core/src/index.js packages/core/src/index.d.ts packages/core/test
git commit -m "feat(core): anexos — tipo pelos bytes, sha256, volume com escrita atômica, ocultar sem apagar, export e anonimização (D38)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Core — `listPatients` paginada com busca e status; `registered → active` no convite

**Files:**

- Modify: `packages/core/src/patients/index.js` (`listPatients`), `packages/core/src/auth/invite.js`, `packages/core/src/index.d.ts`
- Modify tests: `packages/core/test/services.test.js:~104,121`, `packages/core/test/conditions.test.js:~162-166` (chamadas passam a ler `.rows`), `apps/web/test/medica-api.test.ts` (se ler o array direto)
- Test: `packages/core/test/patients-list.test.js`

**Interfaces:**

- Produces: `listPatients(db, { clinicId, condition?, q?, status?, page?, pageSize? }, now) → { rows: PatientSummary[], total: number, page: number, pageSize: number }`; `acceptInvite` promove `registered → active` e grava consentimento no paciente.

- [ ] **Step 1: Teste que falha**

```js
// packages/core/test/patients-list.test.js
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { freshDb, seedClinic } from './helpers/db.js';
import { createPatient, listPatients } from '../src/patients/index.js';
import { acceptInvite } from '../src/auth/invite.js';
import { catalogNameKey } from '../src/catalog/nameKey.js';

// D37: lista abre em "Em acompanhamento", busca sem acento, pagina; Cadastrado só aparece pedindo.
describe('listPatients paginada + registered', () => {
  let db, ctx, session;
  const NOW = new Date('2026-09-15T12:00:00Z');
  beforeAll(async () => {
    db = await freshDb();
    ctx = await seedClinic(db, 'lista');
    session = {
      kind: 'user',
      sessionId: 't',
      userId: ctx.userId,
      clinicId: ctx.clinicId,
      role: 'doctor',
      name: 'Dra.',
      email: 'dra-lista@example.test',
    };
    for (let i = 1; i <= 60; i += 1) {
      await createPatient(
        db,
        session,
        { name: `Paciente ${String(i).padStart(2, '0')}`, consent_version: 'v1' },
        NOW,
      );
    }
    const { patient: jose } = await createPatient(
      db,
      session,
      { name: 'José Antônio', consent_version: 'v1' },
      NOW,
    );
    await db('patients').where({ id: jose.id }).update({ status: 'paused' });
    await db('patients').insert({
      clinic_id: ctx.clinicId,
      name: 'Maria Cadastrada',
      name_key: catalogNameKey('Maria Cadastrada'),
      timezone: 'America/Cuiaba',
      created_by: ctx.userId,
      status: 'registered',
      external_source: 'versatilis',
      external_ref: 'V-1',
      imported_at: NOW,
    });
  });
  afterAll(async () => db.destroy());

  it('padrão following: ativos + pausados, 50 por página, total certo', async () => {
    const p1 = await listPatients(db, { clinicId: ctx.clinicId }, NOW);
    expect(p1.total).toBe(61);
    expect(p1.rows).toHaveLength(50);
    expect(p1.page).toBe(1);
    expect(p1.pageSize).toBe(50);
    const p2 = await listPatients(db, { clinicId: ctx.clinicId, page: 2 }, NOW);
    expect(p2.rows).toHaveLength(11);
    expect(p1.rows.map((r) => r.name).concat(p2.rows.map((r) => r.name))).toContain('José Antônio');
    expect(p1.rows.some((r) => r.name === 'Maria Cadastrada')).toBe(false);
  });

  it('status registered / all / paused; q sem acento; q curto ignorado; pageSize máximo 200', async () => {
    const reg = await listPatients(db, { clinicId: ctx.clinicId, status: 'registered' }, NOW);
    expect(reg.rows.map((r) => r.name)).toEqual(['Maria Cadastrada']);
    expect(reg.rows[0].external_source).toBe('versatilis');
    expect(
      (await listPatients(db, { clinicId: ctx.clinicId, status: 'all', pageSize: 500 }, NOW)).rows,
    ).toHaveLength(62);
    expect(
      (await listPatients(db, { clinicId: ctx.clinicId, status: 'paused' }, NOW)).rows.map(
        (r) => r.name,
      ),
    ).toEqual(['José Antônio']);
    const q = await listPatients(db, { clinicId: ctx.clinicId, q: 'jose ant' }, NOW);
    expect(q.rows.map((r) => r.name)).toEqual(['José Antônio']);
    expect((await listPatients(db, { clinicId: ctx.clinicId, q: 'j' }, NOW)).total).toBe(61);
    await expect(
      listPatients(db, { clinicId: ctx.clinicId, status: 'zumbi' }, NOW),
    ).rejects.toMatchObject({ code: 'validation' });
  });

  it('acceptInvite promove registered → active e grava consentimento no paciente', async () => {
    const maria = await db('patients').where({ name: 'Maria Cadastrada' }).first();
    const [r] = await db('respondents')
      .insert({
        patient_id: maria.id,
        kind: 'patient',
        name: 'Maria',
        invite_token: 'tok-maria',
        can_answer: true,
        receives_alarms: true,
      })
      .returning('*');
    await acceptInvite(db, { inviteToken: r.invite_token, consentVersion: 'v2' }, NOW);
    const depois = await db('patients').where({ id: maria.id }).first();
    expect(depois.status).toBe('active');
    expect(depois.consent_version).toBe('v2');
    expect(depois.consent_at).not.toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -w @medcheckin/core -- test/patients-list.test.js`
Expected: FAIL — `p1.total` é `undefined` (a função ainda devolve um array).

- [ ] **Step 3: `listPatients`**

Substituir a função por:

```js
const LIST_STATUS = new Set(['following', 'active', 'paused', 'discharged', 'registered', 'all']);
const PAGE_SIZE_MAX = 200;

/**
 * Lista paginada com resumo por paciente. D37: o padrão é "em acompanhamento" (ativos + pausados);
 * `registered` (Cadastrado) só aparece quando pedido. `q` busca sem acento pela `name_key`.
 */
export async function listPatients(
  db,
  { clinicId, condition = null, q = '', status = 'following', page = 1, pageSize = 50 },
  now,
) {
  if (!LIST_STATUS.has(status)) throw new ValidationError('Status de filtro inválido.', 'status');
  const size = Math.min(Math.max(Number(pageSize) || 50, 1), PAGE_SIZE_MAX);
  const pg = Math.max(Number(page) || 1, 1);
  const key = catalogNameKey(String(q ?? ''));

  let base = db('patients as p').where('p.clinic_id', clinicId);
  if (status === 'following') base = base.whereIn('p.status', ['active', 'paused']);
  else if (status !== 'all') base = base.where('p.status', status);
  if (key.length >= 2) base = base.where('p.name_key', 'like', `%${key.replace(/[%_]/g, '\\$&')}%`);
  if (condition)
    base = base.whereExists(
      db('patient_conditions as pc')
        .whereRaw('pc.patient_id = p.id')
        .andWhere('pc.condition_id', condition),
    );

  const [{ count }] = await base.clone().count('* as count');
  const total = Number(count);
  const patients = await base
    .clone()
    .orderBy('p.name')
    .orderBy('p.id')
    .limit(size)
    .offset((pg - 1) * size)
    .select('p.*');
  const ids = patients.map((p) => p.id);
  if (!ids.length) return { rows: [], total, page: pg, pageSize: size };
  // (o resto — episodes, alerts, lastCheckins, meds, conds, respCounts e o map final — fica
  //  exatamente como está hoje, e o `return` vira:)
  return {
    rows: patients.map((p) => ({/* ...igual ao objeto de hoje... */})),
    total,
    page: pg,
    pageSize: size,
  };
}
```

(Manter o corpo intermediário atual; só a montagem da consulta base e o retorno mudam.)

- [ ] **Step 4: `acceptInvite`**

Em `packages/core/src/auth/invite.js`, dentro do `if (!r.accepted_at) { ... }`, após o update de `respondents`:

```js
// D37: paciente "Cadastrado" (importado) passa a ativo no primeiro aceite — é o consentimento
// v2 que autoriza o acompanhamento. Quem já era ativo/pausado não muda.
await db('patients')
  .where({ id: r.patient_id, status: 'registered' })
  .update({ status: 'active', consent_version: v, consent_at: nowJs, updated_at: db.fn.now() });
```

- [ ] **Step 5: Chamadores e tipos**

`packages/core/test/services.test.js` (~104, 121) e `conditions.test.js` (~162-166): `const rows = (await listPatients(...)).rows;` e o `toEqual([])` vira `.rows).toEqual([])`. `apps/web/test/medica-api.test.ts`: se algum caso faz `GET /api/patients` e lê o array, passar a ler `.rows` (a rota muda na Task 7; até lá o teste do web pode ficar vermelho — anotar no report). `apps/web/app/(medica)/pacientes/page.tsx`: trocar `const [rows, conds] = ...listPatients(...)` por `const [{ rows }, conds] = ...` para o typecheck passar (a UI completa é a Task 8).

`index.d.ts`:

```ts
export type PatientListStatus =
  'following' | 'active' | 'paused' | 'discharged' | 'registered' | 'all';
export interface PatientPage {
  rows: PatientSummary[];
  total: number;
  page: number;
  pageSize: number;
}
export function listPatients(
  db: Knex,
  input: {
    clinicId: string;
    condition?: string | null;
    q?: string;
    status?: PatientListStatus;
    page?: number;
    pageSize?: number;
  },
  now?: Instant,
): Promise<PatientPage>;
```

- [ ] **Step 6: Rodar**

Run: `npm test -w @medcheckin/core && npm run typecheck -w @medcheckin/web`
Expected: core verde; typecheck verde.

- [ ] **Step 7: Prettier + commit**

```bash
npx prettier --write packages/core/src/patients/index.js packages/core/src/auth/invite.js packages/core/src/index.d.ts packages/core/test "apps/web/app/(medica)/pacientes/page.tsx" apps/web/test
git add packages/core/src/patients/index.js packages/core/src/auth/invite.js packages/core/src/index.d.ts packages/core/test "apps/web/app/(medica)/pacientes/page.tsx" apps/web/test
git commit -m "feat(core): listPatients paginada com busca sem acento e filtro de status; Cadastrado vira ativo no aceite do convite (D37)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Core — `patientTimeline` com janela e "carregar mais"

**Files:**

- Modify: `packages/core/src/patients/timeline.js`, `packages/core/src/index.d.ts`, `apps/web/app/(medica)/pacientes/[id]/page.tsx` (ler `.days`), `apps/web/app/api/patients/[id]/timeline/route.ts` (`?before=`)
- Test: `packages/core/test/timeline.test.js` (adaptar às novas chaves) + novo `it`

**Interfaces:**

- Produces: `patientTimeline(db, session, patientId, { now, before?, limitDays = 60 }) → { days: TimelineDay[], hasMore: boolean, nextBefore: string | null }`. Janela: dias `(before - limitDays, before]` no fuso do paciente; `hasMore` = existe nota/dose/conduta com dia `<= before - limitDays`; `nextBefore` = esse limite (dia anterior ao primeiro incluído).

- [ ] **Step 1: Teste que falha**

Acrescentar em `packages/core/test/timeline.test.js` (e trocar, nos `it` existentes, `const days = await patientTimeline(...)` por `const { days } = await patientTimeline(...)`):

```js
it('janela de 60 dias com hasMore/nextBefore e before paginando para trás', async () => {
  await createNote(db, session, patientId, { body: 'velha', occurred_at: '2026-01-05' }, NOW);
  await createNote(db, session, patientId, { body: 'recente', occurred_at: '2026-09-01' }, NOW);
  const p1 = await patientTimeline(db, session, patientId, { now: NOW });
  expect(p1.days.every((d) => d.day >= '2026-07-17')).toBe(true); // 2026-09-15 - 60 dias
  expect(p1.days.some((d) => d.notes.some((n) => n.body === 'velha'))).toBe(false);
  expect(p1.hasMore).toBe(true);
  expect(p1.nextBefore).toBe('2026-07-16');
  const p2 = await patientTimeline(db, session, patientId, {
    now: NOW,
    before: p1.nextBefore,
    limitDays: 400,
  });
  expect(p2.days.some((d) => d.notes.some((n) => n.body === 'velha'))).toBe(true);
  expect(p2.hasMore).toBe(false);
  expect(p2.nextBefore).toBeNull();
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -w @medcheckin/core -- test/timeline.test.js`
Expected: FAIL — `p1.days` é `undefined`.

- [ ] **Step 3: Implementar**

Em `patientTimeline`: assinatura `{ now, before = null, limitDays = 60 } = {}`; após `tz`:

```js
const end = before ? String(before).slice(0, 10) : localDate(now, tz);
const start = DateTime.fromISO(end)
  .minus({ days: limitDays - 1 })
  .toISODate();
const startDate = start; // 'AAAA-MM-DD'
```

(importar `DateTime` de `luxon`). Nas três consultas, filtrar pela janela: notas `andWhere('occurred_at', '>=', start).andWhere('occurred_at', '<=', end)`; doses `andWhere('d.effective_from', '>=', start).andWhere('d.effective_from', '<=', end)`; condutas: `at` é instante — filtrar `andWhere('x.at', '>=', DateTime.fromISO(start, { zone: tz }).startOf('day').toJSDate()).andWhere('x.at', '<=', DateTime.fromISO(end, { zone: tz }).endOf('day').toJSDate())`. `hasMore`: três `exists` com `< start` (notas visíveis, doses, condutas) → `const hasMore = Boolean(olderNote || olderDose || olderConduct)`. Retorno:

```js
return {
  days: out,
  hasMore,
  nextBefore: hasMore ? DateTime.fromISO(start).minus({ days: 1 }).toISODate() : null,
};
```

`index.d.ts`:

```ts
export interface TimelinePage {
  days: TimelineDay[];
  hasMore: boolean;
  nextBefore: string | null;
}
export function patientTimeline(
  db: Knex,
  session: Session,
  patientId: string,
  opts?: { now?: Instant; before?: string | null; limitDays?: number },
): Promise<TimelinePage>;
```

`apps/web/app/(medica)/pacientes/[id]/page.tsx`: `timelineRaw` vira `timelinePage`; `const timeline = timelinePage.days.map(...)`; passar também `hasMore={timelinePage.hasMore}` e `nextBefore={timelinePage.nextBefore}` ao `ProntuarioCard` (props adicionadas na Task 9; até lá, TypeScript reclama — então nesta task só troque para `.days` e deixe as props para a Task 9).

`apps/web/app/api/patients/[id]/timeline/route.ts`:

```ts
export const GET = doctorRoute<{ id: string }>(async ({ req, db, session, params }) => {
  const before = new URL(req.url).searchParams.get('before');
  const ok = before && /^\d{4}-\d{2}-\d{2}$/.test(before) ? before : null;
  const page = await patientTimeline(db, session, params.id, { now: new Date(), before: ok });
  return json({
    ...page,
    days: page.days.map((d) => ({
      ...d,
      notes: d.notes.map((n) => ({ ...n, occurred_at: noteDay(n.occurred_at) })),
    })),
  });
});
```

(importar `noteDay`).

- [ ] **Step 4: Rodar**

Run: `npm test -w @medcheckin/core && npm run typecheck -w @medcheckin/web`
Expected: verde.

- [ ] **Step 5: Prettier + commit**

```bash
npx prettier --write packages/core/src/patients/timeline.js packages/core/src/index.d.ts packages/core/test/timeline.test.js "apps/web/app/(medica)/pacientes/[id]/page.tsx" "apps/web/app/api/patients/[id]/timeline/route.ts"
git add packages/core/src/patients/timeline.js packages/core/src/index.d.ts packages/core/test/timeline.test.js "apps/web/app/(medica)/pacientes/[id]/page.tsx" "apps/web/app/api/patients/[id]/timeline/route.ts"
git commit -m "feat(core): patientTimeline com janela de 60 dias, hasMore e before — pré-requisito da importação

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Core — parser CSV e motor de importação do Versatilis (plano + execução)

**Files:**

- Create: `packages/core/src/import/csv.js`, `packages/core/src/import/versatilis.js`
- Create: `packages/core/test/fixtures/versatilis/cadastro.csv`, `packages/core/test/fixtures/versatilis/mapa.json`
- Modify: `packages/core/src/index.js`, `packages/core/src/index.d.ts`
- Test: `packages/core/test/import-versatilis.test.js`

**Interfaces:**

- Produces: `parseCsv(text, { delimiter = ';' }) → { header: string[], rows: Record<string,string>[] }`; `planImport({ rows, mapa, pdfFiles, existing }) → ImportPlan`; `executeImport(db, session, plan, { readPdf }, now) → { created, matched, attached, notes }`. `ImportPlan = { criar: Item[], casar: Item[], colidir: Colisao[], pdfSemPaciente: string[], pacienteSemPdf: string[] }`, `Item = { ref, name, name_key, birth_date, phone, conditions: string[], consultas: string[], pdf: string | null, existingId?: string }`.

- [ ] **Step 1: Fixtures**

```csv
id;Nome do Paciente;Nascimento;Telefone;Diagnósticos;Consultas
101;José da Silva;05/03/1970;65999990001;Epilepsia; Dor crônica;10/02/2024|15/08/2025
102;Maria "Mary" Souza;20/11/1985;;TEA;
103;Ana Paula Lima;;65999990003;Ansiedade;01/01/2026
104;Carlos Existente;01/01/1990;;Insônia;
105;Carlos Existente;02/02/1991;;Insônia;
```

```json
{
  "delimitador": ";",
  "colunas": {
    "ref": "id",
    "nome": "Nome do Paciente",
    "nascimento": "Nascimento",
    "telefone": "Telefone",
    "condicoes": "Diagnósticos",
    "consultas": "Consultas"
  },
  "formatoData": "DD/MM/AAAA",
  "separadorCondicoes": ";",
  "separadorConsultas": "|",
  "pdf": { "padrao": "{ref}.pdf" }
}
```

- [ ] **Step 2: Teste que falha**

```js
// packages/core/test/import-versatilis.test.js
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { freshDb, seedClinic } from './helpers/db.js';
import { parseCsv } from '../src/import/csv.js';
import { planImport, executeImport } from '../src/import/versatilis.js';
import { createPatient } from '../src/patients/index.js';
import { catalogNameKey } from '../src/catalog/nameKey.js';

const FIX = path.join(import.meta.dirname, 'fixtures/versatilis');
const PDF = Buffer.from('%PDF-1.4\n%%EOF\n');

describe('parseCsv', () => {
  it('RFC 4180 com ; e aspas', () => {
    const { header, rows } = parseCsv('a;b\n1;"x;y"\n2;"diz ""oi"""\n', { delimiter: ';' });
    expect(header).toEqual(['a', 'b']);
    expect(rows).toEqual([
      { a: '1', b: 'x;y' },
      { a: '2', b: 'diz "oi"' },
    ]);
  });
});

// D39: ensaio primeiro; casamento conservador; idempotente.
describe('importação Versatilis', () => {
  let db, ctx, session, mapa, rows, dir;
  const NOW = new Date('2026-09-15T12:00:00Z');
  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'mc-import-'));
    process.env.UPLOADS_DIR = dir;
    db = await freshDb();
    ctx = await seedClinic(db, 'imp');
    session = {
      kind: 'user',
      sessionId: 't',
      userId: ctx.userId,
      clinicId: ctx.clinicId,
      role: 'doctor',
      name: 'Dra.',
      email: 'dra-imp@example.test',
    };
    mapa = JSON.parse(await readFile(path.join(FIX, 'mapa.json'), 'utf8'));
    rows = parseCsv(await readFile(path.join(FIX, 'cadastro.csv'), 'utf8'), {
      delimiter: mapa.delimitador,
    }).rows;
    // paciente já existente com mesmo nome+nascimento do 101 → casa; e um homônimo com nascimento diferente
    await createPatient(
      db,
      session,
      { name: 'Jose da Silva', birth_date: '1970-03-05', consent_version: 'v1' },
      NOW,
    );
    await createPatient(
      db,
      session,
      { name: 'Carlos Existente', birth_date: '1999-09-09', consent_version: 'v1' },
      NOW,
    );
  });
  afterAll(async () => {
    await db.destroy();
    await rm(dir, { recursive: true, force: true });
    delete process.env.UPLOADS_DIR;
  });

  it('planImport classifica criar, casar, colidir, pdf órfão e paciente sem pdf', async () => {
    const existing = await db('patients')
      .where({ clinic_id: ctx.clinicId })
      .select('id', 'name_key', 'birth_date', 'external_ref');
    const plan = planImport({ rows, mapa, pdfFiles: ['101.pdf', '102.pdf', '999.pdf'], existing });
    expect(plan.casar.map((i) => i.ref)).toEqual(['101']);
    expect(plan.criar.map((i) => i.ref).sort()).toEqual(['102', '103']);
    expect(plan.colidir.map((c) => c.ref).sort()).toEqual(['104', '105']); // homônimos com nascimento diferente do existente (e entre si)
    expect(plan.pdfSemPaciente).toEqual(['999.pdf']);
    expect(plan.pacienteSemPdf.sort()).toEqual(['103', '104', '105']);
    const jose = plan.casar[0];
    expect(jose.name_key).toBe('jose da silva');
    expect(jose.birth_date).toBe('1970-03-05');
    expect(jose.conditions).toEqual(['Epilepsia', 'Dor crônica']);
    expect(jose.consultas).toEqual(['2024-02-10', '2025-08-15']);
    expect(jose.pdf).toBe('101.pdf');
    expect(jose.existingId).toBeTruthy();
    expect(plan.criar.find((i) => i.ref === '102').name).toBe('Maria "Mary" Souza');
    expect(plan.criar.find((i) => i.ref === '103').birth_date).toBeNull();
  });

  it('executeImport grava registered + condições + notas + anexo; casa sem duplicar; é idempotente', async () => {
    const existing = await db('patients')
      .where({ clinic_id: ctx.clinicId })
      .select('id', 'name_key', 'birth_date', 'external_ref');
    const plan = planImport({ rows, mapa, pdfFiles: ['101.pdf', '102.pdf'], existing });
    const readPdf = async (name) => (name === '101.pdf' || name === '102.pdf' ? PDF : null);
    const r1 = await executeImport(db, session, plan, { readPdf }, NOW);
    expect(r1).toMatchObject({ created: 2, matched: 1, attached: 2, notes: 3 });
    const maria = await db('patients')
      .where({ clinic_id: ctx.clinicId, external_ref: '102' })
      .first();
    expect(maria.status).toBe('registered');
    expect(maria.external_source).toBe('versatilis');
    expect(maria.imported_at).not.toBeNull();
    expect(maria.name).toBe('Maria "Mary" Souza');
    const conds = await db('patient_conditions as pc')
      .join('conditions as c', 'c.id', 'pc.condition_id')
      .where('pc.patient_id', maria.id)
      .select('c.name');
    expect(conds.map((c) => c.name)).toEqual(['TEA']);
    const jose = await db('patients')
      .where({ clinic_id: ctx.clinicId, external_ref: '101' })
      .first();
    expect(jose.status).toBe('active'); // já existia como ativo: casar não rebaixa
    const notas = await db('clinical_notes').where({ patient_id: jose.id }).orderBy('occurred_at');
    expect(notas.map((n) => String(n.occurred_at).slice(0, 10).length)).toEqual([10, 10]);
    expect(notas[0].kind).toBe('importada');
    expect(notas[0].source).toMatchObject({ system: 'versatilis' });
    expect(
      await db('attachments').where({ patient_id: jose.id, source: 'import' }).count().first(),
    ).toMatchObject({ count: '1' });
    const audit = await db('access_audit').where({ route: 'patients.import' });
    expect(audit).toHaveLength(3);

    const r2 = await executeImport(
      db,
      session,
      planImport({
        rows,
        mapa,
        pdfFiles: ['101.pdf', '102.pdf'],
        existing: await db('patients')
          .where({ clinic_id: ctx.clinicId })
          .select('id', 'name_key', 'birth_date', 'external_ref'),
      }),
      { readPdf },
      NOW,
    );
    expect(r2).toMatchObject({ created: 0, attached: 0, notes: 0 });
    expect(
      Number((await db('patients').where({ clinic_id: ctx.clinicId }).count().first()).count),
    ).toBe(4);
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npm test -w @medcheckin/core -- test/import-versatilis.test.js`
Expected: FAIL — módulos não existem.

- [ ] **Step 4: `csv.js`**

```js
// packages/core/src/import/csv.js
/**
 * Parser CSV mínimo (RFC 4180): aspas duplas, aspas escapadas por duplicação, quebras de linha
 * dentro de campo, delimitador configurável. Sem dependência: o extrato do Versatilis é uma vez só.
 */
export function parseCsv(text, { delimiter = ';' } = {}) {
  const src = String(text ?? '').replace(/^﻿/, '');
  const records = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === delimiter) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i += 1;
      row.push(field);
      field = '';
      if (row.some((v) => v !== '')) records.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    if (row.some((v) => v !== '')) records.push(row);
  }
  if (!records.length) return { header: [], rows: [] };
  const header = records[0].map((h) => h.trim());
  const rows = records
    .slice(1)
    .map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()])));
  return { header, rows };
}
```

- [ ] **Step 5: `versatilis.js`**

```js
// packages/core/src/import/versatilis.js
import { DateTime } from 'luxon';
import { toDT } from '../time.js';
import { AuthError } from '../auth/tokens.js';
import { logAccess } from '../auth/access.js';
import { ValidationError } from '../errors.js';
import { catalogNameKey } from '../catalog/nameKey.js';
import { findOrCreateCondition } from '../conditions/index.js';
import { storeAttachment } from '../attachments/index.js';

const SOURCE = 'versatilis';

function requireDoctor(session) {
  if (!session || session.kind !== 'user')
    throw new AuthError('unauthenticated', 'Sessão da clínica necessária.');
}

function parseDay(raw, formato) {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const fmt = (formato || 'DD/MM/AAAA')
    .replace('AAAA', 'yyyy')
    .replace('DD', 'dd')
    .replace('MM', 'MM');
  const d = DateTime.fromFormat(s, fmt);
  if (d.isValid) return d.toISODate();
  const iso = DateTime.fromISO(s);
  return iso.isValid ? iso.toISODate() : null;
}

function splitList(raw, sep) {
  return String(raw ?? '')
    .split(sep || ';')
    .map((s) => s.trim())
    .filter(Boolean);
}

function fileFor(mapa, item) {
  const padrao = mapa?.pdf?.padrao || '{ref}.pdf';
  return padrao.replace('{ref}', item.ref).replace('{nome}', item.name);
}

/**
 * D39 — plano puro (sem I/O): classifica cada linha do CSV.
 * `existing`: pacientes da clínica `{ id, name_key, birth_date, external_ref }`.
 * Casa por external_ref; senão por name_key + birth_date (ambos presentes e iguais).
 * Mesmo name_key com nascimento diferente ou ausente em um dos lados → colisão. Duas linhas do
 * CSV com o mesmo name_key também colidem entre si.
 */
export function planImport({ rows, mapa, pdfFiles = [], existing = [] }) {
  const col = mapa?.colunas ?? {};
  if (!col.ref || !col.nome)
    throw new ValidationError('mapa.colunas precisa de ref e nome.', 'mapa');
  const byRef = new Map(
    existing.filter((e) => e.external_ref).map((e) => [String(e.external_ref), e]),
  );
  const byKey = new Map();
  for (const e of existing) {
    if (!byKey.has(e.name_key)) byKey.set(e.name_key, []);
    byKey.get(e.name_key).push(e);
  }
  const items = rows
    .map((r) => {
      const name = String(r[col.nome] ?? '')
        .replace(/\s+/g, ' ')
        .trim();
      return {
        ref: String(r[col.ref] ?? '').trim(),
        name,
        name_key: catalogNameKey(name),
        birth_date: col.nascimento ? parseDay(r[col.nascimento], mapa.formatoData) : null,
        phone: col.telefone ? String(r[col.telefone] ?? '').trim() || null : null,
        conditions: col.condicoes ? splitList(r[col.condicoes], mapa.separadorCondicoes) : [],
        consultas: col.consultas
          ? splitList(r[col.consultas], mapa.separadorConsultas || '|')
              .map((d) => parseDay(d, mapa.formatoData))
              .filter(Boolean)
          : [],
        pdf: null,
      };
    })
    .filter((i) => i.ref && i.name.length >= 2);
  const pdfSet = new Set(pdfFiles);
  const csvKeys = new Map();
  for (const i of items) csvKeys.set(i.name_key, (csvKeys.get(i.name_key) ?? 0) + 1);

  const plan = { criar: [], casar: [], colidir: [], pdfSemPaciente: [], pacienteSemPdf: [] };
  const usedPdf = new Set();
  for (const item of items) {
    const f = fileFor(mapa, item);
    if (pdfSet.has(f)) {
      item.pdf = f;
      usedPdf.add(f);
    } else plan.pacienteSemPdf.push(item.ref);

    const byRefHit = byRef.get(item.ref);
    if (byRefHit) {
      plan.casar.push({ ...item, existingId: byRefHit.id });
      continue;
    }
    const sameKey = byKey.get(item.name_key) ?? [];
    const exact = sameKey.filter(
      (e) =>
        e.birth_date && item.birth_date && String(e.birth_date).slice(0, 10) === item.birth_date,
    );
    if (
      (csvKeys.get(item.name_key) ?? 0) > 1 ||
      (sameKey.length && exact.length !== sameKey.length)
    ) {
      plan.colidir.push({
        ref: item.ref,
        name: item.name,
        birth_date: item.birth_date,
        motivo:
          (csvKeys.get(item.name_key) ?? 0) > 1
            ? 'mesmo nome em mais de uma linha do CSV'
            : `homônimo já cadastrado com nascimento ${sameKey.map((e) => (e.birth_date ? String(e.birth_date).slice(0, 10) : 'desconhecido')).join(', ')}`,
      });
      continue;
    }
    if (exact.length === 1) plan.casar.push({ ...item, existingId: exact[0].id });
    else plan.criar.push(item);
  }
  plan.pdfSemPaciente = pdfFiles.filter((f) => !usedPdf.has(f));
  return plan;
}

/**
 * Executa o plano por paciente, em transação para o paciente + notas; condições via
 * find-or-create (autocommit, D34) e anexo via storeAttachment (idempotente por sha256) fora dela.
 * `readPdf(nomeArquivo) → Buffer | null`. Reexecutar não duplica: unique parcial em external_ref,
 * onConflict nos vínculos, sha256 nos anexos, e notas importadas checadas por (patient, source.ref).
 */
export async function executeImport(db, session, plan, { readPdf }, now) {
  requireDoctor(session);
  if (plan.colidir.length)
    throw new ValidationError(
      `Há ${plan.colidir.length} colisão(ões) não resolvida(s); ajuste o CSV ou o mapa antes de gravar.`,
      'colidir',
    );
  const nowJs = toDT(now).toJSDate();
  const out = { created: 0, matched: 0, attached: 0, notes: 0 };

  for (const item of [...plan.casar, ...plan.criar]) {
    const conditionIds = [];
    for (const name of item.conditions) {
      const { condition } = await findOrCreateCondition(db, session, { name });
      if (!conditionIds.includes(condition.id)) conditionIds.push(condition.id);
    }
    const patientId = await db.transaction(async (trx) => {
      let id = item.existingId ?? null;
      if (id) {
        await trx('patients')
          .where({ id })
          .update({
            external_source: SOURCE,
            external_ref: item.ref,
            imported_at: trx.raw('coalesce(imported_at, ?)', [nowJs]),
            birth_date: trx.raw('coalesce(birth_date, ?)', [item.birth_date]),
            updated_at: trx.fn.now(),
          });
        out.matched += 1;
      } else {
        const [p] = await trx('patients')
          .insert({
            clinic_id: session.clinicId,
            name: item.name,
            name_key: item.name_key,
            birth_date: item.birth_date,
            timezone: 'America/Cuiaba',
            status: 'registered',
            external_source: SOURCE,
            external_ref: item.ref,
            imported_at: nowJs,
            created_by: session.userId,
          })
          .returning('id');
        id = p.id;
        out.created += 1;
      }
      if (conditionIds.length)
        await trx('patient_conditions')
          .insert(conditionIds.map((condition_id) => ({ patient_id: id, condition_id })))
          .onConflict(['patient_id', 'condition_id'])
          .ignore();
      for (const day of item.consultas) {
        const ref = `${item.ref}:${day}`;
        const exists = await trx('clinical_notes')
          .where({ patient_id: id, kind: 'importada' })
          .whereRaw("source->>'system' = ? and source->>'ref' = ?", [SOURCE, ref])
          .first();
        if (exists) continue;
        await trx('clinical_notes').insert({
          patient_id: id,
          kind: 'importada',
          occurred_at: day,
          body: 'Consulta registrada no Versatilis',
          source: JSON.stringify({ system: SOURCE, ref }),
          created_by: session.userId,
        });
        out.notes += 1;
      }
      await logAccess(
        trx,
        {
          session,
          patientId: id,
          route: 'patients.import',
          action: item.existingId ? 'update' : 'create',
        },
        now,
      );
      return id;
    });
    if (item.pdf) {
      const buf = await readPdf(item.pdf);
      if (buf) {
        const before = await db('attachments').where({ patient_id: patientId }).count().first();
        await storeAttachment(
          db,
          session,
          patientId,
          { buffer: buf, originalName: item.pdf, mime: 'application/pdf', source: 'import' },
          now,
        );
        const after = await db('attachments').where({ patient_id: patientId }).count().first();
        if (Number(after.count) > Number(before.count)) out.attached += 1;
      }
    }
  }
  return out;
}
```

`packages/core/src/index.js`: `export { parseCsv } from './import/csv.js'; export { planImport, executeImport } from './import/versatilis.js';`. `index.d.ts`:

```ts
export function parseCsv(
  text: string,
  opts?: { delimiter?: string },
): { header: string[]; rows: Array<Record<string, string>> };
export interface ImportItem {
  ref: string;
  name: string;
  name_key: string;
  birth_date: string | null;
  phone: string | null;
  conditions: string[];
  consultas: string[];
  pdf: string | null;
  existingId?: string;
}
export interface ImportPlan {
  criar: ImportItem[];
  casar: ImportItem[];
  colidir: Array<{ ref: string; name: string; birth_date: string | null; motivo: string }>;
  pdfSemPaciente: string[];
  pacienteSemPdf: string[];
}
export function planImport(input: {
  rows: Array<Record<string, string>>;
  mapa: Record<string, unknown>;
  pdfFiles?: string[];
  existing?: Array<{
    id: string;
    name_key: string;
    birth_date: string | Date | null;
    external_ref: string | null;
  }>;
}): ImportPlan;
export function executeImport(
  db: Knex,
  session: Session,
  plan: ImportPlan,
  deps: { readPdf: (file: string) => Promise<Buffer | null> },
  now?: Instant,
): Promise<{ created: number; matched: number; attached: number; notes: number }>;
```

- [ ] **Step 6: Rodar**

Run: `npm test -w @medcheckin/core -- test/import-versatilis.test.js` e depois a suíte inteira.
Expected: verde. Se o `vitest` não expor `import.meta.dirname`, usar `fileURLToPath(new URL('./fixtures/versatilis', import.meta.url))`.

- [ ] **Step 7: Prettier + commit**

```bash
npx prettier --write packages/core/src/import packages/core/src/index.js packages/core/src/index.d.ts packages/core/test/import-versatilis.test.js packages/core/test/fixtures
git add packages/core/src/import packages/core/src/index.js packages/core/src/index.d.ts packages/core/test/import-versatilis.test.js packages/core/test/fixtures
git commit -m "feat(core): importação do Versatilis — parser CSV, plano puro com casamento conservador e execução idempotente (D39)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Script `import-versatilis.mjs` + docs de importação

**Files:**

- Create: `scripts/import-versatilis.mjs`, `docs/import/VERSATILIS.md`, `docs/import/versatilis.exemplo.json`
- Test: `packages/core/test/import-script.test.js` (roda o script como processo filho contra as fixtures)

**Interfaces:**

- Consumes: `parseCsv`, `planImport`, `executeImport`, `createDb`, `loadConfig` de `@medcheckin/core`.
- Produces: CLI `node --env-file=.env scripts/import-versatilis.mjs --cadastro <csv> --pdfs <pasta> --mapa <json> --clinica <email> [--gravar] [--saida <pasta>]`; exit 0 sem colisão, 2 com colisão, 3 erro de uso.

- [ ] **Step 1: Teste que falha**

```js
// packages/core/test/import-script.test.js
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { freshDb, seedClinic } from './helpers/db.js';

const run = promisify(execFile);
const ROOT = path.resolve(import.meta.dirname, '../../..');
const FIX = path.join(import.meta.dirname, 'fixtures/versatilis');

describe('scripts/import-versatilis.mjs', () => {
  let db, dir, uploads;
  beforeAll(async () => {
    db = await freshDb();
    await seedClinic(db, 'script'); // dra-script@example.test
    dir = await mkdtemp(path.join(tmpdir(), 'mc-imp-script-'));
    uploads = await mkdtemp(path.join(tmpdir(), 'mc-imp-up-'));
    await writeFile(path.join(dir, '101.pdf'), '%PDF-1.4\n%%EOF\n');
    await writeFile(path.join(dir, '102.pdf'), '%PDF-1.4\n%%EOF\n');
  });
  afterAll(async () => {
    await db.destroy();
    await rm(dir, { recursive: true, force: true });
    await rm(uploads, { recursive: true, force: true });
  });

  const env = () => ({
    ...process.env,
    DATABASE_URL: process.env.DATABASE_URL_TEST || process.env.DATABASE_URL,
    UPLOADS_DIR: uploads,
  });
  const args = (extra = []) => [
    path.join(ROOT, 'scripts/import-versatilis.mjs'),
    '--cadastro',
    path.join(FIX, 'cadastro.csv'),
    '--pdfs',
    dir,
    '--mapa',
    path.join(FIX, 'mapa.json'),
    '--clinica',
    'dra-script@example.test',
    '--saida',
    dir,
    ...extra,
  ];

  it('ensaio: escreve relatório, não grava, sai com 2 por causa das colisões', async () => {
    const r = await run('node', args(), { env: env(), cwd: ROOT }).catch((e) => e);
    expect(r.code).toBe(2);
    const files = await readdir(dir);
    const rel = files.find((f) => f.startsWith('import-ensaio-'));
    expect(rel).toBeTruthy();
    const md = await readFile(path.join(dir, rel), 'utf8');
    expect(md).toMatch(/Criar.*2/);
    expect(md).toMatch(/Colis/);
    expect(md).toMatch(/999\.pdf/); // o PDF órfão consta no relatório
    expect(Number((await db('patients').count().first()).count)).toBe(0);
  });

  it('--gravar recusa com colisão; sem as linhas colidentes, grava e relata', async () => {
    const r = await run('node', args(['--gravar']), { env: env(), cwd: ROOT }).catch((e) => e);
    expect(r.code).toBe(2);
    const csv = (await readFile(path.join(FIX, 'cadastro.csv'), 'utf8'))
      .split('\n')
      .filter((l) => !l.startsWith('104;') && !l.startsWith('105;'))
      .join('\n');
    const limpo = path.join(dir, 'cadastro-limpo.csv');
    await writeFile(limpo, csv);
    const ok = await run(
      'node',
      [...args(['--gravar']).map((a) => (a.endsWith('cadastro.csv') ? limpo : a))],
      { env: env(), cwd: ROOT },
    );
    expect(ok.stdout).toMatch(/gravado|criados/i);
    expect(
      Number((await db('patients').where({ status: 'registered' }).count().first()).count),
    ).toBe(3);
    const files = await readdir(dir);
    expect(files.some((f) => f.startsWith('import-resultado-'))).toBe(true);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -w @medcheckin/core -- test/import-script.test.js`
Expected: FAIL — script não existe (`ENOENT`/exit ≠ 2).

- [ ] **Step 3: Script**

```js
// scripts/import-versatilis.mjs
// Importa o cadastro do Versatilis (D39): ENSAIO por padrão (relatório, nada gravado); --gravar executa.
// Uso: node --env-file=.env scripts/import-versatilis.mjs --cadastro arquivo.csv --pdfs pasta/ --mapa mapa.json --clinica medica@clinica.com [--gravar] [--saida pasta/]
// Sai com 0 (ok), 2 (colisões pendentes) ou 3 (erro de uso).
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createDb, loadConfig, parseCsv, planImport, executeImport } from '@medcheckin/core';

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .map((a, i, arr) =>
      a.startsWith('--')
        ? [a.slice(2), arr[i + 1]?.startsWith('--') || arr[i + 1] === undefined ? true : arr[i + 1]]
        : [],
    )
    .filter((x) => x.length),
);
for (const k of ['cadastro', 'pdfs', 'mapa', 'clinica']) {
  if (!args[k] || args[k] === true) {
    console.error(
      'uso: --cadastro <csv> --pdfs <pasta> --mapa <json> --clinica <email da médica> [--gravar] [--saida <pasta>]',
    );
    process.exit(3);
  }
}
const gravar = args.gravar === true;
const saida = typeof args.saida === 'string' ? args.saida : process.cwd();
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

const cfg = loadConfig(process.env);
const db = createDb(cfg.databaseUrl);
try {
  const user = await db('users')
    .where({ email: String(args.clinica).trim().toLowerCase() })
    .first();
  if (!user) throw new Error(`médica não encontrada: ${args.clinica}`);
  const session = {
    kind: 'user',
    sessionId: 'import',
    userId: user.id,
    clinicId: user.clinic_id,
    role: user.role,
    name: user.name,
    email: user.email,
  };

  const mapa = JSON.parse(await readFile(args.mapa, 'utf8'));
  const { rows } = parseCsv(await readFile(args.cadastro, 'utf8'), {
    delimiter: mapa.delimitador || ';',
  });
  const pdfFiles = (await readdir(args.pdfs)).filter((f) => f.toLowerCase().endsWith('.pdf'));
  const existing = await db('patients')
    .where({ clinic_id: session.clinicId })
    .select('id', 'name_key', 'birth_date', 'external_ref');
  const plan = planImport({ rows, mapa, pdfFiles, existing });

  const linhas = [
    `# Importação Versatilis — ${gravar ? 'RESULTADO' : 'ENSAIO'} ${stamp}`,
    '',
    `- Linhas no CSV: ${rows.length}`,
    `- PDFs na pasta: ${pdfFiles.length}`,
    `- Criar: ${plan.criar.length}`,
    `- Casar com paciente existente: ${plan.casar.length}`,
    `- Colisões (não gravadas): ${plan.colidir.length}`,
    `- PDFs sem paciente: ${plan.pdfSemPaciente.length}`,
    `- Pacientes sem PDF: ${plan.pacienteSemPdf.length}`,
    '',
    '## Colisões',
    ...(plan.colidir.length
      ? plan.colidir.map(
          (c) => `- ref ${c.ref} · ${c.name} · nasc. ${c.birth_date ?? '—'} — ${c.motivo}`,
        )
      : ['- nenhuma']),
    '',
    '## PDFs sem paciente',
    ...(plan.pdfSemPaciente.length ? plan.pdfSemPaciente.map((f) => `- ${f}`) : ['- nenhum']),
    '',
    '## Pacientes sem PDF (refs)',
    ...(plan.pacienteSemPdf.length ? [plan.pacienteSemPdf.join(', ')] : ['- nenhum']),
  ];

  if (gravar) {
    if (plan.colidir.length) {
      console.error(
        `Há ${plan.colidir.length} colisão(ões). Resolva no CSV/mapa e rode o ensaio de novo.`,
      );
      await writeFile(path.join(saida, `import-ensaio-${stamp}.md`), linhas.join('\n') + '\n');
      process.exit(2);
    }
    const t0 = Date.now();
    const readPdf = async (f) => readFile(path.join(args.pdfs, f)).catch(() => null);
    const r = await executeImport(db, session, plan, { readPdf }, new Date());
    linhas.push(
      '',
      '## Gravado',
      `- criados: ${r.created}`,
      `- casados: ${r.matched}`,
      `- anexos: ${r.attached}`,
      `- notas de consulta: ${r.notes}`,
      `- tempo: ${Math.round((Date.now() - t0) / 1000)} s`,
    );
    await writeFile(path.join(saida, `import-resultado-${stamp}.md`), linhas.join('\n') + '\n');
    console.log(
      `gravado: ${r.created} criados, ${r.matched} casados, ${r.attached} anexos, ${r.notes} notas.`,
    );
  } else {
    await writeFile(path.join(saida, `import-ensaio-${stamp}.md`), linhas.join('\n') + '\n');
    console.log(linhas.slice(0, 9).join('\n'));
    if (plan.colidir.length) process.exit(2);
  }
} finally {
  await db.destroy();
}
```

Se `@medcheckin/core` não resolver a partir de `scripts/` (o `pilot-report.mjs` avisa "rode de dentro de packages/core ou com NODE_PATH"), conferir como o `package.json` da raiz declara `workspaces` — em workspaces npm o pacote fica em `node_modules/@medcheckin/core` na raiz e resolve; se não, o teste roda com `cwd: ROOT` e `NODE_PATH=packages` no `env`.

- [ ] **Step 4: Docs de importação**

`docs/import/versatilis.exemplo.json` = cópia do `mapa.json` das fixtures com comentário no README. `docs/import/VERSATILIS.md`:

```markdown
# Importar o cadastro do Versatilis

## 1. O que pedir ao Versatilis

- **Cadastro estruturado** (CSV, uma linha por paciente): id do paciente no Versatilis, nome completo, data de nascimento, telefone, diagnósticos/condições, datas das consultas.
- **Histórico em PDF, um arquivo por paciente**, com o **id do paciente no nome do arquivo** (ex.: `12345.pdf`). Sem isso não há como ligar o PDF ao cadastro com segurança.

## 2. Preencher o mapa

Copie `docs/import/versatilis.exemplo.json` para `mapa.json` e troque os nomes das colunas pelos do seu CSV. `formatoData` aceita `DD/MM/AAAA`; `pdf.padrao` aceita `{ref}.pdf` ou `{nome}.pdf`.

## 3. Ensaio (nada é gravado)
```

node --env-file=.env.prod scripts/import-versatilis.mjs --cadastro cadastro.csv --pdfs pdfs/ --mapa mapa.json --clinica medica@clinica.com --saida relatorios/

```
Leia `relatorios/import-ensaio-<data>.md`: criar, casar, **colisões**, PDFs órfãos, pacientes sem PDF. Colisão = mesmo nome com nascimento diferente (ou faltando) de um paciente já cadastrado, ou repetido no CSV. **Nenhuma fusão é automática.** Resolva editando o CSV (corrigir nascimento, remover duplicata) e rode o ensaio de novo até zerar as colisões.

## 4. Gravar
Mesmo comando com `--gravar`. Cada paciente entra numa transação; rodar de novo não duplica (id do Versatilis, hash do PDF e data da consulta são únicos). Pacientes importados nascem como **Cadastrado**: sem acompanhamento, sem envios; vire ativo por **Iniciar acompanhamento** na página do paciente.

## 5. Depois
- Conferir `import-resultado-<data>.md` e a lista de pacientes filtrada por **Cadastrados**.
- Rodar o backup (`backup.sh`) — o volume de anexos cresceu.
```

- [ ] **Step 5: Rodar**

Run: `npm test -w @medcheckin/core -- test/import-script.test.js`
Expected: PASS.

- [ ] **Step 6: Prettier + commit**

```bash
npx prettier --write scripts/import-versatilis.mjs docs/import packages/core/test/import-script.test.js
git add scripts/import-versatilis.mjs docs/import packages/core/test/import-script.test.js
git commit -m "feat(import): script import-versatilis com ensaio obrigatório, relatório em Markdown e recusa com colisão (D39)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: API — envelope de upload, rotas de anexos, lista paginada

**Files:**

- Modify: `apps/web/lib/api.ts` (`doctorUploadRoute`), `apps/web/app/api/patients/route.ts` (GET com `q`, `status`, `page`)
- Create: `apps/web/app/api/patients/[id]/attachments/route.ts`, `apps/web/app/api/patients/[id]/attachments/[attachmentId]/route.ts`
- Test: `apps/web/test/medica-api.test.ts` (casos de anexo e lista)

**Interfaces:**

- Produces: `doctorUploadRoute<P>(handler)` — igual a `doctorRoute` mas **não lê o corpo** (passa `req`); rotas da spec §6.

- [ ] **Step 1: Envelope**

Em `apps/web/lib/api.ts`, após `doctorRoute`:

```ts
type UploadHandler<P> = (args: {
  req: Request;
  db: Knex;
  session: UserSession;
  params: P;
  baseUrl: string;
}) => Promise<Response>;

/**
 * Envelope para rotas com corpo binário/multipart: mesma sessão e checagem de Origin do
 * doctorRoute, mas o corpo fica intocado para o handler ler com `req.formData()` — o
 * `readBody` genérico faria `req.text()` + JSON.parse e corromperia o arquivo.
 */
export function doctorUploadRoute<P = Record<string, never>>(handler: UploadHandler<P>) {
  return async (req: Request, ctx: Ctx<P>): Promise<Response> => {
    try {
      const session = await requireUser(req);
      assertSameOrigin(req);
      const params = (ctx?.params ? await ctx.params : {}) as P;
      const baseUrl = process.env.APP_BASE_URL ?? new URL(req.url).origin;
      return await handler({ req, db: getDb(), session, params, baseUrl });
    } catch (err) {
      return errorResponse(err);
    }
  };
}
```

`errorResponse` precisa mapear o tamanho/tipo: em `apps/web/lib/auth.ts`, no `errorResponse`, antes do ramo genérico de `validation`, acrescentar: se `code === 'validation'` e `(err as {field?:string}).field === 'file'`, devolver 413 quando a mensagem contém "25 MB" e 415 quando contém "não aceito" (senão 400). Ler o arquivo para ver o formato do JSON de erro e manter `{ error, message, field }`.

- [ ] **Step 2: Rotas**

```ts
// apps/web/app/api/patients/[id]/attachments/route.ts
import { listAttachments, storeAttachment, ATTACHMENT_MAX_BYTES } from '@medcheckin/core';
import { doctorRoute, doctorUploadRoute, json } from '@/lib/api';

export const dynamic = 'force-dynamic';

export const GET = doctorRoute<{ id: string }>(async ({ db, session, params }) =>
  json(await listAttachments(db, session, params.id)),
);

/** multipart/form-data com o campo `file`. Tipo e tamanho são decididos no core pelos bytes. */
export const POST = doctorUploadRoute<{ id: string }>(async ({ req, db, session, params }) => {
  const len = Number(req.headers.get('content-length') ?? 0);
  if (len > ATTACHMENT_MAX_BYTES + 64 * 1024)
    return json({ error: 'validation', message: 'Arquivo acima de 25 MB.', field: 'file' }, 413);
  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof File))
    return json(
      { error: 'validation', message: 'Envie o arquivo no campo "file".', field: 'file' },
      400,
    );
  const buffer = Buffer.from(await file.arrayBuffer());
  const row = await storeAttachment(
    db,
    session,
    params.id,
    { buffer, originalName: file.name, mime: file.type },
    new Date(),
  );
  return json(row, 201);
});
```

```ts
// apps/web/app/api/patients/[id]/attachments/[attachmentId]/route.ts
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { openAttachment, hideAttachment } from '@medcheckin/core';
import { doctorRoute } from '@/lib/api';

export const dynamic = 'force-dynamic';

/** Stream do arquivo, inline (o visualizador embute PDF/imagem). Tenancy e auditoria no core. */
export const GET = doctorRoute<{ id: string; attachmentId: string }>(
  async ({ db, session, params }) => {
    const { row, path } = await openAttachment(db, session, params.attachmentId, new Date());
    const stream = Readable.toWeb(createReadStream(path)) as ReadableStream;
    const safeName = row.original_name.replace(/["\r\n]/g, '_');
    return new Response(stream, {
      status: 200,
      headers: {
        'content-type': row.mime,
        'content-length': String(row.size_bytes),
        'content-disposition': `inline; filename="${safeName}"`,
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  },
);

export const DELETE = doctorRoute<{ id: string; attachmentId: string }>(
  async ({ db, session, params }) => {
    await hideAttachment(db, session, params.attachmentId, new Date());
    return new Response(null, { status: 204 });
  },
);
```

`apps/web/app/api/patients/route.ts`, GET:

```ts
export const GET = doctorRoute(async ({ req, db, session }) => {
  const sp = new URL(req.url).searchParams;
  const rawCondition = sp.get('condition') ?? '';
  return json(
    await listPatients(
      db,
      {
        clinicId: session.clinicId,
        condition: UUID_RE.test(rawCondition) ? rawCondition : null,
        q: sp.get('q') ?? '',
        status: (sp.get('status') as PatientListStatus) || 'following',
        page: Number(sp.get('page') ?? 1),
        pageSize: Number(sp.get('pageSize') ?? 50),
      },
      new Date(),
    ),
  );
});
```

(importar `PatientListStatus` como type de `@medcheckin/core`; `UUID_RE` já está em `@/lib/format`.)

- [ ] **Step 3: Testes de rota**

Em `apps/web/test/medica-api.test.ts`, seguindo o helper de request do arquivo (cookie + Origin), acrescentar: (a) `POST /api/patients/:id/attachments` com `FormData` contendo um `File` PDF mínimo (`new File([Buffer.from('%PDF-1.4\n%%EOF\n')], 'x.pdf', { type: 'application/pdf' })`) → 201 com `kind: 'pdf'`; `GET /api/patients/:id/attachments` traz 1; `GET .../attachments/:id` → 200, `content-type: application/pdf`, corpo começa com `%PDF`; `DELETE` → 204; lista vazia depois. Enviar um `.exe` disfarçado → 415; (b) `GET /api/patients?status=registered` devolve `{ rows: [], total: 0 }` e `GET /api/patients?q=sint` devolve os dois pacientes sintéticos com `total: 2`. O teste do web precisa de `UPLOADS_DIR` temporário: no `beforeAll` do arquivo (ou num `setup` do vitest do web), `process.env.UPLOADS_DIR = await mkdtemp(...)`.

- [ ] **Step 4: Typecheck, lint, testes do web**

Run: `npm run typecheck -w @medcheckin/web && npm run lint && npm test -w @medcheckin/web`
Expected: verde.

- [ ] **Step 5: Prettier + commit**

```bash
npx prettier --write apps/web/lib/api.ts apps/web/lib/auth.ts apps/web/app/api apps/web/test
git add apps/web/lib/api.ts apps/web/lib/auth.ts apps/web/app/api apps/web/test
git commit -m "feat(api): upload e stream de anexos com envelope próprio; lista de pacientes com q, status e página

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: UI — lista de pacientes com busca, status e paginação

**Files:**

- Create: `apps/web/components/medica/PatientsToolbar.tsx`
- Modify: `apps/web/app/(medica)/pacientes/page.tsx`

**Interfaces:**

- Consumes: `listPatients` paginada; `ConditionsFilter` existente.
- Produces: test ids `patients-search`, `patients-status`, `patients-pager`, `patients-prev`, `patients-next`; badge **Cadastrado** e origem na linha.

- [ ] **Step 1: Toolbar**

```tsx
// apps/web/components/medica/PatientsToolbar.tsx
'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Input } from '@/components/ui/input';
import { SimpleSelect } from '@/components/ui/simple-select';
import { ConditionsFilter } from './ConditionsFilter';

const STATUS_OPTIONS = [
  { value: 'following', label: 'Em acompanhamento' },
  { value: 'registered', label: 'Cadastrados' },
  { value: 'discharged', label: 'Alta' },
  { value: 'all', label: 'Todos' },
];

/** D37 — busca por nome (300 ms ou Enter), status e condição; tudo vive na URL. */
export function PatientsToolbar({
  q,
  status,
  condition,
  conditions,
}: {
  q: string;
  status: string;
  condition: string;
  conditions: Array<{ id: string; name: string; patients: number }>;
}) {
  const router = useRouter();
  const [text, setText] = useState(q);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function go(next: { q?: string; status?: string; condition?: string }) {
    const params = new URLSearchParams();
    const nq = next.q ?? text;
    const ns = next.status ?? status;
    const nc = next.condition ?? condition;
    if (nq.trim().length >= 2) params.set('q', nq.trim());
    if (ns && ns !== 'following') params.set('status', ns);
    if (nc) params.set('condition', nc);
    const s = params.toString();
    router.push(s ? `/pacientes?${s}` : '/pacientes');
  }
  useEffect(() => {
    if (text === q) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => go({ q: text }), 300);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        className="w-56"
        placeholder="Buscar por nome"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') go({ q: text });
        }}
        aria-label="Buscar paciente por nome"
        data-testid="patients-search"
      />
      <div className="w-48">
        <SimpleSelect
          value={status || 'following'}
          onValueChange={(v) => go({ status: v })}
          options={STATUS_OPTIONS}
          size="sm"
          aria-label="Filtrar por status"
          data-testid="patients-status"
        />
      </div>
      {conditions.length > 0 && <ConditionsFilter options={conditions} value={condition} />}
    </div>
  );
}
```

`ConditionsFilter` hoje navega para `/pacientes?condition=` perdendo `q`/`status`; trocar seu `router.push` para preservar os outros parâmetros: ler `useSearchParams()`, copiar, setar/remover `condition`, `router.push`.

- [ ] **Step 2: Página**

`apps/web/app/(medica)/pacientes/page.tsx`: `searchParams: Promise<{ condition?: string; q?: string; status?: string; page?: string }>`; ler os quatro; `status` válido ∈ `following|registered|discharged|all|active|paused` (senão `following`); `page = Math.max(1, Number(page) || 1)`; chamar `listPatients(db, { clinicId, condition, q, status, page }, new Date())` → `{ rows, total, pageSize }`. Cabeçalho: `total` no lugar de `rows.length` ("N em acompanhamento" quando `status === 'following'`, "N cadastrados", "N com alta", "N no total", "N encontrados" quando há `q`). Substituir `<ConditionsFilter …/>` por `<PatientsToolbar q={q} status={status} condition={condition} conditions={conds} />`. Linha: `Badge` `variant={p.status === 'active' ? 'default' : p.status === 'registered' ? 'outline' : 'secondary'}`; na coluna Dose vigente, se `p.status === 'registered'`, mostrar `importado do Versatilis em {fmtDate(p.imported_at)}` em `text-muted-foreground text-[13px]`. Vazio: se `q` → "Nenhum paciente com esse nome."; se `status === 'registered'` → "Nenhum paciente cadastrado por importação."; mantém os textos atuais nos outros casos. Rodapé da tabela (`data-testid="patients-pager"`): "{início}–{fim} de {total}" e dois `Button` (`patients-prev`/`patients-next`, `nativeButton={false}` com `render={<Link href=…/>}`, desabilitados na borda) preservando `q`/`status`/`condition` na URL.

- [ ] **Step 3: Typecheck + lint**

Run: `npm run typecheck -w @medcheckin/web && npm run lint`. Expected: verde.

- [ ] **Step 4: Prettier + commit**

```bash
npx prettier --write apps/web/components/medica/PatientsToolbar.tsx apps/web/components/medica/ConditionsFilter.tsx "apps/web/app/(medica)/pacientes/page.tsx"
git add apps/web/components/medica/PatientsToolbar.tsx apps/web/components/medica/ConditionsFilter.tsx "apps/web/app/(medica)/pacientes/page.tsx"
git commit -m "feat(web): lista de pacientes com busca, status (Em acompanhamento por padrão) e paginação de 50 (D37)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: UI — página do paciente: faixa Cadastrado, card Anexos, Carregar mais

**Files:**

- Create: `apps/web/components/medica/RegisteredBanner.tsx`, `apps/web/components/medica/AttachmentsCard.tsx`
- Modify: `apps/web/components/medica/ProntuarioCard.tsx` (props `hasMore`, `nextBefore`, botão), `apps/web/app/(medica)/pacientes/[id]/page.tsx`

**Interfaces:**

- Consumes: rotas de anexos e `GET /api/patients/:id/timeline?before=`; `listAttachments`.
- Produces: test ids `registered-banner`, `start-followup`, `attachments-card`, `attachment-upload`, `attachment-item`, `attachment-open`, `attachment-hide`, `attachment-hide-confirm`, `attachment-viewer`, `timeline-more`.

- [ ] **Step 1: `RegisteredBanner`**

```tsx
// apps/web/components/medica/RegisteredBanner.tsx
import { fmtDate } from '@/lib/format';

/** D37 — paciente importado: tem histórico, não está no acompanhamento. O convite (aba
 *  Configuração → Respondentes) é o que o torna ativo, no aceite do consentimento. */
export function RegisteredBanner({
  importedAt,
  source,
}: {
  importedAt: Date | string | null;
  source: string | null;
}) {
  return (
    <section
      className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 text-sm"
      data-testid="registered-banner"
    >
      <strong>Cadastrado</strong> a partir do{' '}
      {source === 'versatilis' ? 'Versatilis' : 'sistema anterior'}
      {importedAt
        ? ` em ${fmtDate(importedAt, { day: '2-digit', month: '2-digit', year: 'numeric' })}`
        : ''}
      . Sem acompanhamento no app: nenhum lembrete ou check-in é enviado.{' '}
      <a
        href="#respondents-card"
        className="font-medium underline underline-offset-4"
        data-testid="start-followup"
      >
        Iniciar acompanhamento
      </a>{' '}
      — convide quem responde e peça o consentimento; ao aceitar, o paciente passa a Ativo.
    </section>
  );
}
```

(Na página, o `RespondentsCard` já tem `data-testid="respondents-card"`; acrescentar `id="respondents-card"` ao `Card` dele para a âncora funcionar.)

- [ ] **Step 2: `AttachmentsCard`**

```tsx
// apps/web/components/medica/AttachmentsCard.tsx
'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError } from '@/lib/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { fmtDate } from '@/lib/format';
import type { AttachmentRow } from '@medcheckin/core';

const MAX = 25 * 1024 * 1024;
const fmtBytes = (n: number) =>
  n >= 1024 * 1024
    ? `${(n / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(n / 1024))} KB`;

/** D38 — anexos do paciente: PDF/JPG/PNG até 25 MB, visualizador embutido, ocultar sem apagar. */
export function AttachmentsCard({
  patientId,
  attachments,
}: {
  patientId: string;
  attachments: AttachmentRow[];
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [hiding, setHiding] = useState<string | null>(null);

  async function upload(file: File) {
    setError(null);
    if (file.size > MAX) {
      setError('Arquivo acima de 25 MB.');
      return;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`/api/patients/${patientId}/attachments`, {
        method: 'POST',
        body: fd,
        credentials: 'same-origin',
      });
      if (!res.ok) {
        const e = (await res.json().catch(() => ({}))) as { message?: string };
        throw new ApiError(res.status, 'error', e.message ?? `Erro ${res.status}`);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erro ao enviar');
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }
  async function hide(id: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/patients/${patientId}/attachments/${id}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      });
      if (!res.ok) throw new ApiError(res.status, 'error', `Erro ${res.status}`);
      setHiding(null);
      if (open === id) setOpen(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erro');
    } finally {
      setBusy(false);
    }
  }
  const url = (id: string) => `/api/patients/${patientId}/attachments/${id}`;

  return (
    <Card data-testid="attachments-card">
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle>Anexos</CardTitle>
        <div className="print:hidden">
          <input
            ref={input}
            type="file"
            accept="application/pdf,image/jpeg,image/png"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void upload(f);
            }}
            data-testid="attachment-upload"
          />
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => input.current?.click()}
          >
            {busy ? 'Enviando…' : 'Anexar arquivo'}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground print:hidden">
          PDF, JPG ou PNG até 25 MB. Exames, prontuários antigos, laudos.
        </p>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {attachments.length === 0 && <p className="text-sm text-muted-foreground">Nenhum anexo.</p>}
        <ul className="divide-y">
          {attachments.map((a) => (
            <li key={a.id} className="py-2 text-sm" data-testid="attachment-item">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  className="text-left font-medium underline-offset-2 hover:underline"
                  onClick={() => setOpen(open === a.id ? null : a.id)}
                  data-testid="attachment-open"
                >
                  {a.original_name}
                </button>
                <span className="font-mono text-xs text-muted-foreground">
                  {a.kind === 'pdf' ? 'PDF' : 'imagem'} · {fmtBytes(a.size_bytes)} ·{' '}
                  {fmtDate(a.created_at)} · {a.source === 'import' ? 'importado' : 'enviado'}
                </span>
                <span className="flex gap-1 print:hidden">
                  <a
                    href={url(a.id)}
                    target="_blank"
                    rel="noopener"
                    className="text-xs underline underline-offset-2"
                  >
                    abrir em nova aba
                  </a>
                  {hiding === a.id ? (
                    <>
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={busy}
                        onClick={() => void hide(a.id)}
                        data-testid="attachment-hide-confirm"
                      >
                        Confirmar
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setHiding(null)}>
                        Voltar
                      </Button>
                    </>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setHiding(a.id)}
                      data-testid="attachment-hide"
                    >
                      Ocultar
                    </Button>
                  )}
                </span>
              </div>
              {open === a.id && (
                <div className="mt-2 print:hidden" data-testid="attachment-viewer">
                  {a.kind === 'pdf' ? (
                    <iframe
                      src={url(a.id)}
                      title={a.original_name}
                      className="h-[70vh] w-full rounded-md border"
                    />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={url(a.id)}
                      alt={a.original_name}
                      className="max-h-[70vh] rounded-md border"
                    />
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: `ProntuarioCard` — Carregar mais**

Props novas: `hasMore: boolean; nextBefore: string | null`. Estado: `const [extra, setExtra] = useState<TimelineDay[]>([]); const [more, setMore] = useState({ hasMore, nextBefore }); const [loadingMore, setLoadingMore] = useState(false);`. Função:

```tsx
async function carregarMais() {
  if (!more.nextBefore || loadingMore) return;
  setLoadingMore(true);
  try {
    const page = await api<{ days: TimelineDay[]; hasMore: boolean; nextBefore: string | null }>(
      `/api/patients/${patientId}/timeline?before=${more.nextBefore}`,
    );
    setExtra((x) => [...x, ...page.days]);
    setMore({ hasMore: page.hasMore, nextBefore: page.nextBefore });
  } catch (err) {
    setError(err instanceof ApiError ? err.message : 'Erro');
  } finally {
    setLoadingMore(false);
  }
}
```

Renderizar `[...timeline, ...extra]` no `<ol>` e, após ele: `{more.hasMore && <Button variant="outline" size="sm" className="print:hidden" disabled={loadingMore} onClick={() => void carregarMais()} data-testid="timeline-more">{loadingMore ? 'Carregando…' : 'Carregar mais'}</Button>}`. Após `router.refresh()` em salvar/ocultar, `setExtra([])` e `setMore({ hasMore, nextBefore })` (props novas chegam pelo refresh). Nota `importada`: quando `n.source?.system === 'versatilis'`, mostrar "importada · Versatilis" (o tipo `source` em `index.d.ts` ganha `system?: string; ref?: string`).

- [ ] **Step 4: Página**

`apps/web/app/(medica)/pacientes/[id]/page.tsx`: importar `listAttachments`, `RegisteredBanner`, `AttachmentsCard`; no `Promise.all` acrescentar `listAttachments(db, session, id)` → `attachments`; passar `hasMore`/`nextBefore` ao `ProntuarioCard`; renderizar `{p.status === 'registered' && <RegisteredBanner importedAt={p.imported_at} source={p.external_source} />}` no lugar do `SetupChecklist` quando `registered` (`{p.status !== 'registered' && <SetupChecklist detail={detail} />}`); `<AttachmentsCard patientId={p.id} attachments={attachments} />` logo após o `ProntuarioCard` na aba "O caso". `PatientHeaderActions` recebe `status` e já esconde Pausar/Retomar para `registered` (só mostra "Dar alta"); manter.

- [ ] **Step 5: Typecheck + lint**

Run: `npm run typecheck -w @medcheckin/web && npm run lint`. Expected: verde.

- [ ] **Step 6: Prettier + commit**

```bash
npx prettier --write apps/web/components/medica "apps/web/app/(medica)/pacientes/[id]/page.tsx" packages/core/src/index.d.ts
git add apps/web/components/medica "apps/web/app/(medica)/pacientes/[id]/page.tsx" packages/core/src/index.d.ts
git commit -m "feat(web): card Anexos com visualizador embutido, faixa de paciente Cadastrado e Carregar mais na linha do tempo (D37, D38)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Deploy — volume `uploads`, backup em duas partes, restore drill

**Files:**

- Modify: `docker-compose.prod.yml`, `docker-compose.casa.yml`, `docker-compose.yml` (dev, se definir o web), `scripts/backup.sh`, `scripts/restore-drill.sh`, `.env.example`, `.gitignore` (`uploads/`), `docs/DEPLOY.md`, `docs/DEPLOY-CASA.md`

- [ ] **Step 1: Compose**

`docker-compose.prod.yml`: no serviço `web`, `environment` ganha `UPLOADS_DIR: /data/uploads` e `volumes: - uploads:/data/uploads`; no serviço `backup`, `volumes` ganha `- uploads:/data/uploads:ro` e `environment` ganha `UPLOADS_DIR: /data/uploads`; em `volumes:` acrescentar `uploads:`. `docker-compose.casa.yml`: nada muda (herda). `.env.example`: linha `UPLOADS_DIR=./uploads` com comentário "produção: /data/uploads (volume `uploads`)". `.gitignore`: `uploads/`.

- [ ] **Step 2: `backup.sh`**

Após a linha `find ... .sha256 -delete` e antes do bloco off-site, acrescentar (o tar do volume é a segunda parte; ausência de `UPLOADS_DIR` mantém o comportamento antigo):

```sh
# D38: anexos vivem fora do banco. Segunda parte do backup: tar do volume, cifrado com a mesma frase.
UP_OUT=""
if [ -n "${UPLOADS_DIR:-}" ] && [ -d "$UPLOADS_DIR" ]; then
  UP_TMP="$DIR/.tmp-$STAMP.uploads.tar"
  UP_OUT="$DIR/uploads-$STAMP.tar.enc"
  tar -C "$UPLOADS_DIR" -cf "$UP_TMP" .
  openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -in "$UP_TMP" -out "$UP_OUT" -pass env:BACKUP_PASSPHRASE
  rm -f "$UP_TMP"
  sha256sum "$UP_OUT" | awk '{print $1}' > "$UP_OUT.sha256"
  echo "{\"ts\":\"$(date -u +%FT%TZ)\",\"msg\":\"backup.uploads_ok\",\"file\":\"$(basename "$UP_OUT")\",\"bytes\":$(wc -c < "$UP_OUT")}"
  find "$DIR" -name 'uploads-*.tar.enc' -mtime +"$KEEP" -delete
  find "$DIR" -name 'uploads-*.tar.enc.sha256' -mtime +"$KEEP" -delete
fi
```

e no bloco off-site, após o `rclone copy` do dump: `if [ -n "$UP_OUT" ]; then rclone copy "$UP_OUT" "$BACKUP_RCLONE_REMOTE" && rclone copy "$UP_OUT.sha256" "$BACKUP_RCLONE_REMOTE" || { echo '{"msg":"backup.offsite_failed","reason":"uploads"}'; exit 6; }; fi`.

- [ ] **Step 3: `restore-drill.sh`**

Após o passo 3 (hash igual), acrescentar o passo 4 — cada `stored_path` do banco restaurado existe no tar mais recente:

```sh
# 4) anexos (D38): cada stored_path do banco restaurado precisa existir no tar de uploads mais recente
UP_FILE="${UPLOADS_FILE:-$(ls -1t "$DIR"/uploads-*.tar.enc 2>/dev/null | head -1)}"
N_ATT="$(psql -d "$DRILL" -qAtc "select count(*) from attachments" 2>/dev/null || echo 0)"
if [ "$N_ATT" -gt 0 ]; then
  [ -n "$UP_FILE" ] || { echo "RESTORE DRILL FAIL: $N_ATT anexo(s) no banco e nenhum uploads-*.tar.enc em $DIR"; exit 7; }
  UP_TMP="$(mktemp)"; trap 'rm -f "$TMP" "$UP_TMP"; psql -d postgres -qAtc "drop database if exists $DRILL" >/dev/null 2>&1 || true' EXIT
  openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in "$UP_FILE" -out "$UP_TMP" -pass env:BACKUP_PASSPHRASE
  MISSING=0
  for p in $(psql -d "$DRILL" -qAtc "select stored_path from attachments"); do
    tar -tf "$UP_TMP" "./$p" >/dev/null 2>&1 || { echo "RESTORE DRILL: anexo ausente no tar: $p"; MISSING=$((MISSING+1)); }
  done
  [ "$MISSING" -eq 0 ] || { echo "RESTORE DRILL FAIL: $MISSING anexo(s) sem arquivo no tar"; exit 8; }
  echo "RESTORE DRILL anexos OK ($N_ATT arquivo(s) conferido(s) em $(basename "$UP_FILE"))"
fi
```

- [ ] **Step 4: Docs de deploy**

`docs/DEPLOY.md`, item 7: acrescentar que o backup gera dois arquivos (`medcheckin-*.dump.enc` e `uploads-*.tar.enc`), que `UPLOADS_DIR=/data/uploads` é fixado no compose e que o drill confere os anexos. `docs/DEPLOY-CASA.md`, Parte 6 e Parte 10: idem, e que a pasta do Syncthing vai receber os dois. `.env.prod` de exemplo na Parte 7 não muda (o compose fixa `UPLOADS_DIR`).

- [ ] **Step 5: Prova local**

Com o compose de dev de pé, rodar o `backup.sh` e o `restore-drill.sh` **fora** do container, apontando para o banco de dev e um `UPLOADS_DIR` com um anexo criado pela tela ou pelo teste: `BACKUP_PASSPHRASE=x BACKUP_DIR=/tmp/mcbk UPLOADS_DIR=./uploads PGHOST=localhost PGPORT=5434 PGUSER=… PGPASSWORD=… PGDATABASE=medcheckin sh scripts/backup.sh` (ver credenciais no `docker-compose.yml`), depois `restore-drill.sh` com as mesmas variáveis. Esperado: `backup.ok`, `backup.uploads_ok`, `RESTORE DRILL OK`, `RESTORE DRILL anexos OK`. Colar a saída no report. `docker compose -f docker-compose.prod.yml config` também precisa passar (validação do YAML).

- [ ] **Step 6: Prettier + commit**

```bash
npx prettier --write docker-compose.prod.yml docker-compose.casa.yml docs/DEPLOY.md docs/DEPLOY-CASA.md .env.example
git add docker-compose.prod.yml docker-compose.casa.yml docker-compose.yml scripts/backup.sh scripts/restore-drill.sh .env.example .gitignore docs/DEPLOY.md docs/DEPLOY-CASA.md
git commit -m "feat(deploy): volume uploads, backup em duas partes (dump + tar cifrado) e restore drill conferindo anexos (D38)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: E2E — anexos e lista de pacientes

**Files:**

- Create: `apps/web/e2e/anexos.spec.ts`, `apps/web/e2e/lista-pacientes.spec.ts`
- Modify: `apps/web/playwright.config.ts` (`webServer.env.UPLOADS_DIR` para uma pasta temporária, ex. `path.join(os.tmpdir(), 'mc-e2e-uploads')`)

- [ ] **Step 1: `anexos.spec.ts`**

```ts
import { test, expect } from '@playwright/test';
import { createDb, createPatient, type Session } from '@medcheckin/core';
import { loginAsDoctor } from './helpers';

const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n');

/** E12.2 / D38 — anexar PDF, ver na lista, abrir o visualizador, ocultar. */
test.describe('anexos', () => {
  test('anexar → listar → abrir → ocultar', async ({ page, context, baseURL }) => {
    await loginAsDoctor(context, baseURL!);
    const db = createDb(process.env.DATABASE_URL_TEST || process.env.DATABASE_URL!);
    try {
      const user = await db('users').where({ email: 'medica@medcheckin.test' }).first();
      const doctor = {
        kind: 'user',
        sessionId: 'e2e',
        userId: user.id,
        clinicId: user.clinic_id,
        role: 'doctor',
        name: 'Dra.',
        email: user.email,
      } as Session;
      const { patient } = await createPatient(
        db,
        doctor,
        {
          name: 'Paciente Anexo E2E',
          respondents: [{ kind: 'caregiver', name: 'C', email: 'anexo@x.test' }],
          consent_version: 'v1',
        },
        new Date(),
      );
      await page.goto(`/pacientes/${patient.id}`);
      const card = page.getByTestId('attachments-card');
      await expect(card).toContainText('Nenhum anexo');
      await card
        .getByTestId('attachment-upload')
        .setInputFiles({ name: 'prontuario-antigo.pdf', mimeType: 'application/pdf', buffer: PDF });
      const item = card.getByTestId('attachment-item');
      await expect(item).toHaveCount(1);
      await expect(item).toContainText('prontuario-antigo.pdf');
      await expect(item).toContainText('PDF');
      await item.getByTestId('attachment-open').click();
      await expect(card.getByTestId('attachment-viewer').locator('iframe')).toHaveAttribute(
        'src',
        /\/api\/patients\/.+\/attachments\//,
      );
      const src = await card.getByTestId('attachment-viewer').locator('iframe').getAttribute('src');
      const res = await page.request.get(src!);
      expect(res.status()).toBe(200);
      expect(res.headers()['content-type']).toContain('application/pdf');
      expect((await res.body()).subarray(0, 4).toString()).toBe('%PDF');
      // tipo errado recusado
      await card
        .getByTestId('attachment-upload')
        .setInputFiles({
          name: 'falso.pdf',
          mimeType: 'application/pdf',
          buffer: Buffer.from('MZ nao sou pdf'),
        });
      await expect(card).toContainText('não aceito');
      await expect(item).toHaveCount(1);
      // ocultar
      await item.getByTestId('attachment-hide').click();
      await item.getByTestId('attachment-hide-confirm').click();
      await expect(card.getByTestId('attachment-item')).toHaveCount(0);
      const rows = await db('attachments').where({ patient_id: patient.id });
      expect(rows).toHaveLength(1);
      expect(rows[0].deleted_at).not.toBeNull();
      const audit = await db('access_audit')
        .where({ patient_id: patient.id })
        .whereIn('route', ['attachments.create', 'attachments.read', 'attachments.delete']);
      expect(audit.length).toBeGreaterThanOrEqual(3);
    } finally {
      await db.destroy();
    }
  });
});
```

- [ ] **Step 2: `lista-pacientes.spec.ts`**

```ts
import { test, expect } from '@playwright/test';
import { createDb, createPatient, catalogNameKey, type Session } from '@medcheckin/core';
import { escolher, loginAsDoctor } from './helpers';

/** E12.2 / D37 — Cadastrado só em "Cadastrados"; busca sem acento; paginação de 50. */
test.describe('lista de pacientes', () => {
  test('status, busca e paginação', async ({ page, context, baseURL }) => {
    await loginAsDoctor(context, baseURL!);
    const db = createDb(process.env.DATABASE_URL_TEST || process.env.DATABASE_URL!);
    try {
      const user = await db('users').where({ email: 'medica@medcheckin.test' }).first();
      const doctor = {
        kind: 'user',
        sessionId: 'e2e',
        userId: user.id,
        clinicId: user.clinic_id,
        role: 'doctor',
        name: 'Dra.',
        email: user.email,
      } as Session;
      for (let i = 1; i <= 55; i += 1) {
        await createPatient(
          db,
          doctor,
          {
            name: `Lote E2E ${String(i).padStart(2, '0')}`,
            respondents: [{ kind: 'caregiver', name: 'C', email: `lote${i}@x.test` }],
            consent_version: 'v1',
          },
          new Date(),
        );
      }
      await db('patients').insert({
        clinic_id: user.clinic_id,
        name: 'Zélia Importada E2E',
        name_key: catalogNameKey('Zélia Importada E2E'),
        timezone: 'America/Cuiaba',
        created_by: user.id,
        status: 'registered',
        external_source: 'versatilis',
        external_ref: 'E2E-1',
        imported_at: new Date(),
      });

      await page.goto('/pacientes');
      await expect(page.getByRole('row', { name: /Zélia Importada/ })).toHaveCount(0);
      await expect(page.getByTestId('patients-pager')).toContainText('1–50 de');
      await page.getByTestId('patients-next').click();
      await expect(page).toHaveURL(/page=2/);
      await expect(page.getByTestId('patients-pager')).toContainText('51–');

      await escolher(page, 'patients-status', 'Cadastrados');
      await expect(page).toHaveURL(/status=registered/);
      const zelia = page.getByRole('row', { name: /Zélia Importada/ });
      await expect(zelia).toBeVisible();
      await expect(zelia).toContainText('Cadastrado');
      await expect(zelia).toContainText('importado do Versatilis');

      await escolher(page, 'patients-status', 'Todos');
      await page.getByTestId('patients-search').fill('zelia imp');
      await page.getByTestId('patients-search').press('Enter');
      await expect(page).toHaveURL(/q=zelia/);
      await expect(page.getByRole('row', { name: /Zélia Importada/ })).toBeVisible();
      await expect(page.getByRole('row', { name: /Lote E2E/ })).toHaveCount(0);

      // página do paciente Cadastrado mostra a faixa
      await page.getByRole('link', { name: 'Zélia Importada E2E' }).click();
      await expect(page.getByTestId('registered-banner')).toContainText('Cadastrado');
      await expect(page.getByTestId('setup-checklist')).toHaveCount(0);
    } finally {
      await db.destroy();
    }
  });
});
```

- [ ] **Step 3: Rodar**

Run: `npm run test:e2e -- e2e/anexos.spec.ts e2e/lista-pacientes.spec.ts` e depois `npm run test:e2e` inteiro.
Expected: verde. Specs antigos que asseriam "N no total" ou leem a lista sem paginação podem precisar de ajuste de rótulo (adaptar o teste ao texto da tela, não o contrário). Falha em componente/core → BLOCKED com o erro.

- [ ] **Step 4: Prettier + commit**

```bash
npx prettier --write apps/web/e2e apps/web/playwright.config.ts
git add apps/web/e2e apps/web/playwright.config.ts
git commit -m "test(e2e): anexos (enviar, abrir, recusar tipo, ocultar) e lista de pacientes (status, busca, paginação, faixa Cadastrado)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: Docs — LGPD, manual, D37–D39, PLANO, todo

**Files:**

- Modify: `docs/LGPD.md`, `docs/MANUAL_MEDICA.md`, `DECISOES.md`, `PLANO.md`, `tasks/todo.md`

- [ ] **Step 1: LGPD** — nova seção após "## Prontuário (notas clínicas e condições) — E12.1":

```markdown
## Anexos e pacientes importados — E12.2

- **Anexos** (`attachments` + arquivos em `UPLOADS_DIR`) são dado de saúde do titular (exames, prontuários antigos): base legal = tutela da saúde e guarda do prontuário. Só PDF, JPG e PNG, tipo conferido pelo conteúdo, até 25 MB. Servidos só à médica da clínica, com auditoria `attachments.read` a cada abertura. **Ocultar** grava `deleted_at`; o arquivo fica.
- **Export** (`export.zip`): `attachments.json` com metadados de todos (inclusive ocultos) e os arquivos em `anexos/`. **Anonimização**: os arquivos são apagados do disco e `original_name` vira `anexo N`.
- **Backup**: o volume de anexos entra no backup diário como segunda parte (`uploads-*.tar.enc`), cifrada com a mesma frase; o restore drill confere que cada anexo do banco existe no tar.
- **Pacientes importados** (status **Cadastrado**) vêm do sistema anterior da clínica (Versatilis), com cadastro, condições, datas de consulta e o PDF do prontuário. Não têm consentimento v2 e **não recebem nada**; a base legal é a continuidade do cuidado e a guarda do prontuário. O termo v2 é pedido em **Iniciar acompanhamento**, e só então o paciente passa a ativo. A importação registra `patients.import` na auditoria.
```

- [ ] **Step 2: Manual** — em `### 4.2 Pacientes — a lista`: parágrafo sobre **Buscar por nome**, o seletor **Em acompanhamento · Cadastrados · Alta · Todos** e a paginação de 50. Em `#### Aba "O caso"`, após o Prontuário: **Anexos** (Anexar arquivo, tipos e limite, clicar para ver, abrir em nova aba, Ocultar). Em `### 4.4`: parágrafo **Paciente Cadastrado** (faixa amarela, o que significa, Iniciar acompanhamento). Em `## 2. Palavras que você vai ver na tela`: linhas **Cadastrado** e **Anexo**.

- [ ] **Step 3: DECISOES** — após D36:

```markdown
| D37 | **Status "Cadastrado" (`registered`)**: paciente com histórico e sem acompanhamento; só a importação grava; vira ativo no primeiro aceite de consentimento; invisível para scheduler, alarmes e Hoje; a lista abre em "Em acompanhamento" com busca por nome, seletor de status e paginação de 50 | Mais de 1.000 pacientes do Versatilis não cabem numa tabela nem podem virar "pausados" (isso quebraria a tela Hoje e o relatório do piloto) |
| D38 | **Anexo = arquivo no volume `uploads` + metadados no banco**: PDF/JPG/PNG até 25 MB, tipo pelos bytes, `sha256` único por paciente, servido só por rota autenticada da clínica, **Ocultar** nunca apaga (a anonimização apaga); backup em duas partes (dump + tar cifrado) e restore drill conferindo cada anexo | Scans podem chegar a gigabytes e inflar o dump; volume com backup próprio mantém o drill honesto sem depender de terceiro (LGPD) |
| D39 | **Importação por script com ensaio obrigatório e casamento conservador**: casa por id do Versatilis, senão por nome + nascimento; nome igual com nascimento diferente ou faltando é colisão, nunca fusão; `--gravar` recusa com colisão; idempotente; o SQLite da v1 fica de fora (Versatilis é a fonte) | Fundir dois pacientes é o pior erro possível num prontuário; o ensaio é a única forma de a médica ver o que vai acontecer antes |
```

- [ ] **Step 4: PLANO e todo** — `#### E12.2 … \`[~]\``→`\`[x]\``; linha de log no topo da tabela: `| 2026-09-15 | E12.2 | Anexos e importação (D37–D39): migration 014, módulo attachments, listPatients paginada com busca e status, timeline com janela, parser CSV + planImport/executeImport, script import-versatilis com ensaio, rotas de upload/stream, card Anexos, faixa Cadastrado, toolbar da lista, volume uploads com backup em duas partes e restore drill. Spec em docs/superpowers/specs/2026-09-15-anexos-importacao-design.md. N testes + M E2E. |`(totais reais).`tasks/todo.md`: seção `# E12.2 Anexos e importação (15/09, \`feat/anexos-importacao\`)`com`[x]`por task e SHA, e`## Revisão` com desvios e follow-ups.

- [ ] **Step 5: Prettier + commit**

```bash
npx prettier --write docs/LGPD.md docs/MANUAL_MEDICA.md DECISOES.md PLANO.md tasks/todo.md
git add docs/LGPD.md docs/MANUAL_MEDICA.md DECISOES.md PLANO.md tasks/todo.md
git commit -m "docs: anexos e importação — LGPD, manual, D37–D39, log do PLANO e todo

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 13: Verificação final

- [ ] **Step 1:** `npm run check && npm run test:e2e` — tudo verde (prettier pode reclamar só de arquivos gitignorados: `docs/INVENTARIO_V1.md`, `.superpowers/**`, `uploads/**`; provar com `npx prettier --check . '!docs/INVENTARIO_V1.md' '!.superpowers/**' '!uploads/**'`). Anotar totais.
- [ ] **Step 2:** `npm run migrate` no banco de dev; conferir `patients.name_key` preenchido e `attachments` criada. Subir o web pela launch config (controller) e: anexar um PDF a um paciente, abrir o visualizador, ocultar; na lista, buscar por nome e trocar para "Cadastrados". Rodar o script em ensaio contra as fixtures apontando para a clínica de dev (`--clinica medica@medcheckin.test --saida /tmp`) e ler o relatório.
- [ ] **Step 3:** `backup.sh` + `restore-drill.sh` locais com o anexo criado (mesmas variáveis da Task 10) → `RESTORE DRILL OK` e `RESTORE DRILL anexos OK`.
- [ ] **Step 4:** `git diff --stat main..HEAD` só com arquivos da "Estrutura de arquivos"; `git status --short` só `?? docs/INVENTARIO_V1.md`.
- [ ] **Step 5:** Parar e reportar. Sem push nem PR até o dono pedir.
