import { listQuestionSets } from '@medcheckin/core';
import { getDb } from '@/lib/db';
import { currentUserSession } from '@/lib/session';
import { QuestionSetsEditor } from '@/components/medica/QuestionSetsEditor';

export default async function PerguntasPage() {
  const session = (await currentUserSession())!;
  const sets = await listQuestionSets(getDb(), session.clinicId);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Perguntas & planos</h1>
      <p className="text-sm text-muted-foreground">
        Conjuntos de perguntas usados pelos episódios. A frequência (diário/semanal/quinzenal) é
        definida no episódio de cada paciente.
      </p>
      <QuestionSetsEditor sets={JSON.parse(JSON.stringify(sets))} />
    </div>
  );
}
