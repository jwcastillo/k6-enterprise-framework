/**
 * Phase 5 / AI-01 (D-03): Tests for OpenAIProvider stub.
 * Every method must throw the exact D-03 message.
 */

import { describe, it, expect } from "vitest";
import { OpenAIProvider } from "../../src/ai/core/providers/openai-provider.js";

const NOT_IMPLEMENTED = "OpenAIProvider not implemented for v0.3.0; use AnthropicProvider";

describe("OpenAIProvider stub", () => {
  it("constructs without throwing", () => {
    expect(() => new OpenAIProvider({ apiKey: "sk-x" })).not.toThrow();
  });

  it("name is 'openai'", () => {
    const provider = new OpenAIProvider({ apiKey: "sk-x" });
    expect(provider.name).toBe("openai");
  });

  it("chat() rejects with exact D-03 message", async () => {
    const provider = new OpenAIProvider({ apiKey: "sk-x" });
    await expect(
      provider.chat([{ role: "user", content: "hello" }])
    ).rejects.toThrow(NOT_IMPLEMENTED);
  });

  it("embed() rejects with exact D-03 message", async () => {
    const provider = new OpenAIProvider({ apiKey: "sk-x" });
    await expect(provider.embed("something")).rejects.toThrow(NOT_IMPLEMENTED);
  });

  it("estimateCost() throws with exact D-03 message", () => {
    const provider = new OpenAIProvider({ apiKey: "sk-x" });
    expect(() =>
      provider.estimateCost({ inputTokens: 100, outputTokens: 50, totalTokens: 150 })
    ).toThrow(NOT_IMPLEMENTED);
  });

  it("constructs with no apiKey (does not throw on construction)", () => {
    expect(() => new OpenAIProvider({})).not.toThrow();
  });
});
