import { describe, it, expect } from "vitest";
import { ErrorCalculator } from "../../../src/metrics/calculators/error-calculator";
import type { MetricsEngineInput, K6MetricsMap } from "../../../src/metrics/types";

// ── Fixture factory ──────────────────────────────────────────────────────────

/**
 * Builds a minimal MetricsEngineInput with sensible defaults.
 * Any field can be overridden via the overrides argument.
 */
function makeInput(
  overrides: Partial<MetricsEngineInput> & {
    k6MetricsOverrides?: Partial<K6MetricsMap>;
  } = {}
): MetricsEngineInput {
  const { k6MetricsOverrides, ...rest } = overrides;

  const baseK6Metrics: K6MetricsMap = {
    http_reqs: { values: { count: 1000, rate: 16.67 } },
    http_req_failed: { values: { passes: 10, fails: 990 } },
    iterations: { values: { count: 1000 } },
    http_req_connecting: { values: { avg: 5, max: 50 } },
    http_req_tls_handshaking: { values: { avg: 10, max: 120 } },
    http_req_duration: { values: { avg: 200, max: 800, "p(95)": 400, "p(99)": 700 } },
    checks: { values: { passes: 980, fails: 20 } },
  };

  return {
    k6Metrics: { ...baseK6Metrics, ...(k6MetricsOverrides ?? {}) },
    durationMs: 60_000,
    vusMax: 50,
    context: {
      client: "test-client",
      environment: "test",
      profile: "load",
      testName: "unit-test",
      startTime: new Date().toISOString(),
    },
    ...rest,
  };
}

const calculator = new ErrorCalculator();

// ── Category ─────────────────────────────────────────────────────────────────

describe("ErrorCalculator.category", () => {
  it("exposes category as 'error'", () => {
    expect(calculator.category).toBe("error");
  });
});

// ── calculate() — structural contract ────────────────────────────────────────

describe("ErrorCalculator.calculate() — structure", () => {
  it("returns a non-empty array of MetricResult objects", () => {
    const results = calculator.calculate(makeInput());
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
  });

  it("every result has a valid MetricResult shape", () => {
    const results = calculator.calculate(makeInput());
    for (const r of results) {
      expect(typeof r.id).toBe("string");
      expect(r.id.length).toBeGreaterThan(0);
      expect(typeof r.name).toBe("string");
      expect(r.category).toBe("error");
      expect(["pass", "warn", "fail", "na"]).toContain(r.status);
      expect(["k6", "prometheus", "derived", "external"]).toContain(r.source);
      expect(typeof r.unit).toBe("string");
      expect(typeof r.description).toBe("string");
    }
  });

  it("all result IDs are unique within a single calculation", () => {
    const results = calculator.calculate(makeInput());
    const ids = results.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("includes ERR-001 through ERR-009 as named metric IDs", () => {
    const results = calculator.calculate(makeInput());
    const ids = new Set(results.map((r) => r.id));
    for (let n = 1; n <= 9; n++) {
      const id = `ERR-00${n}`;
      expect(ids.has(id), `Expected ${id} to be present`).toBe(true);
    }
  });
});

// ── ERR-001: Overall HTTP Error Rate ─────────────────────────────────────────

describe("ERR-001 — Overall HTTP Error Rate", () => {
  it("calculates error rate as (failedReqs / totalReqs) * 100", () => {
    // 50 failed out of 500 = 10%
    const input = makeInput({
      k6MetricsOverrides: {
        http_reqs: { values: { count: 500 } },
        http_req_failed: { values: { passes: 50 } },
      },
    });
    const result = calculator.calculate(input).find((r) => r.id === "ERR-001")!;
    expect(result.value).toBeCloseTo(10, 3);
    expect(result.unit).toBe("%");
  });

  it("reports 0% error rate when no requests have failed", () => {
    const input = makeInput({
      k6MetricsOverrides: {
        http_reqs: { values: { count: 200 } },
        http_req_failed: { values: { passes: 0 } },
      },
    });
    const result = calculator.calculate(input).find((r) => r.id === "ERR-001")!;
    expect(result.value).toBe(0);
  });

  it("produces 'pass' status when error rate is below 1%", () => {
    const input = makeInput({
      k6MetricsOverrides: {
        http_reqs: { values: { count: 1000 } },
        http_req_failed: { values: { passes: 5 } }, // 0.5%
      },
    });
    const result = calculator.calculate(input).find((r) => r.id === "ERR-001")!;
    expect(result.status).toBe("pass");
  });

  it("produces 'fail' status when error rate is high (>= 10%)", () => {
    const input = makeInput({
      k6MetricsOverrides: {
        http_reqs: { values: { count: 100 } },
        http_req_failed: { values: { passes: 50 } }, // 50%
      },
    });
    const result = calculator.calculate(input).find((r) => r.id === "ERR-001")!;
    expect(result.status).toBe("fail");
  });

  it("returns 0 when totalReqs is zero (no division by zero)", () => {
    const input = makeInput({
      k6MetricsOverrides: {
        http_reqs: { values: { count: 0 } },
        http_req_failed: { values: { passes: 0 } },
      },
    });
    const result = calculator.calculate(input).find((r) => r.id === "ERR-001")!;
    expect(result.value).toBe(0);
    expect(result.status).toBe("pass");
  });
});

// ── ERR-009: Check Failure Rate ───────────────────────────────────────────────

describe("ERR-009 — Check Failure Rate", () => {
  it("calculates check failure rate as (fails / total) * 100", () => {
    // 25 fails out of 100 checks = 25%
    const input = makeInput({
      k6MetricsOverrides: {
        checks: { values: { passes: 75, fails: 25 } },
      },
    });
    const result = calculator.calculate(input).find((r) => r.id === "ERR-009")!;
    expect(result.value).toBeCloseTo(25, 3);
    expect(result.unit).toBe("%");
  });

  it("reports 0% check failure rate when all checks pass", () => {
    const input = makeInput({
      k6MetricsOverrides: {
        checks: { values: { passes: 500, fails: 0 } },
      },
    });
    const result = calculator.calculate(input).find((r) => r.id === "ERR-009")!;
    expect(result.value).toBe(0);
    expect(result.status).toBe("pass");
  });

  it("produces 'fail' status when check failure rate exceeds threshold", () => {
    const input = makeInput({
      k6MetricsOverrides: {
        checks: { values: { passes: 50, fails: 50 } }, // 50%
      },
    });
    const result = calculator.calculate(input).find((r) => r.id === "ERR-009")!;
    expect(result.status).toBe("fail");
  });

  it("returns 0 check failure rate when no checks have been executed", () => {
    const input = makeInput({
      k6MetricsOverrides: {
        checks: { values: { passes: 0, fails: 0 } },
      },
    });
    const result = calculator.calculate(input).find((r) => r.id === "ERR-009")!;
    expect(result.value).toBe(0);
  });
});

// ── ERR-012: Error Budget Burn Rate ─────────────────────────────────────────

describe("ERR-012 — Error Budget Burn Rate", () => {
  it("calculates burn rate relative to SLO error budget", () => {
    // SLO = 99.9% => budget = 0.1%. Error rate = 0.5% => burn = 0.5 / 0.1 = 5x
    const input = makeInput({
      sloConfig: { availabilityTarget: 0.999, latencyP95TargetMs: 500 },
      k6MetricsOverrides: {
        http_reqs: { values: { count: 1000 } },
        http_req_failed: { values: { passes: 5 } }, // 0.5%
      },
    });
    const result = calculator.calculate(input).find((r) => r.id === "ERR-012")!;
    expect(result.value).toBeCloseTo(5, 1);
    expect(result.unit).toBe("×");
  });

  it("uses default SLO target (99.9%) when sloConfig is not provided", () => {
    const input = makeInput({
      k6MetricsOverrides: {
        http_reqs: { values: { count: 1000 } },
        http_req_failed: { values: { passes: 0 } }, // 0% error rate
      },
    });
    const result = calculator.calculate(input).find((r) => r.id === "ERR-012")!;
    expect(result.value).toBe(0);
    expect(result.status).toBe("pass");
  });

  it("produces 'fail' status when burn rate exceeds threshold of 5x", () => {
    // 10% error rate, budget=0.1% => burn = 100x
    const input = makeInput({
      sloConfig: { availabilityTarget: 0.999, latencyP95TargetMs: 500 },
      k6MetricsOverrides: {
        http_reqs: { values: { count: 100 } },
        http_req_failed: { values: { passes: 10 } }, // 10%
      },
    });
    const result = calculator.calculate(input).find((r) => r.id === "ERR-012")!;
    expect(result.status).toBe("fail");
  });
});

// ── ERR-002 to ERR-004: External metrics branching ───────────────────────────

describe("ERR-002/003/004 — External series presence", () => {
  it("computes ERR-002 from 5xx series when externalMetrics provides it", () => {
    const input = makeInput({
      k6MetricsOverrides: {
        http_reqs: { values: { count: 1000 } },
      },
      externalMetrics: {
        http_errors_5xx: [
          { ts: 1, value: 20 },
          { ts: 2, value: 30 },
        ],
      },
    });
    const result = calculator.calculate(input).find((r) => r.id === "ERR-002")!;
    // (20+30) / 1000 * 100 = 5%
    expect(result.value).toBeCloseTo(5, 3);
    expect(result.status).toBe("fail");
  });

  it("falls back to approximation for ERR-002 when no 5xx series is present", () => {
    const input = makeInput({ externalMetrics: {} });
    const result = calculator.calculate(input).find((r) => r.id === "ERR-002")!;
    expect(result.name).toContain("approx");
  });

  it("produces N/A for ERR-003 when no 429 series is present", () => {
    const input = makeInput({ externalMetrics: {} });
    const result = calculator.calculate(input).find((r) => r.id === "ERR-003")!;
    expect(result.status).toBe("na");
    expect(result.value).toBeNull();
  });

  it("computes ERR-003 correctly when 429 series is provided", () => {
    const input = makeInput({
      k6MetricsOverrides: {
        http_reqs: { values: { count: 1000 } },
      },
      externalMetrics: {
        http_errors_429: [{ ts: 1, value: 10 }],
      },
    });
    const result = calculator.calculate(input).find((r) => r.id === "ERR-003")!;
    expect(result.value).toBeCloseTo(1, 3); // 10 / 1000 * 100
  });

  it("produces N/A for ERR-004 when no 4xx series is present", () => {
    const input = makeInput({ externalMetrics: {} });
    const result = calculator.calculate(input).find((r) => r.id === "ERR-004")!;
    expect(result.status).toBe("na");
  });
});

// ── Empty / minimal metrics ───────────────────────────────────────────────────

describe("ErrorCalculator.calculate() — empty / minimal metrics", () => {
  it("handles completely empty k6Metrics map without throwing", () => {
    const input = makeInput({ k6Metrics: {} });
    expect(() => calculator.calculate(input)).not.toThrow();
  });

  it("returns zero for ERR-001 value when k6Metrics is empty", () => {
    const input = makeInput({ k6Metrics: {} });
    const result = calculator.calculate(input).find((r) => r.id === "ERR-001")!;
    expect(result.value).toBe(0);
  });

  it("produces N/A for ERR-010 and ERR-011 when no error_rate_percent series is present", () => {
    const input = makeInput({ externalMetrics: {} });
    const results = calculator.calculate(input);
    const err010 = results.find((r) => r.id === "ERR-010")!;
    const err011 = results.find((r) => r.id === "ERR-011")!;
    expect(err010.status).toBe("na");
    expect(err011.status).toBe("na");
  });
});
