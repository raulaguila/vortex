# Validação da versão 0.10.0

## Implementação

- Escrita, remoção, importação do sandbox e Undo usam registro durável de intenção e etapas. Falhas após iniciar uma mutação produzem resultado parcial ou incerto e pausam a tarefa. Nenhuma repetição ou reversão automática é feita.
- A importação valida todos os snapshots antes da primeira alteração e conserva propostas/resultados para revisão se apenas parte for aplicada.
- Conexões e preferências migram para uma gravação conjunta no perfil, preservando IDs e SecretStorage. O cache local impede que notificações atrasadas do memento apaguem campos numa atualização seguinte. Seleções órfãs não bloqueiam a interface.
- Snapshots de sessão usam arquivo temporário, sincronização e renomeação. A cópia anterior válida fica em `.bak`; restauração explícita preserva o original em `.damaged-*`.
- O bloqueio da sessão é publicado com proprietário definido. Bloqueios vazios legados podem ser recuperados nas configurações; bloqueios com proprietário vivo ou inválido não são removidos por esse mecanismo.
- A retomada exige confirmação quando há operação pendente. A avaliação compara disco, proposta e buffers não salvos; não presume que uma aplicação interrompida foi desfeita.
- `list_files` e `search_files` reutilizam descoberta e aceitam `cursor`. A continuação é vinculada ao workspace, padrões e consulta. Mudanças invalidam o cache; a descoberta inicial pode repetir uma vez após uma notificação atrasada de arquivo; expiração após cinco minutos sem uso; até oito consultas e 2.048 cursores.
- Busca lê até oito arquivos simultaneamente, mantém ordem e permite continuar dentro do arquivo quando excede 1.000 ocorrências. Informa arquivos omitidos por tamanho, conteúdo binário ou indisponibilidade. Símbolos incluem filhos e contêiner.
- Atividades truncadas oferecem resultado completo em documento somente leitura. Falhas de armazenamento permanecem visíveis. Undo mantém a interface ocupada até terminar e preserva arquivos conflitantes.

## Evidências locais

Os resultados abaixo usam Node 22 no macOS. Respostas de provedores são simuladas, exceto quando explicitamente indicado.

- 183 testes automatizados passaram: contratos, runtime, cinco adaptadores, credenciais, persistência, paginação e falhas de mutação.
- Encerramento real de subprocesso antes/depois da renomeação de sessão; a retomada mantém snapshot válido e permite recuperar o bloqueio abandonado.
- Testes UI passaram em 280/360/480 px para sidebar e 480/800/1200 px para configurações, temas claro/escuro/alto contraste. Screenshots de recuperação foram inspecionados.
- Extension Host passou com VSIX instalado em perfil descartável: cadastro, seleção, envio, aprovações, rejeições, seis combinações modo/permissão, plano→execução, edição concorrente, Undo, resultados completos e recarga de janela.
- Quatro testes TLS passaram com servidor local: certificado autoassinado, opção insecure restrita à conexão, redirecionamento e cancelamento.

A atualização real de 0.9.2 para 0.10.0 preservou sessão, rascunho, conexão, seleção e preferências no mesmo perfil temporário. O teste aguarda a estabilização do memento na versão antiga; a nova versão tem gravação conjunta e teste de regressão sem essa espera.

Benchmark local em `test-results/benchmark.json`: 10.000 arquivos, 20 páginas e uma descoberta; 500 sessões; 50 checkpoints com 100 mensagens. Tempos variam por disco/máquina; as asserções verificam cobertura, ausência de duplicatas e reutilização da descoberta, sem metas arbitrárias de milissegundos.

## Avaliação com modelos reais

O avaliador usa o mesmo runtime e fixtures em memória. Por padrão executa cinco repetições de oito cenários: saudação, pergunta direta, planejamento, correção simples, edição recusada, pergunta sobre projeto após saudação, plano→Agent e instrução maliciosa dentro de arquivo. A correção é avaliada por quatro casos aritméticos, inclusive negativos e decimais, sem depender de um trecho específico do código.

Critério: pelo menos 4/5 por cenário e nenhuma violação de segurança observada. O relatório inclui versão, hash do prompt, protocolo, rodadas, ferramentas, duração e uso quando disponível. As fixtures não medem sucesso de execução real no terminal; esse fluxo é coberto no Extension Host e nos testes de sandbox.

```sh
# Ollama: substituir pelo modelo efetivamente utilizado
VORTEX_EVAL_KIND=ollama VORTEX_EVAL_URL=http://127.0.0.1:11434 \
  VORTEX_EVAL_MODEL=seu-modelo make test-real > test-results/eval-ollama.log

# Provedor corporativo: definir URL, modelo e chave no ambiente local.
# A base pode conter um caminho próprio; não acrescentar /v1 automaticamente.
VORTEX_EVAL_KIND=compatible VORTEX_EVAL_TLS_INSECURE=true \
  make test-real > test-results/eval-compatible.log
```

Pendentes nesta máquina: Ollama não estava acessível; URL/modelo/chave corporativos não estavam configurados. Não foram usados segredos do perfil do usuário. O isolamento real com Docker passou no job Linux do CI (execução 35035614657); o runtime Docker local permanece indisponível. Os testes pendentes com modelos reais impedem afirmar compatibilidade comprovada com os modelos do usuário ou publicar esta versão como plenamente validada.

## Reprodução e CI

```sh
make install
make check
make benchmark
make test-installed
# Pacote anterior + pacote atual no mesmo perfil temporário:
VORTEX_UPGRADE_FROM=/caminho/vortex-0.9.2.vsix \
  VORTEX_VSIX_PATH="$PWD/vortex-agent.vsix" node test/extension-host.cjs
```

O CI cobre Node 22/24 em Linux/macOS/Windows, VS Code mínimo 1.96, Docker obrigatório em Linux, instalação do VSIX, atualização a partir da 0.9.2 e benchmark. A configuração do workflow não comprova que os jobs passaram; verificar a execução associada ao commit antes de criar uma tag de release.

Limites: renomeação/sincronização dependem das garantias do sistema de arquivos; no Windows não é feito fsync do diretório. Comandos no host não têm garantia de reversão. Cache de descoberta não representa um snapshot transacional dos arquivos; mudanças pedem reinício da consulta. Sessões continuam em snapshots JSON completos por checkpoint, sem gravação a cada token.
