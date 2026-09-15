# Vortex

Agente de código para VS Code, com BYOK e interface compacta na sidebar. O visual acompanha o tema do editor: claro, escuro ou alto contraste.

## Executar

Requer Node.js 22 para desenvolvimento e VS Code 1.96+.

```sh
make install
make test
make package
```

Abra esta pasta no VS Code e pressione **F5 → Executar Vortex**. Na janela Extension Development Host, abra Vortex na Activity Bar. Após atualizar o código, compile e reinicie a sessão de depuração para carregar a nova versão.

## Interface

- Input com modo, modelo e enviar/parar integrados. `Enter` envia; `Shift+Enter` insere uma linha; `Ctrl/Cmd+Enter` também envia.
- Menu de modelos com busca, favoritos e agrupamento por conexão.
- Configurações em uma aba reutilizável do editor, com Provedores, Modelos e Conversa. Abrir a aba preserva o rascunho e a execução. Comando: **Vortex: Abrir configurações**.
- Interface em inglês por padrão, com opção de português. O idioma das respostas segue a mensagem por padrão e pode ser definido separadamente.
- Modos e permissões com ícones e descrições; seletor de modelos com atualização dos catálogos.
- Markdown com blocos de código, tabelas, links e listas; checklist de planejamento visível e atualizado pelas ações do agente.
- Sessões recentes na tela inicial, pesquisa e reabertura de conversas antigas. Histórico salvo localmente por workspace.
- Atividades recolhíveis. Erros de envio preservam ou restauram o rascunho sem sobrescrever uma nova mensagem digitada.
- Modos **Perguntar**, **Planejar** e **Agente**, com política de aprovação selecionável e preservada ao trocar de modo.

## Configurar BYOK

Em **Settings → Providers → Add** (ou os equivalentes em português), no modal de cadastro, escolha o tipo, nome da conexão, URL base e chave. Use **Testar conexão** para consultar o catálogo sem salvar. **Salvar** guarda a conexão e consulta os modelos automaticamente.

| Provedor | Catálogo | Conversa |
| --- | --- | --- |
| OpenAI | `/v1/models` | `/v1/chat/completions` |
| Anthropic | `/v1/models`, paginado | `/v1/messages` |
| Gemini | `/v1beta/models`, paginado e filtrado por `generateContent` | `generateContent` |
| Ollama | `/api/tags` | `/api/chat` |
| OpenAI-compatible | `/models` relativo à URL base | `/chat/completions` relativo à URL base |

- Várias conexões do mesmo tipo são permitidas. Cada uma pode ser editada, testada, atualizada ou removida.
- Chaves ficam no `ExtensionContext.secrets`, nunca em settings.json ou no estado persistido da webview. Na edição, o campo vazio preserva a chave; uma nova chave substitui a anterior. Ollama e OpenAI-compatible permitem chave opcional e remoção explícita.
- **HTTP e HTTPS são aceitos para qualquer host**, inclusive servidores remotos e de rede local.
- **TLS insecure**, disponível para OpenAI-compatible, desativa a validação do certificado HTTPS apenas nessa conexão, tanto no catálogo quanto nas conversas. A opção vem desligada; não altera a configuração TLS global. Em URLs HTTP, ela não tem efeito.
- Catálogos vazios ou indisponíveis permitem cadastro de **modelos manuais** pelo ID. O resultado do teste de conexão não garante que cada modelo listado suporta chat ou o protocolo de ações do agente.
- Favoritos, modelos manuais e seleção são persistidos por ID da conexão + ID do modelo. Remover a conexão selecionada limpa a seleção, sem escolher outra automaticamente.

## Uso local — 0.3.0

Esta versão concentra-se no fluxo Ask → Plan → Agent e no uso diário com BYOK. A interface mantém margem de 16 px e usa SVGs de contorno nos controles: nova conversa com lápis, engrenagem, mão para aprovação, busca, modos, atualização e favoritos. Os controles usam SVGs Lucide, família identificada na instalação local do Codex. As referências de posição e espaçamento são os prints fornecidos; a marca permanece Vortex. Use npm run icons para regenerar os símbolos a partir da dependência fixada no lockfile. As licenças estão em THIRD_PARTY_NOTICES.md.

- A pergunta atual permanece no contexto ao remover mensagens antigas. Atualizar catálogos não invalida uma consulta simultânea ao limite do modelo.
- Uma resposta Markdown pode encerrar a conversa. Somente JSON completo e validado executa ferramentas; ações incompletas ou proibidas nunca são executadas.
- Respostas cortadas pelo limite de saída são informadas como erro, antes de tentar aplicar uma edição.
- Aprovar uma edição antiga não sobrescreve um arquivo alterado enquanto o diálogo estava aberto. Arquivos não salvos, alvos grandes e links para caminhos protegidos são rejeitados.
- Parar e timeout encerram o grupo do comando e seus descendentes comuns no macOS/Linux. Processos que deliberadamente se desacoplam do grupo continuam fora dessa garantia. Windows usa taskkill; ainda não foi validado em uma máquina Windows.
- A conversa ativa, o rascunho e a política são retomados após recarregar a janela. Uma execução interrompida não recomeça sozinha.
- O pacote inclui o runtime em um único bundle, sem depender do node_modules do projeto.

Terminal continua sujeito a aprovação nos dois níveis; não há sandbox de sistema operacional. O modo Supervisionado é indicado para começar. Não há tool calling nativo nem streaming nesta versão. A qualidade das decisões depende do modelo escolhido.

Validação local: 57 testes automatizados, teste de HTTPS autoassinado, capturas nos temas claro/escuro/alto contraste e Extension Host real. Inclui criação de arquivo em pasta nova, edição concorrente, recarga de janela, seis combinações de modo/permissão, checklist, aprovação/recusa e cancelamento de processos. O VSIX extraído foi testado isoladamente, sem node_modules do repositório. APIs dos cinco provedores são simuladas. O Ollama cadastrado no perfil foi localizado, mas não respondeu à tentativa de conexão na rede; não foram usadas credenciais pagas.

Referências dos adaptadores: [Chat Completions](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/retrieve), [Ollama chat](https://docs.ollama.com/api/chat).

## Modos e aprovações — 0.2.8

Modo de trabalho e política de aprovação agora são campos separados no protocolo, no executor e nas sessões. O seletor de permissão permanece visível em Ask, Plan e Agent. Em Ask/Plan, a descrição informa que a escolha se aplica ao Agent; ela não libera ferramentas de escrita nesses modos. Trocar de modo ou reabrir uma sessão preserva a política. Sessões antigas são migradas sem perder mensagens e checklist.

Ask responde e consulta arquivos; Plan consulta e prepara um checklist; Agent implementa. Os prompts expõem somente ferramentas aceitas pelo executor. O modelo não pode mudar de modo ou conceder permissões. Supervisionado pede aprovação para edições e terminal; Autônomo aplica edições diretamente, mas o terminal continua exigindo aprovação.

A referência oficial do Codex separa sandbox e aprovação: o preset Auto executa dentro da sandbox e pede aprovação para sair dos limites. O Vortex ainda não tem sandbox de sistema operacional; portanto esta versão não oferece equivalência ao Auto do Codex. Referência: [Agent approvals & security](https://learn.chatgpt.com/docs/agent-approvals-security).

Validação: 46 testes unitários; teste visual em navegador; Extension Host real com os seis pares de modo/permissão, leitura sem mutações, Plan → Agent, checklist, migração, retomada, aprovação e recusa de edições/comandos. O provedor Ollama é simulado; arquivos, diálogos, WorkspaceEdit e comandos echo são reais em um workspace descartável.

## Espaçamento — 0.2.7

Referência visual: prints da extensão OpenAI fornecidos pelo usuário. Manter margem lateral de 16 px em cabeçalho, conversa e compositor, com os seletores alinhados ao compositor. Validar visualmente futuras mudanças contra essa referência nas larguras 280, 360, 480 e 538 px.

Mensagens usam 12 px de separação, bolhas com padding vertical de 8 px e ações de 22 px. O input vazio começa com duas linhas e continua crescendo conforme o conteúdo. Os controles mantêm navegação por teclado e foco visível. Esta orientação substitui a margem de 4 px das versões anteriores.

## Conversa — 0.2.6

Mensagens do usuário aparecem em bolhas alinhadas à direita; respostas usam a largura da conversa sem rótulos repetidos. O cabeçalho mostra o título baseado na primeira mensagem e uma seta para voltar ao início. Atividades consecutivas ficam em um grupo recolhível.

Mensagens podem ser copiadas pelo clipboard do VS Code. Reutilizar uma pergunta preenche o input sem enviar ou alterar o histórico; um rascunho diferente é preservado. Mensagens longas do usuário têm Mostrar mais/menos. Novos eventos guardam horários reais; históricos antigos sem horário não recebem datas inventadas.

Inclui a correção de contexto 0.2.5. Validação: 41 testes unitários, fluxos de interface com 55 capturas e Extension Host real. Provedores e clipboard do teste de navegador são simulados.

## Correção de contexto — 0.2.5

Configurações e chat recebem o mesmo orçamento efetivo do gerenciador. Em modo API, o campo Tokens mostra o limite atual informado pelo provedor, não um valor antigo salvo. Em modo personalizado, respeita o valor escolhido e o teto conhecido. Eventos de uso não sobrescrevem o limite e são associados ao modelo correto. O agente consulta o orçamento atualizado antes de cada requisição.

Validação: 41 testes unitários, teste UI com mudança de 262.144 para 131.072 e respostas atrasadas simuladas, além do fluxo Extension Host.

## Contexto e seletores — 0.2.4

O rodapé recebe o orçamento de contexto calculado pelo gerenciador de provedores. Atualizações dos metadados ou do limite personalizado são refletidas sem trocar de modelo. O uso de tokens continua sendo estimado; o limite exibido acompanha o orçamento escolhido, não uma contagem estimada.

Modelo, modo e permissão compartilham o componente `media/picker.js`, ancorado acima do input, com largura, fechamento externo, Escape, foco e navegação por teclado consistentes. A tela inicial mostra somente a lista recente com datas relativas e um botão de busca de conversas no cabeçalho.

## Interface e análise do Continue — 0.2.3

- Modos na ordem Ask, Plan, Agent; Ask é o padrão em uma interface nova e ao iniciar outra conversa.
- Fechar conversa retorna ao início e mantém a sessão salva, disponível para reabrir. Durante execução, interrompa antes de fechar.
- Sidebar e menus usam a mesma margem de 4 px; o padding padrão da webview é removido. O hover do modelo fica limitado ao botão.
- Supervisionado usa escudo, Autônomo usa raio e os modos de leitura usam olho, sem badge duplicada.
- Prompts distinguem sugestões de mudanças aplicadas e exigem conteúdo real nas ferramentas de edição.

A análise dos prompts do Continue, em `docs/continue-prompts-review.md`, registra fontes, mudanças aplicadas e prioridades futuras. Testes: 40 unitários, fluxos UI com 46 capturas e Extension Host real, incluindo aprovação/recusa e fechar/reabrir sessão; APIs simuladas.

## Prompts e ferramentas — 0.2.2

Cada modo tem instruções próprias em `src/prompts/`: Perguntar responde e investiga, Planejar prepara um checklist sem executar, e Agente implementa e verifica o pedido. Supervisionado e Autônomo têm instruções explícitas de permissão. Idioma, segurança e protocolo ficam na base comum `src/prompt.ts`.

O catálogo em `src/actions.ts` determina quais ferramentas aparecem no prompt e quais ações o executor aceita. Argumentos são validados antes da execução; leitura e edição exigem caminhos literais, enquanto listagem e busca aceitam padrões. Perguntar não altera o checklist, e Planejar não pode marcar novos itens como executados.

Resultados de ferramentas identificam sucesso, erro ou recusa. Recusar uma aprovação encerra o turno, sem dar ao modelo outra tentativa por uma ferramenta alternativa. Comandos com saída diferente de zero contam como falha. Interrupções não afirmam que houve edição.

O teste do Extension Host valida a recusa e a aprovação de uma edição real em arquivo temporário: nenhuma mudança antes de aprovar ou após recusar. As respostas do modelo continuam simuladas; os testes validam o executor, não garantem a qualidade de todos os modelos reais. O transporte ainda utiliza ações JSON em texto, sem tool calling nativo dos provedores.

## Correção 0.2.1

Saudações simples como “oi” recebem apenas resposta de conversa: o controle de execução bloqueia ferramentas nesse turno, mesmo se o modelo tentar acioná-las. O prompt exige uma solicitação concreta para trabalhar no workspace. Perguntas comuns não obrigam a criação de checklist; três respostas inválidas ou falhas consecutivas encerram a execução. Pedidos como “oi, corrija o login” continuam sendo tratados como tarefas.

## Permissões e execução

| Modo | Leitura | Edição | Comandos |
| --- | --- | --- | --- |
| Perguntar | Sim | Não | Não |
| Planejar | Sim | Não | Não |
| Agente · Supervisionado | Sim | Com aprovação | Com aprovação |
| Agente · Autônomo | Sim | Direta | Com aprovação |

O agente usa um protocolo de ações JSON, com até 20 etapas, leitura por intervalo, listagem, busca textual, diagnósticos do VS Code, checklist, edição por trecho e gravação de arquivos. Comandos têm limite de 60 segundos e devolvem stdout/stderr ao modelo. Edições usam WorkspaceEdit e salvam os arquivos. Parar cancela a requisição em andamento; edições anteriores permanecem. O cancelamento encerra o grupo de processos do comando; processos que se desacoplam deliberadamente do grupo não são cobertos.

O workspace deve ser confiável. As ferramentas de arquivo bloqueiam `.git`, `.env`, travessia de diretórios e links para fora da pasta. O terminal autorizado executa com as permissões do usuário, sem sandbox. Arquivos lidos são enviados ao provedor selecionado.

## Modelos e contexto

Defina modelos padrão por modo em **Settings → Models**. Os padrões são aplicados ao iniciar uma tarefa ou trocar de modo; salvar um padrão não muda uma execução em andamento. Seleções manuais valem para a tarefa atual.

A descoberta de contexto consulta metadados das APIs quando disponíveis. Escolha usar o limite informado pela API ou um orçamento personalizado, limitado ao máximo conhecido. APIs sem essa informação permitem um valor manual; o limite real não pode ser validado nesse caso. O fallback é 16.384 tokens e pode precisar de ajuste conforme o modelo.

A UI informa uso **estimado**, com contagem conservadora por bytes, e reserva espaço para a resposta. Ao atingir o orçamento, mensagens antigas são omitidas da próxima requisição, preservando a solicitação atual e o checklist; continuam no histórico salvo. Não há resumo automático nem tokenizador específico de cada modelo.

Em **Settings → Conversation**, ajuste idioma da interface, idioma das respostas, fonte (VS Code ou 11–20 px) e atalho de envio. Fonte e atalho entram em vigor imediatamente; o idioma das respostas vale para a próxima execução.

## Makefile

`make install`, `make build`, `make watch`, `make test`, `make test-ui`, `make test-tls`, `make test-host`, `make check` e `make package` cobrem o desenvolvimento e a validação. `make install-vsix` gera e instala o pacote no VS Code local usando o comando `code`.

Para instalação manual, use **Extensions: Install from VSIX…** e selecione `vortex-agent.vsix`.

## Testes

```sh
npm test         # Compilação, adaptadores, credenciais, preferências e políticas
npm run test:ui  # Chrome: fluxos BYOK + capturas: sidebar e configurações, 3 temas e larguras variadas
npm run test:tls # HTTPS local: certificado autoassinado e isolamento de TLS insecure
npm run test:host # VS Code isolado: fluxo real da extensão com Ollama simulado
```

Os testes UI e TLS precisam abrir portas locais. O teste UI usa o Chrome instalado no macOS; `CHROME_PATH` permite indicar outro executável. O teste Host usa uma instalação local de VS Code; `VSCODE_PATH` pode indicar outro executável. Esse teste abre uma janela e usa um perfil temporário. Capturas ficam em `test-results/` (não distribuídas com a extensão). Nenhum teste usa chaves ou contas reais.

## Estado e arquitetura

Versão para uso local, ainda não publicada no Marketplace. Conversas e checklists persistem localmente e podem ser retomados. Sem streaming, anexos de contexto ou revisão de diffs própria. O agente trabalha na primeira pasta do workspace. Catálogos, chat e limites de contexto nos testes usam respostas simuladas; não houve validação com credenciais reais dos provedores.

- `src/extension.ts`: lifecycle e coordenação da webview.
- `src/agent.ts`: execução e ferramentas do workspace.
- `src/providerManager.ts`: conexões, SecretStorage, catálogos e preferências.
- `src/protocol.ts`: mensagens tipadas e validação do canal webview/extensão.
- `src/providers.ts`: adaptadores e transporte HTTP/TLS.
- `src/view.ts` e `media/`: renderização, interface sem framework e CSP restritiva.

A identidade aprovada é **Vórtex, alternativa 3**. O símbolo atual permanece provisório até receber a imagem original; a interface usa cores do tema do VS Code.

Referências: [VS Code API](https://code.visualstudio.com/api/references/vscode-api), [Anthropic models](https://platform.claude.com/docs/en/api/models), [Gemini models](https://ai.google.dev/api/models), [Ollama](https://docs.ollama.com/api), [TLS por requisição no Undici](https://github.com/nodejs/undici/blob/main/docs/docs/api/Fetch.md).
