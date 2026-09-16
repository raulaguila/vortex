# Estabilização — Vortex 0.11.0

## Contrato 2

A proposta do modelo contém objetivo, etapas com título/objetivo, dependências opcionais por número (1-based), operações em arquivos literais, comandos e critérios. A extensão atribui IDs. Campos semânticos não são preenchidos automaticamente; somente listas opcionais, diretório `.` e rede desabilitada recebem padrões.

`report_step_result` recebe `outcome`, `summary` e, opcionalmente, `remaining_issues` e evidências observadas. A IA não informa identificadores de execução, etapa, versão ou tentativa. O backend captura esses dados antes da requisição e recusa respostas obsoletas antes de executar ferramentas. Propostas e relatórios devem ser chamadas isoladas.

## Autorização

O plano mostra arquivos/operações e comandos exatos com diretório, local e rede. A aprovação autoriza esse escopo por etapa, inclusive em Supervisionado. Fora do plano continuam valendo as permissões individuais existentes.

Uma ação adicional usa a interação da sidebar, registra ampliação na autorização e só então executa. Comandos com outra grafia, diretório, rede ou local são diferentes autorizações. Arquivos não aceitam curingas. Um comando no computador pode ter efeitos além dos arquivos listados; essa autorização não equivale a isolamento do shell.

O sandbox aprovado nunca é substituído automaticamente por execução no computador. Sem Docker, uma proposta pode apresentar execução no computador, explicitamente, antes de ser aprovada.

## Verificação e recuperação

Ao receber `completed`, o controlador executa os comandos dos critérios, registra resultados e confere o snapshot. A declaração do modelo não conclui a etapa. Critérios humanos continuam com revisão explícita e evidências de trabalho observado.

Falhas conhecidas de testes permitem duas rodadas de correção, com releitura dos arquivos e sem reiniciar os limites globais. Saída vazia/formato inválido têm até três respostas. Stop, timeout de comando, falha de persistência e operação incerta não acionam repetição automática.

A retomada é explícita. Autorizações, operações e correções são persistidas; outra janela não pode assumir uma sessão ativa. Sessões anteriores mantêm seu histórico, mas precisam de proposta revisada e nova autorização para executar no contrato 2.

## Reprodução

```sh
make install
make check
make test-sandbox
make test-installed
VORTEX_EVAL_URL=http://seu-ollama:11434 make test-stability
```

A matriz usa o VSIX instalado em perfis descartáveis, cinco variantes da fixture, seis cenários e cinco repetições para cada modelo: `gemma4:26b` e `qwen3.8:27b`. Os comandos permitidos pelo driver são fixos. O relatório guarda hashes do pacote e do driver e todas as tentativas; uma pausa segura em cenário de sucesso não passa.

Os relatórios ficam em `test-results/stability-<timestamp>/report.json`, com detalhes e capturas em `test-results/ollama-host/`. Testes unitários e do Extension Host simulado não comprovam a confiabilidade de um modelo real. Docker obrigatório indisponível continua pendente, mesmo que o teste local apareça como skipped.
