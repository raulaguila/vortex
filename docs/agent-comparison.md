# Prompts, ferramentas e fluxo — Vortex, Forge, OpenCode e Continue

## Escopo e referências

Análise estática do código, em 2026-09-15. Não é um benchmark de qualidade de modelos, popularidade, desempenho ou segurança completa. Não foram executados os projetos externos. O OpenCode tem um núcleo de agente com interfaces CLI/desktop/integrações; não foi tratado como uma simples extensão equivalente ao Continue.

Versões examinadas:

- Vortex: `bb207a07bf49247ec03133212f16bab2fa83da07` (0.4.3).
- [Forge](https://github.com/raulaguila/forge-agent/tree/788203dc1a62ca6f7e337897d2fa6cfbb852c23e): `788203dc1a62ca6f7e337897d2fa6cfbb852c23e`.
- [OpenCode](https://github.com/anomalyco/opencode/tree/e03db9bc6908f75c9334d8aa997deeaac81c0298): `e03db9bc6908f75c9334d8aa997deeaac81c0298`.
- [Continue](https://github.com/continuedev/continue/tree/5522c6f44ca0ac3528b37244818fbfa39b5af470): `5522c6f44ca0ac3528b37244818fbfa39b5af470`. A análise do fluxo usa a interface IDE, não presume que o CLI tenha comportamento idêntico.

## Conclusão

O Vortex já separa os modos, valida ações no executor, exige aprovação supervisionada, guarda alterações e suporta protocolos nativo/textual. A maior oportunidade é tornar a informação que chega ao modelo mais precisa e melhorar a continuidade da execução. Copiar prompts extensos não resolve ferramentas pouco descritivas, contexto incompleto ou resultados cortados.

## Comparação dos prompts

| Projeto | Organização observada | Adaptação útil |
| --- | --- | --- |
| Vortex | Base + arquivo por modo + permissão; conversão posterior para protocolo nativo | Preservar a separação, mas montar nativo e textual a partir de blocos comuns |
| Forge | Prompt montado com modo, regras, raiz, arquivo ativo e editores abertos | Contexto leve do editor e orientação para referências como “este arquivo” |
| OpenCode | Seleção de prompt por família de modelo, ambiente, agentes, skills e instruções de ferramentas | Perfis opcionais por capacidade, ambiente explícito e descrições especializadas |
| Continue | Base por Chat/Plan/Agent, substituições por modelo, regras e protocolo textual adicionado quando necessário | Composição explícita, sem cortar um prompt já pronto; contratos de ferramentas mais ricos |

### Problemas concretos no Vortex

1. **`nativePrompt()` corta a partir de `PROTOCOL`.** Além de remover JSON, perde orientações de formatação de código, placeholders, limites, falhas e truncamento. Os limites continuam impostos pelo host; a informação fornecida ao modelo é que fica desigual. Local: `src/native.ts`, `src/prompt.ts`.
2. **Descrições nativas pouco informativas.** `toolDefinitions()` usa apenas o texto após “—” do catálogo textual. A descrição de `edit` explica unicidade, mas não descreve adequadamente a substituição, os parâmetros e a necessidade de preservar indentação. Local: `src/actions.ts`.
3. **Registry parcialmente duplicado.** Catálogo, schemas, validação, despacho e rótulos de UI estão em estruturas diferentes. Uma ferramenta deveria declarar schema, executor, modos, efeito, política e apresentação em um registro tipado comum.
4. **Ambiente insuficiente.** O prompt normal não informa explicitamente sistema operacional/shell e editor ativo. Isso reduz a precisão de comandos e de perguntas sobre o arquivo atual.

Arquitetura sugerida: identidade e intenção → modo → permissões efetivas → ambiente/contexto selecionado → regras aplicáveis → contrato do protocolo. As descrições de ferramentas seguem separadas. Perfis por modelo são ajustes pequenos, versionados e avaliados; o nome comercial do modelo não deve ser a única fonte de capacidade.

Não importar instruções de produto alheio, como botões Apply inexistentes, atalhos específicos ou imposição de checklist para qualquer tarefa. Também não importar placeholders de snippets para argumentos que alteram arquivos.

Fontes: [Forge/session.ts](https://github.com/raulaguila/forge-agent/blob/788203dc1a62ca6f7e337897d2fa6cfbb852c23e/src/agent/session.ts), [OpenCode/system.ts](https://github.com/anomalyco/opencode/blob/e03db9bc6908f75c9334d8aa997deeaac81c0298/packages/opencode/src/session/system.ts), [Continue/defaultSystemMessages.ts](https://github.com/continuedev/continue/blob/5522c6f44ca0ac3528b37244818fbfa39b5af470/core/llm/defaultSystemMessages.ts).

## Ferramentas

| Capacidade | Vortex atual | Referências e adaptação |
| --- | --- | --- |
| Arquivo ativo/seleção | Anexos explícitos; ferramenta read lê disco | Forge: get_open_editors/get_selection; Continue: read_currently_open_file. Adicionar ferramentas usando o último editor de código, sem perder referência ao focar a webview |
| Leitura | Intervalos numerados, limites fixos | Preferir buffer aberto quando pertinente e identificar versão/origem; preservar proteção contra gravação sobre buffer sujo |
| Descoberta | Glob até 500 caminhos | Listagem por diretório, filtros por linguagem e exclusão de artefatos gerados, inclusive VSIX; saída paginada |
| Busca | Literal, até 300 arquivos e 80 resultados | Regex opcional, case sensitivity, escopo, paginação e aviso de cobertura/truncamento. Não retornar “sem resultados” como se todo o projeto tivesse sido pesquisado |
| Edição | Uma substituição exata por chamada ou arquivo inteiro | Continue multi_edit e OpenCode apply_patch: várias alterações com validação prévia, snapshot, aprovação e aplicação consistente |
| Diagnósticos | Diagnósticos de todo o workspace, cortados como string | Filtrar por arquivo e severidade; comparar erros antes/depois. Diagnóstico não equivale a teste executado |
| Perguntas | Resposta final com pergunta encerra turno | OpenCode question: pausa tipada, escolhas ou texto, resposta associada à mesma tarefa |
| Terminal | Comando com timeout, resultado final, Docker opcional | Cwd validado, ambiente controlado, saída incremental e estado do processo; terminal do host continua exigindo aprovação |
| Plano | Checklist e transição explícita para Agent | Preservar IDs e evidência; transição deve carregar objetivo, decisões, arquivos e critérios de aceite |
| Expansão | Sem MCP/skills operacionais | Introduzir depois de registry/políticas; carregar ferramentas sob demanda e classificar efeitos no host |

**Gap de leitura importante:** `src/readTools.ts` usa `readFile` do filesystem mesmo com buffer não salvo. Os anexos já podem capturar esse buffer; as duas vias deveriam fornecer contexto consistente, identificando a versão lida.

**Gap de saída importante:** `src/agent.ts` corta resultados com `slice()` e não entrega cursor/artefato nem marcador específico em todo resultado cortado. O OpenCode mantém saída completa em arquivo e retorna preview e referência. Adaptar usando um armazenamento controlado pelo Vortex, evitando liberar caminhos arbitrários fora do workspace.

**Terminal:** o Forge usa `scrubEnv`; o Vortex herda o ambiente do processo em `runCommand`. Vale adaptar ambiente explícito, preservando configurações necessárias de build/proxy de forma consciente. Filtrar variáveis não equivale a isolar filesystem ou rede.

Fontes: [Forge/tools.ts](https://github.com/raulaguila/forge-agent/blob/788203dc1a62ca6f7e337897d2fa6cfbb852c23e/src/agent/tools.ts), [Forge/pathGuard.ts](https://github.com/raulaguila/forge-agent/blob/788203dc1a62ca6f7e337897d2fa6cfbb852c23e/src/agent/pathGuard.ts), [Continue/multiEdit.ts](https://github.com/continuedev/continue/blob/5522c6f44ca0ac3528b37244818fbfa39b5af470/core/tools/definitions/multiEdit.ts), [OpenCode/registry.ts](https://github.com/anomalyco/opencode/blob/e03db9bc6908f75c9334d8aa997deeaac81c0298/packages/opencode/src/tool/registry.ts), [OpenCode/truncate.ts](https://github.com/anomalyco/opencode/blob/e03db9bc6908f75c9334d8aa997deeaac81c0298/packages/opencode/src/tool/truncate.ts).

## Fluxo e permissões

### Vortex

Mensagem → contexto/regras → chamada ao modelo → validação do lote → ferramentas sequenciais → aprovação quando exigida → resultado/checkpoint → nova chamada ou conclusão.

Pontos a preservar: validação de modo no host, recusa encerra turno, resposta parcial não executa ferramenta, registro antes de edição, proteção de conflitos e retomada sem repetição automática de resultado incerto.

Pontos a melhorar:

- Parada por três falhas não identifica ciclos de ferramentas bem-sucedidas que não acrescentam informação. Detectar assinatura da chamada + versão do recurso/resultado, sem bloquear uma leitura legítima após edição.
- Separar falha recuperável, falta de informação, espera por aprovação, pausa por limite e conclusão em estados persistidos explícitos. Não inferir estados a partir de textos traduzidos.
- Executar leituras independentes em paralelo limitado; manter mutações dependentes sequenciais e validação do lote antes de qualquer efeito.
- Resumo estruturado: objetivo, autorização, decisões, arquivos/versões, checklist, testes e impedimentos. Não resumir descartando silenciosamente restrições importantes.
- Mostrar Continuar somente em pausa retomável e Revisar/Desfazer somente quando houver alterações correspondentes.

### Forge

Tem registry com risco, streaming, propostas de diff e metadados de editor. Uma recusa devolve resultado ao modelo e o ciclo pode prosseguir; não importar isso sem uma política explícita. A compactação examinada corta caracteres/mensagens com limites fixos e altera a lista em memória; não substitui uma memória de trabalho estruturada.

### Continue

No seletor IDE analisado, Chat não expõe tools; Plan filtra built-ins para readonly, mas ferramentas externas têm tratamento separado. O fluxo pré-processa argumentos, avalia política e executa/aguarda aprovação. Há execução concorrente, mas não significa que todas as tools devam ser paralelizadas. O Vortex deve preservar Ask com leitura, se esse for o contrato de produto, e não classificar ferramentas externas como seguras apenas pelo nome.

### OpenCode

Possui estados persistidos de tool, avaliação de permissões, retries, compactação e detecção de repetição de chamadas, que pode pedir autorização de continuidade. Também possui ferramentas condicionadas ao cliente/modelo/flags; LSP e determinadas transições de plano, por exemplo, não devem ser descritos como universalmente habilitados.

Fontes: [Continue/selectActiveTools.ts](https://github.com/continuedev/continue/blob/5522c6f44ca0ac3528b37244818fbfa39b5af470/gui/src/redux/selectors/selectActiveTools.ts), [Continue/streamNormalInput.ts](https://github.com/continuedev/continue/blob/5522c6f44ca0ac3528b37244818fbfa39b5af470/gui/src/redux/thunks/streamNormalInput.ts), [OpenCode/processor.ts](https://github.com/anomalyco/opencode/blob/e03db9bc6908f75c9334d8aa997deeaac81c0298/packages/opencode/src/session/processor.ts).

## Ordem recomendada

1. **Fundação:** composição de prompt sem cortes; registry unificado; descrições e schemas consistentes; erros e saídas estruturados.
2. **Entendimento do projeto:** arquivo ativo/seleção/buffers, descoberta por escopo, busca com cobertura explícita e paginação.
3. **Implementação confiável:** multi-edit atômico, leitura versionada, diagnósticos por arquivo, comandos com ambiente/cwd explícitos.
4. **Continuidade:** question, estados persistidos, ciclos sem progresso, resumo estruturado e leituras paralelas limitadas.
5. **Extensibilidade:** perfis por capacidade, MCP, skills e LSP. Subagentes somente após os contratos básicos e as permissões estarem maduros.

## Como medir a melhoria

Mesmas tarefas, mesmo modelo/endpoint/configuração, incluindo um modelo local e o gateway corporativo. Medir acerto, chamadas, tokens, latência, perguntas desnecessárias e mutações indevidas. Contratos simulados verificam o executor; modelos reais medem decisões.

Casos mínimos: saudação em cada modo; pergunta geral sem tools; arquivo ativo com edição não salva; visão geral do repositório sem varrer artefatos; busca além dos limites atuais; plano sem mutações; execução explícita do plano; recusa de edição; conflito após leitura; edição em vários trechos; teste com falha; comando interrompido; repetição sem progresso; compactação preservando restrições; retomada após reload; instrução maliciosa em resultado de ferramenta.

Este documento é uma proposta de evolução. Nenhuma mudança nos prompts, ferramentas ou comportamento de execução foi aplicada durante esta análise.
