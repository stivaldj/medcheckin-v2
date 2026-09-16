import { notFound } from 'next/navigation';
import {
  getPatientDetail,
  listProducts,
  listQuestionSets,
  listConditions,
  questionsForPatient,
  patientTimeline,
  listAttachments,
  localDate,
  noteDay,
  AuthError,
} from '@medcheckin/core';
import { getDb } from '@/lib/db';
import { requireUserPage } from '@/lib/session';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
import { SetupChecklist } from '@/components/medica/SetupChecklist';
import { RegisteredBanner } from '@/components/medica/RegisteredBanner';
import { ProntuarioCard } from '@/components/medica/ProntuarioCard';
import { AttachmentsCard } from '@/components/medica/AttachmentsCard';
import { PatientConditions } from '@/components/medica/PatientConditions';

export default async function PacientePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const { tab } = await searchParams;
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
  const [products, questionSets, catalog, perguntas, timelinePage, attachments] = await Promise.all(
    [
      listProducts(db, session.clinicId),
      listQuestionSets(db, session.clinicId),
      listConditions(db, session.clinicId),
      // Direção do score por pergunta: a grade só pinta o que sabe interpretar (pack + extras).
      questionsForPatient(db, { patientId: id, includeInactive: true }),
      patientTimeline(db, session, id, { now: new Date() }),
      listAttachments(db, session, id),
    ],
  );
  const direcoes = Object.fromEntries(perguntas.map((q) => [q.key, q.score_direction]));
  const p = detail.patient;
  // Postgres devolve colunas `date` como objeto Date; o RSC serializa esse Date para o client
  // como Date, e ali `String(...)` não dá AAAA-MM-DD. Normaliza aqui, no fuso do servidor
  // (o mesmo que o pg usou para interpretar a data), com o mesmo conversor canônico das notas.
  const timeline = timelinePage.days.map((d) => ({
    ...d,
    notes: d.notes.map((n) => ({ ...n, occurred_at: noteDay(n.occurred_at) })),
  }));
  const today = localDate(new Date(), p.timezone);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold" data-testid="patient-name">
            {p.name}
          </h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Badge variant={p.status === 'active' ? 'default' : 'secondary'}>
              {STATUS_LABEL[p.status] ?? p.status}
            </Badge>
            <span className="font-mono text-xs">
              nasc. {fmtDate(p.birth_date, { day: '2-digit', month: '2-digit', year: 'numeric' })}
            </span>
            <span aria-hidden>·</span>
            <span className="font-mono text-xs">
              check-in às {String(p.checkin_time ?? '').slice(0, 5) || '—'}
            </span>
          </div>
          <div className="mt-2">
            <PatientConditions
              patientId={p.id}
              conditions={detail.conditions}
              catalog={catalog.map((c) => c.name)}
            />
          </div>
        </div>
        <PatientHeaderActions patientId={p.id} status={p.status} />
      </div>

      {p.status === 'registered' ? (
        <RegisteredBanner patientId={p.id} importedAt={p.imported_at} source={p.external_source} />
      ) : (
        <SetupChecklist detail={detail} />
      )}

      <Tabs defaultValue={tab === 'configuracao' ? 'configuracao' : 'caso'}>
        <TabsList>
          <TabsTrigger value="caso" data-testid="tab-caso">
            O caso
          </TabsTrigger>
          <TabsTrigger value="configuracao" data-testid="tab-configuracao">
            A configuração
          </TabsTrigger>
        </TabsList>

        {/* Ler o caso e configurar o plano são trabalhos diferentes; antes disputavam o mesmo scroll. */}
        <TabsContent value="caso" className="space-y-6">
          <ProntuarioCard
            patientId={p.id}
            timeline={timeline}
            today={today}
            hasMore={timelinePage.hasMore}
            nextBefore={timelinePage.nextBefore}
          />
          <AttachmentsCard patientId={p.id} attachments={attachments} />
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <SymptomDoseChart patientId={p.id} questions={detail.grid.questions} />
            </div>
            <AlertsCard alerts={detail.alerts} conducts={conducts} />
          </div>
          <GridCard grid={detail.grid} direcoes={direcoes} />
        </TabsContent>

        <TabsContent value="configuracao" className="space-y-6">
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
          </div>
          <LgpdActions patientId={p.id} patientName={p.name} anonymizedAt={p.anonymized_at} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
