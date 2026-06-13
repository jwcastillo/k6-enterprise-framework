/**
 * Phase 5 / AI-01: Contract tests for LLMProvider interface.
 * Verifies that a mock class satisfying LLMProvider compiles and behaves correctly.
 */

import { describe, it, expect } from "vitest";
import type {
  LLMProvider,
  ChatMessage,
  ChatOptions,
  ChatResponse,
  TokenUsage,
  EstimateCostResult,
} from "../../src/ai/core/llm-provider.js";

// Hand-rolled mock satisfying LLMProvider contract
class MockProvider implements LLMProvider {
  readonly name = "anthropic" as const;

  async chat(_messages: ChatMessage[], _options?: ChatOptions): Promise<ChatResponse> {
    return {
      text: "mock response",
      usage: {
        inputTokens: 10,
        outputTokens: 20,
        totalTokens: 30,
      },
      model: "mock-model",
      stopReason: "end_turn",
    };
  }

  async embed(_text: string): Promise<number[]> {
    return [0, 0, 0];
  }

  estimateCost(usage: TokenUsage, model?: string): EstimateCostResult {
    return { usd: 0, model: model ?? "mock-model" };
  }
}

describe("LLMProvider interface contract", () => {
  const mock: LLMProvider = new MockProvider();

  it("chat() resolves to ChatResponse with required fields", async () => {
    const result = await mock.chat([{ role: "user", content: "hi" }]);
    expect(result).toHaveProperty("text");
    expect(result).toHaveProperty("usage");
    expect(result).toHaveProperty("model");
    expect(result).toHaveProperty("stopReason");
    expect(typeof result.text).toBe("string");
    expect(typeof result.model).toBe("string");
  });

  it("chat() usage has inputTokens, outputTokens, totalTokens", async () => {
    const result = await mock.chat([{ role: "user", content: "hello" }]);
    expect(result.usage).toHaveProperty("inputTokens");
    expect(result.usage).toHaveProperty("outputTokens");
    expect(result.usage).toHaveProperty("totalTokens");
    expect(typeof result.usage.inputTokens).toBe("number");
    expect(typeof result.usage.outputTokens).toBe("number");
    expect(typeof result.usage.totalTokens).toBe("number");
  });

  it("chat() stopReason is a valid union value", async () => {
    const result = await mock.chat([{ role: "user", content: "test" }]);
    const validStopReasons = ["end_turn", "stop_sequence", "max_tokens", "tool_use", "error", "unknown"];
    expect(validStopReasons).toContain(result.stopReason);
  });

  it("embed() resolves to number[]", async () => {
    const result = await mock.embed("anything");
    expect(Array.isArray(result)).toBe(true);
    expect(result.every((n) => typeof n === "number")).toBe(true);
  });

  it("estimateCost() returns { usd, model }", () => {
    const usage: TokenUsage = { inputTokens: 1000, outputTokens: 500, totalTokens: 1500 };
    const result = mock.estimateCost(usage);
    expect(result).toHaveProperty("usd");
    expect(result).toHaveProperty("model");
    expect(typeof result.usd).toBe("number");
    expect(typeof result.model).toBe("string");
  });

  it("MockProvider is assignable to LLMProvider", () => {
    // If this compiles, the interface is satisfied
    const provider: LLMProvider = new MockProvider();
    expect(provider.name).toBe("anthropic");
  });

  it("chat() with system message in options", async () => {
    const result = await mock.chat(
      [{ role: "user", content: "test" }],
      { system: "Be helpful", maxTokens: 100 }
    );
    expect(result.text).toBeDefined();
  });
});
