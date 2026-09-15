# Validação 0.6.0 — ciclo estruturado

## Contrato

1. System prompt define escopo, modo, permissões, fluxo e comunicação. As ferramentas existentes do Vortex são descritas separadamente por nome, descrição e inputSchema.
2. Cada adaptador converte esse contrato para o formato da API do provedor.
3. A resposta normalizada contém texto, chamadas, motivo de parada e estado tool_use ou final. Texto vazio com chamadas válidas é aceito.
4. O lote inteiro é validado antes da primeira execução. As políticas de modo e aprovação continuam no executor.
5. Resultados são correlacionados aos IDs das chamadas e incluídos no histórico da próxima rodada. O modo Compatibility é um adaptador para esse ciclo.
6. Resposta final encerra o turno. Bloqueios, respostas truncadas e estados inválidos não executam ferramentas parciais.
7. Após o limite de etapas, uma síntese sem ferramentas pode informar trabalho concluído e pendente, se houver tempo e orçamento. A tarefa continua pausada.

Auto tenta chamadas nativas quando os metadados não informam capacidade. Uma rejeição explícita de suporte pode ativar Compatibility; autenticação, rede e respostas malformadas não provocam essa troca. A seleção explícita de protocolo permanece disponível.

A adaptação aproveita a estrutura do exemplo fornecido pelo usuário, sem copiar suas ferramentas, instruções de domínio ou dados. Não adiciona integração MCP.

## Evidências

- Compilação TypeScript e 110 testes aprovados.
- Fixture de três rodadas: duas ferramentas, resultados correlacionados, uma nova ferramenta e resposta final; verifica preservação do histórico.
- Contratos dos cinco adaptadores, ausência de tools na rodada sem ferramentas, estados inválidos, compatibilidade e síntese no limite.
- Extension Host com VS Code real: cadastro/chat em provedores locais simulados, pares de modo/permissão, aprovações e recusas, edição múltipla, esclarecimento interativo e restauração da interface. O fluxo longo também exerce resumo de contexto.

Provedores e respostas dos testes são simulados. Credenciais e o gateway corporativo real não foram usados; decisões de modelos reais não são comprovadas por essas fixtures. Logs continuam limitados a metadados de diagnóstico, sem exportação automática de prompts ou resultados completos.
