## 2026-09-15 — vitest e Playwright disputando o mesmo banco

- Erro: para adiantar os totais de teste, rodei `npm test` em background enquanto um subagente rodava `npm run test:e2e`. O `global-setup` do Playwright faz rollback total + migrate + seed no mesmo `DATABASE_URL_TEST`; a suíte unitária viu tabelas sumindo e reportou 19 falhas e 229 testes pulados — tudo falso.
- Regra: **nunca** rodar vitest (core ou web) e E2E ao mesmo tempo no mesmo banco. Um de cada vez, ou bancos separados (`DATABASE_URL_TEST` distinto para o E2E).
- Regra: falha em massa e súbita (dezenas de arquivos) depois de uma suíte que estava verde é sinal de interferência externa, não de regressão — checar o que mais estava rodando antes de investigar código.

## 2026-09-16 — operar o PC de casa pelo AnyDesk custou 1h; o SSH levou 10 min

- Erro: fiz o deploy da E12.2 digitando comandos na janela do AnyDesk. Perdi três prompts de `sudo` (a sessão gratuita cai a cada ~40 min e o `sudo -v` expira em 5), o console do Windows entrou em "modo seleção" a cada clique e engoliu os comandos, a tecla `^` não chegou ao WSL (o `grep ^APP_VERSION` não casava) e `Escape` comia a letra seguinte (`clear` virou `lear`).
- Regra: se a operação vai passar de dois comandos, o primeiro passo é criar um canal de texto (SSH pela tailnet, `scripts/wsl-ssh-setup.sh`), não digitar em tela remota. Tela remota é só para ler a primeira senha do `sudo`.
- Regra: em console remoto, nunca clicar dentro do terminal (liga seleção); usar o ícone da barra para focar. Evitar `^` e `\` em comandos digitados; preferir `sed '/X=/s/...'` a `s/^X=/`. Nunca canalizar um instalador para `| tail`: o link de login do Tailscale ficou escondido e o script pareceu travado.
- Regra: prompt de `sudo` para o dono digitar só depois de tudo o mais estar pronto (script commitado, `git pull` feito), e o pedido de senha vai na mesma mensagem que o comando que vai usá-la.

## 2026-09-14 — plano de verificação sem o gate que o repo já tem

- Erro: o plano da feature "medicação por nome" listou lint, typecheck, vitest e E2E como verificação final, mas o repositório tem `npm run check` (que inclui `prettier --check .`) como hook de pre-push. O push falhou na primeira tentativa por formatação em 6 arquivos meus.
- Regra: ao escrever a task de verificação de um plano, começar por `grep '"check"\|pre-push' package.json .husky/*` e usar **o mesmo comando do hook**, não uma lista minha. Se o repo tem um gate, o plano herda o gate.
- Regra: `prettier --check .` avalia a árvore inteira, inclusive untracked de outra sessão. Antes de culpar meu diff, `git status --short` para separar o que é meu.

## 2026-09-13 — afirmei um defeito a partir de screenshot, sem abrir o código

- Erro: no sync do design system, disse que `InviteAccept` usava `<input type="checkbox">` cru. Ele sempre usou o `Checkbox` do DS — o estado _desmarcado_ é uma caixa cinza neutra que parece a nativa no screenshot. A afirmação foi para o PR #26, para as notas e virou tarefa para outra sessão.
- Regra: screenshot mostra sintoma, não causa. Antes de afirmar "o componente X usa Y", abrir o arquivo (`grep` pelo import/elemento) — custa segundos e evita espalhar um erro por PR, notas e tarefas.
- Regra: comparar estados equivalentes. Checkbox marcado vs. desmarcado não é comparação válida de estilo.

## 2026-08-17 — provas do jeito do usuário

- Erro: todos os meus testes de E0–E9 carregavam `.env` com `set -a; . ./.env` no shell; o README mandava rodar `npm run dev:web` puro, que não carrega o `.env` da raiz. O dono não conseguiu logar no primeiro teste.
- Regra: antes de declarar uma etapa "feita", executar o roteiro do README **num shell limpo** (`env -u DATABASE_URL …`), exatamente como o dono vai rodar. Se eu preciso de um `source` para funcionar, o produto está quebrado, não o meu shell.
- Regra: qualquer variável obrigatória deve ser carregada pelo próprio comando (`node --env-file`, config do runner), nunca pelo ambiente do operador.
