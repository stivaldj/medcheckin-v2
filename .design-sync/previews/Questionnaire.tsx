import {
  Questionnaire,
  QuestionnaireActions,
  QuestionnaireChoice,
  QuestionnaireChoices,
  QuestionnaireDescription,
  QuestionnaireItem,
  QuestionnaireNext,
  QuestionnairePrevious,
  QuestionnaireProgress,
  QuestionnaireSkip,
  QuestionnaireTitle,
} from '@medcheckin/web';

const ITENS = [{ name: 'dor' }, { name: 'sono' }, { name: 'apetite' }];

export function CheckinDoPaciente() {
  return (
    <div className="w-[460px]">
      <Questionnaire items={ITENS} defaultItem="dor">
        <QuestionnaireProgress />
        <QuestionnaireItem name="dor" required>
          <QuestionnaireTitle>Como está sua dor hoje?</QuestionnaireTitle>
          <QuestionnaireDescription>
            Considere o pior momento desde o último check-in.
          </QuestionnaireDescription>
          <QuestionnaireChoices>
            <QuestionnaireChoice value="0">Nenhuma</QuestionnaireChoice>
            <QuestionnaireChoice value="3">Leve</QuestionnaireChoice>
            <QuestionnaireChoice value="6" defaultChecked>
              Moderada
            </QuestionnaireChoice>
            <QuestionnaireChoice value="9">Intensa</QuestionnaireChoice>
          </QuestionnaireChoices>
        </QuestionnaireItem>
        <QuestionnaireActions>
          <QuestionnairePrevious />
          <QuestionnaireSkip />
          <QuestionnaireNext />
        </QuestionnaireActions>
      </Questionnaire>
    </div>
  );
}
