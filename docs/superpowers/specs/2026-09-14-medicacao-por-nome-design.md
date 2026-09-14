# Medicação por nome: digitar, dar OK, e o produto nasce junto

**Data:** 2026-09-14 · **Branch alvo:** nova, a partir de `main` · **Etapa no PLANO:** correção de E4 (telas da médica); pré-requisito de E12.

## 1. Problema

Na página do paciente, o card **Medicações e dose vigente** tem um select "Adicionar medicação" que só lista a tabela `products` da clínica. Produto só nasce pelo seed sintético ou por `POST /api/products`, que **nenhuma tela chama**. Numa clínica real a lista é vazia: não há o que selecionar, o botão fica desabilitado e a médica não consegue registrar medicação nenhuma. Não é defeito do componente; é o cadastro de produto que nunca foi exposto.

Na v1 (medcheck-G01) o campo era texto livre ("Nome" + "Concentração") e por isso produtos de cannabis entravam sem problema. O autocompletar de lá (OpenFDA + lista fixa de remédios de balcão) nunca cobriu cannabis. Bases externas não resolvem: os dados abertos da ANVISA têm 2 linhas com canabidiol (Mevatyl); os óleos usados na clínica são produtos RDC 327 ou importados RDC 660 e não constam em nenhum catálogo público. A Memed só oferece receita, exige contrato de parceiro, e o sandbox não serve para produção.

## 2. Decisão de produto

A médica **digita o nome do produto como quiser e confirma**. Isso vale por si: se o nome já existe na clínica, reaproveita o produto; se não existe, cria o produto e vincula ao paciente numa única ação. As sugestões enquanto digita vêm do que a **própria clínica** já cadastrou. Nenhuma fonte externa nesta feature.

Registrar em `DECISOES.md` como **D34**: produto identificado por `name_key` (nome normalizado) único por clínica; find-or-create no core, não na tela; por quê: uma clínica real começa com catálogo vazio e o agente da E12 vai escrever o mesmo produto de dez jeitos.

## 3. Fora de escopo

- Autocompletar por base externa (ANVISA/Memed). Etapa opcional futura, só se faltar nos remédios convencionais.
- Prontuário e importação agêntica (E12). Esta feature só deixa o core pronto para ser chamado por ela.
- Editar ou apagar produto, expor forma farmacêutica e concentração na tela. Os campos continuam existindo e a função do core os aceita.
- Tabela `products` continua: o gráfico dose × sintoma depende dela (D3, D16).

## 4. Arquitetura

### 4.1 Core (`packages/core/src/medications/index.js`)

- `productNameKey(name)`: `trim`, minúsculo, NFD sem diacríticos, espaços colapsados em um. Exportada, pura, testada.
- `findOrCreateProduct(trx, session, { name, form?, cbd_mg_ml?, thc_mg_ml? })`: valida `name` (≥ 2 caracteres, ≤ 120), calcula `name_key`, busca `products` por `(clinic_id, name_key)`; se não achar, insere com o nome **como digitado** (só o `name_key` é normalizado). Em corrida (`23505` no índice único), relê e devolve o existente. Reaproveita a validação de forma e concentração que já existe em `createProduct`.
- `addMedication(db, session, patientId, input, now)` passa a aceitar **`product_id` ou `name`**: com `product_id`, comportamento atual; com `name`, roda em transação `findOrCreateProduct` + insert em `medications` + `logAccess`. Os dois ausentes → `ValidationError('Informe o produto.', 'name')`. Devolve a medicação com `product_name` para a UI não precisar de outra chamada.
- `createProduct` passa a gravar `name_key` e a usar o mesmo find-or-create (mesma regra em um lugar só).
- `index.d.ts`: `ProductRow.name_key`, assinatura nova de `addMedication`, export de `productNameKey`.

### 4.2 Migration `012_product_name_key.js`

- `products.name_key text`; backfill em JS com `productNameKey` (a mesma função do core, importada); depois `NOT NULL` e **índice único `(clinic_id, name_key)`**.
- Sem extensão `unaccent`: normalização é em JS para a chave ser idêntica no backfill e no runtime.
- Colisão no backfill (dois produtos da mesma clínica com a mesma chave): a migration falha com mensagem que nomeia os ids. Hoje só existem produtos de seed; a falha é a saída certa em vez de fundir dados às cegas.
- `down`: derruba índice e coluna.

### 4.3 API

- `POST /api/patients/:id/medications` aceita `{ product_id }` ou `{ name }`. Só passa o body para o core, como hoje.
- `GET /api/products` já existe e é a fonte das sugestões; a página do paciente já carrega `products` no servidor, então a UI recebe a lista por props e **filtra no cliente**. Sem rota nova.

### 4.4 UI (`apps/web/components/medica/MedicationsCard.tsx`)

- Substituir o `SimpleSelect` por um campo **"digite ou escolha"**: `Input` com `autoComplete="off"`, lista de sugestões abaixo filtrada por `productNameKey` (prefixo e substring), navegável por teclado (↑ ↓ Enter Esc), papel `combobox`/`listbox` para acessibilidade. Clicar numa sugestão preenche o input.
- Enter no input ou o botão **Adicionar** envia `{ name }` sempre. O servidor decide se reaproveita ou cria; a UI não distingue.
- Botão habilitado quando `name.trim().length ≥ 2`. Após sucesso: limpa o input, `router.refresh()`. Erro: mesma linha de erro que já existe.
- Legenda sob o campo quando a lista está vazia: "Escreva o nome do produto e toque em Adicionar. Ele fica salvo para os próximos pacientes."
- `data-testid`: `product-input`, `product-suggestion`, `add-medication` (mantido).

### 4.5 Manual (`docs/MANUAL_MEDICA.md`, seção Medicações)

Trocar "escolha o produto" por: escreva o nome do produto (ex.: _Óleo CBD 50 mg/ml_) e toque em **Adicionar**; nomes já usados aparecem como sugestão; o produto nasce **sem dose vigente**.

## 5. Fluxo

1. Médica digita "Óleo cbd 50mg/ml" → sugestões filtradas do catálogo da clínica aparecem.
2. Enter → `POST /api/patients/:id/medications { name }`.
3. Core: `name_key = "oleo cbd 50mg/ml"`; busca por clínica; cria produto se preciso; insere medicação; `logAccess`.
4. Resposta 201 → card recarrega e a medicação aparece "Sem dose vigente — registre o primeiro ajuste".

## 6. Erros

| Situação | Resposta |
| --- | --- |
| Nome com < 2 caracteres ou vazio, e sem `product_id` | 400 `ValidationError` em `name` |
| `product_id` de outra clínica | 404 `not_found` (mantido) |
| Duas requisições simultâneas com o mesmo nome novo | uma insere, a outra recebe `23505`, relê e usa o mesmo produto; as duas medicações apontam para um só produto |
| Mesmo produto adicionado duas vezes ao mesmo paciente | permitido hoje e continua permitido; não é desta feature |

## 7. Testes

**Core (`packages/core/test/medications-by-name.test.js`, vitest):**
- `productNameKey`: "  Óleo  CBD 50mg/ml " → "oleo cbd 50mg/ml"; "ÓLEO CBD" e "oleo cbd" dão a mesma chave.
- nome novo cria produto com o nome como digitado e vincula ao paciente.
- nome repetido com maiúsculas e acentos diferentes reaproveita o produto (contagem de `products` não muda).
- nome vazio recusa; `product_id` continua funcionando; nem `name` nem `product_id` recusa.
- corrida: dois `addMedication` em paralelo com o mesmo nome novo → um produto.
- migration: `migrations.test.js` já roda up/down; adicionar caso com dois produtos de chaves iguais na mesma clínica para provar que a 012 falha nomeando os ids.

**E2E (`apps/web/e2e/medicacao-por-nome.spec.ts`, Playwright):**
- clínica sem produtos: digitar "Óleo CBD 50 mg/ml", Enter, medicação aparece no card.
- segundo paciente: ao digitar "óleo", a sugestão "Óleo CBD 50 mg/ml" aparece; escolher e adicionar; banco tem um produto só.

**Prova manual:** roteiro do README num shell limpo, clínica nova, adicionar medicação e ajustar dose.

## 8. Arquivos

| Arquivo | Ação |
| --- | --- |
| `packages/core/src/medications/index.js` | `productNameKey`, `findOrCreateProduct`, `addMedication` por nome |
| `packages/core/src/migrations/012_product_name_key.js` | novo |
| `packages/core/src/index.js`, `index.d.ts` | exports e tipos |
| `packages/core/test/medications-by-name.test.js` | novo |
| `packages/core/test/migrations.test.js` | caso de colisão |
| `apps/web/components/medica/MedicationsCard.tsx` | campo digite-ou-escolha |
| `apps/web/e2e/medicacao-por-nome.spec.ts` | novo |
| `docs/MANUAL_MEDICA.md` | 1 item |
| `DECISOES.md` | D34 |
| `PLANO.md` | linha no log |

Sem mudança em `apps/web/app/api/patients/[id]/medications/route.ts` além do tipo do body.
