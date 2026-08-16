import { notFound } from 'next/navigation';
import { getPatientDetail, listProducts, listQuestionSets, AuthError } from '@medcheckin/core';
import { getDb } from '@/lib/db';
import { requireUserPage } from '@/lib/session';
import { Badge } from '@/components/ui/badge';
import { fmtDate, STATUS_LABEL } from '@/lib/format';
import { PatientHeaderActions } from '@/components/medica/PatientHeaderActions';
import { RespondentsCard } from '@/components/medica/RespondentsCard';
import { MedicationsCard } from '@/components/medica/MedicationsCard';
import { EpisodeCard } from '@/components/medica/EpisodeCard';
import { GridCard } from '@/components/medica/GridCard';
import { AlertsCard } from '@/components/medica/AlertsCard';

export default async function PacientePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireUserPage();
  const db = getDb();
  let detail;
  try {
    detail = await getPatientDetail(db, session, id, {
      baseUrl: process.env.APP_BASE_URL ?? '',
      now: new Date(),
    });
  } catch (err) {
    if (err instanceof AuthError && err.code === 'not_found') notFound();
    throw err;
  }
  const [products, questionSets] = await Promise.all([
    listProducts(db, session.clinicId),
    listQuestionSets(db, session.clinicId),
  ]);
  const p = detail.patient;
  const tags = (p.condition_tags as string[]) ?? [];
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold" data-testid="patient-name">
            {p.name}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Badge variant={p.status === 'active' ? 'default' : 'secondary'}>
              {STATUS_LABEL[p.status] ?? p.status}
            </Badge>
            <span>
              nasc. {fmtDate(p.birth_date, { day: '2-digit', month: '2-digit', year: 'numeric' })}
            </span>
            <span>· check-in às {String(p.checkin_time ?? '').slice(0, 5) || '—'}</span>
            {tags.map((t) => (
              <Badge key={t} variant="outline">
                {t}
              </Badge>
            ))}
          </div>
        </div>
        <PatientHeaderActions patientId={p.id} status={p.status} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <MedicationsCard
          patientId={p.id}
          medications={detail.medications}
          products={products}
          questionSets={questionSets}
        />
        <EpisodeCard patientId={p.id} episode={detail.episode} questionSets={questionSets} />
        <RespondentsCard patientId={p.id} respondents={detail.respondents} />
        <AlertsCard alerts={detail.alerts} />
      </div>

      <GridCard grid={detail.grid} />
    </div>
  );
}
