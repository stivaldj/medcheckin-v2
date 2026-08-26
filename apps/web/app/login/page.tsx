'use client';
import { useState } from 'react';
import { MailCheckIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState('sending');
    const res = await fetch('/api/auth/magic-link', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    // Só "enviado" com 202 do servidor (nunca sucesso falso).
    setState(res.status === 202 ? 'sent' : 'error');
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10">
      {/* Halo em CSS puro: é a única superfície do app que pode gastar decoração, e mesmo aqui
          sem canvas — o custo tem que caber em quem abre isso num Android antigo. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -left-32 size-[34rem] rounded-full bg-primary/25 blur-[80px]" />
        <div className="absolute -right-28 -bottom-44 size-[30rem] rounded-full bg-[var(--chart-dose)]/15 blur-[80px]" />
      </div>

      <div className="relative w-full max-w-sm rounded-2xl border bg-card p-7 shadow-lg">
        <div className="mb-5 flex items-center gap-2">
          <span aria-hidden className="size-3 rounded-full bg-primary ring-3 ring-primary/15" />
          <span className="font-semibold tracking-tight">MedCheck-in</span>
        </div>

        {state === 'sent' ? (
          <div className="space-y-3">
            <div className="flex size-10 items-center justify-center rounded-full bg-sev-low-soft text-sev-low">
              <MailCheckIcon className="size-5" />
            </div>
            <h1 className="text-lg font-semibold tracking-tight">Verifique seu e-mail</h1>
            <p className="text-sm text-muted-foreground">
              Se este e-mail estiver cadastrado, você receberá um link de acesso válido por{' '}
              <span className="font-mono">15 minutos</span>. Ele funciona uma vez só.
            </p>
          </div>
        ) : (
          <>
            <h1 className="text-lg font-semibold tracking-tight">Entrar</h1>
            <p className="mt-1 mb-5 text-sm text-muted-foreground">
              Enviamos um link de acesso para o seu e-mail. Não há senha.
            </p>
            <form onSubmit={submit} className="space-y-4">
              <Field>
                <FieldLabel htmlFor="email">E-mail</FieldLabel>
                <Input
                  id="email"
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="voce@clinica.com.br"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </Field>
              <Button type="submit" className="h-9 w-full" disabled={state === 'sending'}>
                {state === 'sending' ? 'Enviando…' : 'Receber link por e-mail'}
              </Button>
              {state === 'error' && (
                <p role="alert" className="text-sm text-destructive">
                  Não foi possível enviar agora. Tente novamente.
                </p>
              )}
              <FieldDescription>
                Não confirmamos aqui se a conta existe — a mensagem é a mesma nos dois casos.
              </FieldDescription>
            </form>
          </>
        )}
      </div>
    </main>
  );
}
