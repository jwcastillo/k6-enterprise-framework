/** Phase 5 / AI-01 (D-02): AnthropicProvider — the ONE file allowed to import @anthropic-ai/sdk. */

import Anthropic from "@anthropic-ai/sdk";
import type {
  LLMProvider,
  ChatMessage,
  ChatOptions,
  ChatResponse,
  TokenUsage,
  EstimateCostResult,
} from "../llm-provider.js";
import { loadPricing, lookupRate, type PricingTable } from "../pricing.js";

// ── Constructor options ───────────────────────────────────────────────────────

export interface AnthropicProviderOptions {
  /** API key — resolves opts.apiKey → LLM_API_KEY → ANTHROPIC_API_KEY (D-04 fallback chain). */
  apiKey?: string;
  /** Default model to use when options.model is omitted. Defaults to "claude-sonnet-4-6". */
  model?: string;
  /** Custom base URL for the Anthropic API (e.g. for proxies). */
  baseURL?: string;
  /** Default max tokens when options.maxTokens is omitted. Defaults to 4096. */
  defaultMaxTokens?: number;
  /** Pre-loaded pricing table (test/DI hook). When omitted, loadPricing() is called. */
  pricing?: PricingTable;
}

// ── Stop reason mapping ───────────────────────────────────────────────────────

type AnthropicStopReason = string | null | undefined;

function mapStopReason(raw: AnthropicStopReason): ChatResponse["stopReason"] {
  switch (raw) {
    case "end_turn":
      return "end_turn";
    case "stop_sequence":
      return "stop_sequence";
    case "max_tokens":
      return "max_tokens";
    case "tool_use":
      return "tool_use";
    case "error":
      return "error";
    default:
      return "unknown";
  }
}

// ── AnthropicProvider ─────────────────────────────────────────────────────────

export class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic" as const;

  private readonly client: Anthropic;
  private readonly defaultModel: string;
  private readonly defaultMaxTokens: number;
  private readonly pricing: PricingTable;

  constructor(opts: AnthropicProviderOptions) {
    // D-04 fallback chain: explicit → LLM_API_KEY → ANTHROPIC_API_KEY
    const apiKey = opts.apiKey ?? process.env.LLM_API_KEY ?? process.env.ANTHROPIC_API_KEY ?? "";

    if (!apiKey) {
      throw new Error(
        "AnthropicProvider: API key not provided. Pass { apiKey } or set LLM_API_KEY / ANTHROPIC_API_KEY."
      );
    }

    try {
      this.client = new Anthropic({ apiKey, baseURL: opts.baseURL });
    } catch (err) {
      throw new Error(
        `AnthropicProvider: @anthropic-ai/sdk unavailable — ${(err as Error).message}`
      );
    }

    this.defaultModel = opts.model ?? "claude-sonnet-4-6";
    this.defaultMaxTokens = opts.defaultMaxTokens ?? 4096;
    this.pricing = opts.pricing ?? loadPricing();
  }

  // ── chat() ────────────────────────────────────────────────────────────────

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse> {
    const model = options?.model ?? this.defaultModel;
    const maxTokens = options?.maxTokens ?? this.defaultMaxTokens;

    // Determine system prompt: explicit options.system takes precedence,
    // otherwise hoist leading role:"system" message
    // (Anthropic does NOT accept role:"system" in messages array)
    let system: string | undefined;
    let filteredMessages: ChatMessage[];

    if (options?.system !== undefined) {
      // Explicit system wins — do NOT hoist from messages
      system = options.system;
      filteredMessages = messages;
    } else {
      // Hoist leading role:"system" message if present
      const firstMessage = messages[0];
      if (firstMessage?.role === "system") {
        system = firstMessage.content;
        filteredMessages = messages.slice(1);
      } else {
        system = undefined;
        filteredMessages = messages;
      }
    }

    // Map to Anthropic SDK message shape (only user/assistant roles allowed)
    const sdkMessages: Anthropic.MessageParam[] = filteredMessages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));

    const response = await this.client.messages.create({
      model,
      max_tokens: maxTokens,
      messages: sdkMessages,
      ...(system !== undefined ? { system } : {}),
      ...(options?.temperature !== undefined ? { temperature: options.temperature } : {}),
      ...(options?.stopSequences !== undefined ? { stop_sequences: options.stopSequences } : {}),
    });

    // Concatenate text blocks from the response
    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");

    const usage: TokenUsage = {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      totalTokens: response.usage.input_tokens + response.usage.output_tokens,
    };

    return {
      text,
      usage,
      model: response.model,
      stopReason: mapStopReason(response.stop_reason),
    };
  }

  // ── embed() ───────────────────────────────────────────────────────────────

  async embed(_text: string): Promise<number[]> {
    throw new Error(
      "AnthropicProvider.embed() not supported by Anthropic SDK; use a separate embeddings provider"
    );
  }

  // ── estimateCost() ────────────────────────────────────────────────────────

  estimateCost(usage: TokenUsage, model?: string): EstimateCostResult {
    const requested = model ?? this.defaultModel;
    const { model: chosen, rate } = lookupRate(this.pricing, requested);
    const usd =
      (usage.inputTokens / 1000) * rate.input_usd_per_1k +
      (usage.outputTokens / 1000) * rate.output_usd_per_1k;
    return { usd, model: chosen };
  }
}
