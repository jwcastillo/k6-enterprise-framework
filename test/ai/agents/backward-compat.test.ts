/**
 * Phase 5 / AI-01 / D-25 invariant: every legacy agent constructor form
 * continues to work. DO NOT DELETE without phase replanning — this suite
 * encodes the backward-compat contract from 05-CONTEXT.md.
 *
 * - { apiKey } only construction (the historical form) still succeeds.
 * - LLM_API_KEY env var resolution still works.
 * - ANTHROPIC_API_KEY env var resolution still works.
 * - The internal provider defaults to AnthropicProvider when none is injected.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("chromadb", () => ({
  ChromaClient: vi.fn().mockImplementation(() => ({})),
  IncludeEnum: { Documents: "documents", Metadatas: "metadatas", Distances: "distances" },
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = {
      create: vi.fn().mockResolvedValue({
        content: [{ type: "text", text: "ok" }],
        usage: { input_tokens: 1, output_tokens: 1 },
        stop_reason: "end_turn",
        model: "claude-sonnet-4-6",
      }),
    };
    constructor(_: unknown) {}
  },
}));

import { PlannerAgent } from "../../../src/ai/agents/planner-agent";
import { BuilderAgent } from "../../../src/ai/agents/builder-agent";
import { AnalystAgent } from "../../../src/ai/agents/analyst-agent";
import { ReporterAgent } from "../../../src/ai/agents/reporter-agent";
import { AnthropicProvider } from "../../../src/ai/core/providers/anthropic-provider";

const agentClasses = [
  { name: "PlannerAgent", Cls: PlannerAgent },
  { name: "BuilderAgent", Cls: BuilderAgent },
  { name: "AnalystAgent", Cls: AnalystAgent },
  { name: "ReporterAgent", Cls: ReporterAgent },
] as const;

describe("Phase 5 / AI-01 / D-25 — agent backward-compat invariants", () => {
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
      it("constructs with apiKey only (historical D-25 form)", () => {
        expect(() => new Cls({ apiKey: "sk-test" })).not.toThrow();
      });

      it("constructs with no args when ANTHROPIC_API_KEY is set", () => {
        process.env.ANTHROPIC_API_KEY = "sk-from-env-anthropic";
        expect(() => new Cls()).not.toThrow();
      });

      it("constructs with no args when LLM_API_KEY is set", () => {
        process.env.LLM_API_KEY = "sk-from-env-llm";
        expect(() => new Cls()).not.toThrow();
      });

      it("default internal provider is AnthropicProvider with name='anthropic'", () => {
        const agent = new Cls({ apiKey: "sk-test" });
        const provider = (agent as unknown as { provider: { name: string } }).provider;
        expect(provider).toBeInstanceOf(AnthropicProvider);
        expect(provider.name).toBe("anthropic");
      });
    });
  }
});
