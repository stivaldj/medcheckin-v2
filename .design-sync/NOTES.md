# design-sync — notas do repositório

Este repo **não é uma biblioteca de design system publicada**: é o app Next.js `@medcheckin/web`.
O sync usa o shape `package` em modo synth-entry (sem `dist/`), varrendo `apps/web/components`.
`PKG_DIR` resolve por `node_modules/@medcheckin/web`, que é o symlink do workspace para `apps/web`.

## Comandos

```sh
node .design-sync/tw-build.mjs                       # compila o CSS do Tailwind (cfg.buildCmd)
node .ds-sync/resync.mjs --config .design-sync/config.json \
  --node-modules ./node_modules --out ./ds-bundle    # build → diff → validate → capture
```

Sempre rode `tw-build.mjs` antes do driver quando `globals.css`, os componentes ou os previews
mudarem — o CSS compilado é entrada do bundle, não saída dele.

## Armadilhas já resolvidas (não redescobrir)

- **Caminhos de `cfg`.** `cfgPath` resolve tudo relativo a `PKG_DIR`
  (`node_modules/@medcheckin/web`), sem seguir o symlink. Por isso `tsconfig`, `docsMap` e
  `extraFonts` levam `../../../` para chegar à raiz do repo. `cssEntry` é o único limitado a
  `PKG_DIR`, daí o CSS compilado morar em `apps/web/.ds-css/`.
- **`next/navigation` e `next/link`.** Sem shim, o esbuild empacota o Next inteiro e todo preview
  quebra no `useRouter`. Os shims estão em `.design-sync/shims/`, ligados por
  `paths` em `.design-sync/tsconfig.build.json`. `usePathname` devolve `/pacientes` de propósito,
  para o `MedicaNav` mostrar estado ativo no card.
- **Cobertura de utilitários Tailwind.** Um CSS gerado só a partir de `apps/web` contém apenas as
  classes que este app já usa — qualquer classe nova que o agente de design escrever sai sem
  estilo. `tw-build.mjs` varre também `.design-sync/previews` e mantém uma safelist
  (`@source inline`) com as famílias de utilitários de layout, tipografia e cor por token.
  Ao acrescentar utilitário novo num preview, confira que ele existe no CSS compilado.
- **Fontes.** O app injeta `--font-sans`/`--font-mono` via `next/font` em runtime. Fora do Next
  essas variáveis não existem e `font-family: var(--font-sans), ...` fica **inválida por
  inteiro** — todo texto cai em serifada, sem nenhum aviso. Os `.woff2` (Instrument Sans e IBM
  Plex Mono, subset latin, extraídos de `.next/static/media`) estão versionados em
  `.design-sync/fonts/` e as variáveis são amarradas no fim de `tw-build.mjs`.
- **`recharts` em `cfg.extraEntries`.** Sem isso o preview empacota uma segunda cópia do recharts
  e o `ChartContainer` renderiza em branco. Efeito colateral conhecido: `[EXPORT_COLLISION]` em
  `Label` — o `Label` do DS ganha, que é o comportamento desejado.
- **Gráficos em captura estática** precisam de `isAnimationActive={false}`; sem isso o screenshot
  pega a animação do recharts pela metade e a linha aparece cortada.
- **Regex com marcas de acentuação literais** (`/[̀-ͯ]/`) sobrevive no bundle e quebra quando o
  arquivo é interpretado como latin1. `QuestionSetsEditor.tsx` foi trocado para `̀-ͯ`.

## Formas de dados que os previews precisam acertar

- `Grid.cells` é indexado **[dia][pergunta]**, e `yes_no` é `1`/`0`, não `'sim'`/`'não'`.
  Errar isso deixa a grade inteira em "—" sem lançar erro.
- `Med` = `MedicationRow & { dose_history: DoseEvent[] }` — sem `dose_history` o
  `MedicationsCard` quebra por inteiro.
- `EpisodeCard` lê `episode.question_set_name` (já resolvido pela query), não o `question_set_id`.
- `QuestionSetsEditor` lê `score_weight` em cada pergunta.

## Known render warns (esperados; um warn fora desta lista é novo)

- `[RENDER_THIN]` em `Dialog`, `DialogFooter` e `DoseDialog`: conteúdo em portal, altura medida 0.
  Os screenshots estão corretos — confirmado visualmente.
- `[EXPORT_COLLISION] recharts … Label`: consequência deliberada de `extraEntries`.
- `[DOCS_UNMAPPED]` nos 22 componentes de `medica/` e `pwa/`: eles não têm doc de família; o
  `.prompt.md` é sintetizado a partir do `.d.ts`.

## Componentes que não renderizam de verdade sem backend

Ficam no floor card ou mostram o estado real de erro; não é defeito do preview:

- `PushToggle` — exige service worker; o card mostra o erro de registro. Stories desligados em
  `cfg.overrides.PushToggle.skip`.
- `TodayView`, `HistoryView` — buscam a sessão do respondente; sem API mostram
  "Não foi possível carregar."
- `SymptomDoseChart` — busca a série; preview removido de propósito para o card cair no bloco
  tipográfico em vez de exibir "Erro 404".

## Inconsistências do app observadas durante o sync (não corrigidas aqui)

- `RespondentsCard` e `InviteAccept` usam `<input type="checkbox">` cru em vez do `Checkbox` do
  DS — aparecem como caixas azuis nativas, fora do tema.
- `LgpdActions` mostra "Anonimizar" apenas quando `discharged` é **falso**. Vale confirmar se é
  intencional; a leitura natural de um fluxo LGPD seria o contrário.

## Riscos de re-sync

- **`.design-sync/fonts/*.woff2` foram extraídos de um build do Next.** Se o app trocar de
  família tipográfica, esses arquivos ficam desatualizados em silêncio — o preview continua
  renderizando, só que na fonte velha. Reextraia de `.next/static/css/app/layout.css`.
- **A safelist do Tailwind é uma aposta sobre o que o agente de design vai escrever.** Ela não
  cobre valores arbitrários (`w-[380px]` só existe porque um preview usa). Se designs saírem com
  espaçamento ou cor sem efeito, o primeiro lugar a olhar é a safelist em `tw-build.mjs`.
- **Os fixtures em `.design-sync/previews/_fixtures.ts` são cópias das formas de
  `@medcheckin/core`.** Mudança de contrato no core não quebra o build do sync — quebra o card,
  silenciosamente, com um campo `undefined`. Vale reconferir os cards de `medica/` depois de
  qualquer mudança em `packages/core/src/index.d.ts`.
- **Projeto:** "MedCheck-in v2 Design System" (`projectId` em `config.json`). Primeiro upload
  completo em 2026-09-13: 549 arquivos, âncora `_ds_sync.json` gravada por último. Re-syncs
  buscam essa âncora e pulam o que não mudou.
- 78 componentes seguem no floor card (sub-partes compostas e os quatro dependentes de backend).
  Autorar previews para eles é incremental: qualquer re-sync aproveita o que já está gravado.
