## 2026-09-13 — afirmei um defeito a partir de screenshot, sem abrir o código

- Erro: no sync do design system, disse que `InviteAccept` usava `<input type="checkbox">` cru. Ele sempre usou o `Checkbox` do DS — o estado _desmarcado_ é uma caixa cinza neutra que parece a nativa no screenshot. A afirmação foi para o PR #26, para as notas e virou tarefa para outra sessão.
- Regra: screenshot mostra sintoma, não causa. Antes de afirmar "o componente X usa Y", abrir o arquivo (`grep` pelo import/elemento) — custa segundos e evita espalhar um erro por PR, notas e tarefas.
- Regra: comparar estados equivalentes. Checkbox marcado vs. desmarcado não é comparação válida de estilo.

## 2026-08-17 — provas do jeito do usuário

- Erro: todos os meus testes de E0–E9 carregavam `.env` com `set -a; . ./.env` no shell; o README mandava rodar `npm run dev:web` puro, que não carrega o `.env` da raiz. O dono não conseguiu logar no primeiro teste.
- Regra: antes de declarar uma etapa "feita", executar o roteiro do README **num shell limpo** (`env -u DATABASE_URL …`), exatamente como o dono vai rodar. Se eu preciso de um `source` para funcionar, o produto está quebrado, não o meu shell.
- Regra: qualquer variável obrigatória deve ser carregada pelo próprio comando (`node --env-file`, config do runner), nunca pelo ambiente do operador.
