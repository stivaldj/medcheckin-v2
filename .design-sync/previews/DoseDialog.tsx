import { DoseDialog } from '@medcheckin/web';
import { MEDICATIONS, QUESTION_SETS } from './_fixtures';

export function Aberto() {
  return (
    <DoseDialog
      med={MEDICATIONS[0]}
      questionSets={QUESTION_SETS}
      onDone={() => {}}
      open
      onOpenChange={() => {}}
      withTrigger={false}
    />
  );
}
