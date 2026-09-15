# Continue: revisão dos prompts e aplicação no Vortex

Análise do código no commit `5522c6f44ca0ac3528b37244818fbfa39b5af470`, consultado em 15/09/2026. O foco foi a extensão e seu núcleo compartilhado; não é uma auditoria completa do produto nem uma medição de qualidade dos modelos.

## O que o código mostra

1. **Objetivos distintos por modo.** Chat sugere alterações; Plan prioriza compreensão e planejamento com ferramentas de leitura; Agent usa ferramentas para aplicar mudanças. Os prompts também diferenciam exemplos de código de implementação efetiva. [Fonte: defaultSystemMessages.ts](https://github.com/continuedev/continue/blob/5522c6f44ca0ac3528b37244818fbfa39b5af470/core/llm/defaultSystemMessages.ts).
2. **Composição em camadas.** A seleção do prompt considera o modo, aceita uma base específica por modelo e acrescenta um aviso quando não há ferramentas disponíveis. [Fonte: getBaseSystemMessage.ts](https://github.com/continuedev/continue/blob/5522c6f44ca0ac3528b37244818fbfa39b5af470/gui/src/redux/util/getBaseSystemMessage.ts).
3. **Documentação das ferramentas a partir das definições.** As instruções são geradas com descrições e exemplos das ferramentas fornecidas, utilizando um formato de chamadas separado da base comportamental. [Fonte: buildToolsSystemMessage.ts](https://github.com/continuedev/continue/blob/5522c6f44ca0ac3528b37244818fbfa39b5af470/core/tools/systemMessageTools/buildToolsSystemMessage.ts).
4. **Regras de projeto selecionadas por contexto.** O núcleo filtra regras por políticas, caminhos, padrões e conteúdo antes de acrescentá-las ao sistema. [Fonte: getSystemMessageWithRules.ts](https://github.com/continuedev/continue/blob/5522c6f44ca0ac3528b37244818fbfa39b5af470/core/llm/rules/getSystemMessageWithRules.ts).

## Aplicado agora

O Vortex já separava Ask, Plan e Agent e expunha ferramentas por modo. Mantivemos essa arquitetura e reforçamos:

- Exemplos devem identificar linguagem e arquivo.
- Código sugerido no chat não equivale a uma alteração aplicada.
- Agent deve usar as ferramentas de edição para implementar.
- O prompt não deve mencionar controles inexistentes, como Apply.
- Exemplos explicativos podem abreviar trechos; argumentos de edit/write devem conter o texto real, sem marcadores de omissão.

As instruções foram redigidas para os recursos do Vortex. Não importamos os prompts integralmente: referências à interface, execução paralela e formatos de edição precisam corresponder ao executor real.

## Melhorias seguintes, por prioridade

1. **Avaliar modelos reais por comportamento:** saudações, perguntas, planejamento, implementação, recusa, erro de ferramenta e retomada. O executor já possui testes determinísticos; eles não medem adesão semântica do modelo ao prompt.
2. **Melhorar o protocolo:** adicionar chamadas nativas de ferramentas quando suportadas, preservando um fallback validado. Isso é uma recomendação para o Vortex; os arquivos analisados mostram que o Continue também possui suporte a ferramentas descritas no system prompt.
3. **Regras locais com procedência e escopo explícitos:** carregar apenas regras pertinentes e mostrar quais entraram no contexto, sem permitir que alterem permissões.
4. **Perfis de compatibilidade por modelo:** ajustar formato e concisão com evidência de testes, sem permitir overrides que removam as restrições do executor.
5. **Leituras paralelas:** somente depois de haver suporte de execução, cancelamento, limites e ordenação de resultados. Não prometer isso no prompt atual, que aceita uma ação por resposta.

Um prompt mais longo não é, por si só, melhor. O ganho principal é alinhar objetivo, ferramentas disponíveis, contexto e permissões verificadas pelo código.
