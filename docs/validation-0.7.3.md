# Validação 0.7.3

## Correção

O modelo enviava `editor.selection` como `"false"`. O contrato exige um booleano. Um parser compartilhado agora reconhece booleanos JSON, números 1/0 e textos true/false, 1/0, on/off. Textos ignoram maiúsculas e espaços externos. Valores fora desse conjunto não são convertidos por truthiness.

A normalização ocorre na entrada das ferramentas, em campos que o schema declara como booleanos, tanto no protocolo Nativo como em Compatibilidade. O executor mantém validação estrita após a conversão. Campos de texto e números de linha não são convertidos, argumentos desconhecidos continuam sendo rejeitados e modo/permissões são preservados. `editor.selection: null` equivale a omitir a opção e consulta apenas metadados dos arquivos abertos.

A chamada original permanece no JSON de diagnóstico. A descrição e a orientação de correção do editor distinguem o booleano do texto selecionado e das coordenadas do cursor.

## Verificações

- 141 testes unitários/integrados aprovados, incluindo o parser, os dois protocolos, preservação da entrada original, tipos inválidos e modos de leitura.
- `"false"`, `"off"` e 0 produzem false; a ferramenta editor executa uma vez, sem rejeição ou rodada extra.
- `network: "on"` continua exigindo aprovação antes da execução no sandbox; recusa impede a ação.
- Extension Host real com provedor local simulado: recuperação de argumento ambíguo e execução direta de `editor.selection: "false"` em Ask, sem alterações no workspace.

Não foram usados o gateway nem credenciais reais do trabalho. A regressão reproduz o valor confirmado pelo usuário e verifica o comportamento no VS Code com respostas simuladas.
