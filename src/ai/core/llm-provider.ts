/**
 * Phase 5 / AI-01: Vendor-neutral LLM provider contract.
 * Implementations live in src/ai/core/providers/.
 */

// ── Message types ────────────────────────────────────────────────────────────

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  model?: string; // when omitted, provider uses its configured default
  maxTokens?: number; // default 4096
  temperature?: number;
  stopSequences?: string[];
  system?: string; // hoisted system prompt; alternative to role:"system" in messages
}

// ── Token usage ──────────────────────────────────────────────────────────────

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

// ── Response types ───────────────────────────────────────────────────────────

export interface ChatResponse {
  text: string; // concatenated assistant text content
  usage: TokenUsage;
  model: string; // model that actually served the request
  stopReason: "end_turn" | "stop_sequence" | "max_tokens" | "tool_use" | "error" | "unknown";
}

export interface EstimateCostResult {
  usd: number; // total USD for the supplied usage
  model: string; // model used for the rate lookup (after default fallback)
}

// ── Provider contract ────────────────────────────────────────────────────────

export interface LLMProvider {
  readonly name: "anthropic" | "openai";
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse>;
  embed(text: string): Promise<number[]>;
  estimateCost(usage: TokenUsage, model?: string): EstimateCostResult;
}
