import type { ReactNode } from 'react';
import { IBM_Plex_Mono, Instrument_Sans } from 'next/font/google';
import './globals.css';

/* Duas famílias com papéis distintos: sans para o que uma pessoa escreveu, mono para o que
   o sistema mediu (horários, escalas, contagens). É a regra "nenhum número sem fonte" visível. */
const sans = Instrument_Sans({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-sans',
});
const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  display: 'swap',
  variable: '--font-mono',
});

export const metadata = { title: 'MedCheck-in', description: 'Monitorização de pacientes' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      {/* suppressHydrationWarning no body: extensões de navegador (Kapture, gerenciadores de
          senha, Grammarly) injetam classes no <body> antes do React hidratar. A className aqui
          é literal estática — não há divergência possível vinda do nosso lado, então suprimir
          não esconde bug nenhum nosso. O <html> tem o seu por causa do theme-init.js, e o
          atributo não cascateia para os filhos. */}
      <body
        className="min-h-screen bg-background text-foreground antialiased"
        suppressHydrationWarning
      >
        {/* tema claro/escuro pela preferência do sistema; síncrono de propósito: roda antes da
            pintura para a página não piscar clara no escuro */}
        <script src="/theme-init.js" />
        {children}
      </body>
    </html>
  );
}
