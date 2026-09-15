# Vortex 0.4.0 — validação local

Data: 2026-09-15. Ambiente: macOS, VS Code local, perfil e workspace de teste isolados.

## Resultados

- TypeScript e bundles: compilação aprovada.
- Suíte de unidade/contratos: 78 testes aprovados; mais 2 regressões de orçamento/limite aprovadas na execução dirigida de 36 testes.
- Interface: aprovada, 55 capturas; sidebar 280/360/480 px, configurações 480/800/1200 px, temas claro/escuro/alto contraste. Margem lateral de 16 px preservada.
- Extension Host: aprovado no código de desenvolvimento e no VSIX 0.4.0 extraído, sem depender de node_modules do projeto. Inclui cadastro/edição/remoção, catálogo/envio, rascunho/reload, seis combinações de modo/permissão, checklist, recusas, revisão e desfazer.
- TLS: aprovado com servidor local e certificado autoassinado; a opção insecure não altera as outras conexões.
- Empacotamento: vortex-agent.vsix, versão 0.4.0.

Os provedores nos testes automatizados são simulados. O Extension Host usa o executor e as operações reais do VS Code sobre arquivos temporários.

## Validações externas pendentes

- Docker real: teste marcado SKIP porque o executável não está instalado. Os testes de snapshot/exclusões passaram, mas não comprovam isolamento do runtime. Sem runtime, comandos no computador continuam exigindo aprovação.
- Avaliação com modelos reais: não executada. O comando make test-real está disponível para execução manual com endpoint/modelo e credenciais quando necessárias.
- CI macOS/Linux/Windows e release por tag: workflows adicionados, ainda não executados no GitHub nesta entrega. O backend de container Windows permanece desativado.

## Limites funcionais conhecidos

- Streaming de texto está disponível no protocolo nativo; Compatibility entrega a resposta textual completa.
- A UI mostra estado/duração de comandos; stdout/stderr aparecem nas atividades ao terminar, sem transmissão incremental.
- Comandos aprovados no computador podem produzir efeitos fora do registro de edições e não têm reversão garantida.
- O resumo automático usa o próprio provedor e a contabilização estimada quando ele não informa uso; o orçamento de tokens não é um teto financeiro exato.
- A revisão por trechos ocorre na aprovação supervisionada. O registro posterior permite revisar arquivos e desfazer com verificação de conflitos.
