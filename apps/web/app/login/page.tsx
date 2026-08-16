'use client';
import { useState } from 'react';

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
    <main style={{ maxWidth: 420, margin: '4rem auto', fontFamily: 'system-ui' }}>
      <h1>MedCheck-in — entrar</h1>
      {state === 'sent' ? (
        <p>
          Se este e-mail estiver cadastrado, você receberá um link de acesso válido por 15 minutos.
        </p>
      ) : (
        <form onSubmit={submit}>
          <label>
            E-mail
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={{ display: 'block', width: '100%', margin: '.5rem 0 1rem' }}
            />
          </label>
          <button type="submit" disabled={state === 'sending'}>
            {state === 'sending' ? 'Enviando…' : 'Receber link por e-mail'}
          </button>
          {state === 'error' && <p role="alert">Não foi possível enviar agora. Tente novamente.</p>}
        </form>
      )}
    </main>
  );
}
