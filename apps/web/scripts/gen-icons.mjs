// Gera ícones PNG do PWA a partir de um SVG (sem dependência externa: usa o sharp já presente
// via Next). Placeholder com identidade — gradiente teal + linha de batimento que termina em
// check — até a clínica fornecer o ícone real (ACHADOS E5).
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
const svg = (s) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 100 100">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#14b8a6"/>
      <stop offset="1" stop-color="#0f766e"/>
    </linearGradient>
  </defs>
  <rect width="100" height="100" rx="22" fill="url(#g)"/>
  <path d="M14 56 h16 l7 -16 l11 30 l8 -24 l5 10 h9" stroke="#ffffff" stroke-opacity="0.55"
    stroke-width="6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M56 60 l9 9 l21 -23" stroke="#ffffff" stroke-width="9" fill="none"
    stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
mkdirSync('public/icons', { recursive: true });
for (const s of [192, 512])
  await sharp(Buffer.from(svg(s)))
    .png()
    .toFile(`public/icons/icon-${s}.png`);
console.log('ícones gerados');
