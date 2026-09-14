import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * E9.3 — manifest POR CONVITE. No iPhone o app da tela inicial não enxerga o cookie do Safari:
 * com o manifest geral ele abriria em /p/hoje sem sessão (beco sem saída). Instalado a partir do
 * convite, ele abre no próprio convite (`?app=1`), que entra sozinho quando já foi aceito.
 * O token é o mesmo do link que a pessoa já tem; "Novo link" o invalida.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const r = await getDb()('respondents').where({ invite_token: token }).first('id');
  if (!r) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return new NextResponse(
    JSON.stringify({
      name: 'MedCheck-in',
      short_name: 'MedCheck-in',
      description: 'Lembretes e check-ins do seu tratamento',
      id: '/p/',
      start_url: `/p/convite/${token}?app=1`,
      scope: '/p/',
      display: 'standalone',
      background_color: '#ffffff',
      theme_color: '#0f766e',
      lang: 'pt-BR',
      icons: [
        { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    }),
    {
      status: 200,
      headers: {
        'content-type': 'application/manifest+json; charset=utf-8',
        'cache-control': 'no-store',
      },
    },
  );
}
