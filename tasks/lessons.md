## 2026-08-17 — provas do jeito do usuário

- Erro: todos os meus testes de E0–E9 carregavam `.env` com `set -a; . ./.env` no shell; o README mandava rodar `npm run dev:web` puro, que não carrega o `.env` da raiz. O dono não conseguiu logar no primeiro teste.
- Regra: antes de declarar uma etapa "feita", executar o roteiro do README **num shell limpo** (`env -u DATABASE_URL …`), exatamente como o dono vai rodar. Se eu preciso de um `source` para funcionar, o produto está quebrado, não o meu shell.
- Regra: qualquer variável obrigatória deve ser carregada pelo próprio comando (`node --env-file`, config do runner), nunca pelo ambiente do operador.
