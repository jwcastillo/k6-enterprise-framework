/**
 * Phase 5 / AI-01 (D-04, D-05): provider injection for all four agents.
 *
 * Asserts each agent's options.provider is honored:
 * - Construction succeeds without env vars / apiKey when a provider is supplied.
 * - The agent stores the injected provider (no AnthropicProvider fallback).
 * - When BOTH provider and apiKey are passed, provider wins (D-04 + D-05).
 *
 * Mock providers are hand-rolled per CONTEXT D-26 — no real LLM calls.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("chromadb", () => ({
  ChromaClient: vi.fn().mockImplementation(() => ({})),
  IncludeEnum: { Documents: "documents", Metadatas: "metadatas", Distances: "distances" },
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = { create: vi.fn() };
    constructor(_: unknown) {}
  },
}));

import { PlannerAgent } from "../../../src/ai/agents/planner-agent";
import { BuilderAgent } from "../../../src/ai/agents/builder-agent";
import { AnalystAgent } from "../../../src/ai/agents/analyst-agent";
import { ReporterAgent } from "../../../src/ai/agents/reporter-agent";
import type { LLMProvider, ChatResponse } from "../../../src/ai/core/llm-provider";

function makeMockProvider(): LLMProvider {
  return {
    name: "mock" as const,
    chat: vi.fn(
      async (): Promise<ChatResponse> => ({
        text: "mock response",
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        model: "mock-model",
        stopReason: "end_turn",
      })
    ),
    embed: vi.fn(),
    estimateCost: vi.fn(() => ({ usd: 0.001, model: "mock-model" })),
  };
}

const agentClasses = [
  { name: "PlannerAgent", Cls: PlannerAgent },
  { name: "BuilderAgent", Cls: BuilderAgent },
  { name: "AnalystAgent", Cls: AnalystAgent },
  { name: "ReporterAgent", Cls: ReporterAgent },
] as const;

describe("Phase 5 / AI-01 — provider injection (all four agents)", () => {
  const savedLlm = process.env.LLM_API_KEY;
  const savedAnthropic = process.env.ANTHROPIC_API_KEY;

  beforeEach(() => {
    delete process.env.LLM_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
  });

  afterEach(() => {
    if (savedLlm === undefined) delete process.env.LLM_API_KEY;
    else process.env.LLM_API_KEY = savedLlm;
    if (savedAnthropic === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = savedAnthropic;
  });

  for (const { name, Cls } of agentClasses) {
    describe(name, () => {
      it("accepts injection without env/apiKey", () => {
        const provider = makeMockProvider();
        expect(() => new Cls({ provider })).not.toThrow();
      });

      it("stores the injected provider instance verbatim", () => {
        const provider = makeMockProvider();
        const agent = new Cls({ provider });
        const stored = (agent as unknown as { provider: LLMProvider }).provider;
        expect(stored).toBe(provider);
        expect(stored.name).toBe("mock");
      });

      it("provider wins over apiKey when both are passed (D-05)", () => {
        const provider = makeMockProvider();
        const agent = new Cls({ provider, apiKey: "sk-ignored" });
        const stored = (agent as unknown as { provider: LLMProvider }).provider;
        expect(stored).toBe(provider);
      });
    });
  }
});
