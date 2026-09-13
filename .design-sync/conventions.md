# MedCheck-in — como construir com este design system

Sistema de monitorização de pacientes em cannabis medicinal. Duas superfícies com
temperaturas diferentes: o **painel clínico** (denso, informativo, para quem decide conduta) e o
**PWA do paciente** (uma decisão por tela, alvos generosos, texto grande). Componentes de
`medica/` pertencem ao painel; os de `pwa/`, ao aplicativo do paciente.

Tudo vive em `window.MedCheckin`. Não existe provider: os componentes leem apenas variáveis CSS,
então basta importar e usar. O bundle também expõe o **recharts** no mesmo namespace, que é o que
`ChartContainer` consome.

## Idioma da estilização: Tailwind v4 sobre tokens

Não há prop de estilo nem sistema de classes próprio — a composição se faz com **utilitários
Tailwind**, e as cores/raios/sombras vêm de **tokens semânticos**, nunca de valores literais.
Usar `bg-white` ou `text-gray-500` quebra o tema escuro; use os tokens.

| Família | Use |
|---|---|
| Superfície | `bg-background` · `bg-card` · `bg-popover` · `bg-muted` · `bg-secondary` · `bg-accent` |
| Texto | `text-foreground` · `text-muted-foreground` · `text-card-foreground` · `text-primary` · `text-destructive` |
| Traço | `border-border` · `border-input` · `ring-ring` |
| Severidade | `bg-sev-critical-soft` + `text-sev-critical` · idem `sev-high`, `sev-medium`, `sev-low` |
| Gráfico | `--chart-1` … `--chart-5` (via `var()`, dentro do `ChartContainer`) |
| Raio | `rounded-sm` · `rounded-md` · `rounded-lg` · `rounded-xl` · `rounded-2xl` (derivados de `--radius`) |
| Elevação | `shadow-xs` · `shadow-sm` · `shadow-md` · `shadow-lg` (leem `--elev-0..4`, mudam com o tema) |
| Tipografia | `font-sans` (padrão) · `font-mono` · `font-heading` |

Opacidade sobre token funciona e é o jeito idiomático de tons intermediários:
`bg-primary/10`, `text-destructive/90`, `bg-muted/50`.

## Duas regras que este produto leva a sério

**1. Severidade em quatro níveis.** Crítico e alto **não** compartilham cor — é exatamente aí que a
diferença decide a conduta clínica. Use `<Badge variant="critical|high|medium|low">`, nunca
`destructive` para representar severidade.

**2. Nenhum número sem fonte visível.** O que uma pessoa escreveu vai em `font-sans`; o que o
sistema **mediu** (horários, escalas, contagens, datas) vai em `font-mono tabular-nums`. Siga isso
em tabelas, grades e métricas.

## Composição

Blocos do painel são sempre `Card`:

```jsx
<Card>
  <CardHeader>
    <CardTitle>Alertas abertos</CardTitle>
    <CardDescription>Últimos 7 dias</CardDescription>
    <CardAction><Button size="xs" variant="ghost">Ver todos</Button></CardAction>
  </CardHeader>
  <CardContent className="flex flex-col gap-2 text-sm">
    <div className="flex items-center justify-between">
      <span>Dor acima do limiar</span>
      <Badge variant="high">Alto</Badge>
    </div>
  </CardContent>
  <CardFooter className="justify-end gap-2">
    <Button size="sm" variant="outline">Dispensar</Button>
    <Button size="sm">Revisar</Button>
  </CardFooter>
</Card>
```

Outros andaimes: `Field`/`FieldGroup`/`FieldSet` para formulário (rótulo, descrição e erro com o
espaçamento certo); `Item`/`ItemGroup` para listas ricas demais para `Table`; `Empty` para todo
estado vazio — o produto não deixa área em branco sem explicação; `Dialog` para modal.

Prefira `SimpleSelect` (`value` / `onValueChange` / `options`) ao conjunto `Select` composto; o
composto existe para quando o menu precisa de grupos e rótulos.

Componentes do Base UI (`Button`, `Dialog`, `Tabs`, `Collapsible`, `Select`, `Checkbox`,
`Separator`) aceitam a prop `render` para trocar o elemento raiz:
`<DialogTrigger render={<Button size="sm">Abrir</Button>} />`.

Erro de formulário é `aria-invalid` no controle mais `FieldError` abaixo — não invente uma borda
vermelha própria.

## Onde está a verdade

- `_ds/<pasta>/styles.css` e o que ele importa (`fonts/fonts.css`, `_ds_bundle.css`): os tokens
  reais e todas as classes disponíveis. Leia antes de estilizar.
- `components/<grupo>/<Nome>/<Nome>.d.ts`: o contrato de props.
- `components/<grupo>/<Nome>/<Nome>.prompt.md`: como compor, com exemplos.

Grupos: `acoes`, `feedback`, `formulario`, `layout`, `dados`, `sobreposicao` (primitivos),
`medica` (painel clínico) e `pwa` (aplicativo do paciente).
