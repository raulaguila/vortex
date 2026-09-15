# Validação 0.7.0

## Compatibilidade e migração

O perfil de preferências usa schemaVersion 3; sessões novas são gravadas na versão 3 e as antigas continuam legíveis. maxSteps migra para maxRounds e maxToolCalls; modelTimeout migra para firstResponseTimeout e idleTimeout. Valores válidos existentes, conexões, modelos e SecretStorage são preservados. Campos inválidos usam os padrões documentados.

Alterações no editor são explícitas por seção, com validação antes da persistência. O cadastro de provedores continua sendo salvo no modal. Catálogo, teste de chat, exportação de diagnóstico e seleção no chat são ações independentes dos rascunhos das configurações.

## Execução

Os prazos distinguem primeira resposta, inatividade, comando e tarefa. Eventos de conteúdo ou argumentos de ferramentas reiniciam a inatividade do streaming; heartbeats não. Aprovações tardias não autorizam execução após cancelamento. Rodadas de trabalho e ferramentas têm contadores separados; resumos respeitam os orçamentos de tempo e tokens.

Atividades novas incluem runId, ID de chamada, ferramenta, caminho, estado e timestamps; atividades antigas usam o adaptador textual. Falhas de transporte podem oferecer retomada sem duplicar mensagens ou repetir ferramentas. Texto parcial permanece no histórico com indicação de incompleto. Resultados incertos de comandos/escritas não permitem retomada automática.

A calibração de contexto é local à instância e ao par conexão/modelo, usando as cinco últimas amostras reportadas. Estimativas não são contagens exatas nem limites financeiros.

O rastreio conserva o envelope de referência. Snapshots são consolidados e gravados atomicamente em segundo plano; a finalização aguarda o flush. Uma execução anterior não sobrescreve a mais recente na mesma instância. O arquivo pode conter código e resultados de ferramentas; headers não são registrados e a chave configurada é removida.

## Verificações

- Compilação TypeScript e 126 testes unitários/integrados: migração, cinco adaptadores, contexto, credenciais, permissões, limites, recuperação, checkpoints e rastreio.
- UI com sidebar de 280/360/480 px e configurações de 480/800/1200 px; temas claro, escuro, alto contraste escuro e claro; nomes longos e fonte de 20 px.
- Navegação por teclado, menus acima do input, estado único, fonte/atalho após salvar, rascunhos entre seções, salvar/descartar/restaurar sem envio acidental, Markdown, sessão e texto parcial.
- Extension Host real com cadastro → catálogo → seleção → mensagem, seis combinações de modo/permissão, aprovações/recusas, edição múltipla, esclarecimento, teste de chat e abertura do último JSON.
- Quatro testes de HTTP remoto e TLS insecure em servidores locais de teste.

Os provedores, mensagens de modelo e gateway desses testes são simulados. Não foram usadas credenciais do trabalho. Docker e modelos remotos reais não foram validados nesta entrega.
