import {
  Questionnaire,
  QuestionnaireActions,
  QuestionnaireChoice,
  QuestionnaireChoices,
  QuestionnaireItem,
  QuestionnaireNext,
  QuestionnairePrevious,
  QuestionnaireSkip,
  QuestionnaireTitle,
} from '@medcheckin/web';

// A barra de ações se posiciona por grid (voltar à esquerda, pular e continuar à direita) e só
// mostra o que faz sentido no item atual — fora do Questionnaire não há o que renderizar.
export function NoRodapeDoCheckin() {
  return (
    <div className="w-[460px]">
      <Questionnaire items={[{ name: 'dor' }, { name: 'sono' }]} defaultItem="sono">
        <QuestionnaireItem name="sono">
          <QuestionnaireTitle>Como você dormiu?</QuestionnaireTitle>
          <QuestionnaireChoices>
            <QuestionnaireChoice value="8" defaultChecked>
              Bem
            </QuestionnaireChoice>
            <QuestionnaireChoice value="3">Mal</QuestionnaireChoice>
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
