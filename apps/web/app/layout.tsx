import type { ReactNode } from 'react';
import './globals.css';

export const metadata = { title: 'MedCheck-in', description: 'Monitorização de pacientes' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <body className="min-h-screen bg-background text-foreground antialiased">
        {/* tema claro/escuro pela preferência do sistema; síncrono de propósito: roda antes da
            pintura para a página não piscar clara no escuro */}
        <script src="/theme-init.js" />
        {children}
      </body>
    </html>
  );
}
