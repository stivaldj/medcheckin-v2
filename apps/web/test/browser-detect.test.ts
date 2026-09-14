import { describe, it, expect } from 'vitest';
import { detectBrowser } from '../lib/browser-detect';

/**
 * E9.3 — o erro nº 1 de quem não é técnico: abrir o convite dentro do Gmail/WhatsApp/Instagram.
 * Nesses navegadores embutidos não dá para instalar o app nem receber aviso.
 */
const UA = {
  iosSafari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  iosSafariOld:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 15_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6 Mobile/15E148 Safari/604.1',
  iosChrome:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1',
  iosGmail:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 GSA/322.0.648915268 Mobile/15E148 Safari/604.1',
  iosInstagram:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 339.0.3.12.91 (iPhone15,2; iOS 17_5; pt_BR; pt; scale=3.00; 1179x2556; 626245312)',
  iosFacebook:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/470.0.0.40.103;FBBV/617340000;FBDV/iPhone15,2;FBMD/iPhone;FBSN/iOS;FBSV/17.5;FBSS/3;FBLC/pt_BR]',
  iosWebviewGeneric:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  androidChrome:
    'Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.6478.71 Mobile Safari/537.36',
  androidWebview:
    'Mozilla/5.0 (Linux; Android 14; SM-A546E; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.6478.71 Mobile Safari/537.36',
  androidWhatsapp:
    'Mozilla/5.0 (Linux; Android 14; SM-A546E; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.6478.71 Mobile Safari/537.36 WhatsApp/2.24.13.78',
  androidSamsung:
    'Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36',
  desktopChrome:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
};

describe('detectBrowser', () => {
  it('Safari no iPhone: ok, instala pelo Compartilhar; iOS 17 suporta aviso', () => {
    expect(detectBrowser(UA.iosSafari)).toEqual({
      platform: 'ios',
      embedded: null,
      iosPushSupported: true,
      needsSafari: false,
    });
  });

  it('iPhone com iOS antigo (< 16.4): avisa que precisa atualizar', () => {
    expect(detectBrowser(UA.iosSafariOld)).toMatchObject({
      platform: 'ios',
      iosPushSupported: false,
    });
  });

  it('Chrome no iPhone: não é embutido, mas no iPhone a instalação é pelo Safari', () => {
    expect(detectBrowser(UA.iosChrome)).toMatchObject({ embedded: null, needsSafari: true });
  });

  it.each([
    ['iosGmail', 'Google/Gmail'],
    ['iosInstagram', 'Instagram'],
    ['iosFacebook', 'Facebook'],
    ['androidWhatsapp', 'WhatsApp'],
  ] as const)('%s → embutido (%s)', (key, name) => {
    expect(detectBrowser(UA[key]).embedded).toBe(name);
  });

  it('webview sem nome (iOS sem "Safari/" ou Android com "; wv") → embutido genérico', () => {
    expect(detectBrowser(UA.iosWebviewGeneric).embedded).toBe('outro aplicativo');
    expect(detectBrowser(UA.androidWebview).embedded).toBe('outro aplicativo');
  });

  it('app instalado no iPhone tem o MESMO user agent sem "Safari/": aberto da tela inicial não é embutido', () => {
    expect(detectBrowser(UA.iosWebviewGeneric, { standalone: true })).toMatchObject({
      platform: 'ios',
      embedded: null,
      needsSafari: false,
    });
  });

  it('Chrome e Samsung Internet no Android: ok', () => {
    expect(detectBrowser(UA.androidChrome)).toMatchObject({ platform: 'android', embedded: null });
    expect(detectBrowser(UA.androidSamsung)).toMatchObject({ platform: 'android', embedded: null });
  });

  it('computador: other, não embutido', () => {
    expect(detectBrowser(UA.desktopChrome)).toMatchObject({ platform: 'other', embedded: null });
  });
});
