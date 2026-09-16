# ADR-001: Arquitetura BYOK

**Data:** 2024-09-XX
**Status:** Aceito

## Contexto

O Vortex precisa permitir que os usuários escolham seu próprio provedor de LLM (OpenAI, Ollama, endpoints compatíveis) sem acoplar a extensão a um provedor específico.

## Decisão

Adotar arquitetura BYOK (Bring Your Own Key):

- `providers.ts` define uma interface comum para todos os provedores
- `providerManager.ts` gerencia conexões e catálogos de modelos
- `modelRequest.ts` normaliza requisições entre provedores
- O usuário configura URL base, chave de API e modelo nas configurações
- Suporte a streaming nativo e compatível (tool use via JSON)

## Consequências

**Positivas:**
- Usuário não fica preso a um provedor
- Suporte a modelos locais (Ollama) sem custo de API
- Fácil adição de novos provedores compatíveis com OpenAI

**Negativas:**
- Necessita normalização de protocolos entre provedores
- Testes precisam cobrir múltiplos formatos de resposta
- Sem token counting nativo — estimativa conservadora por bytes
