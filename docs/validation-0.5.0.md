# Vortex 0.5.0 — ferramentas e continuidade

## Entregue

- Prompts por modo mantidos, com a mesma base de comportamento nos protocolos nativo e textual. A conversão não remove mais orientações sobre evidência, formatação e limites.
- Um registro tipado define descrições, schemas, modos, efeitos e rótulos de execução. O executor continua explícito; as validações ocorrem antes dos efeitos, inclusive em lotes nativos.
- `editor`: último editor de código e buffers abertos; seleção somente quando solicitada. `read` identifica buffer/disco, alterações não salvas, versão, linhas e próximo intervalo.
- `list` e `search`: escopo, paginação e cobertura explícita. Busca literal, sensível a maiúsculas ou regex opcional. Regex roda em worker com prazo de 2 segundos. Arquivos inacessíveis/binários/grandes são contabilizados, não descritos como pesquisados. Máximo de 10 mil candidatos; afunilar o glob quando esse limite for atingido.
- `diagnostics`: filtros de arquivo e severidade. `symbols`: consulta aos serviços de linguagem do VS Code, com prazo de 5 segundos, sem prometer disponibilidade quando não houver extensão de linguagem.
- `multiEdit`: até 30 substituições sequenciais em um arquivo, validadas integralmente antes da aplicação, com uma aprovação do resultado. Arquivos existentes precisam ser lidos durante a execução; alterações posteriores à leitura bloqueiam a edição. Buffers sujos continuam protegidos contra gravação.
- `question`: pergunta durante a execução usando entrada nativa do VS Code. Opções sugeridas e resposta livre; cancelar pausa a tarefa. Stop cancela a entrada. A resposta volta ao mesmo fluxo do modelo.
- `skill`: descoberta e leitura sob demanda de `.vortex/skills/<nome>/SKILL.md`. Instruções de projeto não ampliam permissões.
- `readOutput`: resultados extensos deixam preview e ID com paginação, em memória limitada a 8 milhões de caracteres por execução. IDs expiram ao iniciar outra execução ou por descarte de memória; a ferramenta informa isso. Histórico visual permanece separado.
- Comandos aceitam `cwd` relativo validado. Mantidas aprovações do host, timeout, cancelamento e integração Docker existentes.
- Três leituras idênticas com o mesmo resultado interrompem ciclos sem progresso. Mutações/interações reiniciam essa contagem.
- Controles contextuais: Continuar para pausa/erro retomável; Implementar para plano pendente; Revisar para journal existente; Desfazer para alterações aplicadas/propostas. Execução oculta esses controles.
- Novas atividades usam rótulos legíveis EN/PT. Resultados de listagem, leitura, busca e diagnósticos têm apresentação resumida.

## Validação

- Compilação TypeScript e empacotamento esbuild.
- 90 testes unitários, incluindo cinco adaptadores, contratos nativos/textuais, saudação sem tools, validação de modos, recusa, versões de arquivo, atomicidade, paginação, regex patológica e controles contextuais.
- Teste de UI com dois documentos, 55 capturas, temas claro/escuro/alto contraste; sidebar 280/360/480 px; configurações 480/800/1200 px. Estados dos botões e espera por resposta também cobertos.
- Extension Host real com respostas de provedores **simuladas**: seis combinações de modo/permissão, aprovação/recusa de edição e terminal, conflito, restauração, edição atômica e pergunta interativa. Gateway compatible com chave e URL sem `/v1` preservado.

## Próximos critérios para distribuição pública

Esta versão melhora a base; não é certificação de prontidão comercial.

1. Executar a matriz com modelos reais, principalmente o gateway corporativo, comparando tokens, acerto e mutações indevidas. Credenciais não estavam disponíveis nesta validação.
2. Validar o runtime Docker real, Windows e Linux; este ambiente valida o Extension Host no macOS.
3. Acrescentar streaming de terminal, ambiente de subprocesso configurável, estados persistidos mais detalhados e resumo estruturado com avaliações de retenção de restrições.
4. Avaliar paralelismo de leituras, perfis por capacidade e MCP em entregas próprias, com classificação de efeitos e testes de autorização. Não adicionar apenas por paridade com outro produto.
5. Confirmar licença, publisher, suporte, política de dados e execução do CI antes de publicar no Marketplace.

Nenhum provedor real, servidor MCP ou runtime externo foi adicionado automaticamente. O ambiente de comandos do host ainda é herdado; filtrar variáveis e isolar execução são problemas distintos.
