import { describe, it, expect } from "vitest";
import { SlaCalculator } from "../../../src/metrics/calculators/sla-calculator";
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
    http_req_duration: { values: { avg: 200, med: 180, "p(95)": 400, "p(99)": 700 } },
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
    sloConfig: {
      availabilityTarget: 0.999,
      latencyP95TargetMs: 500,
      latencyP99TargetMs: 1000,
    },
    ...rest,
  };
}

const calculator = new SlaCalculator();

// ── Category ─────────────────────────────────────────────────────────────────

describe("SlaCalculator.category", () => {
  it("exposes category as 'sla'", () => {
    expect(calculator.category).toBe("sla");
  });
});

// ── calculate() — structural contract ────────────────────────────────────────

describe("SlaCalculator.calculate() — structure", () => {
  it("returns a non-empty array", () => {
    const results = calculator.calculate(makeInput());
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
  });

  it("every result has category 'sla'", () => {
    const results = calculator.calculate(makeInput());
    for (const r of results) {
      expect(r.category).toBe("sla");
    }
  });

  it("every result carries a non-empty id, name, unit, and description", () => {
    const results = calculator.calculate(makeInput());
    for (const r of results) {
      expect(typeof r.id).toBe("string");
      expect(r.id.length).toBeGreaterThan(0);
      expect(typeof r.name).toBe("string");
      expect(typeof r.unit).toBe("string");
      expect(typeof r.description).toBe("string");
    }
  });

  it("every result has a valid status value", () => {
    const results = calculator.calculate(makeInput());
    const validStatuses = ["pass", "warn", "fail", "na"];
    for (const r of results) {
      expect(validStatuses).toContain(r.status);
    }
  });

  it("all result IDs are unique within a single calculation", () => {
    const results = calculator.calculate(makeInput());
    const ids = results.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("includes SLA-001 through SLA-008 as named metric IDs", () => {
    const results = calculator.calculate(makeInput());
    const ids = new Set(results.map((r) => r.id));
    for (let n = 1; n <= 8; n++) {
      const id = `SLA-00${n}`;
      expect(ids.has(id), `Expected ${id} to be present`).toBe(true);
    }
  });
});

// ── SLA-001: Request-based availability ──────────────────────────────────────

describe("SLA-001 — Availability (Request-Based)", () => {
  it("calculates availability as (successReqs / totalReqs) * 100", () => {
    // 950 successful out of 1000 = 95%
    const input = makeInput({
      k6MetricsOverrides: {
        http_reqs: { values: { count: 1000 } },
        http_req_failed: { values: { passes: 50 } },
      },
    });
    const result = calculator.calculate(input).find((r) => r.id === "SLA-001")!;
    expect(result.value).toBeCloseTo(95, 3);
    expect(result.unit).toBe("%");
  });

  it("reports 100% availability when no requests fail", () => {
    const input = makeInput({
      k6MetricsOverrides: {
        http_reqs: { values: { count: 500 } },
        http_req_failed: { values: { passes: 0 } },
      },
    });
    const result = calculator.calculate(input).find((r) => r.id === "SLA-001")!;
    expect(result.value).toBeCloseTo(100, 4);
  });

  it("produces 'pass' when availability meets the SLO target", () => {
    // 99.95% availability vs 99.9% SLO target
    const input = makeInput({
      sloConfig: { availabilityTarget: 0.999, latencyP95TargetMs: 500 },
      k6MetricsOverrides: {
        http_reqs: { values: { count: 10000 } },
        http_req_failed: { values: { passes: 5 } }, // 0.05% failure => 99.95% available
      },
    });
    const result = calculator.calculate(input).find((r) => r.id === "SLA-001")!;
    expect(result.status).toBe("pass");
  });

  it("produces 'fail' when availability is well below the SLO target", () => {
    // 90% availability vs 99.9% SLO target
    const input = makeInput({
      sloConfig: { availabilityTarget: 0.999, latencyP95TargetMs: 500 },
      k6MetricsOverrides: {
        http_reqs: { values: { count: 1000 } },
        http_req_failed: { values: { passes: 100 } }, // 10% failure => 90% available
      },
    });
    const result = calculator.calculate(input).find((r) => r.id === "SLA-001")!;
    expect(result.status).toBe("fail");
  });

  it("returns 100% availability when totalReqs is zero", () => {
    const input = makeInput({
      k6MetricsOverrides: {
        http_reqs: { values: { count: 0 } },
        http_req_failed: { values: { passes: 0 } },
      },
    });
    const result = calculator.calculate(input).find((r) => r.id === "SLA-001")!;
    expect(result.value).toBe(100);
  });
});

// ── SLA-002: Check-based availability ────────────────────────────────────────

describe("SLA-002 — Availability (Check-Based)", () => {
  it("calculates check-based availability as (passes / total) * 100", () => {
    // 900 passes out of 1000 checks = 90%
    const input = makeInput({
      k6MetricsOverrides: {
        checks: { values: { passes: 900, fails: 100 } },
      },
    });
    const result = calculator.calculate(input).find((r) => r.id === "SLA-002")!;
    expect(result.value).toBeCloseTo(90, 3);
    expect(result.unit).toBe("%");
  });

  it("reports 100% when all checks pass", () => {
    const input = makeInput({
      k6MetricsOverrides: {
        checks: { values: { passes: 300, fails: 0 } },
      },
    });
    const result = calculator.calculate(input).find((r) => r.id === "SLA-002")!;
    expect(result.value).toBeCloseTo(100, 4);
  });

  it("returns 100% check availability when no checks have been run", () => {
    const input = makeInput({
      k6MetricsOverrides: {
        checks: { values: { passes: 0, fails: 0 } },
      },
    });
    const result = calculator.calculate(input).find((r) => r.id === "SLA-002")!;
    expect(result.value).toBe(100);
  });
});

// ── SLA-003: Error budget remaining ──────────────────────────────────────────

describe("SLA-003 — Error Budget Remaining", () => {
  it("returns 100% budget remaining when there are no errors", () => {
    const input = makeInput({
      sloConfig: { availabilityTarget: 0.999, latencyP95TargetMs: 500 },
      k6MetricsOverrides: {
        http_reqs: { values: { count: 1000 } },
        http_req_failed: { values: { passes: 0 } },
      },
    });
    const result = calculator.calculate(input).find((r) => r.id === "SLA-003")!;
    expect(result.value).toBeCloseTo(100, 1);
    expect(result.unit).toBe("%");
  });

  it("returns 0% budget remaining when error rate exceeds the full budget", () => {
    // SLO = 99.9%, budget = 0.1%. Error rate = 5% => budget fully consumed (capped at 100%)
    const input = makeInput({
      sloConfig: { availabilityTarget: 0.999, latencyP95TargetMs: 500 },
      k6MetricsOverrides: {
        http_reqs: { values: { count: 100 } },
        http_req_failed: { values: { passes: 50 } }, // 50% failure
      },
    });
    const result = calculator.calculate(input).find((r) => r.id === "SLA-003")!;
    expect(result.value).toBe(0);
  });

  it("calculates partial budget consumption correctly", () => {
    // SLO = 99.9%, budget = 0.1%. Error rate = 0.05% => 50% of budget consumed => 50% remaining
    const input = makeInput({
      sloConfig: { availabilityTarget: 0.999, latencyP95TargetMs: 500 },
      k6MetricsOverrides: {
        http_reqs: { values: { count: 10000 } },
        http_req_failed: { values: { passes: 5 } }, // 0.05% failure
      },
    });
    const result = calculator.calculate(input).find((r) => r.id === "SLA-003")!;
    expect(result.value).toBeCloseTo(50, 0);
  });

  it("produces 'pass' status when budget is still remaining", () => {
    const input = makeInput({
      sloConfig: { availabilityTarget: 0.999, latencyP95TargetMs: 500 },
      k6MetricsOverrides: {
        http_reqs: { values: { count: 10000 } },
        http_req_failed: { values: { passes: 0 } },
      },
    });
    const result = calculator.calculate(input).find((r) => r.id === "SLA-003")!;
    expect(result.status).toBe("pass");
  });
});

// ── SLA-005/006: Latency SLO compliance ──────────────────────────────────────

describe("SLA-005 — SLO Latency Compliance (p95)", () => {
  it("produces 'pass' status when p95 is below the target", () => {
    const input = makeInput({
      sloConfig: { availabilityTarget: 0.999, latencyP95TargetMs: 500 },
      k6MetricsOverrides: {
        http_req_duration: { values: { "p(95)": 350, "p(99)": 600 } },
      },
    });
    const result = calculator.calculate(input).find((r) => r.id === "SLA-005")!;
    expect(result.value).toBeCloseTo(350, 1);
    expect(result.status).toBe("pass");
  });

  it("produces 'fail' status when p95 exceeds the SLO target", () => {
    const input = makeInput({
      sloConfig: { availabilityTarget: 0.999, latencyP95TargetMs: 500 },
      k6MetricsOverrides: {
        http_req_duration: { values: { "p(95)": 900, "p(99)": 1500 } },
      },
    });
    const result = calculator.calculate(input).find((r) => r.id === "SLA-005")!;
    expect(result.status).toBe("fail");
  });

  it("reflects the measured p95 value from k6Metrics", () => {
    const input = makeInput({
      k6MetricsOverrides: {
        http_req_duration: { values: { "p(95)": 275, "p(99)": 500 } },
      },
    });
    const result = calculator.calculate(input).find((r) => r.id === "SLA-005")!;
    expect(result.value).toBeCloseTo(275, 1);
    expect(result.unit).toBe("ms");
  });
});

describe("SLA-006 — SLO Latency Compliance (p99)", () => {
  it("produces 'pass' status when p99 is below the target", () => {
    const input = makeInput({
      sloConfig: { availabilityTarget: 0.999, latencyP95TargetMs: 500, latencyP99TargetMs: 1000 },
      k6MetricsOverrides: {
        http_req_duration: { values: { "p(95)": 400, "p(99)": 800 } },
      },
    });
    const result = calculator.calculate(input).find((r) => r.id === "SLA-006")!;
    expect(result.status).toBe("pass");
  });

  it("produces 'fail' status when p99 exceeds the SLO target", () => {
    const input = makeInput({
      sloConfig: { availabilityTarget: 0.999, latencyP95TargetMs: 500, latencyP99TargetMs: 1000 },
      k6MetricsOverrides: {
        http_req_duration: { values: { "p(95)": 700, "p(99)": 2500 } },
      },
    });
    const result = calculator.calculate(input).find((r) => r.id === "SLA-006")!;
    expect(result.status).toBe("fail");
  });

  it("falls back to p95Target * 2 when latencyP99TargetMs is not specified", () => {
    // p95Target = 500, so p99Target defaults to 1000. p99 = 900 => pass
    const input = makeInput({
      sloConfig: { availabilityTarget: 0.999, latencyP95TargetMs: 500 },
      k6MetricsOverrides: {
        http_req_duration: { values: { "p(95)": 400, "p(99)": 900 } },
      },
    });
    const result = calculator.calculate(input).find((r) => r.id === "SLA-006")!;
    expect(result.status).toBe("pass");
  });
});

// ── SLA-007: Throughput SLO ───────────────────────────────────────────────────

describe("SLA-007 — SLO Throughput Compliance", () => {
  it("produces N/A when throughputTargetRps is not configured", () => {
    const input = makeInput({
      sloConfig: { availabilityTarget: 0.999, latencyP95TargetMs: 500 },
    });
    const result = calculator.calculate(input).find((r) => r.id === "SLA-007")!;
    expect(result.status).toBe("na");
    expect(result.value).toBeNull();
  });

  it("produces 'pass' when achieved RPS meets the target", () => {
    // 1000 reqs in 60s = 16.67 RPS. Target = 10 RPS.
    const input = makeInput({
      sloConfig: { availabilityTarget: 0.999, latencyP95TargetMs: 500, throughputTargetRps: 10 },
      k6MetricsOverrides: {
        http_reqs: { values: { count: 1000 } },
      },
    });
    const result = calculator.calculate(input).find((r) => r.id === "SLA-007")!;
    expect(result.status).toBe("pass");
  });

  it("produces 'fail' when achieved RPS is below the target", () => {
    // 100 reqs in 60s = 1.67 RPS. Target = 50 RPS.
    const input = makeInput({
      sloConfig: { availabilityTarget: 0.999, latencyP95TargetMs: 500, throughputTargetRps: 50 },
      k6MetricsOverrides: {
        http_reqs: { values: { count: 100 } },
      },
    });
    const result = calculator.calculate(input).find((r) => r.id === "SLA-007")!;
    expect(result.status).toBe("fail");
  });
});

// ── SLA-008: Multi-SLI Composite Score ───────────────────────────────────────

describe("SLA-008 — Multi-SLI Composite Score", () => {
  it("returns a composite score between 0 and 100", () => {
    const results = calculator.calculate(makeInput());
    const result = results.find((r) => r.id === "SLA-008")!;
    expect(result.value).toBeGreaterThanOrEqual(0);
    expect(result.value).toBeLessThanOrEqual(100);
    expect(result.unit).toBe("%");
  });

  it("produces 'pass' when all SLIs are fully compliant", () => {
    // Perfect availability, p95 well below target, p99 well below target
    const input = makeInput({
      sloConfig: { availabilityTarget: 0.999, latencyP95TargetMs: 500, latencyP99TargetMs: 1000 },
      k6MetricsOverrides: {
        http_reqs: { values: { count: 1000 } },
        http_req_failed: { values: { passes: 0 } }, // 100% availability
        http_req_duration: { values: { "p(95)": 100, "p(99)": 200 } },
        checks: { values: { passes: 1000, fails: 0 } },
      },
    });
    const result = calculator.calculate(input).find((r) => r.id === "SLA-008")!;
    expect(result.status).toBe("pass");
    expect(result.value).toBeGreaterThanOrEqual(95);
  });

  it("produces a low composite score when all SLIs are violated", () => {
    const input = makeInput({
      sloConfig: { availabilityTarget: 0.999, latencyP95TargetMs: 500, latencyP99TargetMs: 1000 },
      k6MetricsOverrides: {
        http_reqs: { values: { count: 1000 } },
        http_req_failed: { values: { passes: 500 } }, // 50% failure
        http_req_duration: { values: { "p(95)": 5000, "p(99)": 10000 } },
        checks: { values: { passes: 100, fails: 900 } },
      },
    });
    const result = calculator.calculate(input).find((r) => r.id === "SLA-008")!;
    expect(result.value).toBeLessThan(50);
  });
});

// ── Default SLO config ────────────────────────────────────────────────────────

describe("SlaCalculator — default SLO config", () => {
  it("uses 99.9% availability target when no sloConfig is provided", () => {
    const input = makeInput({ sloConfig: undefined });
    const result = calculator.calculate(input).find((r) => r.id === "SLA-001")!;
    // With default SLO = 99.9%, threshold should be ">= 99.900"
    expect(result.threshold).toContain("99.900");
  });

  it("uses 500ms p95 target when no sloConfig is provided", () => {
    const input = makeInput({ sloConfig: undefined });
    const result = calculator.calculate(input).find((r) => r.id === "SLA-005")!;
    expect(result.threshold).toContain("500");
  });

  it("uses 1000ms p99 target when no sloConfig is provided", () => {
    const input = makeInput({ sloConfig: undefined });
    const result = calculator.calculate(input).find((r) => r.id === "SLA-006")!;
    expect(result.threshold).toContain("1000");
  });

  it("calculates successfully with no sloConfig without throwing", () => {
    const input = makeInput({ sloConfig: undefined });
    expect(() => calculator.calculate(input)).not.toThrow();
  });
});

// ── Empty / minimal metrics ───────────────────────────────────────────────────

describe("SlaCalculator.calculate() — empty / minimal metrics", () => {
  it("handles completely empty k6Metrics map without throwing", () => {
    const input = makeInput({ k6Metrics: {} });
    expect(() => calculator.calculate(input)).not.toThrow();
  });

  it("returns N/A for SLA-012/013/014 when no slo_breach time-series is provided", () => {
    const input = makeInput({ externalMetrics: {} });
    const results = calculator.calculate(input);
    expect(results.find((r) => r.id === "SLA-012")!.status).toBe("na");
    expect(results.find((r) => r.id === "SLA-013")!.status).toBe("na");
    expect(results.find((r) => r.id === "SLA-014")!.status).toBe("na");
  });
});
