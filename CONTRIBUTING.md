# Contribuindo para o Vortex

Obrigado pelo interesse em contribuir! Este documento cobre o processo de desenvolvimento, convenções e validação.

## Pré-requisitos

- Node.js 22 ou 24
- VS Code 1.96+

## Setup

```sh
git clone https://github.com/raulaguila/vortex.git
cd vortex
make install
```

`make install` executa `npm ci` (sincroniza com `package-lock.json`), compila TypeScript e gera os bundles.

## Desenvolvimento

```sh
make watch    # recompila em modo watch com verificação de tipos
```

Pressione **F5** no VS Code para abrir uma janela de Extension Development Host com a extensão carregada.

## Antes de commitar

```sh
make test     # compila + roda 286 testes
```

Para validação com modelos reais (opcional):

```sh
make test-stability    # matriz real com Gemma e Qwen
```

## Convenções

### Código

- **TypeScript strict** — sem `any` em código novo; use tipos explícitos
- **Sem dependências externas desnecessárias** — preferir módulos nativos do Node.js
- **Arquivos `.ts` em `src/`** — backend da extensão (roda no extension host)
- **Arquivos `.ts` em `webview/`** — frontend (roda no webview do VS Code)
- **Bundler**: esbuild para ambos os lados

### Testes

- **Runner**: `node --test` (nativo do Node.js)
- **Arquivos**: `test/*.test.cjs`
- **Sem mocks globais** — cada teste isola seu estado
- **Nomes descritivos**: `reads use dirty buffers, record versions and expose line pagination`

### Prompts

- **Inglês** nos system prompts (otimização para LLMs)
- **Português e inglês** na interface do usuário
- Prompts em `src/prompts/` — manter concisos (limite de ~3600 chars por modo sem `<tool_selection>`)

### UI

- **16 px de margem externa**, 12 px internos
- Segue o tema do editor (claro, escuro, alto contraste)
- Sidebar compacta com composer integrado

### Commits

- Use **português** ou **inglês** nas mensagens de commit
- Prefixos opcionais: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`
- Mantenha commits focados — uma mudança lógica por commit

### Documentação

- `CHANGELOG.md` para mudanças visíveis ao usuário
- `docs/` para documentação técnica
- `docs/adr/` para decisões de arquitetura

## Estrutura do repositório

```
src/           Backend da extensão (extension host)
webview/       Frontend (UI do chat)
test/          Testes automatizados
scripts/       Build, benchmark, avaliação
docs/          Documentação técnica
docs/design/   Mockups e referências visuais
docs/adr/      Architecture Decision Records
media/         Assets compilados (gitignored)
```

## Reportando bugs

Abra uma issue com:

1. Versão do Vortex e do VS Code
2. Passos para reproduzir
3. Comportamento esperado vs. observado
4. Logs de diagnóstico (Vortex: Show diagnostic log)
