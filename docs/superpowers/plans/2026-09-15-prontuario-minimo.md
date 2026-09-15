# E12.1 Prontuário mínimo — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A médica escreve uma nota clínica datada na página do paciente, registra condições num catálogo da clínica com CID-10 opcional, e vê uma linha do tempo que agrupa nota, ajuste de dose e conduta por dia.

**Architecture:** Migration 013 cria `clinical_notes`, `conditions` e `patient_conditions`, migra `patients.condition_tags` para as tabelas e remove a coluna. Três módulos novos no core (`conditions`, `notes`, `patients/timeline`) reaproveitam o padrão D34 (chave normalizada + unique por clínica + find-or-create em autocommit). A UI ganha o card Prontuário na aba "O caso", condições editáveis no cabeçalho, filtro na lista e uma tela de catálogo em Configurações.

**Tech Stack:** Node 22 ESM, Knex + Postgres (sem SQLite, D6), luxon, vitest (`packages/core`), Next.js 15 App Router + base-ui + Tailwind (`apps/web`), Playwright E2E contra build de produção.

**Spec:** `docs/superpowers/specs/2026-09-15-prontuario-minimo-design.md`

## Global Constraints

- Postgres real em todos os testes (`DATABASE_URL_TEST` ou `DATABASE_URL` do `.env` da raiz; local porta 5434, `docker compose up -d`). Nunca SQLite.
- **Gate do repo:** `npm run check` (lint + `prettier --check .` + typecheck + vitest) e `npm run test:e2e`. Rodar `npx prettier --write <arquivos tocados>` antes de cada commit. Lição do PR #42: o hook de pre-push roda `npm run check`.
- Textos de UI, mensagens de erro, comentários e commits em **português do Brasil**. Commits `tipo(escopo): mensagem`, terminando com `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Chave normalizada (`catalogNameKey`): NFD, remove `\p{M}`, minúsculas, espaços colapsados, `trim`. Nome exibido fica como digitado.
- Nome de condição: 2 a 120 caracteres. `cid10`: opcional, maiúsculo forçado, casa `^[A-Z][0-9]{2}(\.[0-9A-Z]{1,2})?$`. Corpo da nota: 1 a 20.000 caracteres após `trim`. `kind` da nota ∈ {`consulta`, `evolucao`, `contato`, `importada`}. `occurred_at` `AAAA-MM-DD`, não futura no fuso do paciente.
- Nota nunca é apagada: `deleted_at` oculta. Nota com `source` não nulo não se edita.
- Tenancy: `requirePatientInClinic` em tudo que recebe paciente; `conditions` sempre filtrada por `clinic_id`; outra clínica → `not_found`.
- Auditoria (`access_audit.route`): `notes.create`, `notes.update`, `notes.delete`, `notes.read`, `conditions.add`, `conditions.remove`, `conditions.merge`.
- Não fazer `git push` nem abrir PR sem o dono pedir. Branch `feat/prontuario-minimo` (já existe, spec commitada). Não adicionar ao git `docs/INVENTARIO_V1.md` (untracked, de outra sessão).

---

## Estrutura de arquivos

| Arquivo                                                                                                                                                                                            | Responsabilidade                                                                                                                   |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core/src/catalog/nameKey.js` (+ `.d.ts`)                                                                                                                                                 | `catalogNameKey` (única implementação) + alias `productNameKey`                                                                    |
| `packages/core/src/medications/nameKey.js` (+ `.d.ts`)                                                                                                                                             | vira re-export de `catalog/nameKey.js` (migration 012 e imports antigos continuam válidos)                                         |
| `packages/core/src/migrations/013_prontuario.js`                                                                                                                                                   | tabelas novas, backfill de `condition_tags`, remoção da coluna, `down` completo                                                    |
| `packages/core/src/conditions/index.js`                                                                                                                                                            | catálogo de condições e vínculos com paciente                                                                                      |
| `packages/core/src/notes/index.js`                                                                                                                                                                 | CRUD de notas clínicas                                                                                                             |
| `packages/core/src/patients/timeline.js`                                                                                                                                                           | linha do tempo agrupada por dia                                                                                                    |
| `packages/core/src/patients/index.js`                                                                                                                                                              | `createPatient` com `conditions`, `listPatients` com filtro e condições, `getPatientDetail` com `conditions`; sai `condition_tags` |
| `packages/core/src/report/patientReport.js`, `lgpd/export.js`, `lgpd/anonymize.js`, `seed/index.js`                                                                                                | condições e notas                                                                                                                  |
| `packages/core/src/index.js`, `index.d.ts`, `package.json`                                                                                                                                         | exports, tipos, subpath                                                                                                            |
| `packages/core/test/{conditions,notes,timeline}.test.js`; `migrations.test.js`, `services.test.js`                                                                                                 | testes                                                                                                                             |
| `apps/web/app/api/patients/[id]/{notes,notes/[noteId],timeline,conditions,conditions/[conditionId]}/route.ts`; `app/api/conditions/{route,[id]/route,merge/route}.ts`; `app/api/patients/route.ts` | rotas                                                                                                                              |
| `apps/web/components/medica/CatalogNameInput.tsx`                                                                                                                                                  | `ProductNameInput` generalizado (placeholder e testid por prop)                                                                    |
| `apps/web/components/medica/ProntuarioCard.tsx`                                                                                                                                                    | editor de nota + linha do tempo                                                                                                    |
| `apps/web/components/medica/PatientConditions.tsx`                                                                                                                                                 | badges + edição no cabeçalho                                                                                                       |
| `apps/web/components/medica/ConditionsFilter.tsx`                                                                                                                                                  | select de condição na lista                                                                                                        |
| `apps/web/components/medica/ConditionsTable.tsx`                                                                                                                                                   | catálogo: CID-10 inline e Fundir                                                                                                   |
| `apps/web/app/(medica)/pacientes/page.tsx`, `pacientes/[id]/page.tsx`, `pacientes/[id]/relatorio/page.tsx`, `configuracoes/page.tsx`, `configuracoes/condicoes/page.tsx`                           | telas                                                                                                                              |
| `apps/web/components/medica/{MedicationsCard,NewPatientForm}.tsx`                                                                                                                                  | passam a usar `CatalogNameInput`; `NewPatientForm` envia `conditions`                                                              |
| `apps/web/e2e/prontuario.spec.ts`, `condicoes.spec.ts`; `medica.spec.ts`                                                                                                                           | E2E                                                                                                                                |
| `docs/LGPD.md`, `docs/MANUAL_MEDICA.md`, `DECISOES.md`, `PLANO.md`, `tasks/todo.md`                                                                                                                | docs                                                                                                                               |

---

### Task 1: `catalogNameKey` — módulo genérico e alias

**Files:**

- Create: `packages/core/src/catalog/nameKey.js`, `packages/core/src/catalog/nameKey.d.ts`
- Modify: `packages/core/src/medications/nameKey.js` (vira re-export), `packages/core/src/medications/nameKey.d.ts`, `packages/core/package.json` (subpath `./name-key`), `packages/core/src/index.js` (linha `export { productNameKey } from './medications/nameKey.js';`), `packages/core/src/index.d.ts` (declaração de `productNameKey`)
- Test: `packages/core/test/name-key.test.js` (acrescentar 1 caso)

**Interfaces:**

- Produces: `catalogNameKey(name: unknown): string` e `productNameKey` (mesma função) exportadas de `@medcheckin/core` e de `@medcheckin/core/name-key`.

- [ ] **Step 1: Teste que falha**

Acrescentar ao fim do `describe` em `packages/core/test/name-key.test.js`:

```js
it('catalogNameKey é a mesma função, exportada do módulo genérico e pelo alias antigo', async () => {
  const { catalogNameKey, productNameKey: alias } = await import('../src/catalog/nameKey.js');
  expect(catalogNameKey('  Epilepsia  Refratária ')).toBe('epilepsia refrataria');
  expect(alias).toBe(catalogNameKey);
  expect(productNameKey).toBe(catalogNameKey);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -w @medcheckin/core -- test/name-key.test.js`
Expected: FAIL — `Cannot find module '../src/catalog/nameKey.js'`

- [ ] **Step 3: Implementar**

```js
// packages/core/src/catalog/nameKey.js
/**
 * D34/D36 — chave de identidade de um item de catálogo da clínica (produto, condição).
 *
 * O nome exibido fica como a médica digitou; esta chave é o que o índice único compara.
 * Módulo puro (sem knex, sem imports) de propósito: migrations e o cliente web importam
 * daqui, e a normalização tem que ser idêntica em todos os lugares.
 */
export function catalogNameKey(name) {
  if (typeof name !== 'string') return '';
  return name
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Nome antigo (E4/D34). Mantido para a migration 012 e para quem já importava. */
export const productNameKey = catalogNameKey;
```

```ts
// packages/core/src/catalog/nameKey.d.ts
export function catalogNameKey(name: unknown): string;
export const productNameKey: typeof catalogNameKey;
```

Substituir o conteúdo de `packages/core/src/medications/nameKey.js` por:

```js
// Movido para ../catalog/nameKey.js (D36: produtos e condições usam a mesma chave).
export { catalogNameKey, productNameKey } from '../catalog/nameKey.js';
```

e `packages/core/src/medications/nameKey.d.ts` por:

```ts
export { catalogNameKey, productNameKey } from '../catalog/nameKey.js';
```

Em `packages/core/package.json`, o subpath `./name-key` passa a apontar para o módulo genérico:

```json
    "./name-key": {
      "types": "./src/catalog/nameKey.d.ts",
      "default": "./src/catalog/nameKey.js"
    }
```

Em `packages/core/src/index.js`, trocar a linha `export { productNameKey } from './medications/nameKey.js';` por:

```js
export { catalogNameKey, productNameKey } from './catalog/nameKey.js';
```

Em `packages/core/src/index.d.ts`, logo após `export function productNameKey(name: unknown): string;`, acrescentar:

```ts
export function catalogNameKey(name: unknown): string;
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test -w @medcheckin/core -- test/name-key.test.js test/medications-by-name.test.js test/migrations.test.js`
Expected: PASS (a 012 continua importando `productNameKey` de `../medications/nameKey.js`, que agora re-exporta).

- [ ] **Step 5: Prettier + commit**

```bash
npx prettier --write packages/core/src/catalog packages/core/src/medications/nameKey.js packages/core/src/medications/nameKey.d.ts packages/core/package.json packages/core/src/index.js packages/core/src/index.d.ts packages/core/test/name-key.test.js
git add packages/core/src/catalog packages/core/src/medications/nameKey.js packages/core/src/medications/nameKey.d.ts packages/core/package.json packages/core/src/index.js packages/core/src/index.d.ts packages/core/test/name-key.test.js
git commit -m "refactor(core): catalogNameKey — chave de catálogo genérica; productNameKey vira alias (D36)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Migration 013 — tabelas do prontuário e backfill de `condition_tags`

**Files:**

- Create: `packages/core/src/migrations/013_prontuario.js`
- Modify: `packages/core/src/seed/index.js` (dois inserts de pacientes + `TABLES_IN_DELETE_ORDER` + `counts`)
- Test: `packages/core/test/migrations.test.js` (novo `it`)

**Interfaces:**

- Consumes: `catalogNameKey` de `../catalog/nameKey.js`.
- Produces: tabelas `clinical_notes`, `conditions` (unique `(clinic_id, name_key)`), `patient_conditions` (pk `(patient_id, condition_id)`); coluna `patients.condition_tags` **não existe mais**.

- [ ] **Step 1: Teste que falha**

Acrescentar ao fim do `describe` em `packages/core/test/migrations.test.js`:

```js
/**
 * D36 — a 013 leva `patients.condition_tags` para o catálogo da clínica sem perder nada, e o
 * `down` reconstrói a lista a partir dos vínculos.
 */
it('013: condition_tags vira conditions + patient_conditions; down reconstrói a coluna', async () => {
  await db.raw('drop schema public cascade; create schema public');
  const [, pendentes] = await db.migrate.list(migrationConfig);
  for (let i = 0; i < pendentes.length - 1; i += 1) await db.migrate.up(migrationConfig);
  expect(await db.schema.hasColumn('patients', 'condition_tags')).toBe(true);
  expect(await db.schema.hasTable('conditions')).toBe(false);

  const [clinic] = await db('clinics').insert({ name: 'Clínica 013' }).returning('id');
  const [user] = await db('users')
    .insert({ clinic_id: clinic.id, role: 'doctor', email: 'dra-013@example.test', name: 'Dra.' })
    .returning('id');
  const [a] = await db('patients')
    .insert({
      clinic_id: clinic.id,
      name: 'A',
      timezone: 'America/Cuiaba',
      created_by: user.id,
      condition_tags: ['epilepsia', 'Ansiedade'],
    })
    .returning('id');
  const [b] = await db('patients')
    .insert({
      clinic_id: clinic.id,
      name: 'B',
      timezone: 'America/Cuiaba',
      created_by: user.id,
      condition_tags: ['ansiedade'],
    })
    .returning('id');

  await db.migrate.up(migrationConfig);
  expect(await db.schema.hasColumn('patients', 'condition_tags')).toBe(false);
  const conds = await db('conditions').where({ clinic_id: clinic.id }).orderBy('name_key');
  // "Ansiedade" e "ansiedade" caem na MESMA chave → uma condição só, dois vínculos
  expect(conds.map((c) => c.name_key)).toEqual(['ansiedade', 'epilepsia']);
  const links = await db('patient_conditions').whereIn('patient_id', [a.id, b.id]);
  expect(links).toHaveLength(3);

  await db.migrate.down(migrationConfig);
  expect(await db.schema.hasTable('conditions')).toBe(false);
  const pa = await db('patients').where({ id: a.id }).first();
  const pb = await db('patients').where({ id: b.id }).first();
  expect([...pa.condition_tags].sort()).toEqual(['ansiedade', 'epilepsia']);
  expect(pb.condition_tags).toEqual(['ansiedade']);
  await db.migrate.up(migrationConfig);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -w @medcheckin/core -- test/migrations.test.js`
Expected: FAIL — o último `migrate.up` não muda nada (013 não existe) e `hasColumn('patients','condition_tags')` continua `true`.

- [ ] **Step 3: Migration**

```js
// packages/core/src/migrations/013_prontuario.js
import { catalogNameKey } from '../catalog/nameKey.js';

/**
 * E12.1 — prontuário mínimo.
 *
 * D35: `clinical_notes` é texto livre datado, nunca apagado (`deleted_at` oculta). `source`
 * fica nulo aqui; a E12.3 grava { file, page, excerpt } quando a nota vier de importação.
 *
 * D36: `patients.condition_tags` (lista solta por paciente) vira catálogo da clínica com a mesma
 * chave normalizada dos produtos (D34) e CID-10 opcional. Backfill em JS com a MESMA função do
 * runtime; tags que caem na mesma chave viram UMA condição (é o objetivo: "Ansiedade" e
 * "ansiedade" nunca deveriam ter sido duas). Depois a coluna sai.
 */
const ID = (t, knex) => t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
const TS = (t, knex) => {
  t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
};

export async function up(knex) {
  await knex.schema.createTable('clinical_notes', (t) => {
    ID(t, knex);
    t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
    t.text('kind').notNullable().defaultTo('consulta');
    t.check("kind in ('consulta', 'evolucao', 'contato', 'importada')", [], 'chk_note_kind');
    t.date('occurred_at').notNullable();
    t.text('body').notNullable();
    t.jsonb('source');
    t.uuid('created_by').notNullable().references('id').inTable('users').onDelete('RESTRICT');
    t.timestamp('deleted_at', { useTz: true });
    TS(t, knex);
    t.index(['patient_id', 'occurred_at']);
  });

  await knex.schema.createTable('conditions', (t) => {
    ID(t, knex);
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.text('name').notNullable();
    t.text('name_key').notNullable();
    t.text('cid10');
    TS(t, knex);
    t.unique(['clinic_id', 'name_key']);
  });

  await knex.schema.createTable('patient_conditions', (t) => {
    t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
    t.uuid('condition_id')
      .notNullable()
      .references('id')
      .inTable('conditions')
      .onDelete('RESTRICT');
    t.date('noted_at');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.primary(['patient_id', 'condition_id']);
    t.index(['condition_id']);
  });

  const patients = await knex('patients').select('id', 'clinic_id', 'condition_tags');
  const byKey = new Map(); // `${clinic}|${key}` -> condition id
  for (const p of patients) {
    for (const raw of p.condition_tags ?? []) {
      const name = String(raw).trim();
      const key = catalogNameKey(name);
      if (!key) continue;
      const k = `${p.clinic_id}|${key}`;
      let id = byKey.get(k);
      if (!id) {
        const [row] = await knex('conditions')
          .insert({ clinic_id: p.clinic_id, name, name_key: key })
          .returning('id');
        id = row.id;
        byKey.set(k, id);
      }
      await knex('patient_conditions')
        .insert({ patient_id: p.id, condition_id: id })
        .onConflict(['patient_id', 'condition_id'])
        .ignore();
    }
  }

  await knex.schema.alterTable('patients', (t) => {
    t.dropColumn('condition_tags');
  });
}

export async function down(knex) {
  await knex.schema.alterTable('patients', (t) => {
    t.specificType('condition_tags', 'text[]').notNullable().defaultTo('{}');
  });
  await knex.raw(`
    update patients p set condition_tags = coalesce(
      (select array_agg(c.name order by c.name)
         from patient_conditions pc join conditions c on c.id = pc.condition_id
        where pc.patient_id = p.id),
      '{}')
  `);
  await knex.schema.dropTable('patient_conditions');
  await knex.schema.dropTable('conditions');
  await knex.schema.dropTable('clinical_notes');
}
```

- [ ] **Step 4: Seed**

Em `packages/core/src/seed/index.js`: importar no topo `import { catalogNameKey } from '../catalog/nameKey.js';`. Nos dois inserts de pacientes (por volta das linhas 158 e 228) **remover** a linha `condition_tags: [...]`. Logo após cada insert (depois do `.returning('id')` de `p1` e de `p2`), acrescentar:

```js
await seedCondition(trx, clinic.id, p1.id, 'dor_cronica');
```

e

```js
await seedCondition(trx, clinic.id, p2.id, 'epilepsia');
```

e definir no fim do arquivo, antes de `async function counts(trx)`:

```js
/** D36: condição no catálogo da clínica + vínculo com o paciente. */
async function seedCondition(trx, clinicId, patientId, name) {
  const [c] = await trx('conditions')
    .insert({ clinic_id: clinicId, name, name_key: catalogNameKey(name) })
    .onConflict(['clinic_id', 'name_key'])
    .merge({ updated_at: trx.fn.now() })
    .returning('id');
  await trx('patient_conditions')
    .insert({ patient_id: patientId, condition_id: c.id })
    .onConflict(['patient_id', 'condition_id'])
    .ignore();
}
```

Em `TABLES_IN_DELETE_ORDER`, inserir `'clinical_notes'` e `'patient_conditions'` logo após `'access_audit'`, e `'conditions'` logo antes de `'patients'`. Em `counts`, acrescentar `'conditions'` e `'clinical_notes'` à lista.

- [ ] **Step 5: Rodar a suíte do core**

Run: `npm test -w @medcheckin/core`
Expected: `migrations.test.js` e `seed.test.js` verdes. **Vão falhar** `services.test.js` (usa `condition_tags` em `createPatient`/`updatePatient`) e possivelmente `lgpd.test.js`/report — isso é esperado e a Task 3 corrige. Anotar no report exatamente quais arquivos falharam.

- [ ] **Step 6: Prettier + commit**

```bash
npx prettier --write packages/core/src/migrations/013_prontuario.js packages/core/src/seed/index.js packages/core/test/migrations.test.js
git add packages/core/src/migrations/013_prontuario.js packages/core/src/seed/index.js packages/core/test/migrations.test.js
git commit -m "feat(core): migration 013 — clinical_notes, conditions e patient_conditions; condition_tags migra para o catálogo (D35, D36)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Core — módulo `conditions` e integração em pacientes, relatório, export e anonimização

**Files:**

- Create: `packages/core/src/conditions/index.js`
- Modify: `packages/core/src/patients/index.js` (remover `cleanTags` e a linha de `condition_tags` em `patientPatch`; `createPatient`, `listPatients`, `getPatientDetail`), `packages/core/src/report/patientReport.js:164`, `packages/core/src/lgpd/export.js`, `packages/core/src/lgpd/anonymize.js`, `packages/core/src/index.js`, `packages/core/src/index.d.ts`
- Test: `packages/core/test/conditions.test.js` (novo), `packages/core/test/services.test.js:56,153,158`

**Interfaces:**

- Consumes: tabelas da Task 2; `catalogNameKey`.
- Produces:
  - `findOrCreateCondition(db, session, { name, cid10? }) → { condition: ConditionRow, created: boolean }`
  - `listConditions(db, clinicId) → Array<ConditionRow & { patients: number }>`
  - `updateCondition(db, session, conditionId, { name?, cid10? }, now) → ConditionRow`
  - `mergeConditions(db, session, { from_id, into_id }, now) → { into: ConditionRow, moved: number }`
  - `addPatientCondition(db, session, patientId, { name? , condition_id?, noted_at? }, now) → ConditionRow`
  - `removePatientCondition(db, session, patientId, conditionId, now) → void`
  - `listPatientConditions(db, patientId) → Array<{ id, name, cid10, noted_at }>`
  - `createPatient` aceita `conditions: string[] | string`; `listPatients(db, { clinicId, condition? }, now)` devolve `conditions` por paciente; `getPatientDetail` devolve `conditions`.

- [ ] **Step 1: Teste que falha**

```js
// packages/core/test/conditions.test.js
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { freshDb, seedClinic, seedPatient } from './helpers/db.js';
import {
  findOrCreateCondition,
  listConditions,
  updateCondition,
  mergeConditions,
  addPatientCondition,
  removePatientCondition,
  listPatientConditions,
} from '../src/conditions/index.js';
import { createPatient, listPatients, getPatientDetail } from '../src/patients/index.js';

// D36: condições em catálogo da clínica pelo padrão D34; CID-10 opcional; fusão como correção.
describe('condições (catálogo da clínica)', () => {
  let db, ctx, session, p1, p2;
  const NOW = new Date('2026-09-15T12:00:00Z');
  beforeAll(async () => {
    db = await freshDb();
    ctx = await seedClinic(db, 'cond');
    session = {
      kind: 'user',
      sessionId: 't',
      userId: ctx.userId,
      clinicId: ctx.clinicId,
      role: 'doctor',
      name: 'Dra.',
      email: 'dra-cond@example.test',
    };
    p1 = await seedPatient(db, ctx, 'Um');
    p2 = await seedPatient(db, ctx, 'Dois');
  });
  afterAll(async () => db.destroy());

  it('nome novo cria; caixa/acento diferentes reaproveitam; cid10 opcional e validado', async () => {
    const a = await findOrCreateCondition(db, session, { name: '  Epilepsia  Refratária ' });
    expect(a.created).toBe(true);
    expect(a.condition.name).toBe('Epilepsia Refratária');
    expect(a.condition.name_key).toBe('epilepsia refrataria');
    expect(a.condition.cid10).toBeNull();
    const b = await findOrCreateCondition(db, session, {
      name: 'EPILEPSIA REFRATARIA',
      cid10: 'g40.9',
    });
    expect(b.created).toBe(false);
    expect(b.condition.id).toBe(a.condition.id);
    await expect(findOrCreateCondition(db, session, { name: 'x' })).rejects.toMatchObject({
      code: 'validation',
      field: 'name',
    });
    await expect(
      findOrCreateCondition(db, session, { name: 'Asma', cid10: 'banana' }),
    ).rejects.toMatchObject({ code: 'validation', field: 'cid10' });
    const c = await findOrCreateCondition(db, session, { name: 'Asma', cid10: ' j45 ' });
    expect(c.condition.cid10).toBe('J45');
  });

  it('corrida: duas criações em paralelo do mesmo nome geram uma condição', async () => {
    const [x, y] = await Promise.all([
      findOrCreateCondition(db, session, { name: 'Ansiedade generalizada' }),
      findOrCreateCondition(db, session, { name: 'ansiedade GENERALIZADA' }),
    ]);
    expect(x.condition.id).toBe(y.condition.id);
    const n = await db('conditions')
      .where({ clinic_id: ctx.clinicId, name_key: 'ansiedade generalizada' })
      .count()
      .first();
    expect(Number(n.count)).toBe(1);
  });

  it('vincula ao paciente por nome ou id, idempotente; remove; lista', async () => {
    const c1 = await addPatientCondition(
      db,
      session,
      p1,
      { name: 'Autismo', noted_at: '2026-01-10' },
      NOW,
    );
    const again = await addPatientCondition(db, session, p1, { condition_id: c1.id }, NOW);
    expect(again.id).toBe(c1.id);
    const list = await listPatientConditions(db, p1);
    expect(list.map((c) => c.name)).toEqual(['Autismo']);
    expect(String(list[0].noted_at).slice(0, 10)).toBe('2026-01-10');
    await removePatientCondition(db, session, p1, c1.id, NOW);
    expect(await listPatientConditions(db, p1)).toEqual([]);
    const audit = await db('access_audit')
      .where({ patient_id: p1 })
      .whereIn('route', ['conditions.add', 'conditions.remove']);
    expect(audit).toHaveLength(3);
  });

  it('condição de outra clínica é not_found; id inexistente também', async () => {
    const outra = await seedClinic(db, 'outra-cond');
    const { condition } = await findOrCreateCondition(
      db,
      { ...session, clinicId: outra.clinicId, userId: outra.userId },
      { name: 'Da outra' },
    );
    await expect(
      addPatientCondition(db, session, p1, { condition_id: condition.id }, NOW),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      updateCondition(db, session, condition.id, { cid10: 'F41' }, NOW),
    ).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('updateCondition muda nome/cid10 e recusa colisão de chave', async () => {
    const { condition: tea } = await findOrCreateCondition(db, session, { name: 'TEA' });
    const { condition: aut } = await findOrCreateCondition(db, session, { name: 'Autismo' });
    const up = await updateCondition(db, session, tea.id, { cid10: 'f84.0' }, NOW);
    expect(up.cid10).toBe('F84.0');
    await expect(
      updateCondition(db, session, tea.id, { name: 'autismo' }, NOW),
    ).rejects.toMatchObject({
      code: 'validation',
      field: 'name',
    });
    expect(aut.id).not.toBe(tea.id);
  });

  it('mergeConditions move vínculos sem duplicar, apaga a origem e conta pacientes', async () => {
    const { condition: tea } = await findOrCreateCondition(db, session, { name: 'TEA' });
    const { condition: aut } = await findOrCreateCondition(db, session, { name: 'Autismo' });
    await addPatientCondition(db, session, p1, { condition_id: tea.id }, NOW);
    await addPatientCondition(db, session, p1, { condition_id: aut.id }, NOW); // já tem o destino
    await addPatientCondition(db, session, p2, { condition_id: tea.id }, NOW);
    const out = await mergeConditions(db, session, { from_id: tea.id, into_id: aut.id }, NOW);
    expect(out.moved).toBe(1); // p2; p1 já tinha Autismo
    expect(await db('conditions').where({ id: tea.id }).first()).toBeUndefined();
    const all = await listConditions(db, ctx.clinicId);
    const autRow = all.find((c) => c.id === aut.id);
    expect(autRow.patients).toBe(2);
    await expect(
      mergeConditions(db, session, { from_id: aut.id, into_id: aut.id }, NOW),
    ).rejects.toMatchObject({
      code: 'validation',
    });
    const audit = await db('access_audit').where({ route: 'conditions.merge' });
    expect(audit).toHaveLength(1);
    expect(audit[0].patient_id).toBeNull();
  });

  it('createPatient aceita conditions (nomes); detail e lista trazem conditions; lista filtra', async () => {
    const { patient } = await createPatient(
      db,
      session,
      {
        name: 'Paciente Cond',
        conditions: ['Dor crônica', ' dor CRÔNICA ', 'Insônia'],
        consent_version: 'v1',
      },
      NOW,
    );
    const detail = await getPatientDetail(db, session, patient.id, { now: NOW });
    expect(detail.conditions.map((c) => c.name)).toEqual(['Dor crônica', 'Insônia']);
    expect(detail.patient.condition_tags).toBeUndefined();
    const dor = detail.conditions[0];
    const filtrada = await listPatients(db, { clinicId: ctx.clinicId, condition: dor.id }, NOW);
    expect(filtrada.map((p) => p.id)).toEqual([patient.id]);
    const todas = await listPatients(db, { clinicId: ctx.clinicId }, NOW);
    const row = todas.find((p) => p.id === patient.id);
    expect(row.conditions.map((c) => c.name)).toEqual(['Dor crônica', 'Insônia']);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -w @medcheckin/core -- test/conditions.test.js`
Expected: FAIL — `Cannot find module '../src/conditions/index.js'`.

- [ ] **Step 3: Módulo `conditions`**

```js
// packages/core/src/conditions/index.js
import { AuthError } from '../auth/tokens.js';
import { requirePatientInClinic, logAccess } from '../auth/access.js';
import { ValidationError } from '../errors.js';
import { catalogNameKey } from '../catalog/nameKey.js';

const NAME_MIN = 2;
const NAME_MAX = 120;
const CID10 = /^[A-Z][0-9]{2}(\.[0-9A-Z]{1,2})?$/;

function requireDoctor(session) {
  if (!session || session.kind !== 'user')
    throw new AuthError('unauthenticated', 'Sessão da clínica necessária.');
}

function cleanName(raw) {
  const name = String(raw ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (name.length < NAME_MIN) throw new ValidationError('Nome da condição é obrigatório.', 'name');
  if (name.length > NAME_MAX)
    throw new ValidationError(`Nome da condição muito longo (máx. ${NAME_MAX}).`, 'name');
  return name;
}

/** CID-10 é opcional; quando vem, só o formato é validado (ex.: F41.1, G40). */
function cleanCid10(raw) {
  if (raw === undefined || raw === null) return null;
  const cid = String(raw).trim().toUpperCase();
  if (!cid) return null;
  if (!CID10.test(cid)) throw new ValidationError('CID-10 inválido (ex.: F41.1).', 'cid10');
  return cid;
}

function cleanDay(raw, field) {
  if (raw === undefined || raw === null || raw === '') return null;
  const d = String(raw).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d))
    throw new ValidationError('Data inválida (AAAA-MM-DD).', field);
  return d;
}

async function conditionInClinic(db, session, conditionId) {
  const c = await db('conditions').where({ id: conditionId, clinic_id: session.clinicId }).first();
  if (!c) throw new AuthError('not_found', 'Condição não encontrada.');
  return c;
}

/**
 * D36 — acha ou cria a condição pela chave normalizada (mesmo padrão de findOrCreateProduct, D34).
 * Autocommit de propósito: um 23505 dentro de transação a abortaria. Quem perde a corrida relê.
 * `cid10` só é gravado na criação; para trocar, `updateCondition`.
 */
export async function findOrCreateCondition(db, session, input) {
  requireDoctor(session);
  const name = cleanName(input?.name);
  const cid10 = cleanCid10(input?.cid10);
  const where = { clinic_id: session.clinicId, name_key: catalogNameKey(name) };
  const existing = await db('conditions').where(where).first();
  if (existing) return { condition: existing, created: false };
  try {
    const [row] = await db('conditions')
      .insert({ ...where, name, cid10 })
      .returning('*');
    return { condition: row, created: true };
  } catch (err) {
    if (err?.code !== '23505') throw err;
    const again = await db('conditions').where(where).first();
    if (!again) throw err;
    return { condition: again, created: false };
  }
}

/** Catálogo da clínica com o nº de pacientes vinculados. */
export async function listConditions(db, clinicId) {
  const rows = await db('conditions as c')
    .leftJoin('patient_conditions as pc', 'pc.condition_id', 'c.id')
    .where('c.clinic_id', clinicId)
    .groupBy('c.id')
    .orderBy('c.name')
    .select('c.*')
    .count('pc.patient_id as patients');
  return rows.map((r) => ({ ...r, patients: Number(r.patients) }));
}

export async function updateCondition(db, session, conditionId, input, now) {
  requireDoctor(session);
  await conditionInClinic(db, session, conditionId);
  const patch = {};
  if (Object.hasOwn(input ?? {}, 'name')) {
    patch.name = cleanName(input.name);
    patch.name_key = catalogNameKey(patch.name);
  }
  if (Object.hasOwn(input ?? {}, 'cid10')) patch.cid10 = cleanCid10(input.cid10);
  if (!Object.keys(patch).length) throw new ValidationError('Nada para atualizar.');
  try {
    const [row] = await db('conditions')
      .where({ id: conditionId })
      .update({ ...patch, updated_at: db.fn.now() })
      .returning('*');
    await logAccess(db, { session, route: 'conditions.update', action: 'update' }, now);
    return row;
  } catch (err) {
    if (err?.code === '23505')
      throw new ValidationError('Já existe uma condição com esse nome. Use Fundir.', 'name');
    throw err;
  }
}

/**
 * Fundir `from` em `into`: vínculos migram (quem já tinha o destino não duplica), a origem some.
 * É o único jeito de corrigir duplicata que escapou da chave (ex.: "TEA" e "Autismo").
 */
export async function mergeConditions(db, session, { from_id, into_id }, now) {
  requireDoctor(session);
  if (!from_id || !into_id || from_id === into_id)
    throw new ValidationError('Escolha duas condições diferentes para fundir.', 'into_id');
  const from = await conditionInClinic(db, session, from_id);
  const into = await conditionInClinic(db, session, into_id);
  return db.transaction(async (trx) => {
    const jaTem = trx('patient_conditions').select('patient_id').where({ condition_id: into.id });
    const moved = await trx('patient_conditions')
      .where({ condition_id: from.id })
      .whereNotIn('patient_id', jaTem)
      .update({ condition_id: into.id });
    await trx('patient_conditions').where({ condition_id: from.id }).del();
    await trx('conditions').where({ id: from.id }).del();
    await logAccess(
      trx,
      {
        session,
        route: `conditions.merge:${from.name_key}>${into.name_key}`.slice(0, 200),
        action: 'update',
      },
      now,
    );
    return { into, moved };
  });
}

/** Vincula por `condition_id` (existente na clínica) ou por `name` (acha ou cria). Idempotente. */
export async function addPatientCondition(db, session, patientId, input, now) {
  requireDoctor(session);
  await requirePatientInClinic(db, session, patientId);
  let condition;
  if (input?.condition_id) condition = await conditionInClinic(db, session, input.condition_id);
  else ({ condition } = await findOrCreateCondition(db, session, { name: input?.name }));
  const noted_at = cleanDay(input?.noted_at, 'noted_at');
  await db('patient_conditions')
    .insert({ patient_id: patientId, condition_id: condition.id, noted_at })
    .onConflict(['patient_id', 'condition_id'])
    .ignore();
  await logAccess(db, { session, patientId, route: 'conditions.add', action: 'update' }, now);
  return condition;
}

export async function removePatientCondition(db, session, patientId, conditionId, now) {
  requireDoctor(session);
  await requirePatientInClinic(db, session, patientId);
  await db('patient_conditions').where({ patient_id: patientId, condition_id: conditionId }).del();
  await logAccess(db, { session, patientId, route: 'conditions.remove', action: 'update' }, now);
}

/** Condições de um paciente, em ordem alfabética. Sem audit: é chamada por quem já auditou. */
export async function listPatientConditions(db, patientId) {
  return db('patient_conditions as pc')
    .join('conditions as c', 'c.id', 'pc.condition_id')
    .where('pc.patient_id', patientId)
    .orderBy('c.name')
    .select('c.id', 'c.name', 'c.cid10', 'pc.noted_at');
}

/** Mapa patient_id → condições, para listas. */
export async function conditionsByPatient(db, patientIds) {
  const out = new Map();
  if (!patientIds.length) return out;
  const rows = await db('patient_conditions as pc')
    .join('conditions as c', 'c.id', 'pc.condition_id')
    .whereIn('pc.patient_id', patientIds)
    .orderBy('c.name')
    .select('pc.patient_id', 'c.id', 'c.name', 'c.cid10');
  for (const r of rows) {
    if (!out.has(r.patient_id)) out.set(r.patient_id, []);
    out.get(r.patient_id).push({ id: r.id, name: r.name, cid10: r.cid10 });
  }
  return out;
}
```

- [ ] **Step 4: Integração em `patients/index.js`**

No topo, acrescentar:

```js
import {
  findOrCreateCondition,
  listPatientConditions,
  conditionsByPatient,
} from '../conditions/index.js';
```

Remover a função `cleanTags` (linhas 26-30) e a linha `if (has('condition_tags')) patch.condition_tags = cleanTags(input.condition_tags);` de `patientPatch`.

Em `createPatient`, antes do `return db.transaction(...)`, resolver as condições fora da transação (find-or-create é autocommit por desenho):

```js
const conditionNames = Array.isArray(input?.conditions)
  ? input.conditions
  : String(input?.conditions ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
const conditionIds = [];
for (const name of conditionNames) {
  const { condition } = await findOrCreateCondition(db, session, { name });
  if (!conditionIds.includes(condition.id)) conditionIds.push(condition.id);
}
```

e dentro da transação, logo após o insert de `respondents`:

```js
if (conditionIds.length)
  await trx('patient_conditions').insert(
    conditionIds.map((condition_id) => ({ patient_id: patient.id, condition_id })),
  );
```

Em `listPatients`, a assinatura vira `export async function listPatients(db, { clinicId, condition = null }, now)` e a primeira consulta:

```js
let q = db('patients as p').where('p.clinic_id', clinicId).orderBy('p.name').select('p.*');
if (condition)
  q = q.whereExists(
    db('patient_conditions as pc')
      .whereRaw('pc.patient_id = p.id')
      .andWhere('pc.condition_id', condition),
  );
const patients = await q;
```

Depois de `const meds = await medicationsWithDose(db, ids, now);` acrescentar `const conds = await conditionsByPatient(db, ids);` e, no objeto devolvido por paciente, `conditions: conds.get(p.id) ?? [],`.

Em `getPatientDetail`, antes do `logAccess`, `const conditions = await listPatientConditions(db, patientId);` e incluir `conditions,` no objeto devolvido.

- [ ] **Step 5: Relatório, export, anonimização, seed de teste**

`packages/core/src/report/patientReport.js`: importar `listPatientConditions` de `../conditions/index.js`; antes do `return`, `const conditions = await listPatientConditions(db, patientId);`; no bloco `patient`, trocar `condition_tags: patient.condition_tags,` por `conditions: conditions.map((c) => (c.cid10 ? `${c.name} (${c.cid10})` : c.name)),`.

`packages/core/src/lgpd/export.js`: após `const audit = ...`, acrescentar:

```js
const conditions = await db('patient_conditions as pc')
  .join('conditions as c', 'c.id', 'pc.condition_id')
  .where('pc.patient_id', patientId)
  .orderBy('c.name')
  .select('c.id', 'c.name', 'c.cid10', 'pc.noted_at', 'pc.created_at');
```

e `'conditions.json': conditions,` em `files`, `conditions: conditions.length,` em `counts`. (As notas entram na Task 4.)

`packages/core/src/lgpd/anonymize.js`: dentro da transação, após o bloco de `routine_periods`:

```js
// D36: condição é dado clínico, mas ligada a uma identidade que o titular pediu para apagar;
// o vínculo sai, o catálogo da clínica fica.
await trx('patient_conditions').where({ patient_id: patientId }).del();
```

`packages/core/test/services.test.js`: linha 56 `condition_tags: ['epilepsia', 'tea'],` → `conditions: ['epilepsia', 'tea'],`; linha 153 remover `condition_tags: ['dor']` do patch de `updatePatient`; linha 158 trocar `expect(p.condition_tags).toEqual(['dor']);` por `expect(p.condition_tags).toBeUndefined();`. Se o teste de `createPatient` nesse arquivo verificar `condition_tags` no retorno, trocar pela consulta `listPatientConditions`.

- [ ] **Step 6: Exports e tipos**

`packages/core/src/index.js`: acrescentar

```js
export {
  findOrCreateCondition,
  listConditions,
  updateCondition,
  mergeConditions,
  addPatientCondition,
  removePatientCondition,
  listPatientConditions,
} from './conditions/index.js';
```

`packages/core/src/index.d.ts`: remover `condition_tags: string[];` de `PatientRow` (linha 484) e da interface da linha ~1002 (relatório: trocar por `conditions: string[];`); em `PatientInput` trocar `condition_tags?: string[] | string;` por `conditions?: string[] | string;`; acrescentar:

```ts
export interface ConditionRow {
  id: string;
  clinic_id: string;
  name: string;
  name_key: string;
  cid10: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}
export interface PatientCondition {
  id: string;
  name: string;
  cid10: string | null;
  noted_at?: Date | string | null;
}
export function findOrCreateCondition(
  db: Knex,
  session: Session,
  input: { name: string; cid10?: string | null },
): Promise<{ condition: ConditionRow; created: boolean }>;
export function listConditions(
  db: Knex,
  clinicId: string,
): Promise<Array<ConditionRow & { patients: number }>>;
export function updateCondition(
  db: Knex,
  session: Session,
  conditionId: string,
  input: { name?: string; cid10?: string | null },
  now?: Instant,
): Promise<ConditionRow>;
export function mergeConditions(
  db: Knex,
  session: Session,
  input: { from_id: string; into_id: string },
  now?: Instant,
): Promise<{ into: ConditionRow; moved: number }>;
export function addPatientCondition(
  db: Knex,
  session: Session,
  patientId: string,
  input: { name?: string; condition_id?: string; noted_at?: string | null },
  now?: Instant,
): Promise<ConditionRow>;
export function removePatientCondition(
  db: Knex,
  session: Session,
  patientId: string,
  conditionId: string,
  now?: Instant,
): Promise<void>;
export function listPatientConditions(db: Knex, patientId: string): Promise<PatientCondition[]>;
```

Em `PatientDetail` acrescentar `conditions: PatientCondition[];`. Na assinatura de `listPatients`, o segundo parâmetro vira `{ clinicId: string; condition?: string | null }` e o item devolvido ganha `conditions: PatientCondition[]`.

- [ ] **Step 7: Rodar a suíte do core**

Run: `npm test -w @medcheckin/core`
Expected: tudo verde, inclusive `services.test.js`, `lgpd.test.js`, `conditions.test.js`.

- [ ] **Step 8: Prettier + commit**

```bash
npx prettier --write packages/core/src packages/core/test
git add packages/core/src/conditions packages/core/src/patients/index.js packages/core/src/report/patientReport.js packages/core/src/lgpd packages/core/src/index.js packages/core/src/index.d.ts packages/core/test/conditions.test.js packages/core/test/services.test.js
git commit -m "feat(core): condições em catálogo da clínica — find-or-create, vínculo, fusão, filtro e export (D36)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Core — módulo `notes` (CRUD, ocultar, export, anonimização)

**Files:**

- Create: `packages/core/src/notes/index.js`
- Modify: `packages/core/src/lgpd/export.js`, `packages/core/src/lgpd/anonymize.js`, `packages/core/src/index.js`, `packages/core/src/index.d.ts`
- Test: `packages/core/test/notes.test.js`

**Interfaces:**

- Consumes: `localDate` de `../time.js`; tabela `clinical_notes`.
- Produces: `createNote(db, session, patientId, { kind?, occurred_at?, body }, now) → ClinicalNoteRow`; `updateNote(db, session, noteId, { kind?, occurred_at?, body? }, now) → ClinicalNoteRow`; `deleteNote(db, session, noteId, now) → ClinicalNoteRow`; `listNotes(db, session, patientId, { includeDeleted? }) → ClinicalNoteRow[]`; `noteDay(row) → 'AAAA-MM-DD'`.

- [ ] **Step 1: Teste que falha**

```js
// packages/core/test/notes.test.js
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { freshDb, seedClinic, seedPatient } from './helpers/db.js';
import { createNote, updateNote, deleteNote, listNotes } from '../src/notes/index.js';
import { exportPatientData } from '../src/lgpd/export.js';
import { anonymizePatient } from '../src/lgpd/anonymize.js';

// D35: nota livre datada, nunca apagada; ocultar preserva no export; anonimizar apaga o corpo.
describe('notas clínicas', () => {
  let db, ctx, session, patientId;
  // 2026-09-15 02:30Z = 2026-09-14 22:30 em America/Cuiaba → "hoje" no fuso do paciente é 14/09
  const NOW = new Date('2026-09-15T02:30:00Z');
  beforeAll(async () => {
    db = await freshDb();
    ctx = await seedClinic(db, 'notas');
    session = {
      kind: 'user',
      sessionId: 't',
      userId: ctx.userId,
      clinicId: ctx.clinicId,
      role: 'doctor',
      name: 'Dra.',
      email: 'dra-notas@example.test',
    };
    patientId = await seedPatient(db, ctx);
  });
  afterAll(async () => db.destroy());

  it('cria com padrões (consulta, hoje no fuso do paciente) e valida corpo/tipo/data', async () => {
    const n = await createNote(db, session, patientId, { body: '  Primeira consulta. ' }, NOW);
    expect(n.kind).toBe('consulta');
    expect(String(n.occurred_at).slice(0, 10)).toBe('2026-09-14');
    expect(n.body).toBe('Primeira consulta.');
    expect(n.created_by).toBe(ctx.userId);
    await expect(createNote(db, session, patientId, { body: '   ' }, NOW)).rejects.toMatchObject({
      code: 'validation',
      field: 'body',
    });
    await expect(
      createNote(db, session, patientId, { body: 'a'.repeat(20001) }, NOW),
    ).rejects.toMatchObject({ code: 'validation', field: 'body' });
    await expect(
      createNote(db, session, patientId, { body: 'x', kind: 'soap' }, NOW),
    ).rejects.toMatchObject({ code: 'validation', field: 'kind' });
    // 15/09 ainda é futuro no fuso do paciente às 02:30Z
    await expect(
      createNote(db, session, patientId, { body: 'x', occurred_at: '2026-09-15' }, NOW),
    ).rejects.toMatchObject({ code: 'validation', field: 'occurred_at' });
    await expect(
      createNote(db, session, patientId, { body: 'x', occurred_at: '15/09/2026' }, NOW),
    ).rejects.toMatchObject({ code: 'validation', field: 'occurred_at' });
  });

  it('edita, oculta (segue no banco e no export), e não edita nota importada', async () => {
    const n = await createNote(
      db,
      session,
      patientId,
      { body: 'Evolução', kind: 'evolucao', occurred_at: '2026-09-01' },
      NOW,
    );
    const up = await updateNote(db, session, n.id, { body: 'Evolução corrigida' }, NOW);
    expect(up.body).toBe('Evolução corrigida');
    const del = await deleteNote(db, session, n.id, NOW);
    expect(del.deleted_at).not.toBeNull();
    expect((await listNotes(db, session, patientId)).map((x) => x.id)).not.toContain(n.id);
    expect(
      (await listNotes(db, session, patientId, { includeDeleted: true })).map((x) => x.id),
    ).toContain(n.id);
    await expect(updateNote(db, session, n.id, { body: 'de novo' }, NOW)).rejects.toMatchObject({
      code: 'not_found',
    });
    const { files, manifest } = await exportPatientData(db, session, patientId, NOW);
    expect(files['clinical_notes.json'].map((x) => x.id)).toContain(n.id);
    expect(manifest.counts.clinical_notes).toBeGreaterThanOrEqual(2);

    const [imp] = await db('clinical_notes')
      .insert({
        patient_id: patientId,
        kind: 'importada',
        occurred_at: '2020-01-01',
        body: 'Do PDF',
        source: JSON.stringify({ file: 'x.pdf', page: 2 }),
        created_by: ctx.userId,
      })
      .returning('*');
    await expect(updateNote(db, session, imp.id, { body: 'y' }, NOW)).rejects.toMatchObject({
      code: 'validation',
    });
    const audit = await db('access_audit')
      .where({ patient_id: patientId })
      .whereIn('route', ['notes.create', 'notes.update', 'notes.delete']);
    expect(audit.map((a) => a.route).sort()).toEqual([
      'notes.create',
      'notes.create',
      'notes.delete',
      'notes.update',
    ]);
  });

  it('nota de outra clínica é not_found', async () => {
    const outra = await seedClinic(db, 'outra-notas');
    const pOutra = await seedPatient(db, outra, 'Fora');
    const n = await createNote(
      db,
      { ...session, clinicId: outra.clinicId, userId: outra.userId },
      pOutra,
      { body: 'segredo' },
      NOW,
    );
    await expect(updateNote(db, session, n.id, { body: 'x' }, NOW)).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(listNotes(db, session, pOutra)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('anonimizar apaga o corpo das notas e mantém tipo e data', async () => {
    await createNote(db, session, patientId, { body: 'Nome do vizinho aqui' }, NOW);
    await anonymizePatient(db, session, patientId, { reason: 'pedido do titular' }, NOW);
    const rows = await db('clinical_notes').where({ patient_id: patientId });
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.body).toBe('[removido]');
      expect(r.kind).toBeTruthy();
      expect(r.occurred_at).toBeTruthy();
    }
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -w @medcheckin/core -- test/notes.test.js`
Expected: FAIL — `Cannot find module '../src/notes/index.js'`.

- [ ] **Step 3: Módulo `notes`**

```js
// packages/core/src/notes/index.js
import { DateTime } from 'luxon';
import { AuthError } from '../auth/tokens.js';
import { requirePatientInClinic, logAccess } from '../auth/access.js';
import { ValidationError } from '../errors.js';
import { localDate } from '../time.js';

const KINDS = new Set(['consulta', 'evolucao', 'contato', 'importada']);
const BODY_MAX = 20000;

function requireDoctor(session) {
  if (!session || session.kind !== 'user')
    throw new AuthError('unauthenticated', 'Sessão da clínica necessária.');
}

/** Dia civil (AAAA-MM-DD) de uma coluna `date` do Postgres, venha como Date ou string. */
export function noteDay(value) {
  if (value instanceof Date) return DateTime.fromJSDate(value).toISODate();
  return String(value).slice(0, 10);
}

function notePatch(input, { partial, patient, now }) {
  const has = (k) => Object.hasOwn(input ?? {}, k);
  const patch = {};
  if (!partial || has('kind')) {
    const kind = String(input?.kind ?? 'consulta');
    if (!KINDS.has(kind)) throw new ValidationError('Tipo de nota inválido.', 'kind');
    patch.kind = kind;
  }
  if (!partial || has('occurred_at')) {
    const today = localDate(now, patient.timezone || 'UTC');
    const raw = input?.occurred_at;
    const d = raw === undefined || raw === null || raw === '' ? today : String(raw).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !DateTime.fromISO(d).isValid)
      throw new ValidationError('Data da nota inválida (AAAA-MM-DD).', 'occurred_at');
    if (d > today) throw new ValidationError('A data da nota não pode ser futura.', 'occurred_at');
    patch.occurred_at = d;
  }
  if (!partial || has('body')) {
    const body = String(input?.body ?? '').trim();
    if (!body) throw new ValidationError('Escreva o texto da nota.', 'body');
    if (body.length > BODY_MAX)
      throw new ValidationError(`Nota muito longa (máx. ${BODY_MAX} caracteres).`, 'body');
    patch.body = body;
  }
  return patch;
}

/** Nota visível da clínica da sessão (join com patients); oculta ou de outra clínica → not_found. */
async function noteInClinic(db, session, noteId) {
  const n = await db('clinical_notes as n')
    .join('patients as p', 'p.id', 'n.patient_id')
    .where('n.id', noteId)
    .andWhere('p.clinic_id', session.clinicId)
    .whereNull('n.deleted_at')
    .select('n.*', 'p.timezone as patient_timezone')
    .first();
  if (!n) throw new AuthError('not_found', 'Nota não encontrada.');
  return n;
}

/** D35 — nota livre datada. `occurred_at` padrão = hoje no fuso do paciente. */
export async function createNote(db, session, patientId, input, now) {
  requireDoctor(session);
  const patient = await requirePatientInClinic(db, session, patientId);
  const patch = notePatch(input, { partial: false, patient, now });
  const [row] = await db('clinical_notes')
    .insert({ patient_id: patientId, ...patch, created_by: session.userId })
    .returning('*');
  await logAccess(db, { session, patientId, route: 'notes.create', action: 'create' }, now);
  return row;
}

export async function updateNote(db, session, noteId, input, now) {
  requireDoctor(session);
  const note = await noteInClinic(db, session, noteId);
  if (note.source)
    throw new ValidationError('Nota importada não se edita; escreva uma nova.', 'source');
  const patch = notePatch(input, {
    partial: true,
    patient: { timezone: note.patient_timezone },
    now,
  });
  if (!Object.keys(patch).length) throw new ValidationError('Nada para atualizar.');
  const [row] = await db('clinical_notes')
    .where({ id: noteId })
    .update({ ...patch, updated_at: db.fn.now() })
    .returning('*');
  await logAccess(
    db,
    { session, patientId: note.patient_id, route: 'notes.update', action: 'update' },
    now,
  );
  return row;
}

/** "Apagar" é ocultar: a nota fica no banco, no export e na auditoria (D35). */
export async function deleteNote(db, session, noteId, now) {
  requireDoctor(session);
  const note = await noteInClinic(db, session, noteId);
  const [row] = await db('clinical_notes')
    .where({ id: noteId })
    .update({ deleted_at: db.fn.now(), updated_at: db.fn.now() })
    .returning('*');
  await logAccess(
    db,
    { session, patientId: note.patient_id, route: 'notes.delete', action: 'delete' },
    now,
  );
  return row;
}

export async function listNotes(db, session, patientId, { includeDeleted = false } = {}) {
  requireDoctor(session);
  await requirePatientInClinic(db, session, patientId);
  let q = db('clinical_notes').where({ patient_id: patientId });
  if (!includeDeleted) q = q.whereNull('deleted_at');
  return q.orderBy('occurred_at', 'desc').orderBy('created_at', 'desc');
}
```

- [ ] **Step 4: Export e anonimização**

`packages/core/src/lgpd/export.js`: após a consulta de `conditions` (Task 3), acrescentar

```js
// D35: notas ocultas também são dado do titular.
const clinicalNotes = await db('clinical_notes')
  .where({ patient_id: patientId })
  .orderBy('occurred_at')
  .orderBy('created_at');
```

e `'clinical_notes.json': clinicalNotes,` em `files`, `clinical_notes: clinicalNotes.length,` em `counts`.

`packages/core/src/lgpd/anonymize.js`: logo após o `del()` de `patient_conditions`:

```js
// D35: o corpo da nota é texto livre e pode identificar; tipo e data ficam (série clínica).
await trx('clinical_notes')
  .where({ patient_id: patientId })
  .update({ body: '[removido]', updated_at: trx.fn.now() });
```

`packages/core/src/index.js`:

```js
export { createNote, updateNote, deleteNote, listNotes, noteDay } from './notes/index.js';
```

`packages/core/src/index.d.ts`:

```ts
export type NoteKind = 'consulta' | 'evolucao' | 'contato' | 'importada';
export interface ClinicalNoteRow {
  id: string;
  patient_id: string;
  kind: NoteKind;
  occurred_at: Date | string;
  body: string;
  source: { file?: string; page?: number; excerpt?: string } | null;
  created_by: string;
  deleted_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}
export function createNote(
  db: Knex,
  session: Session,
  patientId: string,
  input: { kind?: NoteKind; occurred_at?: string; body: string },
  now?: Instant,
): Promise<ClinicalNoteRow>;
export function updateNote(
  db: Knex,
  session: Session,
  noteId: string,
  input: { kind?: NoteKind; occurred_at?: string; body?: string },
  now?: Instant,
): Promise<ClinicalNoteRow>;
export function deleteNote(
  db: Knex,
  session: Session,
  noteId: string,
  now?: Instant,
): Promise<ClinicalNoteRow>;
export function listNotes(
  db: Knex,
  session: Session,
  patientId: string,
  opts?: { includeDeleted?: boolean },
): Promise<ClinicalNoteRow[]>;
export function noteDay(value: Date | string): string;
```

- [ ] **Step 5: Rodar**

Run: `npm test -w @medcheckin/core`
Expected: tudo verde.

- [ ] **Step 6: Prettier + commit**

```bash
npx prettier --write packages/core/src/notes packages/core/src/lgpd packages/core/src/index.js packages/core/src/index.d.ts packages/core/test/notes.test.js
git add packages/core/src/notes packages/core/src/lgpd packages/core/src/index.js packages/core/src/index.d.ts packages/core/test/notes.test.js
git commit -m "feat(core): notas clínicas — texto livre datado, ocultar sem apagar, export e anonimização (D35)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Core — `patientTimeline` agrupando por dia civil

**Files:**

- Create: `packages/core/src/patients/timeline.js`
- Modify: `packages/core/src/index.js`, `packages/core/src/index.d.ts`
- Test: `packages/core/test/timeline.test.js`

**Interfaces:**

- Consumes: `clinical_notes`, `dose_events`, `alert_actions`; `localDate`, `noteDay`.
- Produces: `patientTimeline(db, session, patientId, { now }) → TimelineDay[]` com `TimelineDay = { day: 'AAAA-MM-DD', notes: ClinicalNoteRow[], events: TimelineEvent[] }` e `TimelineEvent = { kind: 'dose' | 'conduct', at: Date, ref_id: string, summary: string, by: string | null }`. Ordem: dias decrescentes; eventos do dia por `at` decrescente.

- [ ] **Step 1: Teste que falha**

```js
// packages/core/test/timeline.test.js
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { freshDb, seedClinic, seedPatient } from './helpers/db.js';
import { createNote } from '../src/notes/index.js';
import { patientTimeline } from '../src/patients/timeline.js';
import { catalogNameKey } from '../src/catalog/nameKey.js';

// Linha do tempo agrupa nota, ajuste de dose e conduta pelo DIA CIVIL do paciente.
describe('patientTimeline', () => {
  let db, ctx, session, patientId, medicationId, alertId;
  const NOW = new Date('2026-09-15T12:00:00Z');
  beforeAll(async () => {
    db = await freshDb();
    ctx = await seedClinic(db, 'tl');
    session = {
      kind: 'user',
      sessionId: 't',
      userId: ctx.userId,
      clinicId: ctx.clinicId,
      role: 'doctor',
      name: 'Dra.',
      email: 'dra-tl@example.test',
    };
    patientId = await seedPatient(db, ctx); // America/Cuiaba (UTC-4)
    const [prod] = await db('products')
      .insert({
        clinic_id: ctx.clinicId,
        name: 'Óleo CBD 50',
        name_key: catalogNameKey('Óleo CBD 50'),
        form: 'oil',
      })
      .returning('id');
    const [med] = await db('medications')
      .insert({ patient_id: patientId, product_id: prod.id })
      .returning('id');
    medicationId = med.id;
    const [al] = await db('alerts')
      .insert({
        patient_id: patientId,
        code: 'side_effect',
        severity: 'high',
        title: 'Efeito adverso relatado',
        context: JSON.stringify({}),
        status: 'resolved',
        first_seen_at: NOW,
        last_seen_at: NOW,
      })
      .returning('id');
    alertId = al.id;
  });
  afterAll(async () => db.destroy());

  it('agrupa por dia, converte conduta para o fuso do paciente, ordena decrescente', async () => {
    await createNote(
      db,
      session,
      patientId,
      { body: 'Consulta do dia 10', occurred_at: '2026-09-10' },
      NOW,
    );
    await createNote(
      db,
      session,
      patientId,
      { body: 'Contato do dia 10', kind: 'contato', occurred_at: '2026-09-10' },
      NOW,
    );
    await db('dose_events').insert({
      medication_id: medicationId,
      effective_from: '2026-09-10',
      dose_amount: 4,
      dose_unit: 'gotas',
      times_per_day: 2,
      schedule_times: ['08:00', '20:00'],
      reason: 'titulação',
      created_by: ctx.userId,
    });
    // 2026-09-11 02:30Z = 2026-09-10 22:30 em Cuiabá → conduta cai no dia 10
    await db('alert_actions').insert({
      alert_id: alertId,
      user_id: ctx.userId,
      action: 'resolve',
      note: 'Orientei tomar após o jantar',
      at: new Date('2026-09-11T02:30:00Z'),
    });
    // dia sem nota: só o evento
    await db('dose_events').insert({
      medication_id: medicationId,
      effective_from: '2026-09-12',
      dose_amount: 6,
      dose_unit: 'gotas',
      times_per_day: 2,
      schedule_times: ['08:00', '20:00'],
      created_by: ctx.userId,
    });

    const days = await patientTimeline(db, session, patientId, { now: NOW });
    expect(days.map((d) => d.day)).toEqual(['2026-09-12', '2026-09-10']);
    const d12 = days[0];
    expect(d12.notes).toEqual([]);
    expect(d12.events).toHaveLength(1);
    expect(d12.events[0]).toMatchObject({ kind: 'dose' });
    expect(d12.events[0].summary).toBe('Óleo CBD 50: 6 gotas · 2×/dia (08:00, 20:00)');
    const d10 = days[1];
    expect(d10.notes.map((n) => n.body)).toEqual(['Contato do dia 10', 'Consulta do dia 10']);
    expect(d10.events.map((e) => e.kind).sort()).toEqual(['conduct', 'dose']);
    const conduta = d10.events.find((e) => e.kind === 'conduct');
    expect(conduta.summary).toBe('Efeito adverso relatado: Orientei tomar após o jantar');
    expect(conduta.by).toBe('Dra. Teste');
    const dose = d10.events.find((e) => e.kind === 'dose');
    expect(dose.summary).toBe('Óleo CBD 50: 4 gotas · 2×/dia (08:00, 20:00) — titulação');
    const audit = await db('access_audit').where({ patient_id: patientId, route: 'notes.read' });
    expect(audit).toHaveLength(1);
    expect(audit[0].action).toBe('view');
  });

  it('nota oculta não aparece; paciente de outra clínica é not_found', async () => {
    const n = await createNote(
      db,
      session,
      patientId,
      { body: 'some', occurred_at: '2026-09-01' },
      NOW,
    );
    await db('clinical_notes').where({ id: n.id }).update({ deleted_at: NOW });
    const days = await patientTimeline(db, session, patientId, { now: NOW });
    expect(days.some((d) => d.day === '2026-09-01')).toBe(false);
    const outra = await seedClinic(db, 'outra-tl');
    await expect(
      patientTimeline(db, { ...session, clinicId: outra.clinicId }, patientId, { now: NOW }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -w @medcheckin/core -- test/timeline.test.js`
Expected: FAIL — `Cannot find module '../src/patients/timeline.js'`.

- [ ] **Step 3: Implementar**

```js
// packages/core/src/patients/timeline.js
import { AuthError } from '../auth/tokens.js';
import { requirePatientInClinic, logAccess } from '../auth/access.js';
import { localDate } from '../time.js';
import { noteDay } from '../notes/index.js';

function requireDoctor(session) {
  if (!session || session.kind !== 'user')
    throw new AuthError('unauthenticated', 'Sessão da clínica necessária.');
}

const num = (v) => {
  const n = Number(v);
  return Number.isInteger(n) ? String(n) : String(n);
};
const hm = (t) => String(t).slice(0, 5);

/**
 * Linha do tempo do paciente: notas (D35), ajustes de dose e condutas de alerta agrupados pelo
 * DIA CIVIL no fuso do paciente. A nota é o item principal do dia; ajuste e conduta do mesmo dia
 * aparecem sob ela sem a médica repetir no texto. Dia sem nota mostra o evento sozinho.
 *
 * `dose_events.effective_from` já é um dia (a vigência); `alert_actions.at` é instante e vira dia
 * pelo fuso do paciente — uma conduta às 22:30 de Cuiabá é do dia de Cuiabá, não do UTC.
 */
export async function patientTimeline(db, session, patientId, { now } = {}) {
  requireDoctor(session);
  const patient = await requirePatientInClinic(db, session, patientId);
  const tz = patient.timezone || 'UTC';

  const notes = await db('clinical_notes')
    .where({ patient_id: patientId })
    .whereNull('deleted_at')
    .orderBy('occurred_at', 'desc')
    .orderBy('created_at', 'desc');
  const doses = await db('dose_events as d')
    .join('medications as m', 'm.id', 'd.medication_id')
    .join('products as p', 'p.id', 'm.product_id')
    .where('m.patient_id', patientId)
    .select('d.*', 'p.name as product_name');
  const conducts = await db('alert_actions as x')
    .join('alerts as a', 'a.id', 'x.alert_id')
    .leftJoin('users as u', 'u.id', 'x.user_id')
    .where('a.patient_id', patientId)
    .whereIn('x.action', ['resolve', 'note'])
    .select('x.id', 'x.at', 'x.note', 'u.name as user_name', 'a.title as alert_title');

  const days = new Map();
  const dayOf = (k) => {
    if (!days.has(k)) days.set(k, { day: k, notes: [], events: [] });
    return days.get(k);
  };
  for (const n of notes) dayOf(noteDay(n.occurred_at)).notes.push(n);
  for (const d of doses) {
    const times = (d.schedule_times ?? []).map(hm).join(', ');
    dayOf(noteDay(d.effective_from)).events.push({
      kind: 'dose',
      at: d.created_at,
      ref_id: d.id,
      summary:
        `${d.product_name}: ${num(d.dose_amount)} ${d.dose_unit} · ${d.times_per_day}×/dia (${times})` +
        (d.reason ? ` — ${d.reason}` : ''),
      by: null,
    });
  }
  for (const c of conducts) {
    dayOf(localDate(c.at, tz)).events.push({
      kind: 'conduct',
      at: c.at,
      ref_id: c.id,
      summary: `${c.alert_title}${c.note ? `: ${c.note}` : ''}`,
      by: c.user_name ?? null,
    });
  }
  const out = [...days.values()].sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0));
  for (const d of out) d.events.sort((a, b) => new Date(b.at) - new Date(a.at));

  await logAccess(db, { session, patientId, route: 'notes.read', action: 'view' }, now);
  return out;
}
```

`packages/core/src/index.js`: `export { patientTimeline } from './patients/timeline.js';`

`packages/core/src/index.d.ts`:

```ts
export interface TimelineEvent {
  kind: 'dose' | 'conduct';
  at: Date | string;
  ref_id: string;
  summary: string;
  by: string | null;
}
export interface TimelineDay {
  day: string;
  notes: ClinicalNoteRow[];
  events: TimelineEvent[];
}
export function patientTimeline(
  db: Knex,
  session: Session,
  patientId: string,
  opts?: { now?: Instant },
): Promise<TimelineDay[]>;
```

- [ ] **Step 4: Rodar**

Run: `npm test -w @medcheckin/core -- test/timeline.test.js`
Expected: PASS. Se `dose_amount` vier como string `"4.00"` do Postgres (`decimal`), `num()` já converte; ajustar apenas se o teste mostrar `4.00`.

- [ ] **Step 5: Prettier + commit**

```bash
npx prettier --write packages/core/src/patients/timeline.js packages/core/src/index.js packages/core/src/index.d.ts packages/core/test/timeline.test.js
git add packages/core/src/patients/timeline.js packages/core/src/index.js packages/core/src/index.d.ts packages/core/test/timeline.test.js
git commit -m "feat(core): patientTimeline — notas, ajustes de dose e condutas agrupados por dia civil do paciente

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: API — rotas de notas, linha do tempo, condições e filtro da lista

**Files:**

- Create: `apps/web/app/api/patients/[id]/notes/route.ts`, `apps/web/app/api/patients/[id]/notes/[noteId]/route.ts`, `apps/web/app/api/patients/[id]/timeline/route.ts`, `apps/web/app/api/patients/[id]/conditions/route.ts`, `apps/web/app/api/patients/[id]/conditions/[conditionId]/route.ts`, `apps/web/app/api/conditions/route.ts`, `apps/web/app/api/conditions/[id]/route.ts`, `apps/web/app/api/conditions/merge/route.ts`
- Modify: `apps/web/app/api/patients/route.ts` (GET com `?condition=`)
- Test: `apps/web/test/medica-api.test.ts` (acrescentar um caso de notas e um de condições, seguindo o padrão do arquivo)

**Interfaces:**

- Consumes: exports das Tasks 3-5 via `@medcheckin/core`.
- Produces: as rotas da spec §6. Status: POST → 201; DELETE → 204 (`new Response(null, { status: 204 })`).

- [ ] **Step 1: Rotas**

```ts
// apps/web/app/api/patients/[id]/notes/route.ts
import { createNote, listNotes } from '@medcheckin/core';
import { doctorRoute, json } from '@/lib/api';

export const dynamic = 'force-dynamic';

export const GET = doctorRoute<{ id: string }>(async ({ db, session, params }) =>
  json(await listNotes(db, session, params.id)),
);

export const POST = doctorRoute<{ id: string }>(async ({ db, session, params, body }) =>
  json(await createNote(db, session, params.id, body as { body: string }, new Date()), 201),
);
```

```ts
// apps/web/app/api/patients/[id]/notes/[noteId]/route.ts
import { updateNote, deleteNote } from '@medcheckin/core';
import { doctorRoute, json } from '@/lib/api';

export const dynamic = 'force-dynamic';

export const PATCH = doctorRoute<{ id: string; noteId: string }>(
  async ({ db, session, params, body }) =>
    json(await updateNote(db, session, params.noteId, body as Record<string, unknown>, new Date())),
);

export const DELETE = doctorRoute<{ id: string; noteId: string }>(
  async ({ db, session, params }) => {
    await deleteNote(db, session, params.noteId, new Date());
    return new Response(null, { status: 204 });
  },
);
```

```ts
// apps/web/app/api/patients/[id]/timeline/route.ts
import { patientTimeline } from '@medcheckin/core';
import { doctorRoute, json } from '@/lib/api';

export const dynamic = 'force-dynamic';

export const GET = doctorRoute<{ id: string }>(async ({ db, session, params }) =>
  json(await patientTimeline(db, session, params.id, { now: new Date() })),
);
```

```ts
// apps/web/app/api/patients/[id]/conditions/route.ts
import { addPatientCondition, listPatientConditions } from '@medcheckin/core';
import { doctorRoute, json } from '@/lib/api';

export const dynamic = 'force-dynamic';

export const GET = doctorRoute<{ id: string }>(async ({ db, params }) =>
  json(await listPatientConditions(db, params.id)),
);

export const POST = doctorRoute<{ id: string }>(async ({ db, session, params, body }) =>
  json(
    await addPatientCondition(
      db,
      session,
      params.id,
      body as { name?: string; condition_id?: string },
      new Date(),
    ),
    201,
  ),
);
```

Atenção: o `GET` acima não passa por `requirePatientInClinic`. Trocar por uma versão que confira a clínica antes de listar:

```ts
export const GET = doctorRoute<{ id: string }>(async ({ db, session, params }) => {
  await requirePatientInClinic(db, session, params.id);
  return json(await listPatientConditions(db, params.id));
});
```

com `import { addPatientCondition, listPatientConditions, requirePatientInClinic } from '@medcheckin/core';` — conferir que `requirePatientInClinic` está exportado em `packages/core/src/index.js` (`grep -n requirePatientInClinic packages/core/src/index.js`); se não estiver, acrescentar `export { requirePatientInClinic, logAccess } from './auth/access.js';` e as declarações em `index.d.ts`:

```ts
export function requirePatientInClinic(
  db: Knex,
  session: Session,
  patientId: string,
): Promise<PatientRow>;
```

```ts
// apps/web/app/api/patients/[id]/conditions/[conditionId]/route.ts
import { removePatientCondition } from '@medcheckin/core';
import { doctorRoute } from '@/lib/api';

export const dynamic = 'force-dynamic';

export const DELETE = doctorRoute<{ id: string; conditionId: string }>(
  async ({ db, session, params }) => {
    await removePatientCondition(db, session, params.id, params.conditionId, new Date());
    return new Response(null, { status: 204 });
  },
);
```

```ts
// apps/web/app/api/conditions/route.ts
import { listConditions } from '@medcheckin/core';
import { doctorRoute, json } from '@/lib/api';

export const dynamic = 'force-dynamic';

export const GET = doctorRoute(async ({ db, session }) =>
  json(await listConditions(db, session.clinicId)),
);
```

```ts
// apps/web/app/api/conditions/[id]/route.ts
import { updateCondition } from '@medcheckin/core';
import { doctorRoute, json } from '@/lib/api';

export const dynamic = 'force-dynamic';

export const PATCH = doctorRoute<{ id: string }>(async ({ db, session, params, body }) =>
  json(
    await updateCondition(
      db,
      session,
      params.id,
      body as { name?: string; cid10?: string | null },
      new Date(),
    ),
  ),
);
```

```ts
// apps/web/app/api/conditions/merge/route.ts
import { mergeConditions } from '@medcheckin/core';
import { doctorRoute, json } from '@/lib/api';

export const dynamic = 'force-dynamic';

export const POST = doctorRoute(async ({ db, session, body }) =>
  json(
    await mergeConditions(db, session, body as { from_id: string; into_id: string }, new Date()),
  ),
);
```

`apps/web/app/api/patients/route.ts`, o `GET`:

```ts
export const GET = doctorRoute(async ({ req, db, session }) => {
  const condition = new URL(req.url).searchParams.get('condition') || null;
  return json(await listPatients(db, { clinicId: session.clinicId, condition }, new Date()));
});
```

- [ ] **Step 2: Teste de rota**

Abrir `apps/web/test/medica-api.test.ts`, ver como os testes existentes chamam as rotas (função de request com cookie de sessão e `Origin`). Acrescentar, no mesmo estilo do arquivo, um caso que: cria nota (`POST /api/patients/:id/notes` → 201, `kind === 'consulta'`), lista a linha do tempo (`GET /api/patients/:id/timeline` → 200, o dia de hoje contém a nota), oculta (`DELETE /api/patients/:id/notes/:noteId` → 204) e confere que a linha do tempo não a traz mais. E um caso de condições: `POST /api/patients/:id/conditions { name: 'Epilepsia' }` → 201, `GET /api/conditions` traz `patients: 1`, `GET /api/patients?condition=<id>` traz só esse paciente, `POST /api/conditions/merge` funde com uma segunda condição criada por nome e a lista deixa de trazer a origem. Usar o paciente do seed do teste que o arquivo já usa.

- [ ] **Step 3: Typecheck, lint e testes do web**

Run: `npm run typecheck -w @medcheckin/web && npm run lint && npm test -w @medcheckin/web`
Expected: tudo verde.

- [ ] **Step 4: Prettier + commit**

```bash
npx prettier --write apps/web/app/api apps/web/test/medica-api.test.ts packages/core/src/index.js packages/core/src/index.d.ts
git add apps/web/app/api apps/web/test/medica-api.test.ts packages/core/src/index.js packages/core/src/index.d.ts
git commit -m "feat(api): rotas de notas, linha do tempo, condições do paciente, catálogo e filtro da lista

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: UI — `CatalogNameInput` (generalização) em medicações e no cadastro

**Files:**

- Create: `apps/web/components/medica/CatalogNameInput.tsx`
- Delete: `apps/web/components/medica/ProductNameInput.tsx`
- Modify: `apps/web/components/medica/MedicationsCard.tsx` (import e uso), `apps/web/components/medica/NewPatientForm.tsx` (campo de condições vira lista de chips + `CatalogNameInput`; payload `conditions: string[]`), `apps/web/app/(medica)/pacientes/novo/page.tsx` (passar `conditionNames`)
- Modify: `apps/web/e2e/medica.spec.ts:24` (o label do campo muda)

**Interfaces:**

- Produces: `CatalogNameInput({ id, value, onChange, suggestions, onSubmit, disabled?, placeholder?, testId? })`; `testId` padrão `catalog-input`, sugestões `${testId}-suggestion`… **exceto** que o card de medicações continua usando `product-input`/`product-suggestion` (os E2E existentes dependem disso).

- [ ] **Step 1: Componente**

Criar `CatalogNameInput.tsx` copiando `ProductNameInput.tsx` inteiro e mudando: o nome da função para `CatalogNameInput`; o import para `import { catalogNameKey } from '@medcheckin/core/name-key';` (e todas as chamadas `productNameKey(` → `catalogNameKey(`); as props ganham `placeholder?: string` e `testId?: string`. No JSX: `placeholder={placeholder ?? 'Digite para buscar ou criar'}`; no `Input`, `data-testid={testId ? \`${testId}-input\` : 'catalog-input'}`; em cada `<li>`, `data-testid={testId ? \`${testId}-suggestion\` : 'catalog-suggestion'}`. Assim `testId="product"` reproduz exatamente os ids de hoje (`product-input`, `product-suggestion`) e `testId="condition"`gera`condition-input`/`condition-suggestion`. Também `aria-controls={visible ? listId : undefined}`(corrige o minor da revisão do PR #42). Atualizar o JSDoc: "Campo 'digite ou escolha' para itens de catálogo da clínica (produtos D34, condições D36)". Apagar`ProductNameInput.tsx`.

- [ ] **Step 2: `MedicationsCard`**

Trocar `import { ProductNameInput } from './ProductNameInput';` por `import { CatalogNameInput } from './CatalogNameInput';` e o uso por:

```tsx
<CatalogNameInput
  id="product"
  value={name}
  onChange={setName}
  suggestions={products.map((p) => p.name)}
  onSubmit={() => void addMed()}
  disabled={busy}
  placeholder="Ex.: Óleo CBD 50 mg/ml"
  testId="product"
/>
```

Tipo `Product` no card vira `Pick<ProductRow, 'name'>`.

- [ ] **Step 3: `NewPatientForm`**

Estado: trocar `const [tags, setTags] = useState('');` por

```tsx
const [conditions, setConditions] = useState<string[]>([]);
const [conditionDraft, setConditionDraft] = useState('');
function addCondition() {
  const v = conditionDraft.trim();
  if (v.length < 2) return;
  if (!conditions.some((c) => catalogNameKey(c) === catalogNameKey(v)))
    setConditions((cs) => [...cs, v]);
  setConditionDraft('');
}
```

com `import { catalogNameKey } from '@medcheckin/core/name-key';`, `import { CatalogNameInput } from './CatalogNameInput';`, `import { Badge } from '@/components/ui/badge';`. O componente recebe uma prop nova `conditionNames: string[]` (sugestões do catálogo). Payload: `condition_tags: tags,` → `conditions,`. O campo:

```tsx
<div className="sm:col-span-2">
  <Label htmlFor="condition">Condições</Label>
  <CatalogNameInput
    id="condition"
    value={conditionDraft}
    onChange={setConditionDraft}
    suggestions={conditionNames}
    onSubmit={addCondition}
    placeholder="Ex.: epilepsia — Enter adiciona"
    testId="condition"
  />
  {conditions.length > 0 && (
    <div className="mt-2 flex flex-wrap gap-1.5" data-testid="new-patient-conditions">
      {conditions.map((c) => (
        <Badge key={c} variant="outline" className="gap-1 pr-1">
          {c}
          <button
            type="button"
            aria-label={`Remover ${c}`}
            className="rounded-full px-1 hover:bg-muted"
            onClick={() => setConditions((cs) => cs.filter((x) => x !== c))}
          >
            ×
          </button>
        </Badge>
      ))}
    </div>
  )}
</div>
```

Em `apps/web/app/(medica)/pacientes/novo/page.tsx`, carregar `listConditions(getDb(), session.clinicId)` e passar `conditionNames={conds.map((c) => c.name)}` (ler o arquivo para ver como a sessão e o `getDb` já são obtidos; seguir o padrão de `pacientes/page.tsx`).

`apps/web/e2e/medica.spec.ts` linha 24: `await page.getByLabel('Condições (separadas por vírgula)').fill('epilepsia');` → `await page.getByTestId('condition-input').fill('epilepsia'); await page.getByTestId('condition-input').press('Enter');`.

- [ ] **Step 4: Typecheck + lint**

Run: `npm run typecheck -w @medcheckin/web && npm run lint`
Expected: verde. `grep -rn "ProductNameInput" apps/web` deve voltar vazio.

- [ ] **Step 5: Prettier + commit**

```bash
npx prettier --write apps/web/components/medica "apps/web/app/(medica)/pacientes/novo/page.tsx" apps/web/e2e/medica.spec.ts
git add -A apps/web/components/medica "apps/web/app/(medica)/pacientes/novo/page.tsx" apps/web/e2e/medica.spec.ts
git commit -m "refactor(web): CatalogNameInput — campo digite-ou-escolha genérico; condições no cadastro como chips (D36)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: UI — card Prontuário com editor de nota e linha do tempo

**Files:**

- Create: `apps/web/components/medica/ProntuarioCard.tsx`
- Modify: `apps/web/app/(medica)/pacientes/[id]/page.tsx` (carregar `patientTimeline`, renderizar o card no topo de "O caso")

**Interfaces:**

- Consumes: `TimelineDay`, `ClinicalNoteRow`, `NoteKind` de `@medcheckin/core`; rotas de notas (Task 6).
- Produces: `ProntuarioCard({ patientId, timeline, today })` com `today` = dia civil de hoje no fuso do paciente (`AAAA-MM-DD`), calculado no servidor. Test ids: `prontuario-card`, `note-new`, `note-kind`, `note-date`, `note-body`, `note-save`, `note-cancel`, `note-item`, `note-edit`, `note-hide`, `note-hide-confirm`, `timeline-day`, `timeline-event`.

- [ ] **Step 1: Componente**

```tsx
// apps/web/components/medica/ProntuarioCard.tsx
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { SimpleSelect } from '@/components/ui/simple-select';
import { Badge } from '@/components/ui/badge';
import { fmtDate, fmtDateTime } from '@/lib/format';
import { PrintButton } from './PrintButton';
import type { ClinicalNoteRow, NoteKind, TimelineDay } from '@medcheckin/core';

const KIND_LABEL: Record<NoteKind, string> = {
  consulta: 'Consulta',
  evolucao: 'Evolução',
  contato: 'Contato',
  importada: 'Importada',
};
const KIND_OPTIONS = (['consulta', 'evolucao', 'contato'] as NoteKind[]).map((k) => ({
  value: k,
  label: KIND_LABEL[k],
}));

type Draft = { id: string | null; kind: NoteKind; occurred_at: string; body: string };

/**
 * D35 — prontuário como nota livre datada. O editor é inline (sem modal) para o texto ficar
 * visível ao lado da linha do tempo; Ctrl+Enter salva. A linha do tempo agrupa por dia civil do
 * paciente: nota em cima, ajuste de dose e conduta do mesmo dia embaixo (core: patientTimeline).
 */
export function ProntuarioCard({
  patientId,
  timeline,
  today,
}: {
  patientId: string;
  timeline: TimelineDay[];
  today: string;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [hiding, setHiding] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function novaNota() {
    setError(null);
    setDraft({ id: null, kind: 'consulta', occurred_at: today, body: '' });
  }
  function editar(n: ClinicalNoteRow) {
    setError(null);
    setDraft({
      id: n.id,
      kind: n.kind,
      occurred_at: String(n.occurred_at).slice(0, 10),
      body: n.body,
    });
  }
  async function salvar() {
    if (!draft || busy || draft.body.trim().length === 0) return;
    setBusy(true);
    setError(null);
    try {
      if (draft.id)
        await api(`/api/patients/${patientId}/notes/${draft.id}`, {
          method: 'PATCH',
          json: { kind: draft.kind, occurred_at: draft.occurred_at, body: draft.body },
        });
      else
        await api(`/api/patients/${patientId}/notes`, {
          method: 'POST',
          json: { kind: draft.kind, occurred_at: draft.occurred_at, body: draft.body },
        });
      setDraft(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erro');
    } finally {
      setBusy(false);
    }
  }
  async function ocultar(id: string) {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/patients/${patientId}/notes/${id}`, { method: 'DELETE' });
      setHiding(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erro');
    } finally {
      setBusy(false);
    }
  }

  const podeSalvar = !!draft && draft.body.trim().length > 0 && !busy;

  return (
    <Card data-testid="prontuario-card">
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle>Prontuário</CardTitle>
        <div className="flex gap-2 print:hidden">
          <PrintButton />
          <Button onClick={novaNota} disabled={!!draft} data-testid="note-new">
            Nova nota
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {draft && (
          <form
            className="space-y-3 rounded-md border p-3 print:hidden"
            onSubmit={(e) => {
              e.preventDefault();
              void salvar();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                void salvar();
              }
            }}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="note-kind">Tipo</Label>
                <SimpleSelect
                  id="note-kind"
                  value={draft.kind}
                  onValueChange={(v) => setDraft({ ...draft, kind: v as NoteKind })}
                  options={KIND_OPTIONS}
                  data-testid="note-kind"
                />
              </div>
              <div>
                <Label htmlFor="note-date">Data</Label>
                <Input
                  id="note-date"
                  type="date"
                  max={today}
                  value={draft.occurred_at}
                  onChange={(e) => setDraft({ ...draft, occurred_at: e.target.value })}
                  data-testid="note-date"
                />
              </div>
            </div>
            <div>
              <Label htmlFor="note-body">Nota</Label>
              <Textarea
                id="note-body"
                autoFocus
                rows={6}
                maxLength={20000}
                value={draft.body}
                placeholder="Escreva como você escreve: queixa, exame, hipótese, conduta…"
                onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                data-testid="note-body"
              />
              <p className="mt-1 text-xs text-muted-foreground">Ctrl+Enter salva.</p>
            </div>
            <div className="flex gap-2">
              <Button type="submit" disabled={!podeSalvar} data-testid="note-save">
                {draft.id ? 'Salvar alterações' : 'Salvar nota'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setDraft(null)}
                data-testid="note-cancel"
              >
                Cancelar
              </Button>
            </div>
          </form>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}

        {timeline.length === 0 && !draft && (
          <p className="text-sm text-muted-foreground">
            Nenhuma nota ainda. Toque em <strong>Nova nota</strong> na consulta.
          </p>
        )}

        <ol className="space-y-4">
          {timeline.map((d) => (
            <li key={d.day} data-testid="timeline-day" data-day={d.day}>
              <div className="mb-1 font-mono text-xs text-muted-foreground">
                {fmtDate(d.day + 'T12:00:00Z', {
                  day: '2-digit',
                  month: '2-digit',
                  year: 'numeric',
                })}
              </div>
              <div className="space-y-2 border-l-2 pl-3">
                {d.notes.map((n) => (
                  <article key={n.id} className="rounded-md border p-3" data-testid="note-item">
                    <header className="mb-1 flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className="flex items-center gap-2">
                        <Badge variant="outline">{KIND_LABEL[n.kind]}</Badge>
                        {n.source ? (
                          <span className="text-muted-foreground">
                            importada de {n.source.file ?? 'arquivo'}
                            {n.source.page ? `, p. ${n.source.page}` : ''}
                          </span>
                        ) : null}
                      </span>
                      {!n.source && hiding !== n.id && (
                        <span className="flex gap-1 print:hidden">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => editar(n)}
                            data-testid="note-edit"
                          >
                            Editar
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setHiding(n.id)}
                            data-testid="note-hide"
                          >
                            Ocultar
                          </Button>
                        </span>
                      )}
                      {hiding === n.id && (
                        <span className="flex items-center gap-2 print:hidden">
                          <span className="text-muted-foreground">
                            A nota some da lista, mas fica guardada.
                          </span>
                          <Button
                            size="sm"
                            variant="destructive"
                            disabled={busy}
                            onClick={() => void ocultar(n.id)}
                            data-testid="note-hide-confirm"
                          >
                            Confirmar
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setHiding(null)}>
                            Voltar
                          </Button>
                        </span>
                      )}
                    </header>
                    <p className="whitespace-pre-wrap text-sm">{n.body}</p>
                  </article>
                ))}
                {d.events.map((e) => (
                  <div
                    key={e.ref_id}
                    className="grid grid-cols-[5rem_1fr] gap-2 text-xs"
                    data-testid="timeline-event"
                    data-kind={e.kind}
                  >
                    <span className="font-mono text-muted-foreground">
                      {e.kind === 'dose' ? 'dose' : fmtDateTime(e.at).slice(-5)}
                    </span>
                    <span>
                      <span className="text-muted-foreground">
                        {e.kind === 'dose'
                          ? 'Ajuste de dose · '
                          : `Conduta${e.by ? ` · ${e.by}` : ''} · `}
                      </span>
                      {e.summary}
                    </span>
                  </div>
                ))}
              </div>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
```

Se `Button` não aceitar `size="sm"`, conferir as variantes em `apps/web/components/ui/button.tsx` e usar a menor existente.

- [ ] **Step 2: Página do paciente**

Em `apps/web/app/(medica)/pacientes/[id]/page.tsx`: importar `patientTimeline` e `localDate` (conferir que `localDate` está exportado de `@medcheckin/core`; se não, acrescentar `export { toDT, localDate } from './time.js';` em `packages/core/src/index.js` e a declaração `export function localDate(value: Instant, timezone: string): string;` no `.d.ts`), importar `ProntuarioCard`. No `Promise.all` acrescentar `patientTimeline(db, session, id, { now: new Date() })` → `timeline`. Calcular `const today = localDate(new Date(), p.timezone);`. No `TabsContent value="caso"`, antes do `<div className="grid gap-6 lg:grid-cols-3">`:

```tsx
<ProntuarioCard patientId={p.id} timeline={timeline} today={today} />
```

- [ ] **Step 3: Typecheck + lint + conferência no browser**

Run: `npm run typecheck -w @medcheckin/web && npm run lint`. Expected: verde.
Subir o dev pela launch config do Browser pane (controller), abrir um paciente, escrever nota, ajustar dose no mesmo dia e ver o agrupamento. Screenshot.

- [ ] **Step 4: Prettier + commit**

```bash
npx prettier --write apps/web/components/medica/ProntuarioCard.tsx "apps/web/app/(medica)/pacientes/[id]/page.tsx" packages/core/src/index.js packages/core/src/index.d.ts
git add apps/web/components/medica/ProntuarioCard.tsx "apps/web/app/(medica)/pacientes/[id]/page.tsx" packages/core/src/index.js packages/core/src/index.d.ts
git commit -m "feat(web): card Prontuário — nota inline datada e linha do tempo por dia (D35)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: UI — condições no cabeçalho, filtro na lista, relatório

**Files:**

- Create: `apps/web/components/medica/PatientConditions.tsx`, `apps/web/components/medica/ConditionsFilter.tsx`
- Modify: `apps/web/app/(medica)/pacientes/[id]/page.tsx` (cabeçalho), `apps/web/app/(medica)/pacientes/page.tsx` (`searchParams.condition`, filtro), `apps/web/app/(medica)/pacientes/[id]/relatorio/page.tsx:51`

**Interfaces:**

- Consumes: `PatientCondition`, `ConditionRow` de `@medcheckin/core`; rotas `/api/patients/:id/conditions` e `/api/conditions`.
- Produces: test ids `condition-badge`, `condition-remove`, `condition-edit`, `condition-input`, `condition-suggestion`, `conditions-filter`.

- [ ] **Step 1: `PatientConditions`**

```tsx
// apps/web/components/medica/PatientConditions.tsx
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CatalogNameInput } from './CatalogNameInput';
import type { PatientCondition } from '@medcheckin/core';

/** D36 — condições do paciente vêm do catálogo da clínica; Enter adiciona, × remove. */
export function PatientConditions({
  patientId,
  conditions,
  catalog,
}: {
  patientId: string;
  conditions: PatientCondition[];
  catalog: string[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    if (name.trim().length < 2 || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/patients/${patientId}/conditions`, {
        method: 'POST',
        json: { name: name.trim() },
      });
      setName('');
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erro');
    } finally {
      setBusy(false);
    }
  }
  async function remove(id: string) {
    setBusy(true);
    try {
      await api(`/api/patients/${patientId}/conditions/${id}`, { method: 'DELETE' });
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erro');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {conditions.map((c) => (
        <Badge key={c.id} variant="outline" className="gap-1" data-testid="condition-badge">
          {c.name}
          {c.cid10 ? (
            <span className="font-mono text-[10px] text-muted-foreground">{c.cid10}</span>
          ) : null}
          {editing && (
            <button
              type="button"
              aria-label={`Remover ${c.name}`}
              className="rounded-full px-1 hover:bg-muted"
              disabled={busy}
              onClick={() => void remove(c.id)}
              data-testid="condition-remove"
            >
              ×
            </button>
          )}
        </Badge>
      ))}
      {editing ? (
        <span className="flex items-center gap-1">
          <span className="w-56">
            <CatalogNameInput
              id="condition"
              value={name}
              onChange={setName}
              suggestions={catalog}
              onSubmit={() => void add()}
              disabled={busy}
              placeholder="Condição — Enter adiciona"
              testId="condition"
            />
          </span>
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
            Pronto
          </Button>
        </span>
      ) : (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setEditing(true)}
          data-testid="condition-edit"
        >
          {conditions.length ? 'Editar condições' : 'Adicionar condição'}
        </Button>
      )}
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}
```

Na página do paciente: carregar `listConditions(db, session.clinicId)` no `Promise.all` → `catalog`; remover `const tags = ...` e o `tags.map(...)`; no lugar, depois do `</div>` da linha de badges do cabeçalho (mantendo status, nascimento e check-in), inserir:

```tsx
<div className="mt-2">
  <PatientConditions
    patientId={p.id}
    conditions={detail.conditions}
    catalog={catalog.map((c) => c.name)}
  />
</div>
```

- [ ] **Step 2: `ConditionsFilter` e lista**

```tsx
// apps/web/components/medica/ConditionsFilter.tsx
'use client';
import { useRouter } from 'next/navigation';
import { SimpleSelect } from '@/components/ui/simple-select';

/** Filtro por condição na lista de pacientes; o valor vive na URL (?condition=). */
export function ConditionsFilter({
  options,
  value,
}: {
  options: Array<{ id: string; name: string; patients: number }>;
  value: string;
}) {
  const router = useRouter();
  return (
    <div className="w-64">
      <SimpleSelect
        value={value}
        onValueChange={(v) => router.push(v ? `/pacientes?condition=${v}` : '/pacientes')}
        options={[
          { value: '', label: 'Todas as condições' },
          ...options.map((o) => ({ value: o.id, label: `${o.name} (${o.patients})` })),
        ]}
        size="sm"
        aria-label="Filtrar por condição"
        data-testid="conditions-filter"
      />
    </div>
  );
}
```

Se `SimpleSelect` recusar `value: ''` (base-ui pode tratar string vazia como "sem valor"), usar `'all'` como valor da opção neutra e mapear `'all'` → sem filtro.

Em `apps/web/app/(medica)/pacientes/page.tsx`: a assinatura vira `export default async function PacientesPage({ searchParams }: { searchParams: Promise<{ condition?: string }> })`; `const { condition = '' } = await searchParams;`; carregar `listPatients(getDb(), { clinicId: session.clinicId, condition: condition || null }, new Date())` e `listConditions(getDb(), session.clinicId)`; renderizar `<ConditionsFilter options={conds} value={condition} />` ao lado do botão "Novo paciente" (dentro do mesmo `flex`), só quando `conds.length > 0`. Na tabela, acrescentar uma coluna **Condições** depois de **Status** com `p.conditions.map((c) => c.name).join(', ') || '—'` em `text-muted-foreground text-[13px]`. Quando a lista filtrada vier vazia mas `condition` estiver setado, mostrar `Nenhum paciente com essa condição.` em vez do `Empty` de "Nenhum paciente cadastrado".

`apps/web/app/(medica)/pacientes/[id]/relatorio/page.tsx:51`: `r.patient.condition_tags` → `r.patient.conditions` (mesma expressão, só o nome do campo).

- [ ] **Step 3: Typecheck + lint**

Run: `npm run typecheck -w @medcheckin/web && npm run lint`. Expected: verde; `grep -rn "condition_tags" apps packages/core/src --include=*.ts --include=*.tsx --include=*.js | grep -v migrations` volta vazio.

- [ ] **Step 4: Prettier + commit**

```bash
npx prettier --write apps/web/components/medica "apps/web/app/(medica)/pacientes"
git add apps/web/components/medica "apps/web/app/(medica)/pacientes"
git commit -m "feat(web): condições no cabeçalho do paciente, filtro na lista e no relatório (D36)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: UI — Configurações → Condições (CID-10 inline e Fundir)

**Files:**

- Create: `apps/web/app/(medica)/configuracoes/condicoes/page.tsx`, `apps/web/components/medica/ConditionsTable.tsx`
- Modify: `apps/web/app/(medica)/configuracoes/page.tsx` (link ao lado do link do guia)

**Interfaces:**

- Consumes: `listConditions`; rotas `PATCH /api/conditions/:id`, `POST /api/conditions/merge`.
- Produces: test ids `conditions-table`, `condition-row`, `condition-cid10`, `condition-merge`, `condition-merge-target`, `condition-merge-confirm`.

- [ ] **Step 1: Tabela**

```tsx
// apps/web/components/medica/ConditionsTable.tsx
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SimpleSelect } from '@/components/ui/simple-select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { ConditionRow } from '@medcheckin/core';

type Row = ConditionRow & { patients: number };

/** D36 — catálogo da clínica: CID-10 editável inline; Fundir corrige duplicata que escapou da chave. */
export function ConditionsTable({ rows }: { rows: Row[] }) {
  const router = useRouter();
  const [cid, setCid] = useState<Record<string, string>>({});
  const [merging, setMerging] = useState<string | null>(null);
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function saveCid(row: Row) {
    const value = cid[row.id];
    if (value === undefined || value === (row.cid10 ?? '')) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/conditions/${row.id}`, { method: 'PATCH', json: { cid10: value || null } });
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erro');
    } finally {
      setBusy(false);
    }
  }
  async function merge(from: Row) {
    if (!target || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api('/api/conditions/merge', {
        method: 'POST',
        json: { from_id: from.id, into_id: target },
      });
      setMerging(null);
      setTarget('');
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erro');
    } finally {
      setBusy(false);
    }
  }

  if (rows.length === 0)
    return <p className="text-sm text-muted-foreground">Nenhuma condição cadastrada ainda.</p>;

  return (
    <div className="space-y-2">
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Table data-testid="conditions-table">
        <TableHeader>
          <TableRow>
            <TableHead>Condição</TableHead>
            <TableHead>CID-10</TableHead>
            <TableHead className="text-right">Pacientes</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id} data-testid="condition-row" data-name={r.name}>
              <TableCell className="font-medium">{r.name}</TableCell>
              <TableCell>
                <Input
                  className="w-28 font-mono"
                  placeholder="F41.1"
                  value={cid[r.id] ?? r.cid10 ?? ''}
                  onChange={(e) => setCid({ ...cid, [r.id]: e.target.value.toUpperCase() })}
                  onBlur={() => void saveCid(r)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void saveCid(r);
                    }
                  }}
                  disabled={busy}
                  aria-label={`CID-10 de ${r.name}`}
                  data-testid="condition-cid10"
                />
              </TableCell>
              <TableCell className="text-right font-mono">{r.patients}</TableCell>
              <TableCell className="text-right">
                {merging === r.id ? (
                  <span className="flex items-center justify-end gap-2">
                    <span className="w-56">
                      <SimpleSelect
                        value={target}
                        onValueChange={setTarget}
                        options={rows
                          .filter((x) => x.id !== r.id)
                          .map((x) => ({ value: x.id, label: x.name }))}
                        placeholder="Fundir em…"
                        size="sm"
                        data-testid="condition-merge-target"
                      />
                    </span>
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={!target || busy}
                      onClick={() => void merge(r)}
                      data-testid="condition-merge-confirm"
                    >
                      Fundir ({r.patients} vínculo{r.patients === 1 ? '' : 's'})
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setMerging(null)}>
                      Cancelar
                    </Button>
                  </span>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={rows.length < 2}
                    onClick={() => {
                      setMerging(r.id);
                      setTarget('');
                    }}
                    data-testid="condition-merge"
                  >
                    Fundir em…
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
```

- [ ] **Step 2: Página e link**

```tsx
// apps/web/app/(medica)/configuracoes/condicoes/page.tsx
import Link from 'next/link';
import { listConditions } from '@medcheckin/core';
import { getDb } from '@/lib/db';
import { requireUserPage } from '@/lib/session';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ConditionsTable } from '@/components/medica/ConditionsTable';

export const dynamic = 'force-dynamic';

export default async function CondicoesPage() {
  const session = await requireUserPage();
  const rows = await listConditions(getDb(), session.clinicId);
  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm text-muted-foreground">
          <Link href="/configuracoes" className="underline underline-offset-4">
            Configurações
          </Link>{' '}
          / Condições
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">Condições da clínica</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Tudo que você já digitou como condição de algum paciente. O CID-10 é opcional. Se duas
          grafias viraram duas linhas, use <strong>Fundir em…</strong>: os pacientes passam para a
          condição escolhida e a outra some.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>
            {rows.length} condiç{rows.length === 1 ? 'ão' : 'ões'}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ConditionsTable rows={rows} />
        </CardContent>
      </Card>
    </div>
  );
}
```

Em `apps/web/app/(medica)/configuracoes/page.tsx`, logo abaixo do `<p className="mt-3">…Guia da médica…</p>` (linhas 77-85), acrescentar:

```tsx
<p className="mt-2">
  <Link
    href="/configuracoes/condicoes"
    className="font-medium underline underline-offset-4"
    data-testid="conditions-link"
  >
    Condições da clínica (CID-10, fundir duplicadas)
  </Link>
</p>
```

- [ ] **Step 3: Typecheck + lint**

Run: `npm run typecheck -w @medcheckin/web && npm run lint`. Expected: verde.

- [ ] **Step 4: Prettier + commit**

```bash
npx prettier --write apps/web/components/medica/ConditionsTable.tsx "apps/web/app/(medica)/configuracoes"
git add apps/web/components/medica/ConditionsTable.tsx "apps/web/app/(medica)/configuracoes"
git commit -m "feat(web): Configurações → Condições — CID-10 inline e fundir duplicadas (D36)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: E2E — prontuário e condições

**Files:**

- Create: `apps/web/e2e/prontuario.spec.ts`, `apps/web/e2e/condicoes.spec.ts`

**Interfaces:**

- Consumes: helpers `loginAsDoctor`, `abrirConfiguracao`, `abrirCaso`, `escolher`; `createPatient`, `addMedication`, `addPatientCondition`, `findOrCreateCondition` de `@medcheckin/core`; test ids das Tasks 8-10.

Os specs criam pacientes próprios (o seed é compartilhado com outros specs e `dose_events` tem unique por dia).

- [ ] **Step 1: `prontuario.spec.ts`**

```ts
// apps/web/e2e/prontuario.spec.ts
import { test, expect } from '@playwright/test';
import { createDb, createPatient, addMedication, type Session } from '@medcheckin/core';
import { abrirCaso, abrirConfiguracao, loginAsDoctor } from './helpers';

/**
 * E12.1 / D35 — nota na consulta, ajuste de dose no mesmo dia aparece sob a nota, editar, ocultar.
 */
test.describe('prontuário', () => {
  test('nota + ajuste de dose no mesmo dia → agrupados; editar; ocultar', async ({
    page,
    context,
    baseURL,
  }) => {
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
          name: 'Paciente Prontuário E2E',
          respondents: [{ kind: 'caregiver', name: 'C', email: 'pront@x.test' }],
          consent_version: 'v1',
        },
        new Date(),
      );
      await addMedication(db, doctor, patient.id, { name: 'Óleo Prontuário 10 mg/ml' }, new Date());

      await page.goto(`/pacientes/${patient.id}`);
      const card = page.getByTestId('prontuario-card');
      await expect(card).toContainText('Nenhuma nota ainda');

      // 1. nova nota (Ctrl+Enter salva)
      await card.getByTestId('note-new').click();
      await card.getByTestId('note-body').fill('Queixa de dor 7/10. Conduta: subir para 4 gotas.');
      await card.getByTestId('note-body').press('Control+Enter');
      const nota = card.getByTestId('note-item');
      await expect(nota).toContainText('Queixa de dor 7/10');
      await expect(nota).toContainText('Consulta');

      // 2. ajuste de dose hoje → aparece no MESMO dia, embaixo da nota
      await abrirConfiguracao(page);
      const med = page.getByTestId('medication').first();
      await med.getByRole('button', { name: 'Ajustar dose' }).click();
      await page.getByLabel('Dose', { exact: true }).fill('4');
      await page.getByLabel('Vezes por dia').fill('2');
      await page.getByTestId('dose-time-0').fill('08:00');
      await page.getByTestId('dose-time-1').fill('20:00');
      await page.getByLabel('Motivo').fill('dor persistente');
      await page.getByRole('button', { name: 'Registrar ajuste' }).click();
      await expect(med.getByTestId('current-dose')).toContainText('4 gotas');
      await abrirCaso(page);
      const dias = card.getByTestId('timeline-day');
      await expect(dias).toHaveCount(1);
      await expect(dias.first().getByTestId('note-item')).toContainText('Queixa de dor');
      const evento = dias.first().getByTestId('timeline-event');
      await expect(evento).toHaveCount(1);
      await expect(evento).toContainText(
        'Óleo Prontuário 10 mg/ml: 4 gotas · 2×/dia (08:00, 20:00) — dor persistente',
      );

      // 3. editar
      await card.getByTestId('note-edit').click();
      await card
        .getByTestId('note-body')
        .fill('Queixa de dor 7/10. Conduta: subir para 4 gotas. Reavaliar em 7 dias.');
      await card.getByTestId('note-save').click();
      await expect(card.getByTestId('note-item')).toContainText('Reavaliar em 7 dias');

      // 4. ocultar: some da lista, fica no banco
      await card.getByTestId('note-hide').click();
      await card.getByTestId('note-hide-confirm').click();
      await expect(card.getByTestId('note-item')).toHaveCount(0);
      await expect(card.getByTestId('timeline-event')).toHaveCount(1); // a dose continua
      const rows = await db('clinical_notes').where({ patient_id: patient.id });
      expect(rows).toHaveLength(1);
      expect(rows[0].deleted_at).not.toBeNull();
      const audit = await db('access_audit')
        .where({ patient_id: patient.id })
        .whereIn('route', ['notes.create', 'notes.update', 'notes.delete']);
      expect(audit).toHaveLength(3);
    } finally {
      await db.destroy();
    }
  });
});
```

- [ ] **Step 2: `condicoes.spec.ts`**

```ts
// apps/web/e2e/condicoes.spec.ts
import { test, expect } from '@playwright/test';
import { createDb, createPatient, addPatientCondition, type Session } from '@medcheckin/core';
import { escolher, loginAsDoctor } from './helpers';

/** E12.1 / D36 — condição pelo cabeçalho, filtro na lista, CID-10 e fusão em Configurações. */
test.describe('condições', () => {
  test('adicionar no cabeçalho → filtrar lista → CID-10 → fundir', async ({
    page,
    context,
    baseURL,
  }) => {
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
      const novo = async (name: string) =>
        (
          await createPatient(
            db,
            doctor,
            {
              name,
              respondents: [
                { kind: 'caregiver', name: 'C', email: `${name.replace(/\W/g, '')}@x.test` },
              ],
              consent_version: 'v1',
            },
            new Date(),
          )
        ).patient;
      const pa = await novo('Paciente Cond A E2E');
      const pb = await novo('Paciente Cond B E2E');
      // B já tem "Autismo"; A vai ganhar "TEA" pela tela e depois TEA será fundida em Autismo
      await addPatientCondition(db, doctor, pb.id, { name: 'Autismo' }, new Date());

      // 1. cabeçalho: adicionar "TEA"
      await page.goto(`/pacientes/${pa.id}`);
      await page.getByTestId('condition-edit').click();
      await page.getByTestId('condition-input').fill('TEA');
      await page.getByTestId('condition-input').press('Enter');
      await expect(page.getByTestId('condition-badge')).toContainText('TEA');

      // 2. lista filtra por TEA: só A
      const tea = await db('conditions')
        .where({ clinic_id: user.clinic_id, name_key: 'tea' })
        .first();
      await page.goto('/pacientes');
      await escolher(page, 'conditions-filter', 'TEA (1)');
      await expect(page).toHaveURL(new RegExp(`condition=${tea.id}`));
      await expect(page.getByRole('row', { name: /Paciente Cond A E2E/ })).toBeVisible();
      await expect(page.getByRole('row', { name: /Paciente Cond B E2E/ })).toHaveCount(0);

      // 3. Configurações → Condições: CID-10 e fundir TEA em Autismo
      await page.goto('/configuracoes/condicoes');
      const linhaTea = page.getByTestId('condition-row').filter({ hasText: 'TEA' });
      await linhaTea.getByTestId('condition-cid10').fill('f84.0');
      await linhaTea.getByTestId('condition-cid10').press('Enter');
      await expect(linhaTea.getByTestId('condition-cid10')).toHaveValue('F84.0');
      await linhaTea.getByTestId('condition-merge').click();
      await escolher(page, 'condition-merge-target', 'Autismo');
      await linhaTea.getByTestId('condition-merge-confirm').click();
      await expect(page.getByTestId('condition-row').filter({ hasText: 'TEA' })).toHaveCount(0);
      const linhaAut = page.getByTestId('condition-row').filter({ hasText: 'Autismo' });
      await expect(linhaAut).toContainText('2');

      // 4. A agora tem Autismo
      await page.goto(`/pacientes/${pa.id}`);
      await expect(page.getByTestId('condition-badge')).toContainText('Autismo');
      expect(await db('conditions').where({ id: tea.id }).first()).toBeUndefined();
    } finally {
      await db.destroy();
    }
  });
});
```

Se `escolher(page, 'conditions-filter', 'TEA (1)')` falhar porque o `SimpleSelect` do filtro está com `data-testid` no gatilho e a opção tem rótulo diferente, ajustar o rótulo no teste ao que a tela mostra, não a tela ao teste.

- [ ] **Step 3: Rodar os dois e depois a suíte inteira**

Run: `npm run test:e2e -- e2e/prontuario.spec.ts e2e/condicoes.spec.ts` e depois `npm run test:e2e`.
Expected: verde. Falha em componente/core → STOP e reportar BLOCKED com o erro (não corrigir código das Tasks 1-10 dentro desta task).

- [ ] **Step 4: Prettier + commit**

```bash
npx prettier --write apps/web/e2e/prontuario.spec.ts apps/web/e2e/condicoes.spec.ts
git add apps/web/e2e/prontuario.spec.ts apps/web/e2e/condicoes.spec.ts
git commit -m "test(e2e): prontuário (nota + dose agrupados, editar, ocultar) e condições (cabeçalho, filtro, CID-10, fundir)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: Docs — LGPD, manual, D35/D36, PLANO, todo

**Files:**

- Modify: `docs/LGPD.md` (nova seção antes de "## Retenção automática"), `docs/MANUAL_MEDICA.md` (aba "O caso", cabeçalho, lista, Configurações), `DECISOES.md` (D35, D36 após D34), `PLANO.md` (E12.1 `[x]`, linha no log), `tasks/todo.md` (seção da feature)

- [ ] **Step 1: LGPD**

Inserir antes de `## Retenção automática`:

```markdown
## Prontuário (notas clínicas e condições) — E12.1

- **Nota clínica** (`clinical_notes`) é texto livre da médica sobre a consulta: dado de saúde do titular, base legal = tutela da saúde e obrigação de guarda do prontuário (CFM 1.821/2007). Nunca é apagada pelo botão: **Ocultar** grava `deleted_at`; a nota segue no banco, entra no `export.zip` (`clinical_notes.json`, inclusive ocultas) e na auditoria.
- **Anonimização** troca o corpo de toda nota por `[removido]` e mantém tipo e data (série clínica sem identidade). Os vínculos com condições (`patient_conditions`) são removidos; o catálogo de condições da clínica fica.
- **Condições** (`conditions`, `patient_conditions`) são catálogo da clínica; entram no export como `conditions.json`.
- **Auditoria**: `notes.create`, `notes.update`, `notes.delete`, `notes.read` (cada abertura da linha do tempo), `conditions.add`, `conditions.remove`, `conditions.merge`.
- Nada de texto clínico sai da máquina nesta etapa. A E12.3 (importação por agente) exigirá termo de consentimento próprio e pseudonimização antes de qualquer envio.
```

- [ ] **Step 2: Manual**

Em `#### Aba "O caso"` (linha ~121), acrescentar como primeiro item:

```markdown
**Prontuário** — o primeiro card. Toque em **Nova nota**, escreva como você escreve (tipo: consulta, evolução ou contato; a data vem hoje e pode ser mudada) e salve com o botão ou **Ctrl+Enter**. Abaixo fica a **linha do tempo**: por dia, a sua nota e, logo embaixo, o **ajuste de dose** e a **conduta** daquele dia, sem você repetir nada no texto. **Editar** corrige; **Ocultar** tira da lista, mas a nota fica guardada (prontuário não se apaga). **Imprimir / salvar PDF** imprime a linha do tempo inteira.
```

Em `### 4.4 Paciente — a página de trabalho` (cabeçalho), acrescentar:

```markdown
As **condições** do paciente aparecem como etiquetas ao lado do nome. **Editar condições** abre um campo: escreva (ex.: _epilepsia_), Enter adiciona; o **×** remove. Nomes já usados em outros pacientes aparecem como sugestão, para não virar duas grafias da mesma coisa.
```

Em `### 4.2 Pacientes — a lista`: `Filtro **Condição** ao lado do botão Novo paciente: mostra só quem tem aquela condição, com a contagem.`

Em `### 4.6 Configurações`: `**Condições da clínica** — tudo que você já digitou como condição, com o **CID-10** opcional (ex.: _F84.0_) e **Fundir em…** para juntar duas grafias que viraram duas linhas: os pacientes passam para a escolhida e a outra some.`

Em `### 4.3 Novo paciente`, trocar a menção a "Condições (separadas por vírgula)" por "**Condições**: escreva e dê Enter para cada uma; sugestões vêm do que a clínica já usa."

- [ ] **Step 3: DECISOES**

Após a linha de D34:

```markdown
| D35 | **Nota clínica é texto livre datado, nunca apagada**: um texto por consulta com tipo (consulta, evolução, contato, importada) e data da ocorrência; sem seções obrigatórias nem templates; "apagar" oculta (`deleted_at`) e a nota segue no banco, no export e na auditoria; a **linha do tempo agrupa por dia civil do paciente** (nota em cima, ajuste de dose e conduta do mesmo dia embaixo) | A v1 criou tabelas de prontuário com templates e ficaram vazias (3 notas em 910 pacientes); prontuário tem guarda legal e não se apaga; a médica não deve repetir no texto o que o sistema já registrou |
| D36 | **Condições em catálogo da clínica pelo padrão D34** (`conditions.name_key` único por clínica, find-or-create em autocommit), **CID-10 opcional** validado só no formato, **Fundir** move vínculos para corrigir duplicata; `patients.condition_tags` migrou para `patient_conditions` e a coluna saiu | 266 tags livres da v1 em 3.455 vínculos: "Ansiedade" e "ansiedade generalizada" não podem virar dois filtros; CID obrigatório faria o agente da E12.3 errar milhares de códigos |
```

- [ ] **Step 4: PLANO e todo**

`PLANO.md`: `#### E12.1 — Prontuário mínimo \`[~]\``→`\`[x]\``; primeira linha de dados do log:

```markdown
| 2026-09-15 | E12.1 | Prontuário mínimo (D35, D36): migration 013 (`clinical_notes`, `conditions`, `patient_conditions`; `condition_tags` migrado e removido), `catalogNameKey` genérica, módulos `conditions`/`notes`/`patients/timeline` no core, rotas, card Prontuário na aba "O caso", condições no cabeçalho + filtro + Configurações → Condições (CID-10, fundir), export/anonimização/auditoria cobrindo notas. Spec em `docs/superpowers/specs/2026-09-15-prontuario-minimo-design.md`. N testes + M E2E. |
```

(substituir N e M pelos totais reais dos runs).

`tasks/todo.md`: acrescentar no topo uma seção `# E12.1 Prontuário mínimo (15/09, \`feat/prontuario-minimo\`)`com um item`[x]`por task deste plano e o SHA de cada commit, mais uma subseção`## Revisão` com desvios e follow-ups encontrados.

- [ ] **Step 5: Prettier + commit**

```bash
npx prettier --write docs/LGPD.md docs/MANUAL_MEDICA.md DECISOES.md PLANO.md tasks/todo.md
git add docs/LGPD.md docs/MANUAL_MEDICA.md DECISOES.md PLANO.md tasks/todo.md
git commit -m "docs: prontuário mínimo — LGPD, manual, D35/D36, log do PLANO e todo

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 13: Verificação final

**Files:** nenhum.

- [ ] **Step 1: Gate do repo + E2E**

Run: `npm run check && npm run test:e2e`
Expected: tudo verde. Anotar totais (core, web, E2E).

- [ ] **Step 2: Migração num banco com dados**

Com o compose de pé: `npm run migrate` no banco de dev (que tem pacientes com `condition_tags` do seed e do uso). Conferir com uma consulta que `conditions` tem as tags antigas e `patients` não tem mais a coluna. Subir o web pela launch config (controller), abrir um paciente, ver as badges vindo do catálogo, escrever uma nota, ajustar dose, ver o agrupamento, imprimir. Screenshot.

- [ ] **Step 3: Diff contra `main`**

Run: `git diff --stat main..HEAD`
Expected: só arquivos da "Estrutura de arquivos". `grep -rn "condition_tags\|ProductNameInput\|productNameKey" apps packages/core/src --include=*.ts --include=*.tsx --include=*.js | grep -v "migrations/01[23]\|catalog/nameKey\|medications/nameKey"` deve voltar vazio.

- [ ] **Step 4: Parar e reportar**

Sem push, sem PR até o dono pedir. Reportar totais, screenshot, desvios e follow-ups.
