# Execução controlada — contrato 2

Investigar → propor → autorizar escopo → executar etapa → verificar → avançar.

Veja [estabilização 0.11.0](stabilization-0.11.0.md) para contrato, permissões, limites e reprodução dos testes. Resultados da implementação anterior permanecem no [histórico de validação 0.10.0](validation-0.10.0.md); eles não certificam esta versão.

## Componentes

- `planContract`: proposta sem IDs gerados pelo modelo; normalização estrutural e relatório vinculado pelo host.
- `modelRequest`: comunicação com o provedor e identidade capturada por requisição; validação antes/depois da resposta.
- `plan`: definição e transições de etapas, correções, critérios, revisão e histórico.
- `planAuthorization`: concessões exatas por sessão, workspace, versão e etapa; ampliações persistidas.
- `planVerification`: executa os critérios aprovados e associa evidências independentemente das alegações do modelo.
- `AgentRuntime`: coordena esses componentes com o executor, limites globais, persistência e eventos para a sidebar.

## Invariantes

Ask e Plan não recebem ferramentas de escrita/terminal. Agent direto mantém suas permissões individuais. Agent em plano usa a autorização apresentada ao usuário; arquivos/operações adicionais e comandos diferentes exigem ampliação explícita.

A verificação não exige que a IA copie identificadores internos. O host captura sessão, execução, versão, etapa e tentativa antes de solicitar a resposta. A resposta só pode produzir efeitos enquanto essa identidade ainda é atual e o sinal de cancelamento não foi acionado.

Uma resposta com transição de plano e outras ferramentas é rejeitada integralmente. Texto final comum não conclui etapa. O modelo deve reportar resultado, e o host verifica. Falha conhecida de comando permite duas correções; operação incerta, Stop, recusa ou falha de persistência pausa sem repetição automática.

## Snapshots e limites

A impressão digital usa SHA-256 dos caminhos e conteúdos elegíveis. Limites: 10.000 arquivos, 2 MiB por arquivo, 50 MiB total. Dependências, saídas de build, `.git`, `.vortex`, `.codex`, `.agents`, arquivos de ambiente e certificados ficam excluídos. Links simbólicos e buffers não salvos impedem comprovação automática.

Isso comprova correspondência do conjunto elegível, não de serviços externos ou dependências ignoradas. No sandbox, a impressão do conjunto testado deve corresponder à do workspace após a importação; caso contrário, o resultado exige revisão. Código de saída zero comprova apenas a execução do comando aprovado.

## Persistência

Sessões versão 7 armazenam o contrato 2, autorização e suas revisões, etapas/tentativas, correções, evidências e decisões. A gravação antecede operações e avanço. Retomadas são explícitas; estados ativos órfãos abrem pausados. Aprovações antigas não ganham permissões retroativas.

Revisões preservam conclusões somente com definição/dependências iguais e fingerprint ainda atual. O histórico anterior e os arquivos são preservados.

O rastreamento mantém o envelope JSON anterior e adiciona `request_bindings`, `turns[].binding`, autorização em `plan` e transições. Mensagens de orquestração são identificadas por `origin: vortex_orchestrator`.
