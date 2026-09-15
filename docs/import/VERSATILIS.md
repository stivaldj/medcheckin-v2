# Importar o cadastro do Versatilis

## 1. O que pedir ao Versatilis

- **Cadastro estruturado** (CSV, uma linha por paciente): id do paciente no Versatilis, nome completo, data de nascimento, telefone, diagnósticos/condições, datas das consultas.
- **Histórico em PDF, um arquivo por paciente**, com o **id do paciente no nome do arquivo** (ex.: `12345.pdf`). Sem isso não há como ligar o PDF ao cadastro com segurança.

## 2. Preencher o mapa

Copie `docs/import/versatilis.exemplo.json` para `mapa.json` e troque os nomes das colunas pelos do seu CSV. `formatoData` aceita `DD/MM/AAAA`; `pdf.padrao` aceita `{ref}.pdf` ou `{nome}.pdf` — prefira `{ref}` sempre que possível, é o casamento mais seguro. `ref` e `nome` são obrigatórios; os demais campos (`nascimento`, `telefone`, `condicoes`, `consultas`) podem ficar de fora do mapa se a coluna não existir no seu CSV.

## 3. Ensaio (nada é gravado)

```
node --env-file=.env.prod scripts/import-versatilis.mjs --cadastro cadastro.csv --pdfs pdfs/ --mapa mapa.json --clinica medica@clinica.com --saida relatorios/
```

Leia `relatorios/import-ensaio-<data>.md`: criar, casar, **colisões**, PDFs órfãos, pacientes sem PDF e linhas ignoradas (sem id ou com nome curto demais — ficam registradas, mas não viram paciente). O total de criar + casar + colisões + ignoradas bate com o total de linhas do CSV.

Colisão = mesmo nome com nascimento diferente (ou faltando) de um paciente já cadastrado, ou repetido no CSV. **Nenhuma fusão é automática.** Resolva editando o CSV (corrigir nascimento, remover duplicata) e rode o ensaio de novo até zerar as colisões. O script sai com código **2** enquanto houver colisões pendentes — inclusive com `--gravar`, que nesse caso escreve o mesmo relatório de ensaio e não grava nada.

## 4. Gravar

Mesmo comando com `--gravar`. Cada paciente entra numa transação; rodar de novo não duplica (id do Versatilis, hash do PDF e data da consulta são únicos). Pacientes importados nascem como **Cadastrado**: sem acompanhamento, sem envios; vire ativo por **Iniciar acompanhamento** na página do paciente.

Códigos de saída: **0** (gravado sem pendências), **2** (colisões pendentes — nada foi gravado), **3** (erro de uso, ex.: faltou um argumento obrigatório).

## 5. Depois

- Conferir `import-resultado-<data>.md` e a lista de pacientes filtrada por **Cadastrados**.
- Rodar o backup (`backup.sh`) — o volume de anexos cresceu.
