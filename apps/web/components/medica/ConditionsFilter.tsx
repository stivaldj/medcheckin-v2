'use client';
import { useRouter } from 'next/navigation';
import { SimpleSelect } from '@/components/ui/simple-select';

const ALL = 'all';

/** Filtro por condição na lista de pacientes; o valor vive na URL (?condition=). */
export function ConditionsFilter({
  options,
  value,
}: {
  options: Array<{ id: string; name: string; patients: number }>;
  value: string;
}) {
  const router = useRouter();
  return (
    <div className="w-64">
      <SimpleSelect
        value={value || ALL}
        onValueChange={(v) => router.push(v === ALL ? '/pacientes' : `/pacientes?condition=${v}`)}
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
