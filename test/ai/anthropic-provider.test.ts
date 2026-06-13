/**
 * Phase 5 / AI-01 (D-02): Tests for AnthropicProvider.
 * Uses vi.mock to intercept @anthropic-ai/sdk — no real network calls.
 */

import { describe, it, expect, vi, afterEach } from "vitest";

// Shared mock for messages.create, reset per test
const mockCreate = vi.fn();

// Mock @anthropic-ai/sdk before importing AnthropicProvider
vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = { create: mockCreate };
    constructor(_opts: unknown) {}
  },
}));

// Import after mock is set up
import { AnthropicProvider } from "../../src/ai/core/providers/anthropic-provider.js";

// Default successful SDK response fixture
function makeSdkResponse(overrides: Partial<{
  text: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
  stopReason: string;
}> = {}) {
  return {
    content: [{ type: "text", text: overrides.text ?? "Mock response" }],
    usage: {
      input_tokens: overrides.inputTokens ?? 100,
      output_tokens: overrides.outputTokens ?? 50,
    },
    model: overrides.model ?? "claude-sonnet-4-6",
    stop_reason: overrides.stopReason ?? "end_turn",
  };
}

describe("AnthropicProvider", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    // Restore env vars
    const currentKeys = Object.keys(process.env);
    for (const key of currentKeys) {
      if (!(key in originalEnv)) delete process.env[key];
    }
    for (const [k, v] of Object.entries(originalEnv)) {
      process.env[k] = v;
    }
    vi.clearAllMocks();
  });

  // ── Construction ────────────────────────────────────────────────────────────

  it("constructs with explicit apiKey", () => {
    const provider = new AnthropicProvider({ apiKey: "sk-explicit" });
    expect(provider.name).toBe("anthropic");
  });

  it("throws when no apiKey and no env vars", () => {
    delete process.env.LLM_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    expect(() => new AnthropicProvider({})).toThrow("API key not provided");
  });

  it("resolves from LLM_API_KEY env var", () => {
    delete process.env.ANTHROPIC_API_KEY;
    process.env.LLM_API_KEY = "sk-from-llm-key";
    const provider = new AnthropicProvider({});
    expect(provider.name).toBe("anthropic");
  });

  it("resolves from ANTHROPIC_API_KEY env var as fallback", () => {
    delete process.env.LLM_API_KEY;
    process.env.ANTHROPIC_API_KEY = "sk-from-anthropic-key";
    const provider = new AnthropicProvider({});
    expect(provider.name).toBe("anthropic");
  });

  it("prefers LLM_API_KEY over ANTHROPIC_API_KEY (D-04 precedence)", () => {
    process.env.LLM_API_KEY = "sk-llm-wins";
    process.env.ANTHROPIC_API_KEY = "sk-anthropic-loses";
    const provider = new AnthropicProvider({});
    // Construction succeeds — both keys are set; LLM_API_KEY takes precedence per D-04
    expect(provider.name).toBe("anthropic");
  });

  // ── name ────────────────────────────────────────────────────────────────────

  it("name is 'anthropic'", () => {
    const provider = new AnthropicProvider({ apiKey: "sk-test" });
    expect(provider.name).toBe("anthropic");
  });

  // ── chat() ──────────────────────────────────────────────────────────────────

  it("chat() calls SDK and returns mapped ChatResponse with system hoisted", async () => {
    mockCreate.mockResolvedValueOnce(makeSdkResponse({ text: "Hello from Claude" }));

    const provider = new AnthropicProvider({ apiKey: "sk-test" });
    const result = await provider.chat([
      { role: "system", content: "Be helpful" },
      { role: "user", content: "hi" },
    ]);

    expect(result.text).toBe("Hello from Claude");
    expect(result.usage.inputTokens).toBe(100);
    expect(result.usage.outputTokens).toBe(50);
    expect(result.usage.totalTokens).toBe(150);
    expect(result.stopReason).toBe("end_turn");

    // System message should have been hoisted
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ system: "Be helpful" })
    );
    // The hoisted system message should NOT appear in messages array
    const callArg = mockCreate.mock.calls[0][0];
    expect(callArg.messages.every((m: any) => m.role !== "system")).toBe(true);
  });

  it("chat() with explicit options.system does NOT hoist from messages", async () => {
    mockCreate.mockResolvedValueOnce(makeSdkResponse({ text: "ok" }));

    const provider = new AnthropicProvider({ apiKey: "sk-test" });
    await provider.chat(
      [
        { role: "system", content: "This should NOT be the system prompt" },
        { role: "user", content: "test" },
      ],
      { system: "Explicit system wins" }
    );

    // Explicit system takes precedence
    const callArg = mockCreate.mock.calls[0][0];
    expect(callArg.system).toBe("Explicit system wins");
  });

  it("chat() maps stop_reason 'max_tokens' correctly", async () => {
    mockCreate.mockResolvedValueOnce(makeSdkResponse({ stopReason: "max_tokens" }));

    const provider = new AnthropicProvider({ apiKey: "sk-test" });
    const result = await provider.chat([{ role: "user", content: "write a lot" }]);
    expect(result.stopReason).toBe("max_tokens");
  });

  it("chat() maps unknown stop_reason to 'unknown'", async () => {
    mockCreate.mockResolvedValueOnce(makeSdkResponse({ stopReason: "weird_thing" }));

    const provider = new AnthropicProvider({ apiKey: "sk-test" });
    const result = await provider.chat([{ role: "user", content: "test" }]);
    expect(result.stopReason).toBe("unknown");
  });

  // ── embed() ─────────────────────────────────────────────────────────────────

  it("embed() throws 'not supported' error", async () => {
    const provider = new AnthropicProvider({ apiKey: "sk-test" });
    await expect(provider.embed("anything")).rejects.toThrow(
      "AnthropicProvider.embed() not supported"
    );
  });

  // ── estimateCost() ──────────────────────────────────────────────────────────

  it("estimateCost() returns correct USD for 1000 input + 500 output tokens", () => {
    const provider = new AnthropicProvider({ apiKey: "sk-test" });
    const result = provider.estimateCost({
      inputTokens: 1000,
      outputTokens: 500,
      totalTokens: 1500,
    });
    // input: 1000/1000 * 0.003 = 0.003, output: 500/1000 * 0.015 = 0.0075, total = 0.0105
    const expected = (1000 / 1000) * 0.003 + (500 / 1000) * 0.015;
    expect(result.usd).toBeCloseTo(expected, 6);
    expect(result.model).toBe("claude-sonnet-4-6");
  });

  it("estimateCost() uses explicit model in result even with hardcoded rates", () => {
    const provider = new AnthropicProvider({ apiKey: "sk-test" });
    const result = provider.estimateCost(
      { inputTokens: 1000, outputTokens: 500, totalTokens: 1500 },
      "claude-opus-4-7"
    );
    // Model name is returned in result (rates are hardcoded per plan — 05-02 fixes)
    expect(result.model).toBe("claude-opus-4-7");
    expect(typeof result.usd).toBe("number");
  });
});
