/**
 * Phase 5 / AI-03 (D-10, D-15): self-healing sandbox tests.
 *
 * Verifies fixes land in os.tmpdir()/k6-self-healing/<uuid>/ and do NOT
 * mutate the source path when the gate decides to skip.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as crypto from "crypto";

// Mock the optional chromadb peer dep so self-healing's transitive imports resolve
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
export default function () {
  http.get("https://example.com");
}
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

function makeScript(sourcePath: string): GeneratedScript {
  return {
    id: crypto.randomUUID(),
    files: [
      {
        path: sourcePath,
        type: "script",
        content: 'console.log("old code");',
        language: "typescript",
      },
    ],
    validationResult: { passed: true, errors: [], warnings: [] },
    selfHealingCycles: 0,
    metadata: {
      agentVersion: "test",
      generatedAt: new Date().toISOString(),
      confidence: 0.9,
      sourceTestPlan: "test-plan-id",
    },
  };
}

describe("SelfHealingEngine sandbox (AI-03 D-10, D-15)", () => {
  let srcPath: string;
  const origAutoApply = process.env.K6_AI_AUTO_APPLY;

  beforeEach(() => {
    srcPath = path.join(os.tmpdir(), `selfheal-src-${crypto.randomUUID()}.ts`);
    fs.writeFileSync(srcPath, 'console.log("old code");', "utf8");
    delete process.env.K6_AI_AUTO_APPLY;
  });

  afterEach(() => {
    if (fs.existsSync(srcPath)) fs.unlinkSync(srcPath);
    if (origAutoApply === undefined) delete process.env.K6_AI_AUTO_APPLY;
    else process.env.K6_AI_AUTO_APPLY = origAutoApply;
  });

  it("with promote='filesystem' and gate skipping, original source is unchanged", async () => {
    const engine = new SelfHealingEngine({
      provider: mockProvider(),
      promote: "filesystem",
      testCommand: ["true"],
    });
    const script = makeScript(srcPath);
    await engine.heal(script, "Status 400 — http-400-validation");

    const after = fs.readFileSync(srcPath, "utf8");
    expect(after).toBe('console.log("old code");');
  });

  it("uses os.tmpdir()/k6-self-healing as default base directory", async () => {
    const engine = new SelfHealingEngine({
      provider: mockProvider(),
      promote: "filesystem",
      testCommand: ["true"],
    });
    // Force the constructor to materialize the tmpDir.
    const tmpDir = (engine as unknown as { tmpDir: string }).tmpDir;
    expect(tmpDir).toBe(path.join(os.tmpdir(), "k6-self-healing"));
  });

  it("with K6_AI_AUTO_APPLY=true + passing tests, copies fix to original path", async () => {
    process.env.K6_AI_AUTO_APPLY = "true";
    const engine = new SelfHealingEngine({
      provider: mockProvider(),
      promote: "filesystem",
      testCommand: ["true"], // always exits 0
    });
    const script = makeScript(srcPath);
    const result = await engine.heal(script, "Status 400 — http-400-validation");

    expect(result.success).toBe(true);
    const after = fs.readFileSync(srcPath, "utf8");
    // requestHeal()'s markdown-extract step trims the response;
    // so HEALED_CODE.trim() is what actually lands on disk.
    expect(after).toBe(HEALED_CODE.trim());
    expect(result.auditTrail.some((e) => e.action === "heal-promoted")).toBe(true);
  });

  it("default promote='in-memory' does NOT touch the filesystem", async () => {
    const engine = new SelfHealingEngine({
      provider: mockProvider(),
      // no promote → defaults to "in-memory"
    });
    const script = makeScript(srcPath);
    const result = await engine.heal(script, "Status 400 — http-400-validation");

    expect(result.success).toBe(true);
    const after = fs.readFileSync(srcPath, "utf8");
    expect(after).toBe('console.log("old code");'); // unchanged
  });
});
