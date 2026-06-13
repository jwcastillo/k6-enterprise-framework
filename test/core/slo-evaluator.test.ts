import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ClientContext } from "../../src/types/client.d";
import type { SloConfig, SloServiceDefinition, SloEvaluation } from "../../src/types/slo.d";
import type { ExecutionSummary } from "../../src/types/report.d";
import fs from "fs";
import path from "path";

// Spy on the actual fs and path modules that the source requires
const existsSyncSpy = vi.spyOn(fs, "existsSync");
const readFileSyncSpy = vi.spyOn(fs, "readFileSync");
const _joinSpy = vi.spyOn(path, "join");

import {
  loadSloConfig,
  findServiceSlos,
  evaluateServiceSlos,
  evaluateSlos,
  formatSloForJson,
  formatSloForHtml,
} from "../../src/core/slo-evaluator";

function makeClientContext(overrides: Partial<ClientContext> = {}): ClientContext {
  return {
    clientId: "test-client",
    rootDir: "/clients/test-client",
    configDir: "/clients/test-client/config",
    dataDir: "/clients/test-client/data",
    libDir: "/clients/test-client/lib",
    scenariosDir: "/clients/test-client/scenarios",
    reportsDir: "/clients/test-client/reports",
    envFile: "/clients/test-client/.env",
    mocksDir: "/clients/test-client/mocks",
    brandingDir: "/clients/test-client/branding",
    isSubmodule: false,
    isSymlink: false,
    ...overrides,
  };
}

function makeExecutionSummary(overrides: Partial<ExecutionSummary> = {}): ExecutionSummary {
  return {
    testName: "users-api",
    client: "test-client",
    environment: "staging",
    profile: "load",
    startTime: "2026-01-01T00:00:00Z",
    endTime: "2026-01-01T00:15:00Z",
    durationMs: 900000,
    vus: 20,
    iterations: 5000,
    iterationsFailed: 10,
    httpRequests: 10000,
    httpRequestsFailed: 50,
    httpDuration: {
      avg: 200,
      min: 50,
      med: 180,
      max: 3000,
      p90: 400,
      p95: 500,
      p99: 1500,
    },
    checks: [{ name: "status is 200", passes: 9900, fails: 100, passRate: 0.99 }],
    thresholds: [],
    passed: true,
    tags: {},
    ...overrides,
  };
}

function makeSloConfig(services: SloServiceDefinition[]): SloConfig {
  return { services };
}

function makeServiceDef(
  serviceName: string,
  metrics: SloServiceDefinition["metrics"] = []
): SloServiceDefinition {
  return { serviceName, metrics };
}

describe("SloEvaluator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── loadSloConfig ─────────────────────────────────────────────────────────

  describe("loadSloConfig", () => {
    it("should return null when slos.json does not exist", () => {
      existsSyncSpy.mockReturnValue(false);
      const ctx = makeClientContext();
      const result = loadSloConfig(ctx);
      expect(result).toBeNull();
      expect(existsSyncSpy).toHaveBeenCalled();
    });

    it("should load and parse slos.json when it exists", () => {
      const config: SloConfig = makeSloConfig([
        makeServiceDef("users-api", [
          { name: "http_req_duration_p95", target: 500, riskMargin: 0.1, unit: "ms" },
        ]),
      ]);
      existsSyncSpy.mockReturnValue(true);
      readFileSyncSpy.mockReturnValue(JSON.stringify(config));

      const result = loadSloConfig(makeClientContext());
      expect(result).toEqual(config);
    });

    it("should throw when slos.json is invalid JSON", () => {
      existsSyncSpy.mockReturnValue(true);
      readFileSyncSpy.mockReturnValue("{invalid json");

      expect(() => loadSloConfig(makeClientContext())).toThrow("SLO Evaluator: failed to parse");
    });
  });

  // ── findServiceSlos ───────────────────────────────────────────────────────

  describe("findServiceSlos", () => {
    const config = makeSloConfig([
      makeServiceDef("users-api", [
        { name: "http_req_duration_p95", target: 500, riskMargin: 0.1 },
      ]),
      makeServiceDef("orders-api", [{ name: "error_rate", target: 0.01, riskMargin: 0.1 }]),
    ]);

    it("should find a service by name", () => {
      const result = findServiceSlos(config, "users-api");
      expect(result).not.toBeNull();
      expect(result!.serviceName).toBe("users-api");
    });

    it("should return null for unknown service", () => {
      const result = findServiceSlos(config, "payments-api");
      expect(result).toBeNull();
    });
  });

  // ── evaluateServiceSlos ───────────────────────────────────────────────────

  describe("evaluateServiceSlos", () => {
    it("should classify metric as 'cumple' when actual is well below target", () => {
      const serviceDef = makeServiceDef("users-api", [
        { name: "http_req_duration_p95", target: 1000, riskMargin: 0.1, unit: "ms" },
      ]);
      const summary = makeExecutionSummary({
        httpDuration: { avg: 100, min: 50, med: 90, max: 500, p90: 200, p95: 300, p99: 400 },
      });

      const results = evaluateServiceSlos(serviceDef, summary);
      expect(results).toHaveLength(1);
      expect(results[0].status).toBe("cumple");
      expect(results[0].actual).toBe(300);
      expect(results[0].target).toBe(1000);
      expect(results[0].service).toBe("users-api");
      expect(results[0].unit).toBe("ms");
    });

    it("should classify metric as 'en_riesgo' when actual is within risk margin", () => {
      const serviceDef = makeServiceDef("users-api", [
        { name: "http_req_duration_p95", target: 1000, riskMargin: 0.1, unit: "ms" },
      ]);
      const summary = makeExecutionSummary({
        httpDuration: { avg: 100, min: 50, med: 90, max: 2000, p90: 800, p95: 950, p99: 1500 },
      });

      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const results = evaluateServiceSlos(serviceDef, summary);
      expect(results[0].status).toBe("en_riesgo");
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("SLO AT RISK"));
      warnSpy.mockRestore();
    });

    it("should classify metric as 'en_riesgo' at exact risk threshold boundary", () => {
      const serviceDef = makeServiceDef("users-api", [
        { name: "http_req_duration_p95", target: 1000, riskMargin: 0.1, unit: "ms" },
      ]);
      const summary = makeExecutionSummary({
        httpDuration: { avg: 100, min: 50, med: 90, max: 2000, p90: 800, p95: 900, p99: 1500 },
      });

      vi.spyOn(console, "warn").mockImplementation(() => {});
      const results = evaluateServiceSlos(serviceDef, summary);
      expect(results[0].status).toBe("en_riesgo");
    });

    it("should classify metric as 'cumple' just below risk threshold", () => {
      const serviceDef = makeServiceDef("users-api", [
        { name: "http_req_duration_p95", target: 1000, riskMargin: 0.1, unit: "ms" },
      ]);
      const summary = makeExecutionSummary({
        httpDuration: { avg: 100, min: 50, med: 90, max: 2000, p90: 800, p95: 899, p99: 1500 },
      });

      const results = evaluateServiceSlos(serviceDef, summary);
      expect(results[0].status).toBe("cumple");
    });

    it("should classify metric as 'en_riesgo' when actual equals target exactly", () => {
      const serviceDef = makeServiceDef("users-api", [
        { name: "http_req_duration_p95", target: 1000, riskMargin: 0.1, unit: "ms" },
      ]);
      const summary = makeExecutionSummary({
        httpDuration: { avg: 100, min: 50, med: 90, max: 2000, p90: 800, p95: 1000, p99: 1500 },
      });

      vi.spyOn(console, "warn").mockImplementation(() => {});
      const results = evaluateServiceSlos(serviceDef, summary);
      expect(results[0].status).toBe("en_riesgo");
    });

    it("should classify metric as 'incumple' when actual exceeds target", () => {
      const serviceDef = makeServiceDef("users-api", [
        { name: "http_req_duration_p95", target: 500, riskMargin: 0.1, unit: "ms" },
      ]);
      const summary = makeExecutionSummary({
        httpDuration: { avg: 300, min: 100, med: 250, max: 5000, p90: 600, p95: 700, p99: 2000 },
      });

      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const results = evaluateServiceSlos(serviceDef, summary);
      expect(results[0].status).toBe("incumple");
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("SLO VIOLATED"));
      errorSpy.mockRestore();
    });

    it("should skip unknown metrics with a warning", () => {
      const serviceDef = makeServiceDef("users-api", [
        { name: "unknown_metric", target: 100, riskMargin: 0.1 },
      ]);
      const summary = makeExecutionSummary();
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const results = evaluateServiceSlos(serviceDef, summary);
      expect(results).toHaveLength(0);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("metric 'unknown_metric' not found")
      );
      warnSpy.mockRestore();
    });

    it("should evaluate error_rate metric correctly", () => {
      const serviceDef = makeServiceDef("users-api", [
        { name: "error_rate", target: 0.01, riskMargin: 0.1 },
      ]);
      const summary = makeExecutionSummary({
        httpRequests: 10000,
        httpRequestsFailed: 50,
      });

      const results = evaluateServiceSlos(serviceDef, summary);
      expect(results).toHaveLength(1);
      expect(results[0].actual).toBe(0.005);
      expect(results[0].status).toBe("cumple");
    });

    it("should evaluate error_rate as 0 when there are zero requests", () => {
      const serviceDef = makeServiceDef("users-api", [
        { name: "error_rate", target: 0.01, riskMargin: 0.1 },
      ]);
      const summary = makeExecutionSummary({
        httpRequests: 0,
        httpRequestsFailed: 0,
      });

      const results = evaluateServiceSlos(serviceDef, summary);
      expect(results[0].actual).toBe(0);
      expect(results[0].status).toBe("cumple");
    });

    it("should evaluate check_failure_rate metric correctly", () => {
      const serviceDef = makeServiceDef("users-api", [
        { name: "check_failure_rate", target: 0.05, riskMargin: 0.1 },
      ]);
      const summary = makeExecutionSummary({
        checks: [{ name: "status check", passes: 9900, fails: 100, passRate: 0.99 }],
      });

      const results = evaluateServiceSlos(serviceDef, summary);
      expect(results[0].actual).toBe(0.01);
      expect(results[0].status).toBe("cumple");
    });

    it("should evaluate check_failure_rate as 0 when no checks exist", () => {
      const serviceDef = makeServiceDef("users-api", [
        { name: "check_failure_rate", target: 0.05, riskMargin: 0.1 },
      ]);
      const summary = makeExecutionSummary({ checks: [] });

      const results = evaluateServiceSlos(serviceDef, summary);
      expect(results[0].actual).toBe(0);
    });

    it("should evaluate throughput metric correctly", () => {
      const serviceDef = makeServiceDef("users-api", [
        { name: "throughput", target: 20, riskMargin: 0.1 },
      ]);
      const summary = makeExecutionSummary({
        httpRequests: 10000,
        durationMs: 900000,
      });

      const results = evaluateServiceSlos(serviceDef, summary);
      expect(results[0].actual).toBeCloseTo(11.11, 1);
      expect(results[0].status).toBe("cumple");
    });

    it("should evaluate throughput as 0 when duration is 0", () => {
      const serviceDef = makeServiceDef("users-api", [
        { name: "throughput", target: 20, riskMargin: 0.1 },
      ]);
      const summary = makeExecutionSummary({ durationMs: 0 });

      const results = evaluateServiceSlos(serviceDef, summary);
      expect(results[0].actual).toBe(0);
    });

    it("should evaluate all latency metric variants", () => {
      const metricNames = [
        "http_req_duration_avg",
        "http_req_duration_p90",
        "http_req_duration_p95",
        "http_req_duration_p99",
        "http_req_duration_med",
        "http_req_duration_max",
      ];
      const serviceDef = makeServiceDef(
        "users-api",
        metricNames.map((name) => ({ name, target: 5000, riskMargin: 0.1 }))
      );
      const summary = makeExecutionSummary();

      const results = evaluateServiceSlos(serviceDef, summary);
      expect(results).toHaveLength(6);
      results.forEach((r) => {
        expect(r.status).toBe("cumple");
      });
    });

    it("should handle multiple metrics for the same service", () => {
      const serviceDef = makeServiceDef("users-api", [
        { name: "http_req_duration_p95", target: 5000, riskMargin: 0.1, unit: "ms" },
        { name: "error_rate", target: 0.01, riskMargin: 0.1 },
      ]);
      const summary = makeExecutionSummary();

      const results = evaluateServiceSlos(serviceDef, summary);
      expect(results).toHaveLength(2);
    });
  });

  // ── evaluateSlos ──────────────────────────────────────────────────────────

  describe("evaluateSlos", () => {
    it("should return null when no SLO config exists", () => {
      existsSyncSpy.mockReturnValue(false);
      const result = evaluateSlos(makeClientContext(), makeExecutionSummary());
      expect(result).toBeNull();
    });

    it("should return null when service is not found in config", () => {
      const config = makeSloConfig([
        makeServiceDef("other-api", [
          { name: "http_req_duration_p95", target: 500, riskMargin: 0.1 },
        ]),
      ]);
      existsSyncSpy.mockReturnValue(true);
      readFileSyncSpy.mockReturnValue(JSON.stringify(config));

      const result = evaluateSlos(makeClientContext(), makeExecutionSummary());
      expect(result).toBeNull();
    });

    it("should evaluate SLOs using testName as default service name", () => {
      const config = makeSloConfig([
        makeServiceDef("users-api", [
          { name: "http_req_duration_p95", target: 5000, riskMargin: 0.1, unit: "ms" },
        ]),
      ]);
      existsSyncSpy.mockReturnValue(true);
      readFileSyncSpy.mockReturnValue(JSON.stringify(config));

      const result = evaluateSlos(
        makeClientContext(),
        makeExecutionSummary({ testName: "users-api" })
      );
      expect(result).not.toBeNull();
      expect(result!).toHaveLength(1);
    });

    it("should use explicit serviceName when provided", () => {
      const config = makeSloConfig([
        makeServiceDef("custom-service", [
          { name: "http_req_duration_p95", target: 5000, riskMargin: 0.1, unit: "ms" },
        ]),
      ]);
      existsSyncSpy.mockReturnValue(true);
      readFileSyncSpy.mockReturnValue(JSON.stringify(config));

      const result = evaluateSlos(makeClientContext(), makeExecutionSummary(), "custom-service");
      expect(result).not.toBeNull();
      expect(result![0].service).toBe("custom-service");
    });
  });

  // ── formatSloForJson ──────────────────────────────────────────────────────

  describe("formatSloForJson", () => {
    it("should format evaluations into JSON structure with summary", () => {
      const evaluations: SloEvaluation[] = [
        {
          service: "users-api",
          metric: "http_req_duration_p95",
          target: 500,
          actual: 300,
          status: "cumple",
          unit: "ms",
        },
        {
          service: "users-api",
          metric: "error_rate",
          target: 0.01,
          actual: 0.009,
          status: "en_riesgo",
        },
        {
          service: "users-api",
          metric: "http_req_duration_p99",
          target: 1000,
          actual: 1500,
          status: "incumple",
          unit: "ms",
        },
      ];

      const result = formatSloForJson(evaluations);
      expect(result.sloCompliance).toHaveLength(3);
      expect(result.sloSummary).toEqual({
        total: 3,
        passing: 1,
        atRisk: 1,
        failing: 1,
      });
    });

    it("should handle empty evaluations", () => {
      const result = formatSloForJson([]);
      expect(result.sloCompliance).toHaveLength(0);
      expect(result.sloSummary).toEqual({
        total: 0,
        passing: 0,
        atRisk: 0,
        failing: 0,
      });
    });

    it("should preserve all fields in sloCompliance entries", () => {
      const evaluations: SloEvaluation[] = [
        { service: "api", metric: "p95", target: 500, actual: 100, status: "cumple", unit: "ms" },
      ];
      const result = formatSloForJson(evaluations);
      const entry = (result.sloCompliance as SloEvaluation[])[0];
      expect(entry.service).toBe("api");
      expect(entry.metric).toBe("p95");
      expect(entry.target).toBe(500);
      expect(entry.actual).toBe(100);
      expect(entry.status).toBe("cumple");
      expect(entry.unit).toBe("ms");
    });
  });

  // ── formatSloForHtml ──────────────────────────────────────────────────────

  describe("formatSloForHtml", () => {
    it("should return empty string for no evaluations", () => {
      expect(formatSloForHtml([])).toBe("");
    });

    it("should generate HTML table with traffic-light indicators", () => {
      const evaluations: SloEvaluation[] = [
        {
          service: "users-api",
          metric: "http_req_duration_p95",
          target: 500,
          actual: 300,
          status: "cumple",
          unit: "ms",
        },
        {
          service: "users-api",
          metric: "error_rate",
          target: 0.01,
          actual: 0.009,
          status: "en_riesgo",
        },
        {
          service: "users-api",
          metric: "http_req_duration_p99",
          target: 1000,
          actual: 1500,
          status: "incumple",
          unit: "ms",
        },
      ];

      const html = formatSloForHtml(evaluations);
      expect(html).toContain("SLA/SLO Compliance");
      expect(html).toContain("<table>");
      expect(html).toContain("Cumple");
      expect(html).toContain("En riesgo");
      expect(html).toContain("Incumple");
      expect(html).toContain("users-api");
      expect(html).toContain("300.00ms");
      expect(html).toContain("1500.00ms");
    });

    it("should handle metrics without units", () => {
      const evaluations: SloEvaluation[] = [
        { service: "api", metric: "error_rate", target: 0.01, actual: 0.005, status: "cumple" },
      ];

      const html = formatSloForHtml(evaluations);
      expect(html).toContain("0.01");
    });

    it("should contain proper HTML structure with thead and tbody", () => {
      const evaluations: SloEvaluation[] = [
        { service: "api", metric: "p95", target: 500, actual: 100, status: "cumple", unit: "ms" },
      ];

      const html = formatSloForHtml(evaluations);
      expect(html).toContain("<thead>");
      expect(html).toContain("<tbody>");
      expect(html).toContain("Servicio");
      expect(html).toContain("Metrica");
      expect(html).toContain("Objetivo");
      expect(html).toContain("Actual");
      expect(html).toContain("Estado");
    });
  });
});
