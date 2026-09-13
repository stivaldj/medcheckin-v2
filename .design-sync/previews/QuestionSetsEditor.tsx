import { QuestionSetsEditor } from '@medcheckin/web';
import { QUESTION_SET_EDITOR_SETS } from './_fixtures';

export function ComConjunto() {
  return (
    <div className="w-[640px]">
      <QuestionSetsEditor sets={QUESTION_SET_EDITOR_SETS} />
    </div>
  );
}
