// Compila o Tailwind v4 do app num CSS estático para o bundle do design system.
//
// Duas coisas que o app resolve em runtime e o bundle precisa resolver aqui:
//
// 1. COBERTURA DE UTILITÁRIOS. O Tailwind só emite as classes que encontra ao varrer o
//    código. Um CSS gerado só a partir de apps/web contém exatamente os utilitários que
//    ESTE app já usa — qualquer classe nova que o agente de design escrever sai sem estilo.
//    Por isso varremos também os previews e mantemos uma safelist (`@source inline`) com as
//    famílias de utilitários que um agente precisa para compor layout.
//
// 2. VARIÁVEIS DE FONTE. O app injeta --font-sans/--font-mono via next/font. Fora do Next
//    elas não existem, e `font-family: var(--font-sans), ...` fica inválida por inteiro —
//    todo texto cairia em serifada. Amarramos as variáveis no fim do arquivo; os .woff2 vêm
//    por cfg.extraFonts.
import postcss from 'postcss';
import tw from '@tailwindcss/postcss';
import { readFileSync, writeFileSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname;
const IN = `${ROOT}apps/web/app/globals.css`;
const OUT = `${ROOT}apps/web/.ds-css/styles.compiled.css`;

const SPACING = '0,0.5,1,1.5,2,2.5,3,3.5,4,5,6,7,8,9,10,12,14,16,20,24';
const SAFELIST = [
  // espaçamento
  `@source inline("{p,px,py,pt,pr,pb,pl,m,mx,my,mt,mr,mb,ml,gap,gap-x,gap-y,space-x,space-y}-{${SPACING}}");`,
  '@source inline("{m,mx,my,mt,mr,mb,ml}-auto");',
  // layout
  '@source inline("{block,inline-block,inline,flex,inline-flex,grid,inline-grid,hidden,contents}");',
  '@source inline("flex-{row,col,row-reverse,col-reverse,wrap,nowrap,1,auto,initial,none}");',
  '@source inline("items-{start,center,end,baseline,stretch}");',
  '@source inline("justify-{start,center,end,between,around,evenly}");',
  '@source inline("{self,justify-self}-{start,center,end,stretch,auto}");',
  '@source inline("grid-cols-{1,2,3,4,5,6,7,8,9,10,11,12}");',
  '@source inline("grid-rows-{1,2,3,4,5,6}");',
  '@source inline("col-span-{1,2,3,4,5,6,7,8,9,10,11,12,full}");',
  '@source inline("row-span-{1,2,3,4,5,6,full}");',
  '@source inline("{relative,absolute,fixed,sticky,static}");',
  '@source inline("{top,right,bottom,left,inset}-0");',
  '@source inline("z-{0,10,20,30,40,50}");',
  '@source inline("{overflow,overflow-x,overflow-y}-{auto,hidden,visible,scroll}");',
  // dimensões
  `@source inline("{w,h,size,min-w,min-h}-{${SPACING}}");`,
  '@source inline("{w,h,min-w,min-h,max-w,max-h}-{full,screen,fit,min,max,auto}");',
  '@source inline("max-w-{xs,sm,md,lg,xl,2xl,3xl,4xl,5xl,6xl,7xl,prose,none}");',
  '@source inline("{w,h}-{1/2,1/3,2/3,1/4,3/4,1/5,4/5}");',
  '@source inline("shrink-{0,}");',
  '@source inline("grow-{0,}");',
  // tipografia
  '@source inline("text-{xs,sm,base,lg,xl,2xl,3xl,4xl,5xl}");',
  '@source inline("font-{thin,light,normal,medium,semibold,bold,extrabold}");',
  '@source inline("font-{sans,mono,heading}");',
  '@source inline("text-{left,center,right,justify,balance,pretty,wrap,nowrap}");',
  '@source inline("leading-{none,tight,snug,normal,relaxed,loose}");',
  '@source inline("tracking-{tighter,tight,normal,wide,wider}");',
  '@source inline("{truncate,uppercase,lowercase,capitalize,italic,underline,line-through,tabular-nums}");',
  '@source inline("whitespace-{normal,nowrap,pre,pre-wrap}");',
  '@source inline("line-clamp-{1,2,3,4}");',
  // cor — apenas os tokens do tema, que é o vocabulário do design system
  '@source inline("{text,bg,border,ring,fill,stroke,divide}-{background,foreground,card,card-foreground,popover,popover-foreground,primary,primary-foreground,secondary,secondary-foreground,muted,muted-foreground,accent,accent-foreground,destructive,border,input,ring}");',
  '@source inline("{text,bg,border}-sev-{critical,high,medium,low}");',
  '@source inline("{text,bg,border}-sev-{critical,high,medium,low}-soft");',
  '@source inline("{text,bg,fill,stroke}-chart-{1,2,3,4,5}");',
  '@source inline("bg-{transparent,current,white,black}");',
  '@source inline("{bg,text,border}-{primary,muted,foreground,destructive,card}/{5,10,20,30,40,50,60,70,80,90}");',
  // superfície
  '@source inline("rounded{,-none,-sm,-md,-lg,-xl,-2xl,-3xl,-4xl,-full}");',
  '@source inline("rounded-{t,r,b,l,tl,tr,br,bl}-{sm,md,lg,xl,2xl,full}");',
  '@source inline("border{,-0,-2,-4,-t,-r,-b,-l,-x,-y}");',
  '@source inline("shadow-{2xs,xs,sm,md,lg,xl,none}");',
  '@source inline("opacity-{0,25,50,75,90,100}");',
  '@source inline("{cursor-pointer,cursor-default,cursor-not-allowed,select-none,pointer-events-none}");',
  '@source inline("transition{,-all,-colors,-opacity,-transform}");',
  // responsivo e tema: os mesmos utilitários sob os prefixos que um agente usa de verdade
  `@source inline("{sm,md,lg,xl,dark}:{flex,grid,hidden,block}");`,
  `@source inline("{sm,md,lg,xl}:grid-cols-{1,2,3,4,5,6}");`,
  `@source inline("{sm,md,lg,xl}:flex-{row,col}");`,
  `@source inline("{sm,md,lg,xl}:{p,px,py,gap,m,mx,my}-{${SPACING}}");`,
  `@source inline("{sm,md,lg,xl}:text-{xs,sm,base,lg,xl,2xl,3xl}");`,
].join('\n');

// Varre também os previews autorados, senão as classes deles saem do CSS.
const EXTRA_SOURCES = '@source "../../../.design-sync/previews";';

const FONT_VARS = `
:root {
  --font-sans: 'Instrument Sans', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto,
    'Helvetica Neue', Arial, sans-serif;
  --font-mono: 'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
`;

const src = readFileSync(IN, 'utf8');
// As diretivas entram logo após os @import, que precisam vir primeiro no arquivo.
const lastImport = src.lastIndexOf('@import');
const cut = src.indexOf('\n', lastImport) + 1;
const css = src.slice(0, cut) + '\n' + EXTRA_SOURCES + '\n' + SAFELIST + '\n' + src.slice(cut);

const res = await postcss([tw({ base: `${ROOT}apps/web`, optimize: false })]).process(css, {
  from: IN,
  to: OUT,
});
writeFileSync(OUT, res.css + FONT_VARS);
console.log(`styles.compiled.css: ${(res.css.length / 1024).toFixed(0)} KB`);
