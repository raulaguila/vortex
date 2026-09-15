# Conexão OpenAI-compatible — comparação com Forge

Escopo: somente transporte, URL, autenticação e TLS. Revisado Forge em `3bdfd5fbed72659616c36f3a90dc1f3b6e4cd4a2`, arquivos `src/providers/http.ts` e `src/providers/models.ts`.

## Evidência

- Ambos acrescentam `/models` e `/chat/completions` à URL base. Nenhum exige nem acrescenta `/v1` automaticamente.
- Ambos usam `Authorization: Bearer <key>`.
- Forge usa `http.request` / `https.request` com `rejectUnauthorized` por requisição. Vortex 0.4.0 usava fetch e dispatcher Undici para TLS insecure.
- Forge não segue redirects automaticamente. Portanto, não há evidência de que redirects expliquem o sucesso dele.
- O diagnóstico antigo do Vortex ocultava a causa das falhas de transporte.

## Alterações em 0.4.1

- Transporte Node dedicado para OpenAI-compatible, mantendo a política TLS local à conexão, com corpo JSON e streaming.
- Propagação de cancelamento para o socket e o corpo da resposta.
- Erros conhecidos de DNS, rede e TLS exibem código e explicação, sem mensagens brutas que possam conter credenciais.
- HTTP 3xx informa a necessidade de configurar a URL final; credenciais não são encaminhadas a outro destino.
- Nenhuma alteração no transporte dos demais provedores além do diagnóstico e apresentação explícita de redirecionamentos.

## Validação

Quatro testes de transporte/TLS locais passaram: caminho customizado sem `/v1`, Bearer, catálogo, chat, streaming, cancelamento, redirects sem encaminhamento e certificado autoassinado sem alterar outras conexões. O ambiente de trabalho do usuário não está acessível nesta sessão: o transporte é uma diferença relevante, mas a causa específica ainda depende do teste lá.

Também passaram os 80 testes de unidade/contratos e o VSIX 0.4.1 no Extension Host real, incluindo um gateway simulado com chave Bearer e URL `/company` sem `/v1`, com cadastro, catálogo e envio de chat.
