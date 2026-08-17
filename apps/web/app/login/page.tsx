'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

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
    <main className="mx-auto flex min-h-screen max-w-md items-center px-4">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>MedCheck-in — entrar</CardTitle>
        </CardHeader>
        <CardContent>
          {state === 'sent' ? (
            <p className="text-sm">
              Se este e-mail estiver cadastrado, você receberá um link de acesso válido por 15
              minutos.
            </p>
          ) : (
            <form onSubmit={submit} className="space-y-3">
              <div>
                <Label htmlFor="email">E-mail</Label>
                <Input
                  id="email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <Button type="submit" className="w-full" disabled={state === 'sending'}>
                {state === 'sending' ? 'Enviando…' : 'Receber link por e-mail'}
              </Button>
              {state === 'error' && (
                <p role="alert" className="text-sm text-destructive">
                  Não foi possível enviar agora. Tente novamente.
                </p>
              )}
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
