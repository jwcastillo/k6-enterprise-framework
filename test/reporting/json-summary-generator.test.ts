import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock the execution engine
vi.mock("../../src/core/execution-engine", () => ({
  buildExecutionSummary: vi.fn((_data: unknown, context: Record<string, unknown>) => ({
    testName: context.testName ?? "test-scenario",
    client: context.client ?? "test-client",
    environment: context.environment ?? "staging",
    profile: context.profile ?? "smoke",
    startTime: "2026-01-15T10:00:00.000Z",
    endTime: "2026-01-15T10:05:00.000Z",
    durationMs: 300000,
    vus: 50,
    iterations: 1000,
    iterationsFailed: 0,
    httpRequests: 5000,
    httpRequestsFailed: 10,
    httpDuration: {
      avg: 150, min: 20, med: 120, max: 3000, p90: 350, p95: 500, p99: 1200,
    },
    checks: [{ name: "all checks", passes: 4990, fails: 10, passRate: 0.998 }],
    thresholds: [{ metric: "http_req_duration", condition: "p(95)<500", passed: true, value: 480 }],
    passed: true,
    tags: { client: "test-client", environment: "staging" },
  })),
}));

import { generateJsonSummary } from "../../src/reporting/json-summary-generator";
import type { ExecutionContext } from "../../src/core/execution-engine";
import type { MetricsReport } from "../../src/metrics/types";

// ── Fixtures ────────────────────────────────────────────────────────────────

function makeContext(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    testName: "test-scenario",
    client: "test-client",
    environment: "staging",
    profile: "smoke",
    startTime: "2026-01-15T10:00:00.000Z",
    tags: { client: "test-client", environment: "staging" },
    ...overrides,
  };
}

function makeK6Data(): Record<string, unknown> {
  return {
    metrics: {
      http_req_duration: {
        values: { avg: 150, min: 20, med: 120, max: 3000, "p(90)": 350, "p(95)": 500, "p(99)": 1200 },
      },
      http_reqs: { values: { count: 5000, rate: 16.67 } },
    },
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("generateJsonSummary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns an object keyed by the output path", () => {
    const result = generateJsonSummary(makeK6Data(), makeContext(), "./reports/summary.json");
    expect(result).toHaveProperty("./reports/summary.json");
    expect(typeof result["./reports/summary.json"]).toBe("string");
  });

  it("generates valid JSON content", () => {
    const result = generateJsonSummary(makeK6Data(), makeContext(), "summary.json");
    const parsed = JSON.parse(result["summary.json"]);
    expect(parsed).toBeDefined();
    expect(typeof parsed).toBe("object");
  });

  it("includes schema version and $schema reference", () => {
    const result = generateJsonSummary(makeK6Data(), makeContext(), "s.json");
    const parsed = JSON.parse(result["s.json"]);
    expect(parsed.$schema).toContain("summary.schema.json");
    expect(parsed.schemaVersion).toBe("2.0.0");
  });

  it("includes generatedAt as ISO date string", () => {
    const result = generateJsonSummary(makeK6Data(), makeContext(), "s.json");
    const parsed = JSON.parse(result["s.json"]);
    expect(parsed.generatedAt).toBeDefined();
    // Should be a valid ISO date
    expect(new Date(parsed.generatedAt).toISOString()).toBe(parsed.generatedAt);
  });

  it("includes the execution summary from buildExecutionSummary", () => {
    const result = generateJsonSummary(makeK6Data(), makeContext(), "s.json");
    const parsed = JSON.parse(result["s.json"]);
    expect(parsed.summary).toBeDefined();
    expect(parsed.summary.testName).toBe("test-scenario");
    expect(parsed.summary.client).toBe("test-client");
    expect(parsed.summary.passed).toBe(true);
  });

  it("does not include rawMetrics by default", () => {
    const result = generateJsonSummary(makeK6Data(), makeContext(), "s.json");
    const parsed = JSON.parse(result["s.json"]);
    expect(parsed.rawMetrics).toBeUndefined();
  });

  it("includes rawMetrics when includeRawMetrics=true", () => {
    const data = makeK6Data();
    const result = generateJsonSummary(data, makeContext(), "s.json", true);
    const parsed = JSON.parse(result["s.json"]);
    expect(parsed.rawMetrics).toBeDefined();
    expect(parsed.rawMetrics.http_req_duration).toBeDefined();
  });

  it("defaults definitionFormat to typescript", () => {
    const result = generateJsonSummary(makeK6Data(), makeContext(), "s.json");
    const parsed = JSON.parse(result["s.json"]);
    expect(parsed.definitionFormat).toBe("typescript");
  });

  it("uses custom definitionFormat", () => {
    const result = generateJsonSummary(makeK6Data(), makeContext(), "s.json", false, "yaml");
    const parsed = JSON.parse(result["s.json"]);
    expect(parsed.definitionFormat).toBe("yaml");
  });

  it("uses json definitionFormat", () => {
    const result = generateJsonSummary(makeK6Data(), makeContext(), "s.json", false, "json");
    const parsed = JSON.parse(result["s.json"]);
    expect(parsed.definitionFormat).toBe("json");
  });

  it("does not include extendedMetrics when not provided", () => {
    const result = generateJsonSummary(makeK6Data(), makeContext(), "s.json");
    const parsed = JSON.parse(result["s.json"]);
    expect(parsed.extendedMetrics).toBeUndefined();
  });

  it("includes extendedMetrics when provided", () => {
    const extendedMetrics: MetricsReport = {
      generatedAt: "2026-01-15T10:05:00.000Z",
      durationMs: 300000,
      byCategory: {
        performance: [
          {
            id: "PERF-001",
            name: "p95 Latency",
            category: "performance",
            value: 500,
            unit: "ms",
            status: "pass",
            description: "p95 response time",
            source: "k6",
          },
        ],
      },
      all: [
        {
          id: "PERF-001",
          name: "p95 Latency",
          category: "performance",
          value: 500,
          unit: "ms",
          status: "pass",
          description: "p95 response time",
          source: "k6",
        },
      ],
      summary: { total: 1, pass: 1, warn: 0, fail: 0, na: 0 },
    };
    const result = generateJsonSummary(makeK6Data(), makeContext(), "s.json", false, "typescript", extendedMetrics);
    const parsed = JSON.parse(result["s.json"]);
    expect(parsed.extendedMetrics).toBeDefined();
    expect(parsed.extendedMetrics.all).toHaveLength(1);
    expect(parsed.extendedMetrics.all[0].id).toBe("PERF-001");
  });

  it("produces nicely formatted JSON (indented with 2 spaces)", () => {
    const result = generateJsonSummary(makeK6Data(), makeContext(), "s.json");
    const json = result["s.json"];
    // Should be formatted with indentation (not a single line)
    expect(json.split("\n").length).toBeGreaterThan(5);
    expect(json).toContain("  "); // contains indentation
  });

  it("handles empty metrics data gracefully", () => {
    const result = generateJsonSummary({}, makeContext(), "s.json");
    const parsed = JSON.parse(result["s.json"]);
    expect(parsed.summary).toBeDefined();
  });
});
