# Vortex

Extensão de código BYOK para VS Code. Interface em inglês ou português, seguindo o tema do editor, com margem lateral de 16 px.

## Desenvolvimento e instalação

Node.js 22 ou 24 e VS Code 1.96+.

```sh
make install
make test
make package
```

Instale `vortex-agent.vsix` por **Extensions → Install from VSIX**, ou execute `make install-vsix`. Para desenvolvimento, pressione F5 ou use `make watch`, que recompila o bundle e verifica TypeScript.

Os comandos de build do Makefile sincronizam as dependências com `npm ci` na primeira execução e quando `package.json` ou `package-lock.json` mudam. Isso evita usar dependências antigas após `git pull`. Se `node_modules` tiver sido alterado manualmente, execute `make install` para restaurar as versões do lockfile. Ao usar npm diretamente, execute `npm ci` antes de `npm run package`.

## Versão 0.10.0 — consolidação

- Alterações têm registro durável por etapa. Se aplicar, salvar ou registrar falhar, a tarefa pausa para revisão; não repete a escrita nem desfaz automaticamente.
- Conexões e preferências são gravadas juntas para evitar perda de cadastro após atualizações rápidas; chaves permanecem no SecretStorage.
- Sessões mantêm a última cópia válida. **Diagnóstico → Recovery** permite restaurar uma cópia ou liberar um bloqueio vazio legado, com confirmação. O arquivo danificado é preservado.
- Listagem e busca usam cursores associados à consulta, com cache de descoberta. A busca continua dentro de um arquivo quando o limite de resultados é atingido; arquivos omitidos são contabilizados.
- Atividades indicam saída parcial e oferecem **View full output** no editor somente leitura. Falhas de gravação permanecem visíveis; Undo mantém a tarefa ocupada até terminar.
- Avaliações repetem cenários e verificam resultados funcionais. `make benchmark` mede descoberta de 10.000 arquivos, 500 sessões e checkpoints de uma conversa longa.

Veja [evidências, reprodução e validações pendentes](docs/validation-0.10.0.md). Os testes com provedores simulados não substituem a validação com o Ollama e o provedor corporativo usados no dia a dia.

## Versão 0.9.2

O prompt inclui um guia em tópicos para escolher ferramentas, filtrado pelo modo. O workflow descreve a sequência de investigação; schemas continuam definindo argumentos e limites. O guia distingue localizar caminhos (`list_files`) de buscar texto dentro dos arquivos (`search_files`).

## Versão 0.9.1

Prompts reorganizados em identidade, tarefa, modo, fluxo, permissões e comunicação. Ask e Plan não recebem orientações de aprovação de escrita; Agent enfatiza convenções do projeto, preservação do trabalho do usuário e verificação. Checklist só é incluído no contexto quando existe e o modo o utiliza. As definições detalhadas das ferramentas continuam no catálogo. Veja os [exemplos completos](docs/system-prompts.md).

Validação: 166 testes automatizados passaram. A redução das instruções comportamentais foi de aproximadamente 34% em Ask/Plan e 25% em Agent, em caracteres, para modo supervisionado com tools nativas e checklist vazio. Testes simulados verificam os contratos e fluxos, não a aderência de modelos reais.

## Versão 0.9.0

- Ferramentas e parâmetros usam nomes explícitos em `snake_case`, com descrições e validação compartilhadas entre protocolos nativo e compatibilidade. Consulte o [catálogo completo](docs/tool-reference.md).
- Listagem e busca aceitam múltiplos padrões e exclusões; diagnósticos aceitam múltiplos caminhos e paginação.
- Contexto do editor distingue documentos abertos de arquivos do workspace. Checklists têm IDs únicos e no máximo uma etapa em andamento.
- Resultados extensos aceitam tamanho de página configurado pela ferramenta; comandos informam execução no host ou sandbox.

Os nomes anteriores não são aliases. Inicie uma nova conversa após atualizar, pois chamadas antigas e estados antigos de checklist não são convertidos. Conexões e credenciais são preservadas.

## Versão 0.8.1

O contexto do editor agora informa explicitamente que cobre somente documentos abertos, sem representar o diretório inteiro ou o conteúdo dos arquivos. Os prompts de Ask, Plan e Agent orientam a usar listagem e leitura para descrever um projeto. A listagem informa escopo, padrão, exclusões e paginação.

Validação: 162 testes automatizados passaram, incluindo um workspace com três arquivos e apenas package.json aberto. Provedores simulados; isso não comprova a aderência de todos os modelos reais às instruções.

## Versão 0.8.0

- O chat, o teste de ferramentas e as avaliações usam o mesmo motor, com validação, recuperação e limites consistentes.
- **Modelos → Test tools** verifica leitura fictícia → resultado → resposta final. Exibe capacidades observadas e o protocolo efetivo. Não acessa o workspace nem substitui o último fluxo de diagnóstico.
- **Maximum response tokens** define a saída por conexão/modelo; vazio mantém Automático (até 4.096). O limite é reservado no contexto e vale a partir da próxima execução.
- Comandos exibem saída ao vivo. Timeouts e operações interrompidas preservam resultado incerto, sem repetição automática. A continuação exige revisão explícita.
- Resultados extensos ficam disponíveis entre mensagens e reinicializações, até 64 MiB por sessão. Resultados expirados são identificados como parciais.
- A compactação também cobre turnos longos, preservando pedido atual e o último grupo de chamadas/resultados. Sessões têm revisão e bloqueio entre janelas.
- **Diagnósticos → Local storage** mostra uso de disco e retenção: manual por padrão; 30, 90 ou 180 dias opcionais. Somente sessões concluídas e inativas são elegíveis. Excluir uma sessão também remove resultados e histórico de desfazer; arquivos do workspace são preservados.
- Webviews em TypeScript, com contratos de mensagens validados. O CI inclui UI, Extension Host e Docker obrigatório em Linux; releases dependem desses jobs.

O formato do `last-flow.json` permanece compatível. As preferências e sessões antigas migram sem alterar IDs ou credenciais. Consulte [a validação da versão](docs/validation-0.8.0.md).

## Versão 0.7.3

Os argumentos booleanos das ferramentas aceitam `true`/`false`, `1`/`0`, `"true"`/`"false"`, `"1"`/`"0"` e `"on"`/`"off"`, sem distinguir maiúsculas e ignorando espaços externos. A conversão ocorre apenas nos campos declarados como booleanos, antes da validação de argumentos e permissões. Textos de arquivos, comandos e consultas permanecem intactos.

Isso corrige `editor.selection: "false"`, que passa a executar como `false` sem uma rodada extra de recuperação. A chamada original continua no rastreio. Valores ambíguos são rejeitados; a descrição do editor explica que `selection` é uma opção, não o texto selecionado.

Ver [validação da 0.7.3](docs/validation-0.7.3.md).

## Versão 0.7.2

- Respostas rejeitadas recebem retorno específico por campo. Chamadas nativas mantêm os IDs originais e recebem um resultado de erro antes da próxima rodada; nenhum item de um lote rejeitado é executado.
- O limite de três respostas inválidas é independente de falhas durante a execução das ferramentas. O chat mostra o motivo da rejeição e acesso às configurações do modelo e ao diagnóstico.
- `editor` é uma ferramenta de leitura dos arquivos abertos/seleção e está disponível em Ask. As ferramentas de escrita continuam restritas ao Agent.
- O fluxo JSON usa `stop_reason: tool_use` para chamadas interpretadas, mesmo quando o provedor retorna `stop`. O valor original fica em `provider_stop_reason` quando diferente; ações textuais originais ficam em `provider_content`, e rejeições incluem `validation_error`. Os campos principais do envelope permanecem iguais.
- A versão instalada aparece no cabeçalho das configurações desde a 0.7.1.

Ver [validação da 0.7.2](docs/validation-0.7.2.md).

## Versão 0.7.0

- Input com 12 px internos, margem externa de 16 px, controles espaçados e layout em duas linhas na sidebar estreita.
- Uma linha de progresso com fase, arquivo/ferramenta e tempo decorrido; respostas parciais permanecem identificadas se a conexão falhar.
- Configurações separadas em Provedores, Modelos, Conversa, Execução e Diagnóstico. Preferências exigem Salvar por seção. Rascunhos sobrevivem à navegação entre seções e são descartados ao fechar a aba.
- Dois tempos de espera: primeira resposta e inatividade durante streaming, ambos com padrão de 120 s. Cada conexão pode substituir os padrões globais. O limite total da tarefa inclui a espera por aprovação.
- Rodadas de trabalho e chamadas de ferramentas têm limites independentes. Os valores antigos são migrados para os dois novos campos correspondentes.
- Teste de chat explícito em Modelos, separado do catálogo, sem ferramentas ou contexto do workspace. Não substitui o fluxo JSON da tarefa e não comprova suporte a ferramentas.
- Diagnóstico permite abrir, exportar e limpar o último fluxo. A gravação é serializada em segundo plano e preserva o formato solicitado.
- Tentar novamente retoma o histórico da execução após uma falha de transporte, sem duplicar a pergunta ou reproduzir chamadas já concluídas. Resposta parcial ou ferramenta de resultado incerto exige revisão/continuação explícita.
- Contexto estimado pelo payload efetivo, com margem de 20% e calibração por conexão/modelo quando a API informa uso. O medidor continua distinguindo estimativa e valor reportado.

Ver [validação da 0.7.0](docs/validation-0.7.0.md).

## Versão 0.4.3

O transporte OpenAI-compatible usa HTTP/HTTPS do Node, com TLS insecure aplicado por requisição. URLs base sem `/v1` são suportadas: o catálogo usa `<base>/models` e o chat `<base>/chat/completions`. Redirecionamentos são informados sem encaminhar chaves; falhas conhecidas de DNS, rede e certificado têm diagnóstico específico. A comparação e os testes estão em [docs/forge-connection-review.md](docs/forge-connection-review.md).

### Modelos e ferramentas

OpenAI, Anthropic, Gemini, Ollama e endpoints OpenAI-compatible. Múltiplas conexões, catálogo, modelos manuais, favoritos e padrão por modo. HTTP remoto é permitido; TLS insecure é opcional e restrito a uma conexão compatible. Chaves permanecem no SecretStorage.

Em **Settings → Models**, cada modelo oferece **Auto**, **Native tools** ou **Compatibility**. Auto usa capacidades reportadas e tenta tools nativas quando a API não informa essa capacidade, inclusive em Ollama e OpenAI-compatible. Uma rejeição explícita de suporte pode ativar Compatibility; autenticação e falhas de rede não alteram o protocolo. O tooltip informa o protocolo efetivo.

Tools nativas têm streaming, IDs de chamadas/resultados e validação antes de execução. A alternativa textual continua exigindo JSON completo e validado. Streams interrompidos e argumentos parciais não executam ferramentas. A qualidade das decisões continua dependendo do modelo escolhido.

O chat mostra um indicador visível durante a execução: preparação, espera pelo modelo, recebimento da resposta, leitura/pesquisa de arquivos, execução de ferramentas e espera por aprovação. O estado atual é restaurado ao reabrir a sidebar e o indicador desaparece ao concluir, falhar ou interromper.

As atividades concluídas ficam agrupadas em um resumo recolhível, com nomes legíveis, ícones, arquivo envolvido e duração quando registrada. Detalhes técnicos só aparecem ao expandir a atividade; sessões antigas continuam compatíveis.

### Ciclo estruturado (0.6.0)

As definições das ferramentas ficam separadas do system prompt. Cada resposta é normalizada como chamada de ferramentas ou resposta final; o executor valida o lote, aplica as permissões e devolve os resultados vinculados aos IDs das chamadas. O histórico acumulado segue para a próxima rodada. Compatibility adapta o protocolo textual a esse mesmo ciclo.

Ao esgotar etapas, uma rodada sem ferramentas pode resumir o progresso observado, respeitando tempo e orçamento restantes; a tarefa permanece pausada. Detalhes e validação: [docs/validation-0.6.0.md](docs/validation-0.6.0.md).

### Modos e permissões

| Modo | Comportamento |
| --- | --- |
| Ask | Responde e consulta arquivos/diagnósticos; não altera arquivos nem executa shell. |
| Plan | Investiga e prepara checklist; não implementa. |
| Agent | Implementa e valida dentro da política selecionada. |

**Supervised** solicita aprovação para alterações e comandos. **Autonomous** aplica alterações solicitadas e usa container local para comandos quando disponível. Sem Docker, o terminal exige aprovação no computador. Acesso à rede no container exige aprovação específica; não há repetição automática de comandos que falharam.

O executor impõe o modo independentemente do prompt. Saudações não iniciam ferramentas ou planos. Os prompts de cada modo ficam separados; permissões não autorizam trabalho não solicitado.

### Revisão, desfazer e continuidade

- Alterações supervisionadas abrem um diff no editor antes da aprovação. **Select hunks** aplica somente os trechos selecionados e encerra o turno quando há rejeição parcial.
- **Review changes** mostra o registro da tarefa. **Undo task changes** restaura apenas versões ainda correspondentes às alterações do agente; conflitos e buffers não salvos são preservados.
- O registro é salvo antes da aplicação. Comandos executados diretamente no computador não têm garantia de reversão.
- **Implement plan** pede a permissão e inicia explicitamente Agent. **Continue** usa o progresso salvo; ferramentas de resultado incerto exigem revisão e nova instrução antes da retomada.
- Limites em **Settings → Execution**: 20 rodadas de trabalho, 20 chamadas de ferramentas, 60 s por comando, 30 min por tarefa e orçamento de tokens opcional. São configuráveis. Orçamento de tokens não representa um limite financeiro exato.

### Contexto e histórico

- Digite `@` ou use o botão de contexto para anexar arquivo, seleção, pasta ou diagnósticos. Buffers não salvos são snapshots, sem gravação. Limite inicial: 50 itens / 64 KB; omissões de pasta são informadas.
- `AGENTS.md` e `.vortex/rules/*.md` são carregados no workspace confiável. Regras não ampliam permissões. As regras carregadas aparecem nas atividades.
- Conversas longas podem ser resumidas para preservar espaço; o histórico completo continua salvo. Se o resumo não couber, a execução para com erro explícito.
- O medidor distingue estimativa de tokens e uso reportado pela API. O orçamento exibido acompanha a configuração do modelo.
- Sessões são armazenadas no perfil local, com migração do armazenamento antigo por workspace. Busca inclui título, conteúdo, caminho do projeto e data ISO; resultados são paginados. Uma sessão de outro projeto só executa ao abrir sua pasta original.

### Container opcional

Instale e inicie um runtime Docker local. Em **Settings → Execution → Download sandbox image**, prepare a imagem. O padrão é `node:22-bookworm-slim`; pode ser substituído em `vortex.sandbox.image`. Cada execução resolve o ID imutável da imagem local e não baixa imagens silenciosamente.

O comando recebe uma cópia textual do projeto, sem montar o workspace original para escrita. Rede desativada, usuário sem privilégios, capacidades removidas, raiz somente leitura e limites de CPU, memória e processos. Credenciais conhecidas, `.git`, links simbólicos e diretórios de dependências/saída são excluídos da cópia. Dependências precisam ser preparadas no container, com autorização de rede quando necessário.

Alterações textuais retornam pelo mecanismo de diffs; arquivos binários ou grandes elegíveis ficam no armazenamento de artefatos, com caminho informado nas atividades. O snapshot tem limite de 50 MB e 10.000 arquivos textuais. Containers abandonados têm registros de recuperação; recursos de processos ainda ativos não são removidos.

**Limite de validação:** Docker não está instalado no Mac usado nesta entrega. O teste real de isolamento foi registrado como **SKIP**, não como aprovação. O backend Windows fica desativado; comandos continuam supervisionados. Linux/macOS precisam de validação com o runtime instalado antes de anunciar isolamento comprovado nessas plataformas.

### Diagnóstico e testes

**Vortex: Show diagnostic log** registra IDs, ferramentas, estados e duração, sem conteúdo de prompts/arquivos ou chaves. **Vortex: Preview diagnostic export** abre uma prévia que o usuário pode salvar.

```sh
make typecheck
make test
make test-ui
make test-host
make test-tls
make test-sandbox
make benchmark
make package
```

`make test-real` usa `VORTEX_EVAL_URL`, `VORTEX_EVAL_MODEL` e, opcionalmente, `VORTEX_EVAL_KIND`, `VORTEX_EVAL_KEY`, `VORTEX_EVAL_PROTOCOL` e `VORTEX_EVAL_TLS_INSECURE`. Por padrão são cinco repetições de oito cenários, com até 12 rodadas por turno e 20 chamadas de ferramentas; dois cenários têm dois turnos. É uma execução manual e pode consumir créditos. A aprovação exige pelo menos 4/5 em cada cenário e nenhuma violação de segurança. `VORTEX_EVAL_REPETITIONS` altera a amostra (1–20). Modelos são reais; ferramentas operam sobre fixtures em memória, sem shell nem arquivos do usuário. A correção aritmética é verificada pelo comportamento. O Extension Host cobre o executor real com provedor simulado.

CI verifica compilação, contratos e pacote, com cobertura básica Windows e testes completos de unidade em macOS/Linux. Tags `v*` geram release com VSIX. Não há publicação automática no Marketplace.

Referências: [OpenAI tools](https://developers.openai.com/api/docs/guides/function-calling), [Ollama tools](https://docs.ollama.com/capabilities/tool-calling), [Claude streaming](https://platform.claude.com/docs/en/build-with-claude/streaming), [Docker runtime](https://docs.docker.com/engine/containers/run/).

As versões anteriores e suas limitações históricas estão em [docs/history.md](docs/history.md). Licenças de dependências e ícones: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

### Ferramentas e confiabilidade (0.5.0)

Os modos compartilham contratos validados, mantendo Ask e Plan sem escrita. O agente agora pode consultar editor/seleção, buscar com paginação e regex, consultar símbolos e diagnósticos, fazer várias substituições atômicas em um arquivo e pausar para uma resposta do usuário. Leituras respeitam buffers não salvos; versões detectam alterações concorrentes. Resultados extensos têm páginas recuperáveis durante a execução.

Skills de projeto opcionais ficam em `.vortex/skills/<nome>/SKILL.md` e são carregadas sob demanda. Não alteram permissões. Os botões de continuidade, revisão e desfazer aparecem conforme o estado da tarefa.

Consulte [validação e limites da versão](docs/validation-0.5.0.md) e a [comparação técnica das referências](docs/agent-comparison.md).

### Timeout do modelo (0.5.2)

Em **Configurações → Conversa → Limites de execução**, configure **Tempo de resposta do modelo (segundos)**: padrão 120, mínimo 1 e máximo 3.600. O valor é aplicado a partir da próxima tarefa, a cada tentativa de resposta do modelo, incluindo streaming e resumos de contexto. O limite total da tarefa pode interromper a execução antes desse prazo. O timeout de comandos e as consultas de catálogo continuam independentes. Stop permanece disponível.

### Último fluxo da IA (0.6.1)

Cada mensagem inicia um novo `last-flow.json` no armazenamento local do workspace do Vortex, substituindo o anterior. Abra pela paleta: **Vortex: Open last AI flow (JSON)**. Para guardar uma execução antes da próxima mensagem, use Salvar como.

O formato segue o exemplo de rastreamento: `conversation_id`, `model`, `temperature`, `max_tokens`, `system_prompt`, `user_question`, `turns` (request/response), `final_answer` e `sources`. Cada rodada contém o histórico enviado, definições de ferramentas e resposta recebida, normalizados entre provedores. Streaming é registrado como resposta acumulada, sem eventos individuais. Parâmetros não enviados ficam `null`; falhas ficam na resposta da rodada. Retentativas HTTP internas pertencem à mesma rodada.

O arquivo recebe snapshots em segundo plano antes e depois das chamadas, inclusive nos resumos; a finalização aguarda a última gravação. Não inclui headers de autenticação e remove a chave configurada. Pode conter código, prompts e dados retornados pelas ferramentas; revise antes de compartilhar. Não é enviado automaticamente nem incluído no repositório. Falha de gravação é informada sem interromper o agente.
