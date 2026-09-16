# Changelog

Todas as mudanças visíveis são documentadas aqui. O formato segue [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e o projeto usa [Versionamento Semântico](https://semver.org/lang/pt-BR/).

## [Unreleased]

### Added
- `src/exclusions.ts` — fonte única de exclusões de contexto (28 diretórios + padrões de arquivo)
- `safeReadPath()` em `policy.ts` — bloqueia `read_file`, `query_symbols` e `get_diagnostics` em diretórios de dependência
- `readGitignore()` e `buildExclusionGlob()` — leitura de `.gitignore` do workspace
- `.editorconfig` — consistência entre editores
- `CONTRIBUTING.md` — guia para contribuidores
- `CHANGELOG.md` — rastreabilidade de versões
- Templates de PR e Issues no GitHub
- `docs/README.md` — índice da documentação
- `docs/adr/` — Architecture Decision Records

### Changed
- `readTools.ts` agora importa exclusões de `exclusions.ts` em vez de lista hardcoded
- `planFingerprint.ts` usa `isContextProtected()` em vez de lista própria
- Prompts de agent, ask e plan orientam a evitar diretórios de dependência
- `stepPrompt` define "evidence" como output real da tentativa atual
- Lista de exclusões expandida: `build/`, `out/`, `.next/`, `.turbo/`, `vendor/`, `target/`, `__pycache__/`, `.venv/`, `venv/`, `.mypy_cache/`, `.pytest_cache/`, `.tox/`, `.eggs/`, `.nuxt/`, `.output/`, `.gradle/`, `.idea/`, `.vscode-test/`

### Fixed
- IA podia ler arquivos de `node_modules` via `read_file` — agora bloqueado por `safeReadPath()`
- Listas de exclusões dessincronizadas entre `readTools.ts` e `planFingerprint.ts`

## [0.11.0] — 2025-01-XX

### Added
- Sistema de execução controlada por etapas com contract version 2
- Autorização rastreia grants (files + commands) por step
- Fingerprint do workspace para detectar mudanças não autorizadas
- Verificação exige evidências de comandos executados
- Até 2 rodadas de correção por step
- `stepPrompt` para execução controlada
- Matriz de estabilidade com modelos reais (Gemma, Qwen)

### Changed
- Simplificação do contrato de planejamento: extensão atribui IDs e vincula respostas à etapa
- Aprovar um plano autoriza operações de arquivo e comandos exatos

## [0.10.0] — 2024-12-XX

### Added
- Último fluxo da IA exportável em JSON (`last-flow.json`)
- Formato de rastreamento: `conversation_id`, `model`, `turns`, `final_answer`, `sources`

## [0.9.0] — 2024-12-XX

### Added
- Padronização de contratos de ferramentas
- Seleção de ferramentas por modo

## [0.8.0] — 2024-11-XX

### Added
- Recuperação de sessões e persistência robusta
- Diagnósticos de armazenamento

## [0.7.0] — 2024-11-XX

### Added
- Composer, settings e execução aprimorados
- Versão da extensão visível nas configurações

## [0.6.0] — 2024-10-XX

### Added
- Timeout de modelo configurável (1–3600s)
- `last-flow.json` por mensagem

## [0.5.0] — 2024-10-XX

### Added
- Ferramentas de agente, contexto e controles de tarefa
- Apresentação de atividade de ferramentas como detalhes compactos

## [0.4.0] — 2024-09-XX

### Added
- Versão inicial com BYOK, modos Ask/Plan/Agent e permissões Supervised/Autonomous
