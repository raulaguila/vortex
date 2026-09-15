# Vortex

Extensão de código BYOK para VS Code. Interface em inglês ou português, seguindo o tema do editor, com margem lateral de 16 px.

## Desenvolvimento e instalação

Node.js 22 e VS Code 1.96+.

```sh
make install
make test
make package
```

Instale `vortex-agent.vsix` por **Extensions → Install from VSIX**, ou execute `make install-vsix`. Para desenvolvimento, pressione F5 ou use `make watch`, que recompila o bundle e verifica TypeScript.

Os comandos de build do Makefile sincronizam as dependências com `npm ci` na primeira execução e quando `package.json` ou `package-lock.json` mudam. Isso evita usar dependências antigas após `git pull`. Se `node_modules` tiver sido alterado manualmente, execute `make install` para restaurar as versões do lockfile. Ao usar npm diretamente, execute `npm ci` antes de `npm run package`.

## Versão 0.4.3

O transporte OpenAI-compatible usa HTTP/HTTPS do Node, com TLS insecure aplicado por requisição. URLs base sem `/v1` são suportadas: o catálogo usa `<base>/models` e o chat `<base>/chat/completions`. Redirecionamentos são informados sem encaminhar chaves; falhas conhecidas de DNS, rede e certificado têm diagnóstico específico. A comparação e os testes estão em [docs/forge-connection-review.md](docs/forge-connection-review.md).

### Modelos e ferramentas

OpenAI, Anthropic, Gemini, Ollama e endpoints OpenAI-compatible. Múltiplas conexões, catálogo, modelos manuais, favoritos e padrão por modo. HTTP remoto é permitido; TLS insecure é opcional e restrito a uma conexão compatible. Chaves permanecem no SecretStorage.

Em **Settings → Models**, cada modelo oferece **Auto**, **Native tools** ou **Compatibility**. Auto usa capacidades reportadas; para Ollama/compatible sem metadados de tools, conserva o protocolo textual. OpenAI, Anthropic e Gemini tentam tools nativas. Uma rejeição explícita de suporte pode ativar Compatibility; autenticação e falhas de rede não alteram o protocolo. O tooltip informa o protocolo efetivo.

Tools nativas têm streaming, IDs de chamadas/resultados e validação antes de execução. A alternativa textual continua exigindo JSON completo e validado. Streams interrompidos e argumentos parciais não executam ferramentas. A qualidade das decisões continua dependendo do modelo escolhido.

O chat mostra um indicador visível durante a execução: preparação, espera pelo modelo, recebimento da resposta, leitura/pesquisa de arquivos, execução de ferramentas e espera por aprovação. O estado atual é restaurado ao reabrir a sidebar e o indicador desaparece ao concluir, falhar ou interromper.

As atividades concluídas ficam agrupadas em um resumo recolhível, com nomes legíveis, ícones, arquivo envolvido e duração quando registrada. Detalhes técnicos só aparecem ao expandir a atividade; sessões antigas continuam compatíveis.

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
- Limites em **Settings → Conversation**: 20 etapas, 60 s por comando, 30 min por tarefa e orçamento de tokens opcional. São configuráveis. Orçamento de tokens não representa um limite financeiro exato.

### Contexto e histórico

- Digite `@` ou use o botão de contexto para anexar arquivo, seleção, pasta ou diagnósticos. Buffers não salvos são snapshots, sem gravação. Limite inicial: 50 itens / 64 KB; omissões de pasta são informadas.
- `AGENTS.md` e `.vortex/rules/*.md` são carregados no workspace confiável. Regras não ampliam permissões. As regras carregadas aparecem nas atividades.
- Conversas longas podem ser resumidas para preservar espaço; o histórico completo continua salvo. Se o resumo não couber, a execução para com erro explícito.
- O medidor distingue estimativa de tokens e uso reportado pela API. O orçamento exibido acompanha a configuração do modelo.
- Sessões são armazenadas no perfil local, com migração do armazenamento antigo por workspace. Busca inclui título, conteúdo, caminho do projeto e data ISO; resultados são paginados. Uma sessão de outro projeto só executa ao abrir sua pasta original.

### Container opcional

Instale e inicie um runtime Docker local. Em **Settings → Conversation → Download sandbox image**, prepare a imagem. O padrão é `node:22-bookworm-slim`; pode ser substituído em `vortex.sandbox.image`. Cada execução resolve o ID imutável da imagem local e não baixa imagens silenciosamente.

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
make package
```

`make test-real` usa `VORTEX_EVAL_URL`, `VORTEX_EVAL_MODEL` e, opcionalmente, `VORTEX_EVAL_KIND` / `VORTEX_EVAL_KEY`. É uma execução manual, limitada a 24 requisições, que pode consumir créditos. Modelos são reais; ferramentas desse avaliador operam sobre fixtures em memória, sem shell nem arquivos do usuário. O teste do Extension Host cobre o executor real com provedor simulado.

CI verifica compilação, contratos e pacote, com cobertura básica Windows e testes completos de unidade em macOS/Linux. Tags `v*` geram release com VSIX. Não há publicação automática no Marketplace.

Referências: [OpenAI tools](https://developers.openai.com/api/docs/guides/function-calling), [Ollama tools](https://docs.ollama.com/capabilities/tool-calling), [Claude streaming](https://platform.claude.com/docs/en/build-with-claude/streaming), [Docker runtime](https://docs.docker.com/engine/containers/run/).

As versões anteriores e suas limitações históricas estão em [docs/history.md](docs/history.md). Licenças de dependências e ícones: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
