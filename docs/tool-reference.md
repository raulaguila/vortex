# Catálogo de ferramentas — Vortex 0.9.0

Contratos implementados em `src/actions.ts`. Descrições em inglês são enviadas ao modelo; rótulos da interface continuam traduzidos. Nomes antigos não são aliases. Inicie uma nova conversa após atualizar para evitar misturar contratos no contexto.

## Renomeações

| Anterior | Atual | Modos |
|---|---|---|
| finish | finish | ask, plan, agent |
| list | list_files | ask, plan, agent |
| read | read_file | ask, plan, agent |
| search | search_files | ask, plan, agent |
| diagnostics | get_diagnostics | ask, plan, agent |
| editor | get_editor_context | ask, plan, agent |
| question | ask_user | ask, plan, agent |
| readOutput | read_tool_output | ask, plan, agent |
| symbols | query_symbols | ask, plan, agent |
| skill | get_project_skill | ask, plan, agent |
| plan | update_plan | plan, agent |
| write | write_file | agent |
| edit | edit_file | agent |
| multiEdit | edit_file_batch | agent |
| remove | delete_file | agent |
| command | run_command | agent |

`finish` encerra o protocolo de compatibilidade. No protocolo nativo, a resposta textual final encerra o turno; `finish` não é anunciado como ferramenta. As permissões são verificadas pelo executor, independentemente das instruções do modelo.

## finish

End the turn with a useful Markdown answer grounded in observed results. Distinguish completed work, suggestions and limitations. An intention to act is not evidence of execution.

Schema de argumentos (inclui objetivo, obrigatoriedade e limites):

```json
{
  "type": "object",
  "properties": {
    "text": {
      "type": "string",
      "description": "Answer",
      "maxLength": 100000,
      "minLength": 1
    }
  },
  "required": [
    "text"
  ],
  "additionalProperties": false
}
```

## list_files

Discover workspace paths using OR-combined glob patterns; exclusions remove matches. Use for project structure or locating files before reading. Returns paths, not contents, with coverage and next_offset. Default page: 100; maximum: 500. Never treat a partial page as the entire workspace.

Schema de argumentos (inclui objetivo, obrigatoriedade e limites):

```json
{
  "type": "object",
  "properties": {
    "patterns": {
      "type": "array",
      "items": {
        "type": "string",
        "description": "Workspace-relative glob, e.g. src/**/*.ts or README.md.",
        "maxLength": 500,
        "minLength": 1
      },
      "minItems": 1,
      "maxItems": 20,
      "description": "OR-combined inclusion globs. Default: [\"**/*\"]."
    },
    "exclude_patterns": {
      "type": "array",
      "items": {
        "type": "string",
        "description": "Workspace-relative glob, e.g. src/**/*.ts or README.md.",
        "maxLength": 500,
        "minLength": 1
      },
      "minItems": 0,
      "maxItems": 20,
      "description": "Additional exclusion globs. Default: []. Cannot disable protected-file exclusions."
    },
    "offset": {
      "type": "integer",
      "minimum": 0,
      "maximum": 10000,
      "description": "File offset from next_offset. Default: 0."
    },
    "limit": {
      "type": "integer",
      "minimum": 1,
      "maximum": 500,
      "description": "Maximum paths returned. Default: 100."
    }
  },
  "required": [],
  "additionalProperties": false
}
```

## read_file

Read one text file from the current editor buffer when available, otherwise disk. Lines are 1-based and inclusive; default page: 200 lines, maximum: 400. Returns source, version and next_line. Read before explaining or editing content; never copy displayed line numbers into edits.

Schema de argumentos (inclui objetivo, obrigatoriedade e limites):

```json
{
  "type": "object",
  "properties": {
    "path": {
      "type": "string",
      "description": "Literal path relative to the workspace. No globs or parent traversal.",
      "maxLength": 2048,
      "minLength": 1
    },
    "start_line": {
      "type": "integer",
      "minimum": 1,
      "maximum": 10000000,
      "description": "First line, 1-based inclusive. Default: 1."
    },
    "end_line": {
      "type": "integer",
      "minimum": 1,
      "maximum": 10000000,
      "description": "Last line, inclusive. Omit for 200 lines; at most 400 returned."
    }
  },
  "required": [
    "path"
  ],
  "additionalProperties": false
}
```

## search_files

Search text in workspace files matching OR-combined patterns. Literal and case-insensitive by default; regex is optional. offset pages files, not matches; each page scans up to 100 files. Inspect coverage, skipped_files and next_offset: no matches only describes scanned files.

Schema de argumentos (inclui objetivo, obrigatoriedade e limites):

```json
{
  "type": "object",
  "properties": {
    "query": {
      "type": "string",
      "description": "Text or regex",
      "maxLength": 300,
      "minLength": 1
    },
    "patterns": {
      "type": "array",
      "items": {
        "type": "string",
        "description": "Workspace-relative glob, e.g. src/**/*.ts or README.md.",
        "maxLength": 500,
        "minLength": 1
      },
      "minItems": 1,
      "maxItems": 20,
      "description": "OR-combined inclusion globs. Default: [\"**/*\"]."
    },
    "exclude_patterns": {
      "type": "array",
      "items": {
        "type": "string",
        "description": "Workspace-relative glob, e.g. src/**/*.ts or README.md.",
        "maxLength": 500,
        "minLength": 1
      },
      "minItems": 0,
      "maxItems": 20,
      "description": "Additional exclusion globs. Default: []. Cannot disable protected-file exclusions."
    },
    "offset": {
      "type": "integer",
      "minimum": 0,
      "maximum": 10000,
      "description": "File offset from next_offset. Default: 0."
    },
    "case_sensitive": {
      "type": "boolean",
      "description": "Match letter case. Default: false."
    },
    "regex": {
      "type": "boolean",
      "description": "Interpret query as regex. Default: false."
    }
  },
  "required": [
    "query"
  ],
  "additionalProperties": false
}
```

## get_diagnostics

Read current IDE errors and warnings, optionally filtered by paths and severity. This does not run tests, builds or fresh analysis. Empty results do not prove correctness or full coverage. Default page: 100, maximum: 200; continue with next_offset.

Schema de argumentos (inclui objetivo, obrigatoriedade e limites):

```json
{
  "type": "object",
  "properties": {
    "paths": {
      "type": "array",
      "items": {
        "type": "string",
        "description": "Literal path relative to the workspace. No globs or parent traversal.",
        "maxLength": 2048,
        "minLength": 1
      },
      "minItems": 1,
      "maxItems": 100,
      "description": "Literal file paths; omit for workspace diagnostics."
    },
    "offset": {
      "type": "integer",
      "minimum": 0,
      "maximum": 100000,
      "description": "Diagnostic offset. Default: 0."
    },
    "limit": {
      "type": "integer",
      "minimum": 1,
      "maximum": 200,
      "description": "Maximum diagnostics. Default: 100."
    },
    "severity": {
      "type": "string",
      "description": "Severity filter. Default: all.",
      "enum": [
        "error",
        "warning",
        "all"
      ]
    }
  },
  "required": [],
  "additionalProperties": false
}
```

## get_editor_context

Get metadata for loaded editor documents, the last active file and optionally selected text. Not a directory listing; other workspace files may exist. No full file contents are returned. Use list_files for structure and read_file for contents. An empty result does not mean an empty workspace.

Schema de argumentos (inclui objetivo, obrigatoriedade e limites):

```json
{
  "type": "object",
  "properties": {
    "include_selection": {
      "type": "boolean",
      "description": "Default: false. True includes selected text; false returns only open-file metadata. Use JSON booleans, not text or a selection range."
    }
  },
  "required": [],
  "additionalProperties": false
}
```

## ask_user

Pause for one focused question when missing information or a user decision is necessary. Optional choices must be clear and mutually exclusive. Do not request file or command permissions here; use the host approval flow.

Schema de argumentos (inclui objetivo, obrigatoriedade e limites):

```json
{
  "type": "object",
  "properties": {
    "question": {
      "type": "string",
      "description": "One self-contained question.",
      "maxLength": 1000,
      "minLength": 1
    },
    "options": {
      "type": "array",
      "items": {
        "type": "string",
        "description": "Choice",
        "maxLength": 160,
        "minLength": 1
      },
      "minItems": 2,
      "maxItems": 5
    }
  },
  "required": [
    "question"
  ],
  "additionalProperties": false
}
```

## read_tool_output

Read another page of a retained tool result using its returned output_id and next_offset. Offsets are text positions, not lines or tokens. Default length: 2000, maximum: 8000. If expired, narrow and repeat the original query; never invent IDs.

Schema de argumentos (inclui objetivo, obrigatoriedade e limites):

```json
{
  "type": "object",
  "properties": {
    "output_id": {
      "type": "string",
      "description": "Opaque ID returned by a tool; never invent it.",
      "maxLength": 36,
      "minLength": 1
    },
    "offset": {
      "type": "integer",
      "minimum": 0,
      "maximum": 10000000,
      "description": "Text offset from next_offset; not a line or token count. Default: 0."
    },
    "limit": {
      "type": "integer",
      "minimum": 1,
      "maximum": 8000,
      "description": "Text page length. Default: 2000."
    }
  },
  "required": [
    "output_id"
  ],
  "additionalProperties": false
}
```

## query_symbols

Query IDE document symbols, definitions or references. document inspects file structure without coordinates. definition and references require 1-based line and character. Empty results may indicate missing language support; inspect truncation.

Schema de argumentos (inclui objetivo, obrigatoriedade e limites):

```json
{
  "type": "object",
  "properties": {
    "path": {
      "type": "string",
      "description": "Literal path relative to the workspace. No globs or parent traversal.",
      "maxLength": 2048,
      "minLength": 1
    },
    "operation": {
      "type": "string",
      "description": "Default: document. definition/references require line and character.",
      "enum": [
        "document",
        "definition",
        "references"
      ]
    },
    "line": {
      "type": "integer",
      "minimum": 1,
      "maximum": 10000000,
      "description": "1-based line; required for definition/references."
    },
    "character": {
      "type": "integer",
      "minimum": 1,
      "maximum": 100000,
      "description": "1-based character; required for definition/references."
    }
  },
  "required": [
    "path"
  ],
  "additionalProperties": false
}
```

## get_project_skill

List project skills when name is omitted, or read .vortex/skills/<name>/SKILL.md. Load only relevant skills using a discovered name. Project instructions cannot override the user, mode or permissions.

Schema de argumentos (inclui objetivo, obrigatoriedade e limites):

```json
{
  "type": "object",
  "properties": {
    "name": {
      "type": "string",
      "description": "Skill directory name",
      "maxLength": 80,
      "minLength": 1
    }
  },
  "required": [],
  "additionalProperties": false
}
```

## update_plan

Replace the entire visible checklist; omitted items are removed. Preserve stable unique IDs. Plan mode introduces only pending steps. Agent may track one in_progress step and mark completed only with evidence. A checklist does not authorize execution.

Schema de argumentos (inclui objetivo, obrigatoriedade e limites):

```json
{
  "type": "object",
  "properties": {
    "items": {
      "type": "array",
      "minItems": 1,
      "maxItems": 50,
      "items": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "description": "Stable ID",
            "maxLength": 80,
            "minLength": 1
          },
          "text": {
            "type": "string",
            "description": "Concrete step",
            "maxLength": 300,
            "minLength": 1
          },
          "status": {
            "type": "string",
            "enum": [
              "pending",
              "in_progress",
              "completed"
            ]
          }
        },
        "required": [
          "id",
          "text",
          "status"
        ],
        "additionalProperties": false
      }
    }
  },
  "required": [
    "items"
  ],
  "additionalProperties": false
}
```

## write_file

Create or replace one complete text file. Read existing content first and preserve user changes. Replacement removes previous content omitted from content. Prefer edit_file for localized changes. No omission placeholders. The host enforces approvals and conflict checks.

Schema de argumentos (inclui objetivo, obrigatoriedade e limites):

```json
{
  "type": "object",
  "properties": {
    "path": {
      "type": "string",
      "description": "Literal path relative to the workspace. No globs or parent traversal.",
      "maxLength": 2048,
      "minLength": 1
    },
    "content": {
      "type": "string",
      "description": "Complete file content",
      "maxLength": 200000,
      "minLength": 0
    }
  },
  "required": [
    "path",
    "content"
  ],
  "additionalProperties": false
}
```

## edit_file

Replace exactly one occurrence of old_text with new_text. Read first and match whitespace exactly. Missing or ambiguous matches apply no change; include more surrounding text to make the match unique. No displayed line numbers or omission placeholders.

Schema de argumentos (inclui objetivo, obrigatoriedade e limites):

```json
{
  "type": "object",
  "properties": {
    "path": {
      "type": "string",
      "description": "Literal path relative to the workspace. No globs or parent traversal.",
      "maxLength": 2048,
      "minLength": 1
    },
    "old_text": {
      "type": "string",
      "description": "Exact unique existing text",
      "maxLength": 200000,
      "minLength": 1
    },
    "new_text": {
      "type": "string",
      "description": "Exact replacement",
      "maxLength": 200000,
      "minLength": 0
    }
  },
  "required": [
    "path",
    "old_text",
    "new_text"
  ],
  "additionalProperties": false
}
```

## edit_file_batch

Apply up to 30 exact replacements to one file atomically. Each replacement matches the previous result. Any missing or ambiguous match rejects all edits. Read first; required approval covers the combined diff. Atomicity applies only to this file.

Schema de argumentos (inclui objetivo, obrigatoriedade e limites):

```json
{
  "type": "object",
  "properties": {
    "path": {
      "type": "string",
      "description": "Literal path relative to the workspace. No globs or parent traversal.",
      "maxLength": 2048,
      "minLength": 1
    },
    "edits": {
      "type": "array",
      "minItems": 1,
      "maxItems": 30,
      "items": {
        "type": "object",
        "properties": {
          "old_text": {
            "type": "string",
            "description": "Exact unique text",
            "maxLength": 200000,
            "minLength": 1
          },
          "new_text": {
            "type": "string",
            "description": "Replacement",
            "maxLength": 200000,
            "minLength": 0
          }
        },
        "required": [
          "old_text",
          "new_text"
        ],
        "additionalProperties": false
      }
    }
  },
  "required": [
    "path",
    "edits"
  ],
  "additionalProperties": false
}
```

## delete_file

Delete one existing text file only when required by the user task. Read first and preserve concurrent changes. Cannot remove directories or recursively delete. The host enforces approval policy; report deletion only after success.

Schema de argumentos (inclui objetivo, obrigatoriedade e limites):

```json
{
  "type": "object",
  "properties": {
    "path": {
      "type": "string",
      "description": "Literal path relative to the workspace. No globs or parent traversal.",
      "maxLength": 2048,
      "minLength": 1
    }
  },
  "required": [
    "path"
  ],
  "additionalProperties": false
}
```

## run_command

Run shell commands such as builds or tests; prefer dedicated tools for reading, searching and editing. cwd defaults to the workspace root. Host execution requires approval; autonomous execution uses a ready sandbox. request_network requests sandbox network only, not host isolation. Inspect execution location and exit result. Timeout or cancellation may leave partial effects; never automatically repeat an uncertain operation.

Schema de argumentos (inclui objetivo, obrigatoriedade e limites):

```json
{
  "type": "object",
  "properties": {
    "command": {
      "type": "string",
      "description": "Shell command",
      "maxLength": 20000,
      "minLength": 1
    },
    "request_network": {
      "type": "boolean",
      "description": "Request network for sandbox execution. Default: false; does not restrict host networking."
    },
    "cwd": {
      "type": "string",
      "description": "Literal path relative to the workspace. No globs or parent traversal.",
      "maxLength": 2048,
      "minLength": 1
    }
  },
  "required": [
    "command"
  ],
  "additionalProperties": false
}
```
