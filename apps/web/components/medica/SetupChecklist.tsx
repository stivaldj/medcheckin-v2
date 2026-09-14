import Link from 'next/link';
import { CheckIcon, CircleIcon } from 'lucide-react';
import type { PatientDetail } from '@medcheckin/core';

/**
 * E9.3 — o que falta para este paciente começar a receber lembretes e check-ins. Some quando
 * tudo está feito. Cada item é derivado do banco (nada é marcado à mão).
 */
export function setupChecklist(d: Pick<PatientDetail, 'respondents' | 'routine' | 'episode'>) {
  const answering = d.respondents.filter((r) => r.setup.device === 'own' && r.can_answer);
  return [
    { key: 'respondent', label: 'Quem responde tem celular próprio', done: answering.length > 0 },
    {
      key: 'routine',
      label: 'Rotina de alarmes com período vigente ou marcado',
      done: !!d.routine.current || d.routine.upcoming.length > 0,
    },
    { key: 'episode', label: 'Episódio com perguntas', done: !!d.episode },
    {
      key: 'phone',
      label: 'Celular pronto (teste de aviso confirmado)',
      done: answering.some((r) => r.setup.complete),
    },
  ];
}

export function SetupChecklist({
  detail,
}: {
  detail: Pick<PatientDetail, 'respondents' | 'routine' | 'episode'>;
}) {
  const items = setupChecklist(detail);
  if (items.every((i) => i.done)) return null;
  const feitos = items.filter((i) => i.done).length;
  return (
    <section
      className="rounded-xl border border-primary/30 bg-primary/5 p-4"
      data-testid="setup-checklist"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">
          Para começar o acompanhamento{' '}
          <span className="font-mono text-muted-foreground">
            ({feitos} de {items.length})
          </span>
        </h2>
        <Link href="/configuracoes/guia" className="text-xs underline underline-offset-4">
          ver o guia passo a passo
        </Link>
      </div>
      <ul className="mt-2 grid gap-1.5 text-sm sm:grid-cols-2">
        {items.map((i) => (
          <li
            key={i.key}
            className={`flex items-center gap-2 ${i.done ? '' : 'text-muted-foreground'}`}
            data-testid={`checklist-${i.key}`}
            data-done={i.done ? 'true' : 'false'}
          >
            {i.done ? (
              <CheckIcon className="size-4 text-primary" />
            ) : (
              <CircleIcon className="size-3.5" />
            )}
            {i.label}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-muted-foreground">
        Tudo isso fica na aba <strong>A configuração</strong>.
      </p>
    </section>
  );
}
