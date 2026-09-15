# Validação da versão 0.8.0

## Entrega

- O runtime do agente é compartilhado pela extensão, avaliações e diagnóstico isolado de ferramentas.
- Timeouts, cancelamento e saída parcial mantêm sua classificação. Operações de resultado incerto pausam a tarefa; continuar exige revisão explícita. Alterações de comandos isolados interrompidos são propostas para revisão, sem importação automática.
- A saída dos comandos aparece durante a execução. Atividades distinguem recuperação, falha, interrupção e resultado incerto.
- Resultados paginados persistem entre execuções, com limite de 64 MiB por sessão e expiração explícita. A compactação também cobre turnos longos.
- Revisões e bloqueios por sessão impedem gravações simultâneas e identificam execuções abandonadas.
- A exclusão limpa os resultados, histórico de alterações e fluxo associado. Retenção automática é opcional (30, 90 ou 180 dias); o padrão é limpeza manual. Tarefas ativas ou com resultado incerto não são elegíveis.
- Limite de resposta por modelo, diagnóstico de ferramentas e armazenamento local ficam nas configurações.
- Webviews compilam de TypeScript e validam mensagens recebidas. Os JavaScripts de interface são artefatos de build.

## Evidências locais

- 160 testes automatizados passaram: runtime, cinco adaptadores com respostas simuladas, protocolos nativo e compatível, credenciais, persistência, bloqueios, recuperação, compactação e limites.
- Quatro testes TLS passaram com servidor HTTPS local: certificado autoassinado, TLS insecure por conexão, redirecionamento e cancelamento.
- Testes de interface passaram nas larguras da sidebar de 280, 360 e 480 px e configurações de 480, 800 e 1200 px, com temas claro, escuro e alto contraste. Incluem teclado, formulários, diagnóstico de ferramentas, saída de comandos e retenção.
- Extension Host real com provedores locais simulados: cadastro, seleção, conversa, permissões, rascunhos, recuperação de resposta inválida, diagnóstico de ferramentas e limite de resposta.
- Screenshots gerados em test-results/ para inspeção local, sem inclusão no pacote.

## Limites

Os testes simulados não comprovam compatibilidade de um modelo real nem acesso ao provedor corporativo. O teste de ferramentas disponível nas configurações usa um arquivo fictício, sem ler o workspace, e verifica uma chamada real do modelo selecionado.

Docker não está disponível nesta máquina: isolamento e preservação de alterações após timeout dependem do job Linux obrigatório da CI. A matriz CI foi ampliada para macOS, Windows e Linux com Node 22/24, além do VS Code mínimo 1.96.0. Resultados locais não substituem a execução dessa matriz.

## Reprodução

- make install
- make check
- make package
- make test-sandbox (Docker e imagem node:22-bookworm-slim necessários)
- make test-real (credenciais de avaliação necessárias; somente fixtures)

A publicação de uma release depende da conclusão dos jobs de validação.
