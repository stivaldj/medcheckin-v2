import { RoutineCard } from '@medcheckin/web';
import { MEDICATIONS, QUESTION_SETS, ROUTINE } from './_fixtures';

export function ComPeriodoAtivo() {
  return (
    <div className="w-[600px]">
      <RoutineCard
        patientId="p1"
        routine={ROUTINE}
        medications={MEDICATIONS}
        questionSets={QUESTION_SETS}
      />
    </div>
  );
}

export function SemPeriodo() {
  return (
    <div className="w-[600px]">
      <RoutineCard
        patientId="p1"
        routine={{ ...ROUTINE, current: null, upcoming: [] }}
        medications={MEDICATIONS}
        questionSets={QUESTION_SETS}
      />
    </div>
  );
}
