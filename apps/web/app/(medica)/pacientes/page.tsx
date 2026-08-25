import Link from 'next/link';
import { listPatients } from '@medcheckin/core';
import { getDb } from '@/lib/db';
import { requireUserPage } from '@/lib/session';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { fmt, fmtDateTime, EPISODE_LABEL, FREQ_LABEL, STATUS_LABEL } from '@/lib/format';

export default async function PacientesPage() {
  const session = await requireUserPage();
  const rows = await listPatients(getDb(), { clinicId: session.clinicId }, new Date());
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Pacientes</h1>
        <Button nativeButton={false} render={<Link href="/pacientes/novo" />}>
          Novo paciente
        </Button>
      </div>
      {rows.length === 0 ? (
        <p className="text-muted-foreground">Nenhum paciente cadastrado.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Episódio</TableHead>
              <TableHead>Dose vigente</TableHead>
              <TableHead>Último check-in</TableHead>
              <TableHead>Alertas abertos</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((p) => (
              <TableRow key={p.id}>
                <TableCell>
                  <Link
                    href={`/pacientes/${p.id}`}
                    className="font-medium underline-offset-2 hover:underline"
                  >
                    {p.name}
                  </Link>
                </TableCell>
                <TableCell>
                  <Badge variant={p.status === 'active' ? 'default' : 'secondary'}>
                    {STATUS_LABEL[p.status] ?? p.status}
                  </Badge>
                </TableCell>
                <TableCell>
                  {p.episode
                    ? `${EPISODE_LABEL[p.episode.kind as string] ?? p.episode.kind} · ${FREQ_LABEL[p.episode.checkin_frequency as string] ?? p.episode.checkin_frequency}`
                    : '—'}
                </TableCell>
                <TableCell>
                  {p.medications.length === 0
                    ? '—'
                    : p.medications.map((m) => (
                        <div key={m.id}>
                          {m.product_name}:{' '}
                          {m.current_dose
                            ? `${fmt(m.current_dose.dose_amount)} ${m.current_dose.dose_unit} · ${m.current_dose.times_per_day}×/dia`
                            : 'sem dose vigente'}
                        </div>
                      ))}
                </TableCell>
                <TableCell>{fmtDateTime(p.last_checkin_at)}</TableCell>
                <TableCell>
                  {p.open_alerts > 0 ? <Badge variant="destructive">{p.open_alerts}</Badge> : '0'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
