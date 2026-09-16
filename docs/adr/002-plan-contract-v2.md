# ADR-002: Contract de plano v2

**Data:** 2024-12-XX
**Status:** Aceito

## Contexto

O sistema de planejamento original (v1) tinha problemas de confiabilidade: o modelo podia gerar IDs de step inconsistentes, respostas não vinculavam à etapa correta, e a verificação não exigia evidências concretas.

## Decisão

Implementar contract version 2 com as seguintes características:

- A **extensão** atribui IDs de step, não o modelo
- `planAuthorization.ts` rastreia grants (arquivos + comandos) por step
- `planFingerprint.ts` calcula hash do workspace para detectar mudanças não autorizadas
- `planVerification.ts` exige evidências de comandos executados na tentativa atual
- Até 2 rodadas de correção por step
- `stepPrompt` define "evidence" como output real da tentativa atual

## Consequências

**Positivas:**
- Verificação confiável — sem falsos positivos baseados em claims do modelo
- Autorização granular — cada step tem escopo explícito
- Detecção de mudanças externas durante execução

**Negativas:**
- Complexidade adicional no runtime
- Fingerprint pode falhar em workspaces muito grandes (budget de 50 MB / 10k arquivos)
- Modelo precisa seguir o contract estritamente
