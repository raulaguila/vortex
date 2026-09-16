# Validação — Vortex 0.11.0

## Estado de entrega

Implementação do contrato 2 disponível. A aprovação para uso sem monitoramento depende da matriz real abaixo e da validação real de Docker. Testes simulados não substituem esses critérios.

## Validação determinística e do pacote

- Compilação TypeScript e empacotamento VSIX concluídos.
- 286 testes determinísticos passaram, sem falhas ou testes ignorados nessa suíte.
- O VSIX instalado passou no Extension Host com provedor simulado e operações reais em workspace descartável: aprovação única, comandos automáticos de verificação, revisão humana, recusa, Stop, recarga, alterações concorrentes, perguntas ao usuário e os seis pares de modo/permissão.
- Interface verificada em 280, 360 e 480 px, em inglês e português, com temas claro, escuro e alto contraste. As últimas alterações posteriores a essa verificação não alteraram os arquivos da interface.
- Testes adicionais de HTTP/TLS: quatro passaram. O teste de Docker foi ignorado por ausência do executável; permanece **pendente obrigatório**.
- A integridade do VSIX e a correspondência de seus bundles com os arquivos compilados foram conferidas.

## Matriz real

Protocolo: ferramentas nativas via Ollama. Modelos: `gemma4:26b` e `qwen3.8:27b`. Cinco repetições de seis cenários, com variantes de código, VSIX instalado e perfis descartáveis. A compatibilidade textual e os outros adaptadores foram cobertos por testes determinísticos, não por chamadas reais a esses provedores.

Execução: `test-results/stability-2026-09-16T06-06-56-651Z/report.json`.

**Em andamento: Gemma concluído; Qwen em execução.** Pausas seguras em cenários de sucesso contam como falha de conclusão.

| Cenário | Gemma `gemma4:26b` | Qwen `qwen3.8:27b` |
| --- | --- | --- |
| Saudação | 5/5 | Pendente |
| Projeto após saudação | 5/5 | Pendente |
| Diagnóstico em Ask | 5/5 | Pendente |
| Proposta em Plan | 4/5 | Pendente |
| Correção simples em Agent | 1/5 | Pendente |
| Plano completo | 3/5 | Pendente |

Gemma: 23/30 cenários aprovados. As sete falhas foram quatro propostas desnecessárias no cenário de correção direta, duas propostas que continuaram inválidas após três respostas e uma proposta com uma etapa de confirmação do defeito que exigia teste aprovado antes da correção. Nesse último caso, duas rodadas de correção não resolveram o teste e o controlador pausou sem concluir a etapa.

O driver mantém comandos e permissões fixos durante cada rodada. A validação funcional roda fora dos arquivos que o modelo pode editar. Cada cenário retém relatório, captura e o fluxo JSON do modelo; recusas de escopo também são registradas como falha, sem ampliar a autorização para obter aprovação.

## Rodadas anteriores preservadas

As rodadas de desenvolvimento em `test-results/stability-2026-09-16T05-37-55-592Z`, `05-44-55-520Z` e `05-49-41-731Z` foram substituídas após alterações de implementação ou do avaliador. Seus arquivos não foram descartados nem misturados com os resultados finais.

Na terceira rodada de desenvolvimento, o avaliador externo rejeitou incorretamente uma correção válida que usava `export { sum }`. O avaliador passou a carregar módulos ESM em um worker limitado, com testes próprios cobrindo as cinco variantes, código incorreto, importações e loops. Essa falha é do avaliador, não do modelo ou da extensão.

Também foram observadas propostas inválidas, planejamento desnecessário em uma correção localizada e comandos de edição fora da lista autorizada pelo driver. Esses resultados foram preservados. Não se deve interpretar ausência de execução indevida como sucesso funcional.

## Limites

Mesmo uma matriz aprovada limita a confiança aos modelos, protocolos e cenários observados. Não constitui garantia para qualquer projeto. Comandos aprovados no computador podem produzir efeitos além da lista de arquivos; somente a execução isolada testada pode sustentar alegações sobre isolamento.
