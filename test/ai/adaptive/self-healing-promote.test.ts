/**
 * Phase 5 / AI-03 (D-13, D-14): test-pass-before-promote + retry cap.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as crypto from "crypto";

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

import { SelfHealingEngine } from "../../../src/ai/adaptive/self-healing";
import type { GeneratedScript } from "../../../src/types/ai.d";
import type { LLMProvider, ChatResponse } from "../../../src/ai/core/llm-provider";

const HEALED_CODE = `import http from "k6/http";
export default function () { http.get("https://example.com"); }
`;

function mockProvider(): LLMProvider {
  return {
    name: "mock" as const,
    chat: vi.fn(
      async (): Promise<ChatResponse> => ({
        text: HEALED_CODE,
        usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
        model: "mock-model",
        stopReason: "end_turn",
      })
    ),
    embed: vi.fn(),
    estimateCost: vi.fn(() => ({ usd: 0, model: "mock-model" })),
  };
}

function makeScript(p: string): GeneratedScript {
  return {
    id: crypto.randomUUID(),
    files: [{ path: p, type: "script", content: "old", language: "typescript" }],
    validationResult: { passed: true, errors: [], warnings: [] },
    selfHealingCycles: 0,
    metadata: {
      agentVersion: "test",
      generatedAt: new Date().toISOString(),
      confidence: 0.9,
      sourceTestPlan: "tp",
    },
  };
}

describe("SelfHealingEngine promote (AI-03 D-13, D-14)", () => {
  let srcPath: string;
  const origAutoApply = process.env.K6_AI_AUTO_APPLY;

  beforeEach(() => {
    srcPath = path.join(os.tmpdir(), `promote-${crypto.randomUUID()}.ts`);
    fs.writeFileSync(srcPath, "old", "utf8");
    process.env.K6_AI_AUTO_APPLY = "true"; // bypass gate so D-13 is exercised
  });

  afterEach(() => {
    if (fs.existsSync(srcPath)) fs.unlinkSync(srcPath);
    if (origAutoApply === undefined) delete process.env.K6_AI_AUTO_APPLY;
    else process.env.K6_AI_AUTO_APPLY = origAutoApply;
  });

  it("tests passing (exit 0) → fix copied to original path", async () => {
    const engine = new SelfHealingEngine({
      provider: mockProvider(),
      promote: "filesystem",
      testCommand: ["true"], // exits 0
    });
    const result = await engine.heal(makeScript(srcPath), "Status 400");
    expect(result.success).toBe(true);
    expect(fs.readFileSync(srcPath, "utf8")).toBe(HEALED_CODE.trim());
    expect(result.auditTrail.some((e) => e.action === "heal-promoted")).toBe(true);
  });

  it("tests failing (exit non-zero) → fix NOT copied; tmp preserved; audit logs tests-failed", async () => {
    const engine = new SelfHealingEngine({
      provider: mockProvider(),
      promote: "filesystem",
      testCommand: ["false"], // exits 1
    });
    const result = await engine.heal(makeScript(srcPath), "Status 400");
    expect(fs.readFileSync(srcPath, "utf8")).toBe("old");
    expect(result.auditTrail.some((e) => e.action === "heal-tests-failed")).toBe(true);
    expect(result.auditTrail.some((e) => e.action === "heal-promoted")).toBe(false);
  });

  it("retry cap: heal loop never runs more than MAX_RETRIES=3 attempts", async () => {
    // Build a provider whose chat() returns content failing validation
    // (no 'export default function') so validation never passes and the loop
    // exhausts all 3 attempts.
    const badProvider: LLMProvider = {
      name: "mock" as const,
      chat: vi.fn(
        async (): Promise<ChatResponse> => ({
          text: "// no export default function — will fail validation",
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          model: "mock",
          stopReason: "end_turn",
        })
      ),
      embed: vi.fn(),
      estimateCost: vi.fn(() => ({ usd: 0, model: "mock" })),
    };
    const engine = new SelfHealingEngine({
      provider: badProvider,
      promote: "filesystem",
      testCommand: ["true"],
    });
    const result = await engine.heal(makeScript(srcPath), "Status 400");
    expect(result.success).toBe(false);
    expect(result.attempts.length).toBeLessThanOrEqual(3);
    expect(result.auditTrail.some((e) => e.action === "heal-max-retries")).toBe(true);
  });
});
