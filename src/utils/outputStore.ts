import { ToolOutputs } from "../tools/toolOutputs";

/**
 * Persist a potentially large output string in a session-scoped ToolOutputs store.
 * The returned object contains a preview (truncated if needed), a flag, and an
 * output_id (as `outputRef`) that can later be used with `getOutput` to retrieve
 * the full content.
 *
 * The store must be the same ToolOutputs instance that the runtime uses for
 * checkpointing and for the `read_tool_output` tool, so ids resolve across
 * session restarts.
 */
export interface StoredOutput {
  preview: string;
  truncated: boolean;
  outputRef?: string;
  total_characters: number;
  next_offset?: number;
  instruction?: string;
}

export function storeOutput(store: ToolOutputs, value: string, limit: number = 4000): StoredOutput {
  const result = store.preserve(value, limit);
  if (typeof result !== 'string') return result;
  try {
    const parsed = JSON.parse(result);
    if (parsed && typeof parsed === 'object' && typeof parsed.preview === 'string') return parsed as StoredOutput;
    return { preview: result, truncated: false, total_characters: value.length };
  } catch {
    // preserve only returns raw text when no truncation occurs.
    return { preview: result, truncated: false, total_characters: value.length };
  }
}

/** Retrieve the full stored output given its identifier. */
export function getOutput(store: ToolOutputs, id: string): string {
  return store.full(id);
}
