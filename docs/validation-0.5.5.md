# 0.5.5 — finalização prematura

## Alteração

Os prompts agora deixam explícito que anunciar uma investigação não equivale a concluí-la. O modelo deve solicitar uma ferramenta estruturada quando a tarefa a exigir, ou apresentar resposta útil, pergunta necessária ou impedimento.

O executor detecta anúncios curtos e isolados de ação em português, inglês e espanhol, como “Vou explorar os arquivos do workspace para entender o projeto.”. Tanto o protocolo textual como o nativo passam pelo mesmo controle:

1. Preserva o anúncio na conversa.
2. Solicita uma continuação do pedido original uma única vez por execução.
3. Valida qualquer ferramenta normalmente, com as mesmas restrições e aprovações.
4. Se o modelo repetir apenas um anúncio detectável, pausa a tarefa com explicação. Não a marca concluída.

A recuperação não converte linguagem natural em comandos e não força uso de ferramentas. Uma resposta direta, uma pergunta ou um impedimento continuam sendo finais válidos. Limites de passos, tempo, tokens, Stop e recusas continuam prioritários.

## Limites

A detecção é conservadora e baseada no formato de anúncios curtos; não é uma avaliação semântica universal da qualidade da resposta. Textos longos, frases diferentes e outros idiomas podem não ser detectados. Exemplos citados, traduções solicitadas e respostas com conteúdo adicional são preservados. Modelos reais ainda precisam de avaliação no endpoint utilizado pelo usuário.

## MCP

MCP padroniza a conexão entre um host/cliente e servidores que expõem ferramentas. A interface entre modelo e Vortex continua precisando de chamadas estruturadas, validação, execução e resultados mesmo ao integrar um servidor MCP. Para ferramentas externas, o Vortex seria o host com cliente MCP. As ferramentas internas não exigem um servidor MCP, e MCP sozinho não evita uma conclusão prematura do modelo.

Referência: https://modelcontextprotocol.io/specification/2025-06-18/architecture

## Validação

104 testes unitários: recuperação nos seis pares modo/permissão, protocolo nativo, repetição com pausa, recusa, proteção de leitura, respostas úteis e traduções. Extension Host com provedor simulado reproduz anúncio → listagem real do workspace de teste → resposta final na mesma execução. Sem credenciais/modelos reais nesta validação.
