import Link from 'next/link';
import { listConditions } from '@medcheckin/core';
import { getDb } from '@/lib/db';
import { requireUserPage } from '@/lib/session';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ConditionsTable } from '@/components/medica/ConditionsTable';

export const dynamic = 'force-dynamic';

export default async function CondicoesPage() {
  const session = await requireUserPage();
  const rows = await listConditions(getDb(), session.clinicId);
  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm text-muted-foreground">
          <Link href="/configuracoes" className="underline underline-offset-4">
            Configurações
          </Link>{' '}
          / Condições
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">Condições da clínica</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Tudo que você já digitou como condição de algum paciente. O CID-10 é opcional. Se duas
          grafias viraram duas linhas, use <strong>Fundir em…</strong>: os pacientes passam para a
          condição escolhida e a outra some.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>
            {rows.length} condiç{rows.length === 1 ? 'ão' : 'ões'}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ConditionsTable rows={rows} />
        </CardContent>
      </Card>
    </div>
  );
}
