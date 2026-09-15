'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Input } from '@/components/ui/input';
import { SimpleSelect } from '@/components/ui/simple-select';
import { ConditionsFilter } from './ConditionsFilter';

const STATUS_OPTIONS = [
  { value: 'following', label: 'Em acompanhamento' },
  { value: 'registered', label: 'Cadastrados' },
  { value: 'discharged', label: 'Alta' },
  { value: 'all', label: 'Todos' },
];

/** D37 — busca por nome (300 ms ou Enter), status e condição; tudo vive na URL. */
export function PatientsToolbar({
  q,
  status,
  condition,
  conditions,
}: {
  q: string;
  status: string;
  condition: string;
  conditions: Array<{ id: string; name: string; patients: number }>;
}) {
  const router = useRouter();
  const [text, setText] = useState(q);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function go(next: { q?: string; status?: string; condition?: string }) {
    const params = new URLSearchParams();
    const nq = next.q ?? text;
    const ns = next.status ?? status;
    const nc = next.condition ?? condition;
    if (nq.trim().length >= 2) params.set('q', nq.trim());
    if (ns && ns !== 'following') params.set('status', ns);
    if (nc) params.set('condition', nc);
    const s = params.toString();
    router.push(s ? `/pacientes?${s}` : '/pacientes');
  }
  useEffect(() => {
    if (text === q) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => go({ q: text }), 300);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [text]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        className="w-56"
        placeholder="Buscar por nome"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') go({ q: text });
        }}
        aria-label="Buscar paciente por nome"
        data-testid="patients-search"
      />
      <div className="w-48">
        <SimpleSelect
          value={status || 'following'}
          onValueChange={(v) => go({ status: v })}
          options={STATUS_OPTIONS}
          size="sm"
          aria-label="Filtrar por status"
          data-testid="patients-status"
        />
      </div>
      {conditions.length > 0 && <ConditionsFilter options={conditions} value={condition} />}
    </div>
  );
}
