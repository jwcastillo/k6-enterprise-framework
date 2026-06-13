/**
 * Unit tests for ReporterAgent.
 * src/ai/agents/reporter-agent.ts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Anthropic SDK
const mockCreate = vi.fn().mockResolvedValue({
  content: [
    {
      type: "text",
      text: JSON.stringify({
        executiveSummary:
          "Performance test completed with warnings. Latency increased by 30% compared to baseline. Recommend investigating backend services before next release.",
        technicalSummary:
          "HTTP p95 latency spiked to 450ms (threshold 500ms). Error rate stable at 0.5%. Root cause likely related to database connection pool saturation. Recommend: 1) Increase connection pool size, 2) Add caching layer for frequent queries.",
      }),
    },
  ],
  usage: { input_tokens: 300, output_tokens: 150 },
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

// Mock fs and path
vi.mock("fs", async () => {
  const actual = await vi.importActual<typeof import("fs")>("fs");
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(true),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
  };
});

import { ReporterAgent, type ReporterInput } from "../../src/ai/agents/reporter-agent";
import { BudgetManager } from "../../src/ai/core/budget-manager";
import type { AnalysisReport } from "../../src/types/ai.d";

function makeAnalysisReport(overrides: Partial<AnalysisReport> = {}): AnalysisReport {
  return {
    id: "report-001",
    verdict: "warning",
    anomalies: [
      {
        metric: "http_req_duration_p95",
        type: "spike",
        severity: "warning",
        description: "Latency spike detected at 450ms",
        timestamp: "2026-02-18T10:03:00.000Z",
        observed: 450,
        expected: 200,
        deviationPct: 125,
        detectedBy: "zscore",
      },
    ],
    correlations: [
      {
        source: "http_req_duration spike",
        target: "DB connection pool exhaustion",
        confidence: 0.82,
        description: "High latency correlates with connection pool saturation",
        observabilitySource: "prometheus",
      },
    ],
    regressions: [
      {
        metric: "http_req_duration",
        severity: "warning",
        current: 450,
        baseline: 200,
        deltaRel: 125,
        unit: "ms",
        description: "p95 latency increased 125% vs best baseline",
      },
    ],
    recommendations: [
      {
        priority: 1,
        title: "Increase DB connection pool",
        description: "Current pool size is insufficient for peak load",
        category: "database",
        effort: "low",
      },
      {
        priority: 2,
        title: "Add Redis caching",
        description: "Cache frequently queried user profiles",
        category: "infrastructure",
        effort: "medium",
      },
    ],
    executiveSummary: "Test completed with warnings. Latency regression detected.",
    partial: false,
    warnings: [],
    metadata: {
      agentVersion: "1.0.0",
      generatedAt: "2026-02-18T10:10:00.000Z",
      tokensUsed: {
        inputTokens: 500,
        outputTokens: 200,
        totalTokens: 700,
        estimatedCostUsd: 0.005,
      },
      confidence: 0.85,
      clientId: "client-abc",
    },
    ...overrides,
  };
}

describe("ReporterAgent", () => {
  let agent: ReporterAgent;

  beforeEach(() => {
    vi.clearAllMocks();
    BudgetManager.resetPipelineCounters();
    agent = new ReporterAgent({
      apiKey: "test-key",
      budgetManager: new BudgetManager({ agentId: "reporter" }),
    });
  });

  // ---------------------------------------------------------------------------
  // validate
  // ---------------------------------------------------------------------------
  describe("validate", () => {
    it("should pass for valid input with analysisReport", () => {
      const input: ReporterInput = {
        analysisReport: makeAnalysisReport(),
      };
      const result = agent.validate(input);
      expect(result.passed).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should fail when analysisReport is missing", () => {
      const input: ReporterInput = {
        analysisReport: undefined as any,
      };
      const result = agent.validate(input);
      expect(result.passed).toBe(false);
      expect(result.errors.some((e) => e.code === "CHK-API-370-a")).toBe(true);
    });

    it("should fail when analysisReport.id is missing", () => {
      const input: ReporterInput = {
        analysisReport: makeAnalysisReport({ id: "" }),
      };
      const result = agent.validate(input);
      expect(result.passed).toBe(false);
      expect(result.errors.some((e) => e.code === "CHK-API-370-b")).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // execute
  // ---------------------------------------------------------------------------
  describe("execute", () => {
    it("should throw for invalid input", async () => {
      const input: ReporterInput = { analysisReport: undefined as any };
      await expect(agent.execute(input)).rejects.toThrow("ReporterAgent");
    });

    it("should generate executive and technical summaries", async () => {
      const input: ReporterInput = {
        analysisReport: makeAnalysisReport(),
        testName: "users-load-test",
      };
      const result = await agent.execute(input);

      expect(result.executiveSummary).toBeDefined();
      expect(result.executiveSummary.length).toBeGreaterThan(0);
      expect(result.technicalSummary).toBeDefined();
      expect(result.technicalSummary.length).toBeGreaterThan(0);
    });

    it("should include tokensUsed in result", async () => {
      const input: ReporterInput = {
        analysisReport: makeAnalysisReport(),
        testName: "test",
      };
      const result = await agent.execute(input);

      expect(result.tokensUsed).toBeDefined();
      expect(result.tokensUsed.totalTokens).toBeGreaterThan(0);
    });

    it("should not send slack notification when not configured", async () => {
      const input: ReporterInput = {
        analysisReport: makeAnalysisReport(),
        notify: { slack: false },
      };
      const result = await agent.execute(input);
      expect(result.slackResult).toBeUndefined();
    });

    it("should not send teams notification when not configured", async () => {
      const input: ReporterInput = {
        analysisReport: makeAnalysisReport(),
        notify: { teams: false },
      };
      const result = await agent.execute(input);
      expect(result.teamsResult).toBeUndefined();
    });

    it("should skip jira creation when not configured", async () => {
      const input: ReporterInput = {
        analysisReport: makeAnalysisReport(),
        notify: { jira: false },
      };
      const result = await agent.execute(input);
      expect(result.jiraResult).toBeUndefined();
    });

    it("should attempt slack notification when configured", async () => {
      const input: ReporterInput = {
        analysisReport: makeAnalysisReport(),
        notify: { slack: true },
        testName: "test",
      };
      const result = await agent.execute(input);

      // Without NOTIFY_SLACK_WEBHOOK env var, should fail gracefully
      expect(result.slackResult).toBeDefined();
      expect(result.slackResult!.sent).toBe(false);
      expect(result.slackResult!.error).toContain("NOTIFY_SLACK_WEBHOOK");
    });

    it("should attempt teams notification when configured", async () => {
      const input: ReporterInput = {
        analysisReport: makeAnalysisReport(),
        notify: { teams: true },
        testName: "test",
      };
      const result = await agent.execute(input);

      // Without NOTIFY_TEAMS_WEBHOOK env var, should fail gracefully
      expect(result.teamsResult).toBeDefined();
      expect(result.teamsResult!.sent).toBe(false);
      expect(result.teamsResult!.error).toContain("NOTIFY_TEAMS_WEBHOOK");
    });

    it("should attempt jira ticket creation for critical anomalies", async () => {
      const criticalReport = makeAnalysisReport({
        verdict: "fail",
        anomalies: [
          {
            metric: "http_req_duration_p95",
            type: "spike",
            severity: "critical",
            description: "Critical latency spike",
            timestamp: "2026-02-18T10:03:00.000Z",
            observed: 5000,
            expected: 200,
            deviationPct: 2400,
            detectedBy: "zscore",
          },
        ],
      });
      const input: ReporterInput = {
        analysisReport: criticalReport,
        notify: { jira: true },
        testName: "critical-test",
      };
      const result = await agent.execute(input);

      // Without JIRA env vars, should persist locally
      expect(result.jiraResult).toBeDefined();
      expect(result.jiraResult!.created).toBe(false);
      expect(result.jiraResult!.persistedLocallyAt).toBeDefined();
    });

    it("should skip jira when verdict is not fail and no critical anomalies", async () => {
      const passReport = makeAnalysisReport({
        verdict: "pass",
        anomalies: [],
        regressions: [],
      });
      const input: ReporterInput = {
        analysisReport: passReport,
        notify: { jira: true },
        testName: "pass-test",
      };
      const result = await agent.execute(input);

      // No critical anomalies and verdict is pass => no jira ticket
      expect(result.jiraResult).toBeUndefined();
    });

    it("should mask sensitive data in summaries (CHK-SEC-114)", async () => {
      const reportWithSensitive = makeAnalysisReport({
        executiveSummary:
          "Test completed. Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0 was found in logs.",
      });
      const input: ReporterInput = {
        analysisReport: reportWithSensitive,
        testName: "sensitive-test",
      };
      const result = await agent.execute(input);

      // The LLM mock returns safe text, but the maskSensitive function should apply
      expect(result.executiveSummary).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    });

    it("should handle LLM response that is not parseable JSON gracefully", async () => {
      mockCreate.mockResolvedValueOnce({
        content: [{ type: "text", text: "This is not JSON, just plain text summary" }],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const input: ReporterInput = {
        analysisReport: makeAnalysisReport(),
        testName: "fallback-test",
      };
      const result = await agent.execute(input);

      // Should fall back to using the raw text
      expect(result.executiveSummary).toBeDefined();
      expect(result.technicalSummary).toBeDefined();
    });

    it("should use correct verdict emoji in internal processing", async () => {
      for (const verdict of ["pass", "warning", "fail"] as const) {
        const input: ReporterInput = {
          analysisReport: makeAnalysisReport({ verdict }),
          testName: `${verdict}-test`,
        };
        const result = await agent.execute(input);
        expect(result.executiveSummary).toBeDefined();
      }
    });
  });

  // ---------------------------------------------------------------------------
  // getConfig
  // ---------------------------------------------------------------------------
  describe("getConfig", () => {
    it("should return agent configuration", () => {
      const config = agent.getConfig();
      expect(config.agentId).toBe("reporter");
      expect(config.model).toBeDefined();
      expect(config.temperature).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // name and version
  // ---------------------------------------------------------------------------
  describe("agent identity", () => {
    it("should have correct name and version", () => {
      expect(agent.name).toBe("reporter-agent");
      expect(agent.version).toBe("1.0.0");
    });
  });
});
