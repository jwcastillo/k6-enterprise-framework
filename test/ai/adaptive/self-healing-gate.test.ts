/**
 * Phase 5 / AI-03 (D-12): gate precedence tests.
 *
 * Covers: K6_AI_AUTO_APPLY env → TTY prompt → neither.
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

describe("SelfHealingEngine gate precedence (AI-03 D-12)", () => {
  let srcPath: string;
  const origAutoApply = process.env.K6_AI_AUTO_APPLY;
  const origIsTTY = process.stdin.isTTY;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    srcPath = path.join(os.tmpdir(), `gate-${crypto.randomUUID()}.ts`);
    fs.writeFileSync(srcPath, "old", "utf8");
    delete process.env.K6_AI_AUTO_APPLY;
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    if (fs.existsSync(srcPath)) fs.unlinkSync(srcPath);
    if (origAutoApply === undefined) delete process.env.K6_AI_AUTO_APPLY;
    else process.env.K6_AI_AUTO_APPLY = origAutoApply;
    Object.defineProperty(process.stdin, "isTTY", { value: origIsTTY, configurable: true });
    warnSpy.mockRestore();
  });

  it("(1) K6_AI_AUTO_APPLY=true wins — logs auto-apply, returns apply", async () => {
    process.env.K6_AI_AUTO_APPLY = "true";
    const engine = new SelfHealingEngine({
      provider: mockProvider(),
      promote: "filesystem",
      testCommand: ["true"],
    });
    const result = await engine.heal(makeScript(srcPath), "Status 400");
    expect(result.success).toBe(true);
    expect(
      warnSpy.mock.calls.some((call) =>
        String(call[0] ?? "").includes("auto-applying fix (K6_AI_AUTO_APPLY=true)")
      )
    ).toBe(true);
  });

  it("(3) neither env nor TTY — logs 'fix proposed at' + does NOT modify source", async () => {
    const engine = new SelfHealingEngine({
      provider: mockProvider(),
      promote: "filesystem",
      testCommand: ["true"],
    });
    await engine.heal(makeScript(srcPath), "Status 400");
    expect(
      warnSpy.mock.calls.some((c) => String(c[0] ?? "").includes("fix proposed at"))
    ).toBe(true);
    expect(fs.readFileSync(srcPath, "utf8")).toBe("old");
  });

  it("(3) audit trail contains heal-gate-skipped when gate denies", async () => {
    const engine = new SelfHealingEngine({
      provider: mockProvider(),
      promote: "filesystem",
      testCommand: ["true"],
    });
    const result = await engine.heal(makeScript(srcPath), "Status 400");
    expect(result.auditTrail.some((e) => e.action === "heal-gate-skipped")).toBe(true);
  });
});
