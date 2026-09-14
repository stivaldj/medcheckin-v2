# Medicação por nome — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A médica digita o nome de um produto no card "Medicações e dose vigente", confirma, e a medicação entra no paciente; o produto nasce na clínica se ainda não existia e é reaproveitado se já existia.

**Architecture:** Normalização de nome (`productNameKey`) num módulo puro do core, usado pela migration, pelo find-or-create do backend e pelo filtro de sugestões no cliente. `products.name_key` com índice único por clínica garante o dedupe mesmo em corrida. `addMedication` aceita `product_id` ou `name`; a UI troca o select fechado por um campo "digite ou escolha" que sempre envia `name`.

**Tech Stack:** Node 22 ESM, Knex + Postgres (sem SQLite, D6), vitest (`packages/core`), Next.js 15 App Router + base-ui + Tailwind (`apps/web`), Playwright E2E contra build de produção.

**Spec:** `docs/superpowers/specs/2026-09-14-medicacao-por-nome-design.md`

## Global Constraints

- Postgres real em todos os testes: `DATABASE_URL_TEST` (ou `DATABASE_URL`) obrigatória. Local: porta 5434 (`docker compose up -d`).
- Comandos de teste: core `npm test -w @medcheckin/core`; web `npm run typecheck -w @medcheckin/web`; E2E `npm run test:e2e` (precisa do Mailpit do compose de pé e faz `next build`, leva minutos).
- Textos de UI, mensagens de erro, comentários e commits em **português do Brasil**. Commits no formato `tipo(escopo): mensagem` e terminando com `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- `name_key` = `trim`, minúsculas, sem diacríticos (NFD + remoção de `\p{M}`), espaços internos colapsados em um. O nome **exibido** fica como digitado.
- Nome do produto: mínimo 2 caracteres, máximo 120.
- Sem extensão `unaccent`, sem rota de API nova, sem fonte externa de medicamentos.
- Nunca `git push`/PR sem o dono pedir. Branch: `feat/medicacao-por-nome` (já criada, spec commitada).

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
| --- | --- |
| `packages/core/src/medications/nameKey.js` (novo) | `productNameKey(name)`: função pura, sem dependências. Importada pela migration, pelo core e pelo cliente web. |
| `packages/core/src/medications/nameKey.d.ts` (novo) | Tipo da função para o subpath export. |
| `packages/core/package.json` | Subpath export `./name-key` (cliente web importa sem puxar knex). |
| `packages/core/src/migrations/012_product_name_key.js` (novo) | Coluna `name_key`, backfill em JS, NOT NULL, unique `(clinic_id, name_key)`. |
| `packages/core/src/medications/index.js` | `findOrCreateProduct`, `createProduct` via find-or-create, `addMedication` por `product_id` ou `name`. |
| `packages/core/src/index.js`, `src/index.d.ts` | Exports e tipos. |
| `packages/core/test/name-key.test.js` (novo) | Testes puros da normalização. |
| `packages/core/test/medications-by-name.test.js` (novo) | Find-or-create, addMedication por nome, corrida. |
| `packages/core/test/migrations.test.js` | Caso: colisão de chaves faz a 012 falhar nomeando ids. |
| `apps/web/components/medica/ProductNameInput.tsx` (novo) | Campo "digite ou escolha": input + lista de sugestões, teclado, ARIA. |
| `apps/web/components/medica/MedicationsCard.tsx` | Usa `ProductNameInput`, envia `{ name }`. |
| `apps/web/app/api/patients/[id]/medications/route.ts` | Tipo do body. |
| `apps/web/e2e/medicacao-por-nome.spec.ts` (novo) | Digitar cria; segundo paciente vê sugestão e reaproveita. |
| `docs/MANUAL_MEDICA.md`, `DECISOES.md`, `PLANO.md` | Manual, D34, log. |

---

### Task 1: `productNameKey` — módulo puro + subpath export

**Files:**
- Create: `packages/core/src/medications/nameKey.js`
- Create: `packages/core/src/medications/nameKey.d.ts`
- Modify: `packages/core/package.json` (bloco `exports`)
- Test: `packages/core/test/name-key.test.js`

**Interfaces:**
- Produces: `productNameKey(name: unknown): string` — exportada de `@medcheckin/core` (Task 3) e de `@medcheckin/core/name-key` (cliente).

- [ ] **Step 1: Escrever o teste que falha**

```js
// packages/core/test/name-key.test.js
import { describe, it, expect } from 'vitest';
import { productNameKey } from '../src/medications/nameKey.js';

// D34: produto é identificado na clínica pela chave normalizada, não pelo texto digitado.
describe('productNameKey', () => {
  it('minúsculas, sem acento, espaços colapsados, sem bordas', () => {
    expect(productNameKey('  Óleo  CBD 50mg/ml ')).toBe('oleo cbd 50mg/ml');
  });
  it('variações de caixa e acento dão a mesma chave', () => {
    expect(productNameKey('ÓLEO CBD')).toBe(productNameKey('oleo cbd'));
    expect(productNameKey('Canabidiol Prati-Donaduzzi')).toBe('canabidiol prati-donaduzzi');
  });
  it('preserva pontuação que distingue produtos', () => {
    expect(productNameKey('CBD 50mg/ml')).not.toBe(productNameKey('CBD 5mg/ml'));
  });
  it('entrada vazia ou não-string vira string vazia', () => {
    expect(productNameKey('')).toBe('');
    expect(productNameKey(null)).toBe('');
    expect(productNameKey(undefined)).toBe('');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -w @medcheckin/core -- test/name-key.test.js`
Expected: FAIL — `Cannot find module '../src/medications/nameKey.js'`

- [ ] **Step 3: Implementar**

```js
// packages/core/src/medications/nameKey.js
/**
 * D34 — chave de identidade de um produto dentro da clínica.
 *
 * O nome exibido fica como a médica digitou; esta chave é o que o índice único compara.
 * Módulo puro (sem knex, sem imports) de propósito: a migration 012 e o cliente web
 * importam daqui, e a normalização tem que ser idêntica nos três lugares.
 */
export function productNameKey(name) {
  if (typeof name !== 'string') return '';
  return name
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}
```

```ts
// packages/core/src/medications/nameKey.d.ts
export function productNameKey(name: unknown): string;
```

Em `packages/core/package.json`, dentro de `"exports"`, acrescentar depois de `"./db"`:

```json
    "./name-key": {
      "types": "./src/medications/nameKey.d.ts",
      "default": "./src/medications/nameKey.js"
    }
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test -w @medcheckin/core -- test/name-key.test.js`
Expected: PASS (4 testes)

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/medications/nameKey.js packages/core/src/medications/nameKey.d.ts packages/core/package.json packages/core/test/name-key.test.js
git commit -m "feat(core): productNameKey — chave normalizada do produto (D34)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Migration 012 — `products.name_key` único por clínica

**Files:**
- Create: `packages/core/src/migrations/012_product_name_key.js`
- Modify: `packages/core/test/migrations.test.js` (novo `it` no fim do `describe`)

**Interfaces:**
- Consumes: `productNameKey` de `../medications/nameKey.js`.
- Produces: coluna `products.name_key text NOT NULL`, índice único `products_clinic_id_name_key_unique` em `(clinic_id, name_key)`. Inserts em `products` a partir daqui **precisam** informar `name_key`.

- [ ] **Step 1: Escrever o teste que falha**

Acrescentar ao fim do `describe` em `packages/core/test/migrations.test.js` (antes do `});` final):

```js
  /**
   * D34 — o backfill da 012 não funde produtos às cegas: duas linhas da mesma clínica que caem
   * na mesma chave fazem a migration falhar nomeando os ids, para alguém decidir.
   */
  it('012 falha com mensagem clara quando dois produtos da clínica têm a mesma chave', async () => {
    await db.raw('drop schema public cascade; create schema public');
    // sobe até a 011 (tudo menos a última)
    const [, pendentes] = await db.migrate.list(migrationConfig);
    for (let i = 0; i < pendentes.length - 1; i += 1) await db.migrate.up(migrationConfig);
    expect(await db.schema.hasColumn('products', 'name_key')).toBe(false);

    const [clinic] = await db('clinics').insert({ name: 'Clínica colisão' }).returning('id');
    await db('products').insert([
      { clinic_id: clinic.id, name: 'Óleo CBD 50mg/ml', form: 'oil' },
      { clinic_id: clinic.id, name: 'oleo cbd 50mg/ml', form: 'oil' },
    ]);

    await expect(db.migrate.up(migrationConfig)).rejects.toThrow(/mesma chave.*oleo cbd 50mg\/ml/);

    // sem a colisão, a 012 sobe e o índice único vale
    await db('products').where({ name: 'oleo cbd 50mg/ml' }).delete();
    await db.migrate.up(migrationConfig);
    const row = await db('products').where({ name: 'Óleo CBD 50mg/ml' }).first();
    expect(row.name_key).toBe('oleo cbd 50mg/ml');
    await expect(
      db('products').insert({
        clinic_id: clinic.id,
        name: 'ÓLEO CBD 50MG/ML',
        name_key: 'oleo cbd 50mg/ml',
        form: 'oil',
      }),
    ).rejects.toMatchObject({ code: '23505' });
  });
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -w @medcheckin/core -- test/migrations.test.js`
Expected: FAIL — `db.migrate.up` da última pendente não rejeita (a 012 ainda não existe; `hasColumn` já é `false` e o `rejects.toThrow` falha).

- [ ] **Step 3: Implementar a migration**

```js
// packages/core/src/migrations/012_product_name_key.js
import { productNameKey } from '../medications/nameKey.js';

/**
 * D34 — produto identificado na clínica por `name_key` (nome normalizado), com índice único.
 *
 * Antes, `products` só nascia pelo seed ou por uma rota que nenhuma tela chamava, e a médica
 * ficava com um select vazio. Agora ela digita o nome; o backend acha ou cria. Para "achar"
 * ser confiável (inclusive com o agente da E12 escrevendo o mesmo produto de dez jeitos, e com
 * duas requisições em paralelo), a chave vive no banco com unique por clínica.
 *
 * Backfill em JS com a MESMA função do runtime — sem `unaccent`, para a chave ser idêntica
 * nos dois lugares. Colisão no backfill = falha nomeando os ids: só existem produtos de seed
 * hoje, e fundir dados às cegas seria pior do que parar.
 */
export async function up(knex) {
  await knex.schema.alterTable('products', (t) => {
    t.text('name_key');
  });

  const rows = await knex('products').select('id', 'clinic_id', 'name');
  const vistos = new Map(); // `${clinic_id}|${key}` -> id
  for (const r of rows) {
    const key = productNameKey(r.name);
    const k = `${r.clinic_id}|${key}`;
    if (vistos.has(k)) {
      throw new Error(
        `migration 012: produtos ${vistos.get(k)} e ${r.id} da clínica ${r.clinic_id} têm a ` +
          `mesma chave "${key}". Renomeie ou funda um deles antes de migrar.`,
      );
    }
    vistos.set(k, r.id);
    await knex('products').where({ id: r.id }).update({ name_key: key });
  }

  await knex.schema.alterTable('products', (t) => {
    t.text('name_key').notNullable().alter();
    t.unique(['clinic_id', 'name_key']);
  });
}

export async function down(knex) {
  await knex.schema.alterTable('products', (t) => {
    t.dropUnique(['clinic_id', 'name_key']);
    t.dropColumn('name_key');
  });
}
```

- [ ] **Step 4: Corrigir o seed, que insere em `products` sem `name_key`**

Em `packages/core/src/seed/index.js`, no insert de `products` (por volta da linha 124), acrescentar `name_key`. Importar no topo do arquivo:

```js
import { productNameKey } from '../medications/nameKey.js';
```

e no insert:

```js
    const [product] = await trx('products')
      .insert({
        clinic_id: clinic.id,
        name: 'Óleo Full Spectrum CBD 50mg/ml',
        name_key: productNameKey('Óleo Full Spectrum CBD 50mg/ml'),
        cbd_mg_ml: 50,
        thc_mg_ml: 0.5,
        form: 'oil',
      })
      .returning('id');
```

Também nos testes que inserem `products` direto: `packages/core/test/doses.test.js` (linha ~13) e qualquer outro que `grep -rn "db('products')" packages/core/test apps/web/e2e` mostrar inserindo — acrescentar `name_key: productNameKey(<mesmo nome>)` com o import `from '../src/medications/nameKey.js'`.

- [ ] **Step 5: Rodar toda a suíte do core**

Run: `npm test -w @medcheckin/core`
Expected: PASS em tudo, inclusive `migrations.test.js` (o caso novo) e `seed.test.js`.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/migrations/012_product_name_key.js packages/core/src/seed/index.js packages/core/test
git commit -m "feat(core): migration 012 — products.name_key único por clínica, backfill que recusa colisão (D34)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Core — `findOrCreateProduct` e `addMedication` por nome

**Files:**
- Modify: `packages/core/src/medications/index.js:16-50`
- Modify: `packages/core/src/index.js:66-72`
- Modify: `packages/core/src/index.d.ts:567-575` e `:721-733`
- Test: `packages/core/test/medications-by-name.test.js`

**Interfaces:**
- Consumes: `productNameKey` (Task 1); coluna `name_key` (Task 2).
- Produces:
  - `findOrCreateProduct(db, session, { name, form?, cbd_mg_ml?, thc_mg_ml? }) → Promise<{ product: ProductRow, created: boolean }>`
  - `addMedication(db, session, patientId, { product_id?: string, name?: string }, now) → Promise<MedicationRow & { product_name: string }>`
  - `createProduct(db, session, input) → Promise<ProductRow>` (mesma assinatura, agora idempotente por chave).

**Por que o find-or-create fica fora da transação da medicação:** no Postgres, um `23505` dentro de uma transação aborta a transação inteira; a releitura seguinte falharia com "current transaction is aborted". Criar produto é idempotente por chave, então roda em autocommit; a transação cobre só `medications` + `logAccess`.

- [ ] **Step 1: Escrever os testes que falham**

```js
// packages/core/test/medications-by-name.test.js
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { freshDb, seedClinic, seedPatient } from './helpers/db.js';
import { addMedication, findOrCreateProduct, createProduct } from '../src/medications/index.js';

// D34: a médica digita o nome; o backend acha ou cria o produto e vincula ao paciente.
describe('medicação por nome', () => {
  let db, ctx, session, patientId;
  const NOW = new Date('2026-09-14T12:00:00Z');
  beforeAll(async () => {
    db = await freshDb();
    ctx = await seedClinic(db, 'nome');
    patientId = await seedPatient(db, ctx);
    session = {
      kind: 'user',
      sessionId: 't',
      userId: ctx.userId,
      clinicId: ctx.clinicId,
      role: 'doctor',
      name: 'Dra.',
      email: 'dra-nome@example.test',
    };
  });
  afterAll(async () => db.destroy());

  const count = async () =>
    Number((await db('products').where({ clinic_id: ctx.clinicId }).count().first()).count);

  it('nome novo cria o produto com o texto como digitado e vincula ao paciente', async () => {
    const med = await addMedication(db, session, patientId, { name: '  Óleo CBD 50mg/ml ' }, NOW);
    expect(med.patient_id).toBe(patientId);
    expect(med.product_name).toBe('Óleo CBD 50mg/ml');
    const prod = await db('products').where({ id: med.product_id }).first();
    expect(prod.name).toBe('Óleo CBD 50mg/ml');
    expect(prod.name_key).toBe('oleo cbd 50mg/ml');
    expect(prod.form).toBe('oil');
    expect(await count()).toBe(1);
  });

  it('nome repetido com caixa e acento diferentes reaproveita o produto', async () => {
    const med = await addMedication(db, session, patientId, { name: 'OLEO cbd 50MG/ML' }, NOW);
    const primeiro = await db('products').where({ clinic_id: ctx.clinicId }).first();
    expect(med.product_id).toBe(primeiro.id);
    expect(med.product_name).toBe('Óleo CBD 50mg/ml'); // o nome exibido é o do primeiro cadastro
    expect(await count()).toBe(1);
  });

  it('product_id continua funcionando', async () => {
    const prod = await db('products').where({ clinic_id: ctx.clinicId }).first();
    const med = await addMedication(db, session, patientId, { product_id: prod.id }, NOW);
    expect(med.product_id).toBe(prod.id);
    expect(med.product_name).toBe(prod.name);
  });

  it('recusa nome curto, nome longo e ausência de nome e product_id', async () => {
    await expect(addMedication(db, session, patientId, { name: 'x' }, NOW)).rejects.toMatchObject({
      code: 'validation',
      field: 'name',
    });
    await expect(
      addMedication(db, session, patientId, { name: 'a'.repeat(121) }, NOW),
    ).rejects.toMatchObject({ code: 'validation', field: 'name' });
    await expect(addMedication(db, session, patientId, {}, NOW)).rejects.toMatchObject({
      code: 'validation',
      field: 'name',
    });
  });

  it('product_id de outra clínica é not_found', async () => {
    const outra = await seedClinic(db, 'outra');
    const { product } = await findOrCreateProduct(
      db,
      { ...session, clinicId: outra.clinicId, userId: outra.userId },
      { name: 'Produto da outra' },
    );
    await expect(
      addMedication(db, session, patientId, { product_id: product.id }, NOW),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('duas chamadas em paralelo com o mesmo nome novo criam um produto só', async () => {
    const antes = await count();
    const [a, b] = await Promise.all([
      addMedication(db, session, patientId, { name: 'Canabidiol 200mg/ml' }, NOW),
      addMedication(db, session, patientId, { name: 'canabidiol 200MG/ML' }, NOW),
    ]);
    expect(a.product_id).toBe(b.product_id);
    expect(await count()).toBe(antes + 1);
  });

  it('createProduct passa a ser idempotente pela chave', async () => {
    const p1 = await createProduct(db, session, { name: 'Gotas THC 1%' });
    const p2 = await createProduct(db, session, { name: 'gotas thc 1%' });
    expect(p2.id).toBe(p1.id);
    expect(p1.name_key).toBe('gotas thc 1%');
  });

  it('findOrCreateProduct exige sessão de médica', async () => {
    await expect(findOrCreateProduct(db, null, { name: 'Qualquer' })).rejects.toMatchObject({
      code: 'unauthenticated',
    });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -w @medcheckin/core -- test/medications-by-name.test.js`
Expected: FAIL — `findOrCreateProduct` não é exportada; `addMedication` com `name` lança `not_found` (procura `product_id: undefined`).

- [ ] **Step 3: Implementar no core**

Substituir em `packages/core/src/medications/index.js` o bloco de `createProduct` e `addMedication` (linhas 20–50) por:

```js
import { productNameKey } from './nameKey.js';

const NAME_MAX = 120;

/**
 * D34 — acha ou cria o produto pela chave normalizada. Idempotente: em corrida, quem perde o
 * insert (23505 no unique) relê e devolve o mesmo produto. Roda em autocommit de propósito
 * (um 23505 dentro de transação a abortaria inteira).
 */
export async function findOrCreateProduct(db, session, input) {
  requireDoctor(session);
  const name = String(input?.name ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (name.length < 2) throw new ValidationError('Nome do produto é obrigatório.', 'name');
  if (name.length > NAME_MAX)
    throw new ValidationError(`Nome do produto muito longo (máx. ${NAME_MAX}).`, 'name');
  const form = String(input?.form ?? 'oil');
  if (!FORMS.has(form)) throw new ValidationError('Forma farmacêutica inválida.', 'form');
  const num = (v) => (v === undefined || v === null || v === '' ? null : Number(v));
  const cbd = num(input?.cbd_mg_ml);
  const thc = num(input?.thc_mg_ml);
  if ((cbd !== null && !(cbd >= 0)) || (thc !== null && !(thc >= 0)))
    throw new ValidationError('Concentração inválida.');

  const where = { clinic_id: session.clinicId, name_key: productNameKey(name) };
  const existing = await db('products').where(where).first();
  if (existing) return { product: existing, created: false };
  try {
    const [row] = await db('products')
      .insert({ ...where, name, form, cbd_mg_ml: cbd, thc_mg_ml: thc })
      .returning('*');
    return { product: row, created: true };
  } catch (err) {
    if (err?.code !== '23505') throw err;
    const again = await db('products').where(where).first();
    if (!again) throw err;
    return { product: again, created: false };
  }
}

export async function createProduct(db, session, input) {
  const { product } = await findOrCreateProduct(db, session, input);
  return product;
}

/**
 * Aceita `product_id` (produto já existente na clínica) ou `name` (acha ou cria). Devolve a
 * medicação com `product_name` para a tela não precisar de outra chamada.
 */
export async function addMedication(db, session, patientId, input, now) {
  requireDoctor(session);
  await requirePatientInClinic(db, session, patientId);
  let product;
  if (input?.product_id) {
    product = await db('products')
      .where({ id: input.product_id, clinic_id: session.clinicId })
      .first();
    if (!product) throw new AuthError('not_found', 'Produto não encontrado.');
  } else {
    ({ product } = await findOrCreateProduct(db, session, { name: input?.name }));
  }
  return db.transaction(async (trx) => {
    const [row] = await trx('medications')
      .insert({ patient_id: patientId, product_id: product.id })
      .returning('*');
    await logAccess(trx, { session, patientId, route: 'medications.create', action: 'update' }, now);
    return { ...row, product_name: product.name };
  });
}
```

Atenção: o `import { productNameKey }` vai no topo do arquivo, junto dos outros imports. Quando `input` é `{}`, `findOrCreateProduct` recebe `{ name: undefined }` e lança `ValidationError` em `name`, que é o comportamento esperado pelo teste.

Em `packages/core/src/index.js`, no bloco de export de `./medications/index.js`, acrescentar `findOrCreateProduct`; e acrescentar uma linha:

```js
export { productNameKey } from './medications/nameKey.js';
```

Em `packages/core/src/index.d.ts`:

```ts
export interface ProductRow {
  id: string;
  clinic_id: string;
  name: string;
  name_key: string;
  cbd_mg_ml: number | null;
  thc_mg_ml: number | null;
  form: string;
}
```

e, no lugar da assinatura atual de `addMedication`:

```ts
export function productNameKey(name: unknown): string;
export function findOrCreateProduct(
  db: Knex,
  session: Session,
  input: { name: string; form?: string; cbd_mg_ml?: number | null; thc_mg_ml?: number | null },
): Promise<{ product: ProductRow; created: boolean }>;
export type AddMedicationInput = { product_id: string } | { name: string };
export function addMedication(
  db: Knex,
  session: Session,
  patientId: string,
  input: AddMedicationInput,
  now?: Instant,
): Promise<MedicationRow & { product_name: string }>;
```

(`MedicationRow` já existe no arquivo, logo abaixo de `ProductRow`.)

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test -w @medcheckin/core`
Expected: PASS em tudo (o novo arquivo com 8 testes; `lgpd.test.js` e outros que chamam `addMedication` com `product_id` continuam verdes).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/medications/index.js packages/core/src/index.js packages/core/src/index.d.ts packages/core/test/medications-by-name.test.js
git commit -m "feat(core): addMedication por nome — find-or-create do produto pela chave, imune a corrida (D34)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: UI — `ProductNameInput` e o card enviando `{ name }`

**Files:**
- Create: `apps/web/components/medica/ProductNameInput.tsx`
- Modify: `apps/web/components/medica/MedicationsCard.tsx` (imports, estado, `addMed`, o `<form>`)
- Modify: `apps/web/app/api/patients/[id]/medications/route.ts:8`

**Interfaces:**
- Consumes: `productNameKey` de `@medcheckin/core/name-key` (Task 1); `AddMedicationInput` (Task 3); `POST /api/patients/:id/medications` com `{ name }`.
- Produces: componente `ProductNameInput` com props `{ id, value, onChange(value: string), suggestions: string[], onSubmit(): void, disabled?: boolean }`; test ids `product-input`, `product-suggestion`, `add-medication`.

Não há teste unitário de componente no `apps/web` (o E2E da Task 5 é a prova). O typecheck é o gate desta task.

- [ ] **Step 1: Criar o componente**

```tsx
// apps/web/components/medica/ProductNameInput.tsx
'use client';
import { useId, useMemo, useState } from 'react';
import { productNameKey } from '@medcheckin/core/name-key';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * Campo "digite ou escolha" (D34). A médica escreve o nome do produto como quiser; enquanto
 * digita, aparecem os produtos que a clínica já cadastrou. Escolher uma sugestão só preenche
 * o campo — quem decide entre reaproveitar e criar é o servidor, pela chave normalizada.
 * Enter confirma (chama `onSubmit`) quando nenhuma sugestão está realçada.
 */
export function ProductNameInput({
  id,
  value,
  onChange,
  suggestions,
  onSubmit,
  disabled,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  suggestions: string[];
  onSubmit: () => void;
  disabled?: boolean;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

  const filtered = useMemo(() => {
    const key = productNameKey(value);
    if (!key) return [];
    return suggestions
      .filter((s) => {
        const k = productNameKey(s);
        return k !== key && k.includes(key);
      })
      .slice(0, 8);
  }, [value, suggestions]);

  const visible = open && filtered.length > 0;

  function pick(s: string) {
    onChange(s);
    setOpen(false);
    setActive(-1);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' && filtered.length) {
      e.preventDefault();
      setOpen(true);
      setActive((a) => (a + 1) % filtered.length);
    } else if (e.key === 'ArrowUp' && filtered.length) {
      e.preventDefault();
      setOpen(true);
      setActive((a) => (a <= 0 ? filtered.length - 1 : a - 1));
    } else if (e.key === 'Escape') {
      setOpen(false);
      setActive(-1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (visible && active >= 0) pick(filtered[active]);
      else onSubmit();
    }
  }

  return (
    <div className="relative">
      <Input
        id={id}
        value={value}
        disabled={disabled}
        autoComplete="off"
        role="combobox"
        aria-expanded={visible}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={visible && active >= 0 ? `${listId}-${active}` : undefined}
        placeholder="Ex.: Óleo CBD 50 mg/ml"
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={onKeyDown}
        data-testid="product-input"
      />
      {visible && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-lg border bg-popover p-1 text-sm shadow-md"
        >
          {filtered.map((s, i) => (
            <li
              key={s}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={cn(
                'cursor-pointer rounded-md px-2 py-1.5',
                i === active ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60',
              )}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(s)}
              data-testid="product-suggestion"
            >
              {s}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Ligar o componente no card**

Em `apps/web/components/medica/MedicationsCard.tsx`:

Trocar o import de `SimpleSelect` por:

```tsx
import { ProductNameInput } from './ProductNameInput';
```

Trocar o estado e a função de envio:

```tsx
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const podeAdicionar = name.trim().length >= 2 && !busy;

  async function addMed() {
    if (!podeAdicionar) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/patients/${patientId}/medications`, {
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
```

(Remover `const [productId, setProductId] = useState(products[0]?.id ?? '');`.)

Trocar o `<form>` inteiro por:

```tsx
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void addMed();
          }}
          className="space-y-1"
        >
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Label htmlFor="product">Adicionar medicação</Label>
              <ProductNameInput
                id="product"
                value={name}
                onChange={setName}
                suggestions={products.map((p) => p.name)}
                onSubmit={() => void addMed()}
                disabled={busy}
              />
            </div>
            <Button
              type="submit"
              variant="outline"
              disabled={!podeAdicionar}
              data-testid="add-medication"
            >
              Adicionar
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {products.length === 0
              ? 'Escreva o nome do produto e toque em Adicionar. Ele fica salvo para os próximos pacientes.'
              : 'Escreva o nome ou escolha um produto já usado na clínica.'}
          </p>
        </form>
```

- [ ] **Step 3: Tipar o body da rota**

Em `apps/web/app/api/patients/[id]/medications/route.ts`:

```ts
import { addMedication, type AddMedicationInput } from '@medcheckin/core';
import { doctorRoute, json } from '@/lib/api';

export const dynamic = 'force-dynamic';

export const POST = doctorRoute<{ id: string }>(async ({ db, session, params, body }) =>
  json(await addMedication(db, session, params.id, body as AddMedicationInput, new Date()), 201),
);
```

- [ ] **Step 4: Typecheck e lint**

Run: `npm run typecheck -w @medcheckin/web && npm run lint`
Expected: sem erros. Se o TS não resolver `@medcheckin/core/name-key`, conferir que o `exports` da Task 1 tem `"types"` e que `apps/web/tsconfig.json` usa `moduleResolution: "bundler"` (já usa; o `./config` e o `./db` resolvem assim).

- [ ] **Step 5: Ver funcionando no browser (dev)**

Subir o servidor de dev pela launch config do Browser pane (não por Bash), abrir um paciente, aba "A configuração", card "Medicações e dose vigente": digitar um nome novo, Enter, ver a medicação aparecer "Sem dose vigente". Digitar de novo as três primeiras letras e ver a sugestão. Tirar um screenshot como prova.

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/medica/ProductNameInput.tsx apps/web/components/medica/MedicationsCard.tsx "apps/web/app/api/patients/[id]/medications/route.ts"
git commit -m "feat(web): adicionar medicação digitando o nome — campo digite-ou-escolha com sugestões da clínica (D34)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: E2E — digitar cria; segundo paciente reaproveita

**Files:**
- Create: `apps/web/e2e/medicacao-por-nome.spec.ts`

**Interfaces:**
- Consumes: `loginAsDoctor`, `abrirConfiguracao` de `./helpers`; `createPatient`, `createDb` de `@medcheckin/core`; test ids `product-input`, `product-suggestion`, `add-medication`, `medication`.

O seed do E2E já cria um produto ("Óleo Full Spectrum CBD 50mg/ml"), que outros specs usam. Este spec **não** esvazia o catálogo: cria dois pacientes próprios, usa um nome que não existe, e prova pela contagem de `products` que só um produto nasceu.

- [ ] **Step 1: Escrever o teste**

```ts
// apps/web/e2e/medicacao-por-nome.spec.ts
import { test, expect } from '@playwright/test';
import { createDb, createPatient, type Session } from '@medcheckin/core';
import { abrirConfiguracao, loginAsDoctor } from './helpers';

/**
 * D34 — a médica digita o nome do produto e confirma; o produto nasce na clínica na primeira
 * vez e é reaproveitado (com sugestão) na segunda, sem tela de cadastro de produto.
 */
test.describe('medicação por nome', () => {
  test('digitar cria o produto; no 2º paciente ele vem como sugestão e não duplica', async ({
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
            { name, respondents: [{ kind: 'patient', name }], consent_version: 'v1' },
            new Date(),
          )
        ).patient;
      const p1 = await novo('Paciente Nome Um E2E');
      const p2 = await novo('Paciente Nome Dois E2E');
      const NOME = 'Óleo CBD Isolado 100 mg/ml';
      const antes = Number(
        (await db('products').where({ clinic_id: user.clinic_id }).count().first())!.count,
      );

      // 1º paciente: nome novo, Enter
      await page.goto(`/pacientes/${p1.id}`);
      await abrirConfiguracao(page);
      const card = page.getByTestId('medications-card');
      await expect(card.getByTestId('product-suggestion')).toHaveCount(0);
      await card.getByTestId('product-input').fill(NOME);
      await card.getByTestId('product-input').press('Enter');
      await expect(card.getByTestId('medication')).toContainText(NOME);
      await expect(card.getByTestId('current-dose').first()).toContainText('Sem dose vigente');

      // 2º paciente: digita parte do nome, escolhe a sugestão, clica em Adicionar
      await page.goto(`/pacientes/${p2.id}`);
      await abrirConfiguracao(page);
      await card.getByTestId('product-input').fill('isolado');
      const sugestao = card.getByTestId('product-suggestion').filter({ hasText: NOME });
      await expect(sugestao).toBeVisible();
      await sugestao.click();
      await expect(card.getByTestId('product-input')).toHaveValue(NOME);
      await card.getByTestId('add-medication').click();
      await expect(card.getByTestId('medication')).toContainText(NOME);

      // um produto só nasceu; as duas medicações apontam para ele
      const depois = Number(
        (await db('products').where({ clinic_id: user.clinic_id }).count().first())!.count,
      );
      expect(depois).toBe(antes + 1);
      const prod = await db('products').where({ clinic_id: user.clinic_id, name: NOME }).first();
      const meds = await db('medications').whereIn('patient_id', [p1.id, p2.id]);
      expect(meds).toHaveLength(2);
      expect(meds.every((m) => m.product_id === prod.id)).toBe(true);
    } finally {
      await db.destroy();
    }
  });

  test('nome curto não habilita o botão e Enter não envia', async ({ page, context, baseURL }) => {
    await loginAsDoctor(context, baseURL!);
    const db = createDb(process.env.DATABASE_URL_TEST || process.env.DATABASE_URL!);
    try {
      const p = await db('patients').where({ name: 'Paciente Sintético Um' }).first();
      const antes = Number((await db('medications').where({ patient_id: p.id }).count().first())!.count);
      await page.goto(`/pacientes/${p.id}`);
      await abrirConfiguracao(page);
      const card = page.getByTestId('medications-card');
      await card.getByTestId('product-input').fill('x');
      await expect(card.getByTestId('add-medication')).toBeDisabled();
      await card.getByTestId('product-input').press('Enter');
      await page.waitForTimeout(500);
      const depois = Number((await db('medications').where({ patient_id: p.id }).count().first())!.count);
      expect(depois).toBe(antes);
    } finally {
      await db.destroy();
    }
  });
});
```

- [ ] **Step 2: Rodar o E2E**

Pré-requisito: `docker compose up -d` (Postgres 5434 + Mailpit).

Run: `npm run test:e2e -- e2e/medicacao-por-nome.spec.ts`
Expected: PASS nos 2 testes. Se `createPatient` recusar `respondents: [{ kind: 'patient', ... }]` sem e-mail, copiar o formato usado em `apps/web/e2e/lgpd.spec.ts` (caregiver com e-mail).

- [ ] **Step 3: Rodar a suíte E2E inteira**

Run: `npm run test:e2e`
Expected: todos os specs verdes (os que usam `escolher(page, 'product-select', …)`, se houver, precisam ser adaptados para `product-input` — `grep -rn "product-select" apps/web/e2e` deve voltar vazio ao fim).

- [ ] **Step 4: Commit**

```bash
git add apps/web/e2e/medicacao-por-nome.spec.ts
git commit -m "test(e2e): medicação por nome — cria no 1º paciente, sugere e reaproveita no 2º

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Manual, D34 e log do PLANO

**Files:**
- Modify: `docs/MANUAL_MEDICA.md:153`
- Modify: `DECISOES.md` (nova linha após D33, linha 157)
- Modify: `PLANO.md` (nova linha no topo da tabela "Log de progresso")

- [ ] **Step 1: Manual**

Trocar a linha

```
- **Adicionar medicação**: escolha o produto e toque em **Adicionar**. Ele nasce **sem dose vigente**.
```

por

```
- **Adicionar medicação**: escreva o nome do produto do seu jeito (ex.: _Óleo CBD 50 mg/ml_) e toque em **Adicionar** ou dê Enter. Nomes que você já usou em outros pacientes aparecem como sugestão enquanto digita; escolher um evita duplicar. A medicação nasce **sem dose vigente**.
```

- [ ] **Step 2: D34 em DECISOES.md**

Acrescentar logo abaixo da linha de D33:

```
| D34 | **Medicação se adiciona pelo nome**: a médica digita, o backend acha ou cria o produto pela chave normalizada `products.name_key` (minúsculo, sem acento, espaços colapsados; índice único por clínica); sugestões vêm só do catálogo da própria clínica; nenhuma base externa (Memed é receita e exige contrato; ANVISA tem 2 linhas com canabidiol, os óleos RDC 327/660 não constam) | Uma clínica real começa com catálogo vazio e o select fechado deixava a médica sem conseguir registrar medicação nenhuma; o agente da E12 vai escrever o mesmo produto de dez jeitos, e a chave no banco é o que impede duplicata mesmo em corrida |
```

- [ ] **Step 3: Log no PLANO.md**

Inserir como primeira linha de dados da tabela "Log de progresso":

```
| 2026-09-14 | E4    | Medicação por nome (D34): migration 012 (`products.name_key` único por clínica, backfill que recusa colisão), `findOrCreateProduct` + `addMedication` por `name` ou `product_id` no core, campo "digite ou escolha" no card de medicações com sugestões do catálogo da clínica; E12 (prontuário + importação agêntica) registrada. Spec em `docs/superpowers/specs/2026-09-14-medicacao-por-nome-design.md`. |
```

Ajustar o número de testes na linha (`N testes + M E2E`) com os totais reais dos runs das Tasks 3 e 5.

- [ ] **Step 4: Commit**

```bash
git add docs/MANUAL_MEDICA.md DECISOES.md PLANO.md
git commit -m "docs: manual, D34 e log — medicação por nome

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Verificação final do jeito do dono

**Files:** nenhum novo.

- [ ] **Step 1: Suíte completa**

Run: `npm run lint && npm run typecheck && npm test && npm run test:e2e`
Expected: tudo verde. Anotar os totais.

- [ ] **Step 2: Prova num shell limpo (lição de 2026-08-17)**

Com `docker compose up -d` de pé: `npm run migrate` (carrega `.env` sozinho) e depois subir o web pela launch config do Browser pane. Numa clínica **sem produtos** (criar clínica + médica direto no banco, ou apagar os `products` de uma clínica de teste), logar, abrir um paciente, adicionar medicação digitando. Screenshot do card com a medicação. Se precisar de `source .env` para funcionar, o produto está quebrado, não o shell.

- [ ] **Step 3: Diff contra `main`**

Run: `git diff --stat main..HEAD`
Expected: só os arquivos listados na "Estrutura de arquivos" deste plano (mais `apps/web/e2e/tema.spec.ts` **não** deve aparecer — é de outra branch; se estiver untracked, deixar de fora dos commits).

- [ ] **Step 4: Parar e reportar**

Não abrir PR nem fazer push sem o dono pedir. Reportar: o que foi feito, totais de testes, screenshot, e o comando para abrir o PR quando ele quiser.
