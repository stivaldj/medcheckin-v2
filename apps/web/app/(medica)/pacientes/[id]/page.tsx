import { notFound } from 'next/navigation';
import { getPatientDetail, listProducts, listQuestionSets, AuthError } from '@medcheckin/core';
import { getDb } from '@/lib/db';
import { requireUserPage } from '@/lib/session';
import { Badge } from '@/components/ui/badge';
import { fmtDate, STATUS_LABEL } from '@/lib/format';
import { PatientHeaderActions } from '@/components/medica/PatientHeaderActions';
import { LgpdActions } from '@/components/medica/LgpdActions';
import { RespondentsCard } from '@/components/medica/RespondentsCard';
import { MedicationsCard } from '@/components/medica/MedicationsCard';
import { RoutineCard } from '@/components/medica/RoutineCard';
import { EpisodeCard } from '@/components/medica/EpisodeCard';
import { QuestionnaireCard } from '@/components/medica/QuestionnaireCard';
import { GridCard } from '@/components/medica/GridCard';
import { AlertsCard } from '@/components/medica/AlertsCard';
import { SymptomDoseChart } from '@/components/medica/SymptomDoseChart';

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
  const conducts = await db('alert_actions as x')
    .join('alerts as a', 'a.id', 'x.alert_id')
    .leftJoin('users as u', 'u.id', 'x.user_id')
    .where('a.patient_id', id)
    .whereIn('x.action', ['resolve', 'note'])
    .orderBy('x.at', 'desc')
    .limit(20)
    .select(
      'x.id',
      'x.alert_id',
      'x.action',
      'x.note',
      'x.at',
      'u.name as user_name',
      'a.title as alert_title',
    );
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
        <div className="flex flex-col items-end gap-2">
          <PatientHeaderActions patientId={p.id} status={p.status} />
          <LgpdActions
            patientId={p.id}
            patientName={p.name}
            discharged={p.status === 'discharged'}
          />
        </div>
      </div>

      <RoutineCard
        patientId={p.id}
        routine={detail.routine}
        medications={detail.medications}
        questionSets={questionSets}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <MedicationsCard
          patientId={p.id}
          medications={detail.medications}
          products={products}
          questionSets={questionSets}
        />
        <EpisodeCard patientId={p.id} episode={detail.episode} questionSets={questionSets} />
        <QuestionnaireCard
          patientId={p.id}
          checkinTime={String(p.checkin_time ?? '')}
          questions={detail.patient_questions}
          packHasAdherence={detail.pack_has_adherence}
        />
        <RespondentsCard patientId={p.id} respondents={detail.respondents} />
        <AlertsCard alerts={detail.alerts} conducts={conducts} />
      </div>

      <SymptomDoseChart patientId={p.id} questions={detail.grid.questions} />
      <GridCard grid={detail.grid} />
    </div>
  );
}
