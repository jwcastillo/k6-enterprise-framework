/**
 * Unit tests for BuilderAgent.
 * src/ai/agents/builder-agent.ts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Anthropic SDK
const mockCreate = vi.fn().mockResolvedValue({
  content: [
    {
      type: "text",
      text: `import http from "k6/http";
import { check } from "k6";
import { RequestHelper } from "../../src/helpers/request-helper";

// Options with VUs and duration
export const options = {
  vus: 10,
  duration: "30s",
  thresholds: {
    http_req_duration: ["p(95)<500"],
    http_req_failed: ["rate<0.01"],
  },
};

// Default function
export default function () {
  const helper = new RequestHelper(__ENV.BASE_URL);
  const res = helper.get("/api/users");
  check(res, { "status 200": (r) => r.status === 200 });
}`,
    },
  ],
  usage: { input_tokens: 1000, output_tokens: 500 },
});

vi.mock("@anthropic-ai/sdk", () => ({
  default: vi.fn().mockImplementation(function () {
    return { messages: { create: mockCreate } };
  }),
}));

// Mock chromadb
vi.mock("chromadb", () => ({
  ChromaClient: vi.fn().mockImplementation(function () {
    return {};
  }),
}));

// Mock knowledge base
vi.mock("../../src/ai/knowledge-base/knowledge-base", () => ({
  KnowledgeBaseManager: vi.fn().mockImplementation(function () {
    return {
      search: vi.fn().mockResolvedValue({
        query: "test",
        collection: "k6-framework-global",
        documents: [
          {
            id: "doc-1",
            content: 'import { RequestHelper } from "../../src/helpers/request-helper";',
            similarityScore: 0.9,
            metadata: { type: "script", path: "test.ts", description: "Example script" },
          },
        ],
        searchLatencyMs: 10,
        totalDocumentsInCollection: 5,
      }),
      searchWithClientContext: vi.fn().mockResolvedValue({
        query: "test",
        collection: "test+global",
        documents: [],
        searchLatencyMs: 10,
        totalDocumentsInCollection: 0,
      }),
    };
  }),
}));

import { BuilderAgent } from "../../src/ai/agents/builder-agent";
import { BudgetManager } from "../../src/ai/core/budget-manager";
import type { TestPlan } from "../../src/types/ai.d";

function makeTestPlan(overrides: Partial<TestPlan> = {}): TestPlan {
  return {
    id: "plan-001",
    name: "Test Plan",
    baseUrl: "http://localhost:3000",
    endpoints: [
      {
        url: "/api/users",
        method: "GET",
        expectedStatus: 200,
        _description: "List users",
        headers: {},
        tags: ["users"],
      },
    ],
    testTypes: ["load"],
    trafficModel: {
      executor: "ramping-vus",
      config: { stages: [{ duration: "1m", target: 10 }] },
      estimatedDurationSeconds: 60,
      thinkTimeSeconds: 1,
    },
    thresholds: {
      http_req_duration: ["p(95)<500"],
      http_req_failed: ["rate<0.01"],
    },
    dataRequirements: { csvFiles: [], factories: [] },
    authConfig: { type: "bearer", envVar: "AUTH_TOKEN" },
    source: "manual",
    metadata: {
      agentVersion: "1.0.0",
      generatedAt: new Date().toISOString(),
      tokensUsed: { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCostUsd: 0 },
      confidence: 0.9,
    },
    ...overrides,
  };
}

describe("BuilderAgent", () => {
  let agent: BuilderAgent;

  beforeEach(() => {
    vi.clearAllMocks();
    BudgetManager.resetPipelineCounters();
    agent = new BuilderAgent({
      apiKey: "test-key",
      budgetManager: new BudgetManager({ agentId: "builder" }),
    });
  });

  // ---------------------------------------------------------------------------
  // validate
  // ---------------------------------------------------------------------------
  describe("validate", () => {
    it("should pass for valid TestPlan", () => {
      const plan = makeTestPlan();
      const result = agent.validate(plan);
      expect(result.passed).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should fail when id is missing", () => {
      const plan = makeTestPlan({ id: "" });
      const result = agent.validate(plan);
      expect(result.passed).toBe(false);
      expect(result.errors.some((e) => e.code === "CHK-API-362-a")).toBe(true);
    });

    it("should fail when endpoints is empty", () => {
      const plan = makeTestPlan({ endpoints: [] });
      const result = agent.validate(plan);
      expect(result.passed).toBe(false);
      expect(result.errors.some((e) => e.code === "CHK-API-362-b")).toBe(true);
    });

    it("should fail when trafficModel is missing", () => {
      const plan = makeTestPlan({ trafficModel: undefined as any });
      const result = agent.validate(plan);
      expect(result.passed).toBe(false);
      expect(result.errors.some((e) => e.code === "CHK-API-362-c")).toBe(true);
    });

    it("should warn when baseUrl is not defined", () => {
      const plan = makeTestPlan({ baseUrl: "" });
      const result = agent.validate(plan);
      // baseUrl="" is falsy
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain("baseUrl");
    });

    it("should allow multiple validation errors", () => {
      const plan = makeTestPlan({
        id: "",
        endpoints: [],
        trafficModel: undefined as any,
      });
      const result = agent.validate(plan);
      expect(result.passed).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(3);
    });
  });

  // ---------------------------------------------------------------------------
  // execute
  // ---------------------------------------------------------------------------
  describe("execute", () => {
    it("should throw for invalid input", async () => {
      const plan = makeTestPlan({ id: "", endpoints: [] });
      await expect(agent.execute(plan)).rejects.toThrow("BuilderAgent input invalid");
    });

    it("should generate a GeneratedScript for valid input", async () => {
      const plan = makeTestPlan();
      const result = await agent.execute(plan);

      expect(result.id).toBeDefined();
      expect(result.files.length).toBeGreaterThan(0);
      expect(result.validationResult.passed).toBe(true);
      expect(result.metadata.agentVersion).toBe("1.0.0");
      expect(result.metadata.sourceTestPlan).toBe("plan-001");
    });

    it("should create script file with correct path", async () => {
      const plan = makeTestPlan({ name: "My Load Test" });
      const result = await agent.execute(plan);

      const scriptFile = result.files.find((f) => f.type === "script");
      expect(scriptFile).toBeDefined();
      expect(scriptFile!.path).toContain("my-load-test");
      expect(scriptFile!.language).toBe("typescript");
    });

    it("should set confidence based on self-healing cycles", async () => {
      const plan = makeTestPlan();
      const result = await agent.execute(plan);

      // If passed on first try (0 healing cycles), confidence = 0.9
      if (result.selfHealingCycles === 0) {
        expect(result.metadata.confidence).toBe(0.9);
      }
    });

    it("should detect hardcoded secrets in generated code (CHK-SEC-112)", async () => {
      // Mock LLM to return code with hardcoded password
      mockCreate.mockResolvedValueOnce({
        content: [
          {
            type: "text",
            text: `import http from "k6/http";
import { RequestHelper } from "../../src/helpers/request-helper";
export const options = { vus: 1, duration: "10s" };
export default function() {
  const password = 'my-super-secret-password';
  http.get("http://example.com");
}`,
          },
        ],
        usage: { input_tokens: 100, output_tokens: 50 },
      });
      // Subsequent calls return valid code for self-healing
      mockCreate.mockResolvedValue({
        content: [
          {
            type: "text",
            text: `import http from "k6/http";
import { RequestHelper } from "../../src/helpers/request-helper";
export const options = { vus: 1, duration: "10s" };
export default function() {
  http.get(__ENV.BASE_URL + "/api");
}`,
          },
        ],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const plan = makeTestPlan();
      const result = await agent.execute(plan);

      // The builder should self-heal: first attempt has secret, subsequent fixes it
      expect(result.selfHealingCycles).toBeGreaterThanOrEqual(1);
    });

    it("should detect Node.js imports in generated code", async () => {
      mockCreate.mockResolvedValueOnce({
        content: [
          {
            type: "text",
            text: `import http from "k6/http";
import fs from 'fs';
import { RequestHelper } from "../../src/helpers/request-helper";
export const options = { vus: 1, duration: "10s" };
export default function() {
  http.get(__ENV.BASE_URL);
}`,
          },
        ],
        usage: { input_tokens: 100, output_tokens: 50 },
      });
      // Fix on next attempt
      mockCreate.mockResolvedValue({
        content: [
          {
            type: "text",
            text: `import http from "k6/http";
import { RequestHelper } from "../../src/helpers/request-helper";
export const options = { vus: 1, duration: "10s" };
export default function() {
  http.get(__ENV.BASE_URL + "/api");
}`,
          },
        ],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const plan = makeTestPlan();
      const result = await agent.execute(plan);

      expect(result.selfHealingCycles).toBeGreaterThanOrEqual(1);
    });

    it("should throw EC-AI-007 when max self-healing cycles exceeded", async () => {
      // Always return invalid code (empty)
      mockCreate.mockResolvedValue({
        content: [{ type: "text", text: "x" }],
        usage: { input_tokens: 10, output_tokens: 5 },
      });

      const plan = makeTestPlan();
      await expect(agent.execute(plan)).rejects.toThrow("EC-AI-007");
    });

    it("should generate data files when TestPlan has csvFiles", async () => {
      // Reset to valid code
      mockCreate.mockResolvedValue({
        content: [
          {
            type: "text",
            text: `import http from "k6/http";
import { RequestHelper } from "../../src/helpers/request-helper";
export const options = { vus: 1, duration: "10s" };
export default function() {
  http.get(__ENV.BASE_URL + "/api");
}`,
          },
        ],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const plan = makeTestPlan({
        dataRequirements: {
          csvFiles: [
            {
              filename: "users.csv",
              columns: ["username", "password"],
              rowsNeeded: 10,
              _description: "Test users",
            },
          ],
          factories: [],
        },
      });

      const result = await agent.execute(plan);
      const dataFiles = result.files.filter((f) => f.type === "data");
      expect(dataFiles.length).toBeGreaterThan(0);
      expect(dataFiles[0].path).toContain("users.csv");
      expect(dataFiles[0].content).toContain("username,password");
    });

    it("should accumulate tokens across self-healing cycles", async () => {
      // Reset mock
      mockCreate.mockResolvedValue({
        content: [
          {
            type: "text",
            text: `import http from "k6/http";
import { RequestHelper } from "../../src/helpers/request-helper";
export const options = { vus: 1, duration: "10s" };
export default function() {
  http.get(__ENV.BASE_URL + "/api");
}`,
          },
        ],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const plan = makeTestPlan();
      const result = await agent.execute(plan);

      expect(result.metadata.tokensUsed.totalTokens).toBeGreaterThan(0);
    });

    it("should extract code from markdown blocks", async () => {
      mockCreate.mockResolvedValue({
        content: [
          {
            type: "text",
            text: `\`\`\`typescript
import http from "k6/http";
import { RequestHelper } from "../../src/helpers/request-helper";
export const options = { vus: 1, duration: "10s" };
export default function() {
  http.get(__ENV.BASE_URL + "/api");
}
\`\`\``,
          },
        ],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const plan = makeTestPlan();
      const result = await agent.execute(plan);

      expect(result.validationResult.passed).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // getConfig
  // ---------------------------------------------------------------------------
  describe("getConfig", () => {
    it("should return agent configuration", () => {
      const config = agent.getConfig();
      expect(config.agentId).toBe("builder");
      expect(config.model).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // name and version
  // ---------------------------------------------------------------------------
  describe("agent identity", () => {
    it("should have correct name and version", () => {
      expect(agent.name).toBe("builder-agent");
      expect(agent.version).toBe("1.0.0");
    });
  });
});
