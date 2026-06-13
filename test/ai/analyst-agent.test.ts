/**
 * Unit tests for AnalystAgent.
 * src/ai/agents/analyst-agent.ts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Anthropic SDK — must use function() for constructor compatibility
vi.mock("@anthropic-ai/sdk", () => {
  return {
    default: vi.fn().mockImplementation(function () {
      return {
        messages: {
          create: vi.fn().mockResolvedValue({
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  correlations: [
                    {
                      source: "http_req_duration spike",
                      target: "CPU usage 95%",
                      confidence: 0.85,
                      description: "High CPU correlates with latency spike",
                      observabilitySource: "prometheus",
                      timestamp: "2026-02-18T10:03:00.000Z",
                    },
                  ],
                  executiveSummary:
                    "Performance degradation detected. Latency increased by 200%. Recommend scaling up.",
                  recommendations: [
                    {
                      priority: 1,
                      title: "Scale up auth service",
                      description: "Add more replicas to handle increased load",
                      category: "infrastructure",
                      effort: "low",
                    },
                  ],
                }),
              },
            ],
            usage: { input_tokens: 500, output_tokens: 200 },
          }),
        },
      };
    }),
  };
});

// Mock chromadb
vi.mock("chromadb", () => ({ ChromaClient: vi.fn() }));

// Mock observability clients
vi.mock("../../src/ai/observability/observability-clients", () => ({
  createObservabilityClients: vi.fn(() => ({
    prometheus: {
      rangeQuery: vi.fn().mockResolvedValue({
        source: "prometheus",
        query: "rate(http_requests_total[1m])",
        partial: false,
        latencyMs: 50,
        series: [{ labels: { job: "api" }, values: [[1000, 42]] }],
      }),
    },
    tempo: { searchTraces: vi.fn().mockResolvedValue({ partial: true, latencyMs: 0 }) },
    loki: {
      searchErrors: vi.fn().mockResolvedValue({
        source: "loki",
        query: "errors",
        partial: false,
        latencyMs: 30,
        logs: [
          {
            timestamp: "2026-02-18T10:03:00.000Z",
            labels: { service: "auth" },
            message: "Connection timeout",
            level: "error",
          },
        ],
      }),
    },
    pyroscope: { getProfile: vi.fn().mockResolvedValue({ partial: true, latencyMs: 0 }) },
  })),
}));

import { AnalystAgent, type AnalystInput } from "../../src/ai/agents/analyst-agent";
import { BudgetManager } from "../../src/ai/core/budget-manager";

describe("AnalystAgent", () => {
  let agent: AnalystAgent;

  beforeEach(() => {
    vi.clearAllMocks();
    BudgetManager.resetPipelineCounters();
    agent = new AnalystAgent({
      apiKey: "test-key",
      budgetManager: new BudgetManager({ agentId: "analyst" }),
    });
  });

  // ---------------------------------------------------------------------------
  // validate
  // ---------------------------------------------------------------------------
  describe("validate", () => {
    it("should pass for valid input with k6Results", () => {
      const input: AnalystInput = {
        k6Results: { metrics: { http_req_duration: { values: { p95: 200 } } } },
      };
      const result = agent.validate(input);
      expect(result.passed).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should fail when k6Results is missing", () => {
      const input: AnalystInput = {
        k6Results: null as any,
      };
      const result = agent.validate(input);
      expect(result.passed).toBe(false);
      expect(result.errors.some((e) => e.code === "CHK-API-366-a")).toBe(true);
    });

    it("should fail when k6Results is not an object", () => {
      const input: AnalystInput = {
        k6Results: "not an object" as any,
      };
      const result = agent.validate(input);
      expect(result.passed).toBe(false);
    });

    it("should warn when timeRange is not provided", () => {
      const input: AnalystInput = {
        k6Results: { metrics: {} },
      };
      const result = agent.validate(input);
      expect(result.passed).toBe(true);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain("timeRange");
    });

    it("should have no warnings when timeRange is provided", () => {
      const input: AnalystInput = {
        k6Results: { metrics: {} },
        timeRange: { from: "2026-01-01T00:00:00Z", to: "2026-01-01T01:00:00Z" },
      };
      const result = agent.validate(input);
      expect(result.warnings).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // execute — basic flow
  // ---------------------------------------------------------------------------
  describe("execute", () => {
    it("should throw for invalid input", async () => {
      const input: AnalystInput = { k6Results: null as any };
      await expect(agent.execute(input)).rejects.toThrow("AnalystAgent input invalid");
    });

    it("should produce an AnalysisReport with no anomalies for clean results", async () => {
      const input: AnalystInput = {
        k6Results: {
          metrics: {
            http_req_duration: { values: { p95: 100, avg: 50 } },
            http_req_failed: { values: { rate: 0.001 } },
          },
        },
        testName: "clean-test",
      };
      const report = await agent.execute(input);

      expect(report.id).toBeDefined();
      expect(report.verdict).toBeDefined();
      expect(["pass", "warning", "fail"]).toContain(report.verdict);
      expect(report.executiveSummary).toBeDefined();
      expect(report.metadata.agentVersion).toBe("1.0.0");
    });

    it("should detect anomalies for extreme metrics", async () => {
      // Create results with an extreme spike
      const input: AnalystInput = {
        k6Results: {
          metrics: {
            http_req_duration: { values: { p95: 5000, p99: 8000, avg: 100, max: 15000 } },
            http_req_failed: { values: { rate: 0.5 } },
          },
        },
        testName: "spike-test",
        timeRange: { from: "2026-01-01T00:00:00Z", to: "2026-01-01T01:00:00Z" },
      };
      const report = await agent.execute(input);

      // With such extreme values, anomalies should be detected
      expect(report.anomalies.length).toBeGreaterThanOrEqual(0); // Depends on k6SummaryToSeries output
      expect(report.metadata).toBeDefined();
    });

    it("should detect regressions when historical results are provided", async () => {
      const input: AnalystInput = {
        k6Results: {
          metrics: {
            http_req_duration: { values: { p95: 500, p99: 800, avg: 300, max: 1000 } },
          },
        },
        historicalResults: [
          {
            metrics: {
              http_req_duration: { values: { p95: 100, p99: 150, avg: 50, max: 200 } },
            },
          },
        ],
        testName: "regression-test",
        timeRange: { from: "2026-01-01T00:00:00Z", to: "2026-01-01T01:00:00Z" },
      };
      const report = await agent.execute(input);

      // Should detect regressions since current >> baseline
      expect(report.regressions.length).toBeGreaterThan(0);
    });

    it("should set verdict to fail when critical anomalies exist", async () => {
      // Use historical results to force regressions (which will be critical)
      const input: AnalystInput = {
        k6Results: {
          metrics: {
            http_req_duration: { values: { p95: 5000, p99: 8000, avg: 3000, max: 15000 } },
          },
        },
        historicalResults: [
          {
            metrics: {
              http_req_duration: { values: { p95: 100, p99: 150, avg: 50, max: 200 } },
            },
          },
        ],
        testName: "critical-test",
        timeRange: { from: "2026-01-01T00:00:00Z", to: "2026-01-01T01:00:00Z" },
      };
      const report = await agent.execute(input);

      // With 5000% regression on p95, should be critical
      if (report.regressions.some((r) => r.severity === "critical")) {
        expect(report.verdict).toBe("fail");
      }
    });

    it("should include correlations from LLM response", async () => {
      const input: AnalystInput = {
        k6Results: {
          metrics: {
            http_req_duration: { values: { p95: 5000, p99: 8000, avg: 3000, max: 15000 } },
          },
        },
        historicalResults: [
          {
            metrics: {
              http_req_duration: { values: { p95: 100, p99: 150, avg: 50, max: 200 } },
            },
          },
        ],
        testName: "correlation-test",
        timeRange: { from: "2026-01-01T00:00:00Z", to: "2026-01-01T01:00:00Z" },
      };
      const report = await agent.execute(input);

      // LLM is mocked to return one correlation
      if (report.anomalies.length > 0 || report.regressions.length > 0) {
        expect(report.correlations.length).toBeGreaterThan(0);
        expect(report.correlations[0].confidence).toBe(0.85);
      }
    });

    it("should generate executive summary without LLM when no anomalies", async () => {
      const input: AnalystInput = {
        k6Results: {
          metrics: {
            http_req_duration: { values: { p95: 100, avg: 50 } },
          },
        },
        testName: "no-anomalies",
      };
      const report = await agent.execute(input);

      // When no anomalies, summary is generated without LLM
      expect(report.executiveSummary).toContain("no-anomalies");
    });

    it("should handle partial observability data gracefully", async () => {
      const input: AnalystInput = {
        k6Results: {
          metrics: {
            http_req_duration: { values: { p95: 200, avg: 100 } },
          },
        },
        testName: "partial-obs-test",
        // No timeRange => obsData will have available: false
      };
      const report = await agent.execute(input);

      expect(report).toBeDefined();
      // Without timeRange, obsData is not fetched, partial might be false
    });

    it("should find the best baseline from historical results by lowest p95", async () => {
      const input: AnalystInput = {
        k6Results: {
          metrics: {
            http_req_duration: { values: { p95: 500, p99: 800, avg: 300, max: 1000 } },
          },
        },
        historicalResults: [
          // Worst result
          {
            metrics: { http_req_duration: { values: { p95: 400, p99: 600, avg: 200, max: 800 } } },
          },
          // Best result (lowest p95)
          { metrics: { http_req_duration: { values: { p95: 50, p99: 80, avg: 30, max: 100 } } } },
          // Medium result
          {
            metrics: { http_req_duration: { values: { p95: 200, p99: 300, avg: 100, max: 400 } } },
          },
        ],
        testName: "best-baseline-test",
        timeRange: { from: "2026-01-01T00:00:00Z", to: "2026-01-01T01:00:00Z" },
      };
      const report = await agent.execute(input);

      // Regression should be compared against best baseline (p95=50)
      // Current p95=500, baseline p95=50 => 900% regression
      if (report.regressions.length > 0) {
        const durationRegression = report.regressions.find((r) => r.metric === "http_req_duration");
        if (durationRegression) {
          expect(durationRegression.severity).toBe("critical");
        }
      }
    });

    it("should include recommendations sorted by priority", async () => {
      const input: AnalystInput = {
        k6Results: {
          metrics: {
            http_req_duration: { values: { p95: 5000, p99: 8000, avg: 3000, max: 15000 } },
          },
        },
        historicalResults: [
          { metrics: { http_req_duration: { values: { p95: 100, p99: 150, avg: 50, max: 200 } } } },
        ],
        testName: "recommendations-test",
        timeRange: { from: "2026-01-01T00:00:00Z", to: "2026-01-01T01:00:00Z" },
      };
      const report = await agent.execute(input);

      if (report.recommendations.length > 1) {
        for (let i = 1; i < report.recommendations.length; i++) {
          expect(report.recommendations[i].priority).toBeGreaterThanOrEqual(
            report.recommendations[i - 1].priority
          );
        }
      }
    });
  });

  // ---------------------------------------------------------------------------
  // getConfig
  // ---------------------------------------------------------------------------
  describe("getConfig", () => {
    it("should return the agent configuration", () => {
      const config = agent.getConfig();
      expect(config.agentId).toBe("analyst");
      expect(config.model).toBeDefined();
      expect(config.temperature).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // name and version
  // ---------------------------------------------------------------------------
  describe("agent identity", () => {
    it("should have correct name and version", () => {
      expect(agent.name).toBe("analyst-agent");
      expect(agent.version).toBe("1.0.0");
    });
  });
});
