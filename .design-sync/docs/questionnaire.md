---
category: formulario
---
# Questionnaire

Conjunto do check-in do paciente: uma pergunta por vez, com progresso, escolhas e navegação.

Composição: `Questionnaire` > `QuestionnaireProgress` + `QuestionnaireItem`
(`QuestionnaireTitle`, `QuestionnaireDescription`, `QuestionnaireChoices` >
`QuestionnaireChoice`) + `QuestionnaireError` + `QuestionnaireActions`
(`QuestionnairePrevious`, `QuestionnaireSkip`, `QuestionnaireNext`/`QuestionnaireSubmit`).

`QuestionnaireChoice` é um radio/checkbox estilizado com rótulo, descrição opcional e atalho
de teclado. `QuestionnaireInput` cobre resposta livre em vez de escolha.

Este é o conjunto que o paciente vê no PWA — texto grande, alvos de toque generosos, uma
decisão por tela.
