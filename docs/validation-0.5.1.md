# 0.5.1 — respostas sem texto

A mensagem antiga “O modelo não retornou texto. Escolha um modelo de chat.” era emitida depois de uma resposta HTTP bem-sucedida e JSON decodificado, quando `message.content` estava vazio ou não era string. Não comprovava incompatibilidade do modelo com chat.

## Correções

- Texto em blocos é normalizado em chamadas textuais e no adaptador nativo OpenAI/compatible/Ollama. Blocos de raciocínio não são mostrados como resposta.
- Respostas sem texto agora distinguem `empty_response`, `reasoning_only`, `output_limit`, `response_refused` e `tool_protocol_mismatch`.
- Uma chamada nativa inesperada em Compatibilidade não é executada nem descartada silenciosamente. O erro orienta selecionar Nativo somente se o modelo suportar ferramentas. Não mudamos automaticamente o protocolo, o modelo ou as permissões.
- O log local `Vortex: Show diagnostic log` registra início da requisição, código HTTP, duração, formato de conteúdo e presença de ferramentas/raciocínio. Não registra URL, chave, prompt, argumentos, resposta ou raciocínio. Valores livres de término da API são normalizados para uma lista controlada.

## Evidência e limite

O teste reproduz uma saudação com texto seguida de pergunta sobre projeto com `content:null` e `tool_calls`. As duas requisições realmente chegam ao transporte simulado; a segunda passa a informar conflito de protocolo. Há casos separados para texto em blocos, raciocínio, bloqueio, resposta vazia e limite de saída, além de assertions contra vazamento no log.

Isso reproduz uma causa possível, não identifica a resposta do provedor real do usuário: ela não foi disponibilizada. O diagnóstico da execução real e o nome do provedor/modelo ainda são necessários para concluir a causa específica.

Validação: 93 testes unitários e fluxo no Extension Host com respostas simuladas. Nenhuma credencial de provedor real foi usada.
