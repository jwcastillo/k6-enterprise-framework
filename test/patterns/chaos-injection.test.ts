import { describe, it, expect, vi, beforeEach } from "vitest";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

import {
  resetChaosState,
  evaluateChaosRules,
  recordServiceError,
  buildChaosReportBreakdown,
  formatChaosForHtml,
  formatChaosForJson,
} from "../../src/patterns/chaos-injection";
import { loadChaosConfig } from "@node/chaos-injection-node";
import type { ChaosConfig } from "../../src/types/mock.d";
import type { ClientContext } from "../../src/types/client.d";

function makeClientContext(configDir: string): ClientContext {
  return {
    clientId: "test-client",
    rootDir: "/clients/test-client",
    configDir,
    dataDir: "/clients/test-client/data",
    libDir: "/clients/test-client/lib",
    scenariosDir: "/clients/test-client/scenarios",
    reportsDir: "/clients/test-client/reports",
    envFile: "/clients/test-client/.env",
    mocksDir: "/clients/test-client/mocks",
    brandingDir: "/clients/test-client/branding",
    isSubmodule: false,
    isSymlink: false,
  };
}

function makeChaosConfig(overrides: Partial<ChaosConfig> = {}): ChaosConfig {
  return {
    enabled: true,
    targetService: "payment-api",
    faults: [
      { type: "latency", probability: 0.1, params: { delayMs: 2000 } },
      { type: "http_error", probability: 0.05, params: { statusCode: 503 } },
    ],
    ...overrides,
  };
}

describe("chaos-injection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetChaosState();
  });

  // ── loadChaosConfig (uses real fs with temp files) ──────────────────

  describe("loadChaosConfig", () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chaos-test-"));
    });

    it("returns null when chaos.json does not exist", () => {
      const result = loadChaosConfig(makeClientContext(tmpDir));
      expect(result).toBeNull();
    });

    it("returns null when chaos is disabled", () => {
      const config = { enabled: false, targetService: "api", faults: [] };
      fs.writeFileSync(path.join(tmpDir, "chaos.json"), JSON.stringify(config));

      const result = loadChaosConfig(makeClientContext(tmpDir));
      expect(result).toBeNull();
    });

    it("returns config when chaos is enabled", () => {
      const config = makeChaosConfig();
      fs.writeFileSync(path.join(tmpDir, "chaos.json"), JSON.stringify(config));

      const result = loadChaosConfig(makeClientContext(tmpDir));
      expect(result).toEqual(config);
      expect(result!.targetService).toBe("payment-api");
    });

    it("throws when chaos.json has invalid JSON", () => {
      fs.writeFileSync(path.join(tmpDir, "chaos.json"), "not valid json {{{");

      expect(() => loadChaosConfig(makeClientContext(tmpDir))).toThrow(
        "ChaosInjection: failed to parse chaos.json"
      );
    });
  });

  // ── evaluateChaosRules ──────────────────────────────────────────────

  describe("evaluateChaosRules", () => {
    it("returns no fault when probability is 0", () => {
      const config = makeChaosConfig({
        faults: [{ type: "latency", probability: 0 }],
      });

      const result = evaluateChaosRules(config);
      expect(result.injected).toBe(false);
      expect(result.type).toBeNull();
    });

    it("always injects when probability is 1", () => {
      const config = makeChaosConfig({
        faults: [{ type: "http_error", probability: 1, params: { statusCode: 500 } }],
      });

      const result = evaluateChaosRules(config);
      expect(result.injected).toBe(true);
      expect(result.type).toBe("http_error");
    });

    it("injects latency fault with correct details", () => {
      const config = makeChaosConfig({
        faults: [{ type: "latency", probability: 1, params: { delayMs: 3000 } }],
      });

      const result = evaluateChaosRules(config);
      expect(result.injected).toBe(true);
      expect(result.type).toBe("latency");
      expect(result.details.delayMs).toBe(3000);
    });

    it("injects http_error fault with correct details", () => {
      const config = makeChaosConfig({
        faults: [
          { type: "http_error", probability: 1, params: { statusCode: 503, body: { err: "Down" } } },
        ],
      });

      const result = evaluateChaosRules(config);
      expect(result.injected).toBe(true);
      expect(result.type).toBe("http_error");
      expect(result.details.statusCode).toBe(503);
      expect(result.details.body).toEqual({ err: "Down" });
    });

    it("injects disconnect fault with correct details", () => {
      const config = makeChaosConfig({
        faults: [{ type: "disconnect", probability: 1, params: { afterBytes: 100 } }],
      });

      const result = evaluateChaosRules(config);
      expect(result.type).toBe("disconnect");
      expect(result.details.afterBytes).toBe(100);
    });

    it("injects corruption fault with correct details", () => {
      const config = makeChaosConfig({
        faults: [
          { type: "corruption", probability: 1, params: { corruptionType: "truncated" } },
        ],
      });

      const result = evaluateChaosRules(config);
      expect(result.type).toBe("corruption");
      expect(result.details.corruptionType).toBe("truncated");
    });

    it("injects partial_timeout fault with correct details", () => {
      const config = makeChaosConfig({
        faults: [
          {
            type: "partial_timeout",
            probability: 1,
            params: { initialBytes: 20, hangMs: 60000 },
          },
        ],
      });

      const result = evaluateChaosRules(config);
      expect(result.type).toBe("partial_timeout");
      expect(result.details.initialBytes).toBe(20);
      expect(result.details.hangMs).toBe(60000);
    });

    it("injects rate_limit fault with correct details", () => {
      const config = makeChaosConfig({
        faults: [
          { type: "rate_limit", probability: 1, params: { retryAfterSec: 60 } },
        ],
      });

      const result = evaluateChaosRules(config);
      expect(result.type).toBe("rate_limit");
      expect(result.details.statusCode).toBe(429);
      expect(result.details.retryAfterSec).toBe(60);
    });

    it("uses default params when params are not specified", () => {
      const config = makeChaosConfig({
        faults: [{ type: "latency", probability: 1 }],
      });

      const result = evaluateChaosRules(config);
      expect(result.details.delayMs).toBe(2000); // default
    });

    it("uses deterministic distribution (every N-th request)", () => {
      // probability 0.1 -> every 10th request (Math.round(1/0.1)=10)
      const config = makeChaosConfig({
        faults: [{ type: "latency", probability: 0.1 }],
      });

      const results: boolean[] = [];
      for (let i = 0; i < 20; i++) {
        results.push(evaluateChaosRules(config).injected);
      }

      // Should inject on requests 10 and 20 (every 10th)
      expect(results[9]).toBe(true);  // 10th request
      expect(results[19]).toBe(true); // 20th request

      // Others should not be injected
      expect(results[0]).toBe(false);
      expect(results[4]).toBe(false);
    });

    it("evaluates rules in order and returns first matching fault", () => {
      const config = makeChaosConfig({
        faults: [
          { type: "latency", probability: 1 },
          { type: "http_error", probability: 1 },
        ],
      });

      const result = evaluateChaosRules(config);
      expect(result.type).toBe("latency"); // first rule matches
    });

    it("returns no fault for unknown fault type", () => {
      const config = makeChaosConfig({
        faults: [{ type: "unknown_type" as "latency", probability: 1 }],
      });

      const result = evaluateChaosRules(config);
      expect(result.injected).toBe(false);
    });
  });

  // ── recordServiceError ──────────────────────────────────────────────

  describe("recordServiceError", () => {
    it("increments service error counter", () => {
      const config = makeChaosConfig({ faults: [] });

      recordServiceError();
      recordServiceError();

      const breakdown = buildChaosReportBreakdown(config);
      expect(breakdown.serviceErrors).toBe(2);
    });
  });

  // ── buildChaosReportBreakdown ──────────────────────────────────────────

  describe("buildChaosReportBreakdown", () => {
    it("returns breakdown with service and chaos error counts", () => {
      const config = makeChaosConfig({
        faults: [{ type: "http_error", probability: 1 }],
      });

      // Generate some chaos injections
      evaluateChaosRules(config);
      evaluateChaosRules(config);
      recordServiceError();

      const breakdown = buildChaosReportBreakdown(config);
      expect(breakdown.serviceErrors).toBe(1);
      expect(breakdown.chaosInjectedErrors).toBe(2);
      expect(breakdown.chaosConfig).toBe(config);
    });

    it("returns zero counts after reset", () => {
      const config = makeChaosConfig({ faults: [] });

      recordServiceError();
      resetChaosState();

      const breakdown = buildChaosReportBreakdown(config);
      expect(breakdown.serviceErrors).toBe(0);
      expect(breakdown.chaosInjectedErrors).toBe(0);
    });
  });

  // ── formatChaosForHtml ──────────────────────────────────────────────

  describe("formatChaosForHtml", () => {
    it("returns HTML with chaos report data", () => {
      const config = makeChaosConfig();

      evaluateChaosRules(config);
      recordServiceError();

      const breakdown = buildChaosReportBreakdown(config);
      const html = formatChaosForHtml(breakdown);

      expect(html).toContain("Chaos Injection Report");
      expect(html).toContain("payment-api");
      expect(html).toContain("Service errors (genuine)");
      expect(html).toContain("Chaos-injected errors");
      expect(html).toContain("latency");
      expect(html).toContain("http_error");
      expect(html).toContain("10.0%");
      expect(html).toContain("5.0%");
    });

    it("formats total errors correctly", () => {
      const config = makeChaosConfig({
        faults: [{ type: "http_error", probability: 1 }],
      });

      evaluateChaosRules(config);
      recordServiceError();
      recordServiceError();
      recordServiceError();

      const breakdown = buildChaosReportBreakdown(config);
      const html = formatChaosForHtml(breakdown);

      // Total = 3 service + 1 chaos = 4
      expect(html).toContain("<strong>4</strong>");
    });
  });

  // ── formatChaosForJson ──────────────────────────────────────────────

  describe("formatChaosForJson", () => {
    it("returns JSON object with chaos report data", () => {
      const config = makeChaosConfig({
        faults: [{ type: "latency", probability: 1, params: { delayMs: 1000 } }],
      });

      evaluateChaosRules(config);
      evaluateChaosRules(config);
      recordServiceError();

      const breakdown = buildChaosReportBreakdown(config);
      const json = formatChaosForJson(breakdown);

      expect(json.chaosReport).toBeDefined();
      const report = json.chaosReport as Record<string, unknown>;
      expect(report.targetService).toBe("payment-api");
      expect(report.serviceErrors).toBe(1);
      expect(report.chaosInjectedErrors).toBe(2);
      expect(report.totalRequests).toBe(2);
      expect(report.chaosConfig).toBeDefined();
    });
  });

  // ── resetChaosState ──────────────────────────────────────────────────

  describe("resetChaosState", () => {
    it("resets all counters to zero", () => {
      const config = makeChaosConfig({
        faults: [{ type: "http_error", probability: 1 }],
      });

      evaluateChaosRules(config);
      recordServiceError();
      resetChaosState();

      const breakdown = buildChaosReportBreakdown(config);
      expect(breakdown.serviceErrors).toBe(0);
      expect(breakdown.chaosInjectedErrors).toBe(0);
    });
  });
});
