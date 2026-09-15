# Validação 0.7.2

## Correção

A recuperação de respostas inválidas descartava a resposta rejeitada e não devolvia resultados associados aos IDs das chamadas nativas. As saudações ainda repetiam a requisição original sem o feedback. Agora a próxima rodada inclui a resposta e o motivo específico de validação; cada chamada de um lote rejeitado recebe um resultado de erro. Nenhuma ferramenta do lote é executada. O contador de validação é separado das falhas de execução e mantém o limite de três tentativas.

O chat exibe as rejeições nas atividades, o campo inválido na falha final e acesso às configurações do modelo e ao diagnóstico. Aprovações recusadas continuam encerrando o turno; recuperação não altera modo nem permissões.

`editor` consulta arquivos abertos e, opcionalmente, a seleção. É uma ferramenta de leitura, disponível em Ask. Uma chamada nativa acompanhada de `stop` continua sendo interpretada como uso de ferramenta. O JSON normaliza esse estado para `tool_use`, preservando o valor original em `provider_stop_reason` quando diferente. Ações textuais convertidas mantêm `provider_content`; rejeições incluem `validation_error`. O envelope principal é preservado.

## Verificações

- Compilação e 136 testes unitários/integrados aprovados.
- Recuperação nativa e Compatibilidade, validação por campo, isolamento de contexto social, contadores separados e ausência de efeitos em lotes rejeitados.
- Serialização dos retornos de erro com IDs correspondentes nos cinco adaptadores.
- Rastreio de chamadas textuais/nativas, `stop` do provedor e `tool_use` interpretado, preservação de IDs e motivos de rejeição.
- UI aprovada com atividades de rejeição e botões para configurações/diagnóstico.
- Extension Host real: Ask → editor com argumento inválido → retorno de erro → chamada corrigida → resposta final, sem alterações no workspace. As seis combinações de modo/permissão e aprovações/recusas também passaram.

Os provedores e respostas foram simulados. O JSON da ocorrência relatada no trabalho não estava disponível localmente; os defeitos encontrados no código e os cenários de regressão foram verificados, sem atribuir uma causa específica àquela resposta não inspecionada.
