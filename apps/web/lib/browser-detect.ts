/**
 * E9.3 — em que navegador o convite foi aberto. O erro nº 1 de quem não é técnico é abrir o
 * link DENTRO do Gmail/WhatsApp/Instagram: ali não dá para instalar o app nem receber aviso,
 * e nada na tela avisa isso. Detecção por user agent é heurística — o wizard sempre oferece
 * "meu navegador já é o Safari/Chrome, continuar" para o falso positivo.
 */
export type BrowserInfo = {
  platform: 'ios' | 'android' | 'other';
  /** Nome do app que embutiu o navegador, ou null quando é um navegador de verdade. */
  embedded: string | null;
  /** Aviso no iPhone exige iOS 16.4+. Fora do iPhone, true. */
  iosPushSupported: boolean;
  /** iPhone fora do Safari: o caminho mais simples para instalar é o Safari. */
  needsSafari: boolean;
};

const NAMED: Array<[RegExp, string]> = [
  [/WhatsApp/i, 'WhatsApp'],
  [/Instagram/i, 'Instagram'],
  [/FBAN|FBAV|FB_IAB/i, 'Facebook'],
  [/GSA\//, 'Google/Gmail'],
  [/Gmail/i, 'Google/Gmail'],
  [/Telegram/i, 'Telegram'],
  [/\bLine\//, 'LINE'],
  [/TikTok|musical_ly|BytedanceWebview/i, 'TikTok'],
];

export function detectBrowser(ua: string, opts: { standalone?: boolean } = {}): BrowserInfo {
  const s = String(ua || '');
  const platform: BrowserInfo['platform'] = /iPhone|iPad|iPod/.test(s)
    ? 'ios'
    : /Android/.test(s)
      ? 'android'
      : 'other';

  let iosPushSupported = true;
  if (platform === 'ios') {
    const m = s.match(/OS (\d+)_(\d+)/);
    const major = m ? Number(m[1]) : 0;
    const minor = m ? Number(m[2]) : 0;
    iosPushSupported = major > 16 || (major === 16 && minor >= 4);
  }

  // O app aberto da tela inicial do iPhone usa um user agent sem "Safari/" — igual a um webview.
  if (opts.standalone) return { platform, embedded: null, iosPushSupported, needsSafari: false };

  let embedded: string | null = null;
  for (const [re, name] of NAMED) {
    if (re.test(s)) {
      embedded = name;
      break;
    }
  }
  if (!embedded) {
    if (platform === 'ios' && !/Safari\//.test(s)) embedded = 'outro aplicativo';
    if (platform === 'android' && /; wv\)/.test(s)) embedded = 'outro aplicativo';
  }
  const needsSafari = !embedded && platform === 'ios' && /CriOS|FxiOS|EdgiOS|OPiOS/.test(s);
  return { platform, embedded, iosPushSupported, needsSafari };
}
