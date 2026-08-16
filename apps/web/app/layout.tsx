import type { ReactNode } from 'react';
import './globals.css';

export const metadata = { title: 'MedCheck-in', description: 'Monitorização de pacientes' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="min-h-screen bg-background text-foreground antialiased">{children}</body>
    </html>
  );
}
