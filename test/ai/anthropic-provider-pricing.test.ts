/**
 * Phase 5 / AI-02 (D-06..D-09): AnthropicProvider.estimateCost() wired to pricing.json.
 *
 * Validates:
 * - Default-model lookup matches pricing.json (sonnet rates).
 * - Per-model override (claude-opus-4-7).
 * - Unknown model falls back to default (D-08).
 * - env.LLM_INPUT_USD_PER_1K applies to default model only (D-07).
 * - DI hook: opts.pricing replaces the loaded JSON.
 *
 * Does NOT call the Anthropic SDK — the constructor mocks it.
 */

import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = { create: vi.fn() };
    constructor(_opts: unknown) {}
  },
}));

import { AnthropicProvider } from "../../src/ai/core/providers/anthropic-provider.js";
import type { PricingTable } from "../../src/ai/core/pricing.js";

describe("AnthropicProvider.estimateCost — pricing.json integration (AI-02)", () => {
  const savedInput = process.env.LLM_INPUT_USD_PER_1K;
  const savedOutput = process.env.LLM_OUTPUT_USD_PER_1K;

  afterEach(() => {
    if (savedInput === undefined) delete process.env.LLM_INPUT_USD_PER_1K;
    else process.env.LLM_INPUT_USD_PER_1K = savedInput;
    if (savedOutput === undefined) delete process.env.LLM_OUTPUT_USD_PER_1K;
    else process.env.LLM_OUTPUT_USD_PER_1K = savedOutput;
  });

  it("default-model lookup returns the JSON sonnet rate (0.003 + 0.015)", () => {
    delete process.env.LLM_INPUT_USD_PER_1K;
    delete process.env.LLM_OUTPUT_USD_PER_1K;
    const p = new AnthropicProvider({ apiKey: "sk-x" });
    const r = p.estimateCost({ inputTokens: 1000, outputTokens: 500, totalTokens: 1500 });
    // 1000/1000 * 0.003 + 500/1000 * 0.015 = 0.003 + 0.0075 = 0.0105
    expect(r.usd).toBeCloseTo(0.0105, 10);
    expect(r.model).toBe("claude-sonnet-4-6");
  });

  it("explicit claude-opus-4-7 model returns opus rate (0.015 + 0.075)", () => {
    delete process.env.LLM_INPUT_USD_PER_1K;
    delete process.env.LLM_OUTPUT_USD_PER_1K;
    const p = new AnthropicProvider({ apiKey: "sk-x" });
    const r = p.estimateCost(
      { inputTokens: 1000, outputTokens: 1000, totalTokens: 2000 },
      "claude-opus-4-7"
    );
    expect(r.usd).toBeCloseTo(0.09, 10);
    expect(r.model).toBe("claude-opus-4-7");
  });

  it("unknown model falls back to default rate AND default model name (D-08)", () => {
    delete process.env.LLM_INPUT_USD_PER_1K;
    delete process.env.LLM_OUTPUT_USD_PER_1K;
    const p = new AnthropicProvider({ apiKey: "sk-x" });
    const r = p.estimateCost(
      { inputTokens: 100, outputTokens: 100, totalTokens: 200 },
      "ghost-model"
    );
    // 100/1000 * 0.003 + 100/1000 * 0.015 = 0.0003 + 0.0015 = 0.0018
    expect(r.usd).toBeCloseTo(0.0018, 10);
    expect(r.model).toBe("claude-sonnet-4-6");
  });

  it("LLM_INPUT_USD_PER_1K env override applies to default model (D-07)", () => {
    process.env.LLM_INPUT_USD_PER_1K = "0.002";
    delete process.env.LLM_OUTPUT_USD_PER_1K;
    const p = new AnthropicProvider({ apiKey: "sk-x" });
    const r = p.estimateCost({ inputTokens: 1000, outputTokens: 0, totalTokens: 1000 });
    expect(r.usd).toBeCloseTo(0.002, 10);
    expect(r.model).toBe("claude-sonnet-4-6");
  });

  it("opts.pricing DI hook replaces the loaded JSON entirely", () => {
    const custom: PricingTable = {
      default: "custom",
      models: { custom: { input_usd_per_1k: 99, output_usd_per_1k: 1 } },
    };
    const p = new AnthropicProvider({ apiKey: "sk-x", pricing: custom });
    const r = p.estimateCost({ inputTokens: 1000, outputTokens: 1000, totalTokens: 2000 });
    // 1k * 99 + 1k * 1 = 99 + 1 = 100
    expect(r.usd).toBeCloseTo(100, 10);
    expect(r.model).toBe("custom");
  });
});
