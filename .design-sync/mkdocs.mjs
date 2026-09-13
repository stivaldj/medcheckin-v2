import { writeFileSync, readFileSync } from 'node:fs';
const ROOT = '/Users/joseoliveira/CODING/cbd-checkin';
const D = `${ROOT}/.design-sync/docs`;

// família: [arquivo-doc, grupo, membros, corpo]
const fams = [];
const fam = (file, group, members, body) => fams.push({ file, group, members, body });

fam('button', 'acoes', ['Button'], `
# Button

Botão único do sistema. Envolve o \`Button\` do Base UI e aplica as variantes do MedCheck-in.

## Variantes
\`variant\`: \`default\` (primária, teal da marca) · \`outline\` · \`secondary\` · \`ghost\` · \`destructive\` (fundo suave, texto vermelho — não é um bloco vermelho sólido) · \`link\`.
\`size\`: \`xs\` · \`sm\` · \`default\` (h-8) · \`lg\` · \`icon\` · \`icon-xs\` · \`icon-sm\` · \`icon-lg\`.

## Uso
\`\`\`jsx
<Button variant="default" size="sm">Registrar dose</Button>
<Button variant="outline"><PlusIcon /> Nova pergunta</Button>
<Button variant="ghost" size="icon-sm" aria-label="Fechar"><XIcon /></Button>
\`\`\`

Ícones do \`lucide-react\` entram como filhos diretos e são dimensionados automaticamente
(\`size-4\`, ou \`size-3/3.5\` nos tamanhos menores). Para botão só de ícone use um \`size\` \`icon*\`
e sempre um \`aria-label\`.
`);

fam('badge', 'feedback', ['Badge'], `
# Badge

Etiqueta compacta para estado, contagem e — principalmente — **severidade de alerta**.

## Variantes
\`default\` · \`secondary\` · \`destructive\` · \`outline\` · \`ghost\` · \`link\`, mais a escala de
severidade em quatro níveis: \`critical\` · \`high\` · \`medium\` · \`low\`.

A escala de severidade é uma decisão de produto: crítico e alto **não** compartilham a mesma cor,
porque é exatamente aí que a diferença decide a conduta clínica. Cada nível lê os tokens
\`--sev-*\` e \`--sev-*-soft\` (fundo suave + texto saturado), então funciona em tema claro e escuro.

## Uso
\`\`\`jsx
<Badge variant="critical">Crítico</Badge>
<Badge variant="high">Alto</Badge>
<Badge variant="medium">Médio</Badge>
<Badge variant="low">Baixo</Badge>
<Badge variant="outline">Rascunho</Badge>
\`\`\`

Aceita \`render\` (padrão \`useRender\` do Base UI) para trocar a tag raiz, por exemplo por um \`<a>\`.
`);

fam('alert', 'feedback', ['Alert', 'AlertTitle', 'AlertDescription', 'AlertAction'], `
# Alert

Aviso em bloco dentro do fluxo da página. Composição: \`Alert\` > \`AlertTitle\` +
\`AlertDescription\`, com \`AlertAction\` opcional ancorado no canto superior direito.

\`variant\`: \`default\` · \`destructive\`.

Um ícone como **primeiro filho** de \`Alert\` liga o layout de duas colunas automaticamente
(ícone à esquerda, título e descrição à direita) — não é preciso classe nenhuma para isso.

## Uso
\`\`\`jsx
<Alert>
  <TriangleAlertIcon />
  <AlertTitle>Três dias sem check-in</AlertTitle>
  <AlertDescription>A paciente não responde desde 12/03. Considere contato ativo.</AlertDescription>
  <AlertAction><Button size="xs" variant="ghost">Dispensar</Button></AlertAction>
</Alert>
\`\`\`
`);

fam('card', 'layout', ['Card', 'CardHeader', 'CardTitle', 'CardDescription', 'CardAction', 'CardContent', 'CardFooter'], `
# Card

Superfície principal do painel médico. Todo bloco de conteúdo da área clínica é um Card.

Composição: \`Card\` > \`CardHeader\` (\`CardTitle\`, \`CardDescription\`, \`CardAction\`) +
\`CardContent\` + \`CardFooter\`.

\`size\`: \`default\` · \`sm\` — controla o token interno \`--card-spacing\` (spacing 4 vs 3) e o
tamanho do título; use \`sm\` em grades densas.

\`CardAction\` se posiciona sozinho na direita da \`CardHeader\` (o header vira grid de duas
colunas quando detecta a action). \`CardFooter\` ganha borda superior e fundo \`muted\`.

## Uso
\`\`\`jsx
<Card>
  <CardHeader>
    <CardTitle>Alertas abertos</CardTitle>
    <CardDescription>Últimos 7 dias</CardDescription>
    <CardAction><Button size="xs" variant="ghost">Ver todos</Button></CardAction>
  </CardHeader>
  <CardContent>…</CardContent>
</Card>
\`\`\`
`);

fam('item', 'layout', ['Item', 'ItemGroup', 'ItemSeparator', 'ItemMedia', 'ItemContent', 'ItemTitle', 'ItemDescription', 'ItemActions', 'ItemHeader', 'ItemFooter'], `
# Item

Linha de lista composta — a unidade de listagem quando o conteúdo é rico demais para uma
\`Table\` e leve demais para um \`Card\`.

Composição: \`ItemGroup\` > \`Item\` > \`ItemMedia\` (ícone/avatar) + \`ItemContent\`
(\`ItemTitle\`, \`ItemDescription\`) + \`ItemActions\`. \`ItemSeparator\` divide itens;
\`ItemHeader\`/\`ItemFooter\` acrescentam faixas acima e abaixo.

\`variant\` em \`Item\`: \`default\` · \`outline\` · \`muted\`.

## Uso
\`\`\`jsx
<ItemGroup>
  <Item variant="outline">
    <ItemMedia><PillIcon /></ItemMedia>
    <ItemContent>
      <ItemTitle>CBD 200mg/ml</ItemTitle>
      <ItemDescription>2 gotas, 2× ao dia</ItemDescription>
    </ItemContent>
    <ItemActions><Button size="xs" variant="ghost">Editar</Button></ItemActions>
  </Item>
</ItemGroup>
\`\`\`
`);

fam('empty', 'layout', ['Empty', 'EmptyHeader', 'EmptyMedia', 'EmptyTitle', 'EmptyDescription', 'EmptyContent'], `
# Empty

Estado vazio. Use sempre que uma lista, card ou tabela puder vir sem dados — o app não deixa
área em branco sem explicação.

Composição: \`Empty\` > \`EmptyHeader\` (\`EmptyMedia\`, \`EmptyTitle\`, \`EmptyDescription\`) +
\`EmptyContent\` (ação de saída).

\`EmptyMedia\` tem \`variant\`: \`default\` · \`icon\` (círculo com o ícone dentro).

## Uso
\`\`\`jsx
<Empty>
  <EmptyHeader>
    <EmptyMedia variant="icon"><InboxIcon /></EmptyMedia>
    <EmptyTitle>Nenhum alerta aberto</EmptyTitle>
    <EmptyDescription>Os alertas aparecem aqui quando um check-in cruza um limiar.</EmptyDescription>
  </EmptyHeader>
  <EmptyContent><Button variant="outline" size="sm">Revisar limiares</Button></EmptyContent>
</Empty>
\`\`\`
`);

fam('separator', 'layout', ['Separator'], `
# Separator

Régua fina de 1px que lê o token \`--border\`. \`orientation\`: \`horizontal\` (padrão, largura
total) · \`vertical\` (estica na altura do flex pai).

\`\`\`jsx
<Separator />
<div className="flex h-5 items-center gap-2">a <Separator orientation="vertical" /> b</div>
\`\`\`
`);

fam('collapsible', 'layout', ['Collapsible', 'CollapsibleTrigger', 'CollapsibleContent'], `
# Collapsible

Seção que abre e fecha, sobre o Collapsible do Base UI. \`Collapsible\` (\`open\`,
\`defaultOpen\`, \`onOpenChange\`) > \`CollapsibleTrigger\` + \`CollapsibleContent\`.

Sem estilo próprio: é estrutura. Estilize o gatilho com \`Button\` e o painel com utilitários.

\`\`\`jsx
<Collapsible defaultOpen>
  <CollapsibleTrigger render={<Button variant="ghost" size="sm">Detalhes</Button>} />
  <CollapsibleContent className="pt-2 text-sm text-muted-foreground">…</CollapsibleContent>
</Collapsible>
\`\`\`
`);

fam('tabs', 'layout', ['Tabs', 'TabsList', 'TabsTrigger', 'TabsContent'], `
# Tabs

Abas sobre o Base UI. \`Tabs\` (\`value\`, \`defaultValue\`, \`onValueChange\`, \`orientation\`) >
\`TabsList\` > \`TabsTrigger value\`, mais um \`TabsContent value\` por painel.

\`TabsList\` tem \`variant\`: \`default\` · \`line\`.

\`\`\`jsx
<Tabs defaultValue="hoje">
  <TabsList>
    <TabsTrigger value="hoje">Hoje</TabsTrigger>
    <TabsTrigger value="historico">Histórico</TabsTrigger>
  </TabsList>
  <TabsContent value="hoje">…</TabsContent>
  <TabsContent value="historico">…</TabsContent>
</Tabs>
\`\`\`
`);

fam('input', 'formulario', ['Input'], `
# Input

Campo de texto de uma linha (Base UI \`Input\`). Aceita todas as props de \`<input>\`, inclusive
\`type\`. Altura h-8, borda \`--input\`, anel de foco \`--ring\`; \`aria-invalid\` pinta a borda de
\`--destructive\` — é assim que o erro de formulário aparece.

\`\`\`jsx
<Input placeholder="Nome da paciente" />
<Input type="number" aria-invalid defaultValue="999" />
\`\`\`
`);

fam('textarea', 'formulario', ['Textarea'], `
# Textarea

Campo de texto multilinha com \`field-sizing-content\` — cresce sozinho conforme o conteúdo, a
partir de \`min-h-16\`. Mesma gramática de borda, foco e \`aria-invalid\` do \`Input\`.

\`\`\`jsx
<Textarea placeholder="Observações da consulta" />
\`\`\`
`);

fam('label', 'formulario', ['Label'], `
# Label

Rótulo de campo. É um \`<label>\` em flex com \`gap-2\`, então um ícone ou \`Badge\` ao lado do
texto se alinha sozinho. Esmaece junto quando o campo irmão está desabilitado
(\`peer-disabled\`) ou dentro de um grupo \`data-disabled\`.

\`\`\`jsx
<Label htmlFor="dose">Dose</Label>
<Input id="dose" />
\`\`\`
`);

fam('checkbox', 'formulario', ['Checkbox'], `
# Checkbox

Caixa de seleção do Base UI, 16px, com o \`CheckIcon\` do lucide como indicador. Marcada, usa
\`--primary\` de fundo. Props: \`checked\`, \`defaultChecked\`, \`onCheckedChange\`, \`disabled\`,
\`indeterminate\`. A área de toque é ampliada por um pseudo-elemento — não aumente o tamanho
visual só para ganhar alvo de clique.

\`\`\`jsx
<Label><Checkbox defaultChecked /> Aceito os termos</Label>
\`\`\`
`);

fam('field', 'formulario', ['Field', 'FieldSet', 'FieldLegend', 'FieldGroup', 'FieldContent', 'FieldLabel', 'FieldTitle', 'FieldDescription', 'FieldSeparator', 'FieldError'], `
# Field

Andaime de formulário: rótulo, controle, descrição e erro com o espaçamento certo entre eles.

Composição: \`FieldSet\` > \`FieldLegend\` + \`FieldGroup\` > \`Field\` > \`FieldLabel\` +
controle + \`FieldDescription\` + \`FieldError\`. \`FieldContent\` agrupa rótulo e descrição
quando a orientação é horizontal; \`FieldSeparator\` divide blocos e aceita conteúdo no meio
da linha (por exemplo "ou").

\`Field\` tem \`orientation\`: \`vertical\` (padrão) · \`horizontal\` · \`responsive\`.
\`FieldError\` aceita \`errors\` (lista) ou filhos livres.

## Uso
\`\`\`jsx
<FieldSet>
  <FieldLegend>Prescrição</FieldLegend>
  <FieldGroup>
    <Field>
      <FieldLabel htmlFor="mg">Concentração</FieldLabel>
      <Input id="mg" />
      <FieldDescription>Em mg/ml, como está no rótulo do frasco.</FieldDescription>
    </Field>
  </FieldGroup>
</FieldSet>
\`\`\`
`);

fam('select', 'formulario', ['Select', 'SelectTrigger', 'SelectValue', 'SelectContent', 'SelectItem', 'SelectGroup', 'SelectLabel', 'SelectSeparator', 'SelectScrollUpButton', 'SelectScrollDownButton'], `
# Select

Select do Base UI com a casca do MedCheck-in. \`Select\` (\`value\`, \`onValueChange\`, \`items\`) >
\`SelectTrigger\` (\`size\`: \`sm\` · \`default\`) > \`SelectValue\`, e \`SelectContent\` >
\`SelectItem value\`. \`SelectGroup\` + \`SelectLabel\` agrupam; \`SelectSeparator\` divide.

**Prefira \`SimpleSelect\`** para o caso comum de escolha única — este conjunto existe para
quando o menu precisa de grupos, rótulos ou itens compostos.

O conteúdo abre em portal; num card de preview estático, dê altura ao card
(\`cardMode: single\`) ou prefira mostrar só o gatilho.
`);

fam('simple-select', 'formulario', ['SimpleSelect'], `
# SimpleSelect

Select de uma escolha só — a forma de praticamente todo select do app. Existe para o call site
caber numa linha: eram 14 blocos idênticos de oito linhas, um convite a divergirem entre si.

Props: \`value\`, \`onValueChange(value: string)\`, \`options: { value, label }[]\`,
\`placeholder\`, \`size\` (\`sm\` · \`default\`), \`className\`, mais as props de \`<button>\` que
vão para o gatilho.

\`\`\`jsx
<SimpleSelect
  value={periodo}
  onValueChange={setPeriodo}
  options={[
    { value: 'manha', label: 'Manhã' },
    { value: 'noite', label: 'Noite' },
  ]}
  placeholder="Período"
/>
\`\`\`
`);

fam('questionnaire', 'formulario', ['Questionnaire', 'QuestionnaireProgress', 'QuestionnaireItem', 'QuestionnaireTitle', 'QuestionnaireDescription', 'QuestionnaireChoices', 'QuestionnaireChoice', 'QuestionnaireChoiceDescription', 'QuestionnaireInput', 'QuestionnaireError', 'QuestionnaireActions', 'QuestionnairePrevious', 'QuestionnaireNext', 'QuestionnaireSkip', 'QuestionnaireSubmit'], `
# Questionnaire

Conjunto do check-in do paciente: uma pergunta por vez, com progresso, escolhas e navegação.

Composição: \`Questionnaire\` > \`QuestionnaireProgress\` + \`QuestionnaireItem\`
(\`QuestionnaireTitle\`, \`QuestionnaireDescription\`, \`QuestionnaireChoices\` >
\`QuestionnaireChoice\`) + \`QuestionnaireError\` + \`QuestionnaireActions\`
(\`QuestionnairePrevious\`, \`QuestionnaireSkip\`, \`QuestionnaireNext\`/\`QuestionnaireSubmit\`).

\`QuestionnaireChoice\` é um radio/checkbox estilizado com rótulo, descrição opcional e atalho
de teclado. \`QuestionnaireInput\` cobre resposta livre em vez de escolha.

Este é o conjunto que o paciente vê no PWA — texto grande, alvos de toque generosos, uma
decisão por tela.
`);

fam('table', 'dados', ['Table', 'TableHeader', 'TableBody', 'TableFooter', 'TableHead', 'TableRow', 'TableCell', 'TableCaption'], `
# Table

Tabela de dados. \`Table\` já vem embrulhada num container com rolagem horizontal, então não
precisa de wrapper próprio.

Composição HTML padrão: \`Table\` > \`TableHeader\` > \`TableRow\` > \`TableHead\`, e
\`TableBody\` > \`TableRow\` > \`TableCell\`. \`TableFooter\` para totais, \`TableCaption\` para
a legenda abaixo.

\`\`\`jsx
<Table>
  <TableHeader>
    <TableRow><TableHead>Data</TableHead><TableHead>Sintoma</TableHead></TableRow>
  </TableHeader>
  <TableBody>
    <TableRow><TableCell>12/03</TableCell><TableCell>Dor 7/10</TableCell></TableRow>
  </TableBody>
</Table>
\`\`\`

Em card de preview, tabelas são largas: use \`cardMode: "column"\`.
`);

fam('chart', 'dados', ['ChartContainer', 'ChartStyle', 'ChartTooltip', 'ChartTooltipContent', 'ChartLegend', 'ChartLegendContent'], `
# Chart

Casca do Recharts com os tokens do MedCheck-in. \`ChartContainer\` recebe um \`config\`
(\`ChartConfig\`: por série, \`label\`, \`icon\`, \`color\` ou \`theme\`) e injeta as variáveis
\`--color-<serie>\` que os elementos do Recharts consomem.

\`ChartTooltip\` = \`Tooltip\` do Recharts; o conteúdo bonito é \`ChartTooltipContent\`
(\`indicator\`: \`dot\` · \`line\` · \`dashed\`; \`hideLabel\`, \`hideIndicator\`, \`nameKey\`,
\`labelKey\`). Mesma ideia em \`ChartLegend\` / \`ChartLegendContent\`.

\`\`\`jsx
<ChartContainer config={{ dor: { label: 'Dor', color: 'var(--chart-1)' } }}>
  <LineChart data={dados}>
    <ChartTooltip content={<ChartTooltipContent />} />
    <Line dataKey="dor" stroke="var(--color-dor)" />
  </LineChart>
</ChartContainer>
\`\`\`
`);

fam('dialog', 'sobreposicao', ['Dialog', 'DialogTrigger', 'DialogPortal', 'DialogClose', 'DialogOverlay', 'DialogContent', 'DialogHeader', 'DialogFooter', 'DialogTitle', 'DialogDescription'], `
# Dialog

Modal do Base UI. \`Dialog\` (\`open\`, \`defaultOpen\`, \`onOpenChange\`) > \`DialogTrigger\` +
\`DialogContent\` > \`DialogHeader\` (\`DialogTitle\`, \`DialogDescription\`) + conteúdo +
\`DialogFooter\`. \`DialogContent\` já traz overlay e botão de fechar; \`DialogClose\` fecha de
qualquer lugar.

\`DialogFooter\` tem \`orientation\`: \`horizontal\` · \`vertical\`.

\`\`\`jsx
<Dialog>
  <DialogTrigger render={<Button size="sm">Registrar dose</Button>} />
  <DialogContent>
    <DialogHeader>
      <DialogTitle>Registrar dose</DialogTitle>
      <DialogDescription>Confirme o horário e a quantidade.</DialogDescription>
    </DialogHeader>
    <DialogFooter>
      <DialogClose render={<Button variant="outline">Cancelar</Button>} />
      <Button>Salvar</Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
\`\`\`

Conteúdo em portal: no card de preview use \`cardMode: "single"\` e deixe o diálogo aberto por
\`defaultOpen\`.
`);

const docsMap = {};
for (const f of fams) {
  const body = `---\ncategory: ${f.group}\n---\n${f.body.trimStart()}`;
  writeFileSync(`${D}/${f.file}.md`, body);
  for (const m of f.members) docsMap[m] = `../../../.design-sync/docs/${f.file}.md`;
}
const cfgPath = `${ROOT}/.design-sync/config.json`;
const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
cfg.docsMap = { ...(cfg.docsMap ?? {}), ...docsMap };
writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
console.log('docs:', fams.length, 'famílias →', Object.keys(docsMap).length, 'componentes mapeados');
