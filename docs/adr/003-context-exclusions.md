# ADR-003: Exclusões de contexto centralizadas

**Data:** 2025-01-XX
**Status:** Aceito

## Contexto

O Vortex tinha três listas de exclusões independentes:
1. `readTools.ts` — lista hardcoded de 7 padrões para `list_files` e `search_files`
2. `planFingerprint.ts` — lista própria de 8 diretórios
3. `policy.ts` — `safePath()` só bloqueava `.git` e `.env`

Isso causava:
- A IA podia ler arquivos de `node_modules` via `read_file` (não coberto por `safePath`)
- Listas dessincronizadas entre componentes
- Sem leitura de `.gitignore` do projeto
- Sem configuração de exclusões pelo usuário

## Decisão

Criar `src/exclusions.ts` como fonte única de verdade:

- **`PROTECTED_DIRS`**: 28 diretórios sempre bloqueados (node_modules, dist, build, .venv, vendor, target, etc.)
- **`PROTECTED_FILE_PATTERNS`**: padrões de arquivo bloqueados (.env*, .vsix, .pyc, .pem, .key, etc.)
- **`isContextProtected()`**: verificação síncrona de caminho
- **`safeReadPath()`** em `policy.ts`: bloqueia `read_file`, `query_symbols`, `get_diagnostics`
- **`readGitignore()`**: lê `.gitignore` do workspace (preparado para uso futuro)
- **`defaultExcludeGlobs`**: exportado para `readTools.ts` usar em `exclusionGlob()`

## Consequências

**Positivas:**
- Fonte única — mudanças em um lugar se propagam
- `read_file` não pode mais acessar `node_modules` ou `dist`
- Lista expandida cobre mais ecossistemas (Python, Rust, Java, .NET)
- Preparado para configuração de usuário e `.gitignore`

**Negativas:**
- `safeReadPath` adiciona uma verificação extra em cada leitura
- Diretórios como `vendor/` podem conter código legítimo em alguns projetos (raro)
- Lista de 28 diretórios pode ser excessiva para projetos pequenos
