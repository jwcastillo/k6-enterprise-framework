/** Phase 5 / AI-01 (D-03): OpenAIProvider stub. Real implementation deferred (CONTEXT <deferred>). */

import type {
  LLMProvider,
  ChatMessage,
  ChatOptions,
  ChatResponse,
  TokenUsage,
  EstimateCostResult,
} from "../llm-provider.js";

// ── Constructor options ───────────────────────────────────────────────────────

export interface OpenAIProviderOptions {
  apiKey?: string;
  model?: string;
  baseURL?: string;
}

// ── Not-implemented message (exact per D-03) ──────────────────────────────────

const NOT_IMPLEMENTED = "OpenAIProvider not implemented for v0.3.0; use AnthropicProvider";

// ── OpenAIProvider stub ───────────────────────────────────────────────────────

export class OpenAIProvider implements LLMProvider {
  readonly name = "openai" as const;

  // Store options for future real implementation — not used in stub
  private readonly _apiKey: string | undefined;
  private readonly _model: string | undefined;
  private readonly _baseURL: string | undefined;

  constructor(opts: OpenAIProviderOptions) {
    // Store options but do NOT call any SDK — stub only
    this._apiKey = opts.apiKey;
    this._model = opts.model;
    this._baseURL = opts.baseURL;
  }

  // ── LLMProvider methods — all throw NOT_IMPLEMENTED ───────────────────────

  async chat(_messages: ChatMessage[], _options?: ChatOptions): Promise<ChatResponse> {
    throw new Error(NOT_IMPLEMENTED);
  }

  async embed(_text: string): Promise<number[]> {
    throw new Error(NOT_IMPLEMENTED);
  }

  estimateCost(_usage: TokenUsage, _model?: string): EstimateCostResult {
    throw new Error(NOT_IMPLEMENTED);
  }
}
