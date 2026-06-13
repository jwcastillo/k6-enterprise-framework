/**
 * Unit tests for StabilityCalculator (T-186)
 *
 * Tests cover:
 * - Category identification
 * - Return shape (MetricResult fields)
 * - STAB-001/002: Memory leak detection via linear regression
 * - STAB-003: File descriptor leak rate
 * - STAB-004: Thread leak rate
 * - STAB-005: Connection count drift
 * - STAB-006/007: Latency drift (early vs late p95)
 * - STAB-008: Throughput drift
 * - STAB-009/010/011: Error rate drift, volatility, spike
 * - STAB-012: CPU drift
 * - STAB-013: Performance degradation index
 * - STAB-014: Soak test suitability
 * - STAB-015/016: Log volume anomaly
 * - STAB-017/018: GC stability
 * - STAB-019: P99/P95 ratio
 * - STAB-020: Max/P99 ratio
 * - N/A metrics when external data is missing
 * - Empty k6Metrics
 */

import { describe, it, expect, beforeEach } from "vitest";
import { StabilityCalculator } from "../../../src/metrics/calculators/stability-calculator";
import type { MetricsEngineInput } from "../../../src/metrics/types";

// ── Fixture helpers ───────────────────────────────────────────────────────────

function makeInput(overrides: Partial<MetricsEngineInput> = {}): MetricsEngineInput {
  return {
    durationMs: 3_600_000, // 1 hour (qualifies as soak)
    vusMax: 50,
    k6Metrics: {
      http_req_duration: {
        values: {
          avg: 200,
          min: 50,
          med: 180,
          max: 900,
          "p(90)": 350,
          "p(95)": 420,
          "p(99)": 750,
        },
      },
      http_reqs: { values: { count: 10000 } },
      http_req_failed: { values: { passes: 50 } },
      iterations: { values: { count: 10000 } },
    },
    context: {
      client: "test-client",
      environment: "staging",
      profile: "soak",
      testName: "stability-test",
      startTime: new Date().toISOString(),
    },
    ...overrides,
  };
}

function makeTimeSeries(values: number[]): Array<{ ts: number; value: number }> {
  return values.map((v, i) => ({ ts: i * 15, value: v }));
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe("StabilityCalculator", () => {
  let calc: StabilityCalculator;

  beforeEach(() => {
    calc = new StabilityCalculator();
  });

  // ── Category ────────────────────────────────────────────────────────────

  it("exposes category 'stability'", () => {
    expect(calc.category).toBe("stability");
  });

  // ── Return shape ──────────────────────────────────────────────────────────

  it("calculate() returns a non-empty MetricResult array", () => {
    const results = calc.calculate(makeInput());
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
  });

  it("every result has required MetricResult fields", () => {
    const results = calc.calculate(makeInput());
    for (const r of results) {
      expect(r).toHaveProperty("id");
      expect(r).toHaveProperty("name");
      expect(r).toHaveProperty("category", "stability");
      expect(r).toHaveProperty("unit");
      expect(r).toHaveProperty("status");
      expect(r).toHaveProperty("description");
      expect(r).toHaveProperty("source");
    }
  });

  it("all results have a valid status value", () => {
    const validStatuses = new Set(["pass", "warn", "fail", "na"]);
    const results = calc.calculate(makeInput());
    for (const r of results) {
      expect(validStatuses.has(r.status)).toBe(true);
    }
  });

  // ── STAB-001/002: Memory leak detection ──────────────────────────────────

  describe("STAB-001/002: Memory leak detection", () => {
    it("STAB-001 is N/A when no memory_rss_bytes series", () => {
      const r = calc.calculate(makeInput()).find((m) => m.id === "STAB-001")!;
      expect(r.status).toBe("na");
    });

    it("STAB-001 computes memory leak index when series has >= 4 points", () => {
      const input = makeInput({
        externalMetrics: {
          memory_rss_bytes: makeTimeSeries([
            100_000_000, 110_000_000, 120_000_000, 130_000_000, 140_000_000,
          ]),
        },
      });
      const r = calc.calculate(input).find((m) => m.id === "STAB-001")!;
      expect(r.status).not.toBe("na");
      expect(r.unit).toBe("MB/h");
      expect(typeof r.value).toBe("number");
    });

    it("STAB-001 passes when memory growth is small", () => {
      // Nearly flat memory: 100MB to 100.1MB over time
      const input = makeInput({
        externalMetrics: {
          memory_rss_bytes: makeTimeSeries([
            100_000_000, 100_010_000, 100_020_000, 100_030_000,
          ]),
        },
      });
      const r = calc.calculate(input).find((m) => m.id === "STAB-001")!;
      expect(r.status).toBe("pass");
    });

    it("STAB-002 computes residual stddev when memory series is available", () => {
      const input = makeInput({
        externalMetrics: {
          memory_rss_bytes: makeTimeSeries([
            100_000_000, 110_000_000, 120_000_000, 130_000_000,
          ]),
        },
      });
      const r = calc.calculate(input).find((m) => m.id === "STAB-002")!;
      expect(r.status).not.toBe("na");
      expect(r.unit).toBe("MB");
    });
  });

  // ── STAB-003: FD leak ────────────────────────────────────────────────────

  describe("STAB-003: File descriptor leak rate", () => {
    it("is N/A when no open_file_descriptors series", () => {
      const r = calc.calculate(makeInput()).find((m) => m.id === "STAB-003")!;
      expect(r.status).toBe("na");
    });

    it("computes FD growth rate when series has >= 4 points", () => {
      const input = makeInput({
        externalMetrics: {
          open_file_descriptors: makeTimeSeries([100, 102, 104, 106, 108]),
        },
      });
      const r = calc.calculate(input).find((m) => m.id === "STAB-003")!;
      expect(r.status).not.toBe("na");
      expect(r.unit).toBe("FDs/h");
      expect(typeof r.value).toBe("number");
    });
  });

  // ── STAB-004: Thread leak ────────────────────────────────────────────────

  describe("STAB-004: Thread leak rate", () => {
    it("is N/A when no thread_count series", () => {
      const r = calc.calculate(makeInput()).find((m) => m.id === "STAB-004")!;
      expect(r.status).toBe("na");
    });

    it("computes thread growth when series is provided", () => {
      const input = makeInput({
        externalMetrics: {
          thread_count: makeTimeSeries([20, 22, 24, 26]),
        },
      });
      const r = calc.calculate(input).find((m) => m.id === "STAB-004")!;
      expect(r.status).not.toBe("na");
      expect(r.unit).toBe("threads/h");
    });
  });

  // ── STAB-005: Connection drift ────────────────────────────────────────────

  describe("STAB-005: Connection count drift", () => {
    it("is N/A when no conn_pool_active series", () => {
      const r = calc.calculate(makeInput()).find((m) => m.id === "STAB-005")!;
      expect(r.status).toBe("na");
    });

    it("computes connection drift when series is provided", () => {
      const input = makeInput({
        externalMetrics: {
          conn_pool_active: makeTimeSeries([10, 10, 10, 10]),
        },
      });
      const r = calc.calculate(input).find((m) => m.id === "STAB-005")!;
      expect(r.status).not.toBe("na");
      expect(r.unit).toBe("conns/h");
    });
  });

  // ── STAB-006/007: Latency drift ──────────────────────────────────────────

  describe("STAB-006/007: Latency drift", () => {
    it("STAB-006 computes drift when p95 series has >= 6 points", () => {
      const input = makeInput({
        externalMetrics: {
          http_req_duration_p95: makeTimeSeries([200, 210, 220, 230, 240, 250, 260, 280]),
        },
      });
      const r = calc.calculate(input).find((m) => m.id === "STAB-006")!;
      expect(r.status).not.toBe("na");
      expect(r.unit).toBe("%");
    });

    it("STAB-006 passes when latency drift is small", () => {
      const input = makeInput({
        externalMetrics: {
          http_req_duration_p95: makeTimeSeries([200, 201, 202, 203, 204, 205]),
        },
      });
      const r = calc.calculate(input).find((m) => m.id === "STAB-006")!;
      expect(r.status).toBe("pass");
    });

    it("STAB-007 computes trend slope when p95 series is available", () => {
      const input = makeInput({
        externalMetrics: {
          http_req_duration_p95: makeTimeSeries([200, 210, 220, 230, 240, 250]),
        },
      });
      const r = calc.calculate(input).find((m) => m.id === "STAB-007")!;
      expect(r.status).not.toBe("na");
      expect(r.unit).toBe("ms/sample");
    });

    it("STAB-006 falls back to single p95 value when series < 6 points", () => {
      const r = calc.calculate(makeInput()).find((m) => m.id === "STAB-006")!;
      expect(r.value).toBe(420); // k6 p95 value
    });

    it("STAB-007 is N/A when no p95 time-series", () => {
      const r = calc.calculate(makeInput()).find((m) => m.id === "STAB-007")!;
      expect(r.status).toBe("na");
    });
  });

  // ── STAB-008: Throughput drift ────────────────────────────────────────────

  describe("STAB-008: Throughput drift", () => {
    it("is N/A when no http_reqs_rate series", () => {
      const r = calc.calculate(makeInput()).find((m) => m.id === "STAB-008")!;
      expect(r.status).toBe("na");
    });

    it("computes throughput drift when series has >= 6 points", () => {
      const input = makeInput({
        externalMetrics: {
          http_reqs_rate: makeTimeSeries([50, 50, 50, 50, 50, 50, 50, 50]),
        },
      });
      const r = calc.calculate(input).find((m) => m.id === "STAB-008")!;
      expect(r.status).not.toBe("na");
      expect(r.unit).toBe("%");
    });
  });

  // ── STAB-009/010/011: Error rate stability ───────────────────────────────

  describe("STAB-009/010/011: Error rate drift", () => {
    it("STAB-009/010/011 are N/A when no error_rate_percent series", () => {
      const results = calc.calculate(makeInput());
      for (const id of ["STAB-009", "STAB-010", "STAB-011"]) {
        const r = results.find((m) => m.id === id)!;
        expect(r.status).toBe("na");
      }
    });

    it("STAB-009 computes error trend slope when series has >= 4 points", () => {
      const input = makeInput({
        externalMetrics: {
          error_rate_percent: makeTimeSeries([0.1, 0.12, 0.15, 0.2]),
        },
      });
      const r = calc.calculate(input).find((m) => m.id === "STAB-009")!;
      expect(r.status).not.toBe("na");
      expect(r.unit).toBe("%/sample");
    });

    it("STAB-010 computes error rate volatility", () => {
      const input = makeInput({
        externalMetrics: {
          error_rate_percent: makeTimeSeries([0.1, 5, 0.1, 8, 0.1]),
        },
      });
      const r = calc.calculate(input).find((m) => m.id === "STAB-010")!;
      expect(r.status).not.toBe("na");
      expect(r.value).toBeGreaterThan(0);
    });

    it("STAB-011 computes peak error spike", () => {
      const input = makeInput({
        externalMetrics: {
          error_rate_percent: makeTimeSeries([0.1, 0.2, 10, 0.3]),
        },
      });
      const r = calc.calculate(input).find((m) => m.id === "STAB-011")!;
      expect(r.value).toBe(10);
    });
  });

  // ── STAB-012: CPU drift ──────────────────────────────────────────────────

  describe("STAB-012: CPU drift", () => {
    it("is N/A when no cpu_app_percent series", () => {
      const r = calc.calculate(makeInput()).find((m) => m.id === "STAB-012")!;
      expect(r.status).toBe("na");
    });

    it("computes CPU drift slope when series is provided", () => {
      const input = makeInput({
        externalMetrics: {
          cpu_app_percent: makeTimeSeries([30, 32, 34, 36]),
        },
      });
      const r = calc.calculate(input).find((m) => m.id === "STAB-012")!;
      expect(r.status).not.toBe("na");
      expect(r.unit).toBe("%/sample");
    });
  });

  // ── STAB-013: Performance degradation index ──────────────────────────────

  describe("STAB-013: Performance degradation index", () => {
    it("is N/A when p95 and RPS series are missing", () => {
      const r = calc.calculate(makeInput()).find((m) => m.id === "STAB-013")!;
      expect(r.status).toBe("na");
    });

    it("computes PDI when p95 and RPS series are available", () => {
      const input = makeInput({
        externalMetrics: {
          http_req_duration_p95: makeTimeSeries([200, 210, 220, 230, 300, 350, 400, 450]),
          http_reqs_rate: makeTimeSeries([50, 48, 46, 44, 42, 40, 38, 36]),
        },
      });
      const r = calc.calculate(input).find((m) => m.id === "STAB-013")!;
      expect(r.status).not.toBe("na");
      expect(r.unit).toBe("%");
      expect(r.value).toBeGreaterThan(0);
    });

    it("PDI is 0 when performance is stable", () => {
      const input = makeInput({
        externalMetrics: {
          http_req_duration_p95: makeTimeSeries([200, 200, 200, 200, 200, 200]),
          http_reqs_rate: makeTimeSeries([50, 50, 50, 50, 50, 50]),
        },
      });
      const r = calc.calculate(input).find((m) => m.id === "STAB-013")!;
      expect(r.value).toBeCloseTo(0, 0);
    });
  });

  // ── STAB-014: Soak test suitability ──────────────────────────────────────

  describe("STAB-014: Soak test duration", () => {
    it("passes when duration >= 30 minutes", () => {
      const input = makeInput({ durationMs: 30 * 60 * 1000 });
      const r = calc.calculate(input).find((m) => m.id === "STAB-014")!;
      expect(r.status).toBe("pass");
      expect(r.unit).toBe("min");
    });

    it("fails when duration < 30 minutes", () => {
      const input = makeInput({ durationMs: 10 * 60 * 1000 });
      const r = calc.calculate(input).find((m) => m.id === "STAB-014")!;
      expect(r.status).toBe("fail");
    });
  });

  // ── STAB-015/016: Log volume ─────────────────────────────────────────────

  describe("STAB-015/016: Log volume anomaly", () => {
    it("STAB-015/016 are N/A when no log series", () => {
      const results = calc.calculate(makeInput());
      expect(results.find((m) => m.id === "STAB-015")!.status).toBe("na");
      expect(results.find((m) => m.id === "STAB-016")!.status).toBe("na");
    });

    it("STAB-015 computes log drift slope when series is provided", () => {
      const input = makeInput({
        externalMetrics: {
          log_lines_per_sec: makeTimeSeries([10, 12, 14, 16]),
        },
      });
      const r = calc.calculate(input).find((m) => m.id === "STAB-015")!;
      expect(r.status).not.toBe("na");
    });

    it("STAB-016 computes coefficient of variation", () => {
      const input = makeInput({
        externalMetrics: {
          log_lines_per_sec: makeTimeSeries([10, 50, 10, 50]),
        },
      });
      const r = calc.calculate(input).find((m) => m.id === "STAB-016")!;
      expect(r.status).not.toBe("na");
      expect(r.value).toBeGreaterThan(0);
    });
  });

  // ── STAB-017/018: GC stability ───────────────────────────────────────────

  describe("STAB-017/018: GC stability", () => {
    it("STAB-017/018 are N/A when no gc_pause_ms series", () => {
      const results = calc.calculate(makeInput());
      expect(results.find((m) => m.id === "STAB-017")!.status).toBe("na");
      expect(results.find((m) => m.id === "STAB-018")!.status).toBe("na");
    });

    it("STAB-017 computes GC pause trend slope", () => {
      const input = makeInput({
        externalMetrics: {
          gc_pause_ms: makeTimeSeries([5, 6, 7, 8]),
        },
      });
      const r = calc.calculate(input).find((m) => m.id === "STAB-017")!;
      expect(r.status).not.toBe("na");
      expect(r.unit).toBe("ms/sample");
    });

    it("STAB-018 computes GC pause volatility", () => {
      const input = makeInput({
        externalMetrics: {
          gc_pause_ms: makeTimeSeries([5, 100, 5, 200]),
        },
      });
      const r = calc.calculate(input).find((m) => m.id === "STAB-018")!;
      expect(r.status).not.toBe("na");
      expect(r.value).toBeGreaterThan(0);
    });
  });

  // ── STAB-019: P99/P95 ratio ──────────────────────────────────────────────

  describe("STAB-019: P99/P95 ratio", () => {
    it("computes ratio from k6 metrics", () => {
      const r = calc.calculate(makeInput()).find((m) => m.id === "STAB-019")!;
      // p99=750, p95=420 -> ratio ≈ 1.79
      expect(r.value).toBeCloseTo(750 / 420, 1);
      expect(r.unit).toBe("ratio");
    });

    it("passes when ratio < 3", () => {
      const r = calc.calculate(makeInput()).find((m) => m.id === "STAB-019")!;
      expect(r.status).toBe("pass");
    });

    it("defaults to 1 when p95 is 0", () => {
      const input = makeInput();
      input.k6Metrics["http_req_duration"]!.values!["p(95)"] = 0;
      const r = calc.calculate(input).find((m) => m.id === "STAB-019")!;
      expect(r.value).toBe(1);
    });
  });

  // ── STAB-020: Max/P99 ratio ──────────────────────────────────────────────

  describe("STAB-020: Max/P99 ratio", () => {
    it("computes ratio from k6 metrics", () => {
      const r = calc.calculate(makeInput()).find((m) => m.id === "STAB-020")!;
      // max=900, p99=750 -> ratio = 1.2
      expect(r.value).toBeCloseTo(900 / 750, 0);
      expect(r.unit).toBe("ratio");
    });

    it("passes when ratio < 10", () => {
      const r = calc.calculate(makeInput()).find((m) => m.id === "STAB-020")!;
      expect(r.status).toBe("pass");
    });

    it("defaults to 1 when p99 is 0", () => {
      const input = makeInput();
      input.k6Metrics["http_req_duration"]!.values!["p(99)"] = 0;
      const r = calc.calculate(input).find((m) => m.id === "STAB-020")!;
      expect(r.value).toBe(1);
    });
  });

  // ── Empty metrics ────────────────────────────────────────────────────────

  describe("empty k6Metrics", () => {
    it("handles empty k6Metrics without crashing", () => {
      const input = makeInput({ k6Metrics: {} });
      const results = calc.calculate(input);
      expect(results.length).toBeGreaterThan(0);
    });

    it("STAB-019 and STAB-020 use defaults when k6 metrics are missing", () => {
      const input = makeInput({ k6Metrics: {} });
      const results = calc.calculate(input);
      const stab019 = results.find((m) => m.id === "STAB-019")!;
      const stab020 = results.find((m) => m.id === "STAB-020")!;
      expect(stab019.value).toBe(1); // 0/0 fallback
      expect(stab020.value).toBe(1);
    });
  });
});
