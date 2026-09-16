import { Message } from "../providers/providers";
export const estimateTokens = (text: string): number =>
  Math.ceil((Buffer.byteLength(text, "utf8") / 3) * 1.2) + 16;
// Conservative byte estimate, not a provider-specific tokenizer.
export function fitContext(
  system: string,
  messages: Message[],
  window: number,
  output: number,
  currentTurnStart = 0,
  measure?: (messages: Message[]) => number,
) {
  const budget = window - output - 128;
  const result = messages.map((m) => ({ ...m }));
  let removed = 0;
  const size = () =>
    measure
      ? measure(result)
      : estimateTokens(system) +
        result.reduce((n, m) => n + estimateTokens(JSON.stringify(m)), 0);
  // Drop completed turns first. The current user message must never be evicted.
  if (size() > budget && currentTurnStart > 0) {
    result.splice(0, currentTurnStart);
    removed += currentTurnStart;
  }
  // Within a long turn, discard oldest action/result pairs, keeping its request and latest result.
  while (result.length > 3 && size() > budget) {
    let count = result[1].toolCalls?.length
      ? 1 + result[1].toolCalls.length
      : result[1].role === "assistant" && result[2].role === "user"
        ? 2
        : 1;
    if (result.length - count < 2) break;
    result.splice(1, count);
    removed += count;
  }
  if (size() > budget)
    throw new Error(
      "The current request exceeds the context budget. Shorten it or increase the model context setting.",
    );
  return { messages: result, used: size(), budget: window, removed };
}

export class ContextEstimator {
  private samples = new Map<string, number[]>();
  record(key: string, payload: string, input: number) {
    const bytes = Buffer.byteLength(payload);
    if (bytes && Number.isFinite(input) && input > 0) {
      const rows = this.samples.get(key) || [];
      rows.push(input / bytes);
      this.samples.set(key, rows.slice(-5));
    }
  }
  estimate(key: string, payload: string) {
    const rows = [...(this.samples.get(key) || [])].sort((a, b) => a - b);
    const ratio = rows.length ? rows[Math.floor(rows.length / 2)] : 1 / 3;
    return Math.ceil(Buffer.byteLength(payload) * ratio * 1.2) + 16;
  }
}
