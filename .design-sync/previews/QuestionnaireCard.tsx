import { QuestionnaireCard } from '@medcheckin/web';
import { PATIENT_QUESTIONS } from './_fixtures';

export function ComPerguntas() {
  return (
    <div className="w-[560px]">
      <QuestionnaireCard
        patientId="p1"
        checkinTime="09:00"
        questions={PATIENT_QUESTIONS}
        packHasAdherence
      />
    </div>
  );
}
