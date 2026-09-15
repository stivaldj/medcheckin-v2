'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { SimpleSelect } from '@/components/ui/simple-select';

const ALL = 'all';

/** Filtro por condição na lista de pacientes; o valor vive na URL (?condition=), preservando `q`/`status`. */
export function ConditionsFilter({
  options,
  value,
}: {
  options: Array<{ id: string; name: string; patients: number }>;
  value: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  function go(v: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (v === ALL) params.delete('condition');
    else params.set('condition', v);
    const s = params.toString();
    router.push(s ? `/pacientes?${s}` : '/pacientes');
  }
  return (
    <div className="w-64">
      <SimpleSelect
        value={value || ALL}
        onValueChange={go}
        options={[
          { value: ALL, label: 'Todas as condições' },
          ...options.map((o) => ({ value: o.id, label: `${o.name} (${o.patients})` })),
        ]}
        size="sm"
        aria-label="Filtrar por condição"
        data-testid="conditions-filter"
      />
    </div>
  );
}
