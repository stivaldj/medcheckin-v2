// Gera ícones PNG do PWA a partir de um SVG simples (sem dependência externa: usa o sharp já presente via Next).
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
const svg = (s) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 100 100"><rect width="100" height="100" rx="20" fill="#0f766e"/><path d="M30 52 l14 14 l28 -30" stroke="#fff" stroke-width="10" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
mkdirSync('public/icons', { recursive: true });
for (const s of [192, 512])
  await sharp(Buffer.from(svg(s)))
    .png()
    .toFile(`public/icons/icon-${s}.png`);
console.log('ícones gerados');
