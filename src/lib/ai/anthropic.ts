/**
 * Thin wrapper around the Anthropic Messages API.
 *
 * Uses plain fetch so we do NOT need to pull in the @anthropic-ai/sdk
 * package. The rest of the codebase just calls `callClaude()` and gets
 * back a plain string (concatenated text blocks).
 *
 * Gracefully inert: if ANTHROPIC_API_KEY is not set, `isAiEnabled()`
 * returns false and callers should skip without erroring — so trickle-
 * down keeps running even while the key is missing.
 */

const API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";

export function isAiEnabled(): boolean {
  return !!API_KEY;
}

export function getModel(): string {
  return MODEL;
}

export interface CallClaudeOptions {
  maxTokens?: number;
  temperature?: number;
}

export interface CallClaudeResult {
  text: string;
  inputTokens?: number;
  outputTokens?: number;
  stopReason?: string;
}

export async function callClaude(
  systemPrompt: string,
  userMessage: string,
  opts: CallClaudeOptions = {}
): Promise<CallClaudeResult> {
  if (!API_KEY) {
    throw new Error("ANTHROPIC_API_KEY not set");
  }

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: opts.maxTokens ?? 2048,
      temperature: opts.temperature ?? 0.2,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Anthropic API ${res.status}: ${errText}`);
  }

  const json = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>;
    usage?: { input_tokens?: number; output_tokens?: number };
    stop_reason?: string;
  };

  const text = (json.content || [])
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("\n");

  return {
    text,
    inputTokens: json.usage?.input_tokens,
    outputTokens: json.usage?.output_tokens,
    stopReason: json.stop_reason,
  };
}

/**
 * Rough token estimator — ~4 chars per token for English prose.
 * Used only for the cost-guardrail cutoff before we call the API.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}
