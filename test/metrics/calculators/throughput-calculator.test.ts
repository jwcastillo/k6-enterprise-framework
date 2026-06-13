/**
 * Unit tests for ThroughputCalculator (T-182)
 *
 * Tests cover:
 * - Return shape and category
 * - THRU-001: Total RPS (http_reqs / durationSec)
 * - THRU-002: Goodput RPS (successful requests only)
 * - THRU-003: TPS (iterations / durationSec)
 * - THRU-004 / THRU-005: Total data sent/received in MB
 * - THRU-006 / THRU-007: Bandwidth in Mbps
 * - THRU-008: Throughput per VU
 * - THRU-009: Peak-to-mean RPS ratio (N/A without external series)
 * - THRU-010: Ceiling detection (N/A without external series)
 * - THRU-011: Little's Law deviation
 * - THRU-012: Goodput rate %
 * - THRU-013: Retry amplification factor
 * - THRU-017: Rate-limit 429 rate
 * - N/A metrics (THRU-014 to THRU-016, THRU-018 to THRU-025)
 * - Empty metrics fallback (zero-division safety, N/A results)
 */

import { ThroughputCalculator } from "../../../src/metrics/calculators/throughput-calculator";
import type { MetricsEngineInput } from "../../../src/metrics/types";

// ── Fixture helpers ───────────────────────────────────────────────────────────

/**
 * Build a MetricsEngineInput with realistic k6 throughput defaults.
 * durationMs=60_000, vusMax=50, 3000 total requests, 30 failures.
 */
function makeInput(overrides: Partial<MetricsEngineInput> = {}): MetricsEngineInput {
  return {
    durationMs: 60_000, // 60 seconds
    vusMax: 50,
    k6Metrics: {
      http_reqs: {
        values: { count: 3000 },
      },
      http_req_failed: {
        values: { passes: 30 }, // 1% error rate
      },
      iterations: {
        values: { count: 3000 },
      },
      data_sent: {
        values: { count: 3_145_728 }, // 3 MB
      },
      data_received: {
        values: { count: 31_457_280 }, // 30 MB
      },
      http_req_duration: {
        values: { avg: 200 }, // 200 ms avg latency
      },
    },
    context: {
      client: "test-client",
      environment: "staging",
      profile: "load",
      testName: "thru-calc-unit-test",
      startTime: new Date().toISOString(),
    },
    ...overrides,
  };
}

/** Return an input with a completely empty k6Metrics map. */
function makeEmptyInput(): MetricsEngineInput {
  return makeInput({ k6Metrics: {} });
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe("ThroughputCalculator", () => {
  let calc: ThroughputCalculator;

  beforeEach(() => {
    calc = new ThroughputCalculator();
  });

  // ── Category ────────────────────────────────────────────────────────────────

  it("exposes category 'throughput'", () => {
    expect(calc.category).toBe("throughput");
  });

  // ── Return shape ─────────────────────────────────────────────────────────────

  it("calculate() returns a non-empty MetricResult array", () => {
    const results = calc.calculate(makeInput());
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
  });

  it("every result carries category 'throughput'", () => {
    const results = calc.calculate(makeInput());
    for (const r of results) {
      expect(r.category).toBe("throughput");
    }
  });

  it("every result has required MetricResult fields", () => {
    const results = calc.calculate(makeInput());
    for (const r of results) {
      expect(r).toHaveProperty("id");
      expect(r).toHaveProperty("name");
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

  // ── THRU-001: Total RPS ───────────────────────────────────────────────────

  it("THRU-001 value equals totalReqs / durationSec", () => {
    // 3000 reqs / 60 s = 50.00 RPS
    const r = calc.calculate(makeInput()).find((m) => m.id === "THRU-001")!;
    expect(r).toBeDefined();
    expect(r.value).toBeCloseTo(50, 2);
    expect(r.unit).toBe("RPS");
  });

  it("THRU-001 is 0 when durationMs is 0 (zero-division guard)", () => {
    const input = makeInput({ durationMs: 0 });
    const r = calc.calculate(input).find((m) => m.id === "THRU-001")!;
    expect(r.value).toBe(0);
  });

  it("THRU-001 scales correctly with different request counts", () => {
    const input = makeInput();
    input.k6Metrics["http_reqs"]!.values!["count"] = 6000;
    const r = calc.calculate(input).find((m) => m.id === "THRU-001")!;
    expect(r.value).toBeCloseTo(100, 2);
  });

  // ── THRU-002: Goodput RPS ─────────────────────────────────────────────────

  it("THRU-002 value equals (totalReqs - failedReqs) / durationSec", () => {
    // (3000 - 30) / 60 = 49.50 RPS
    const r = calc.calculate(makeInput()).find((m) => m.id === "THRU-002")!;
    expect(r.value).toBeCloseTo(49.5, 1);
    expect(r.unit).toBe("RPS");
  });

  it("THRU-002 equals THRU-001 when there are no failures", () => {
    const input = makeInput();
    input.k6Metrics["http_req_failed"]!.values!["passes"] = 0;
    const results = calc.calculate(input);
    const rps = results.find((m) => m.id === "THRU-001")!.value!;
    const goodput = results.find((m) => m.id === "THRU-002")!.value!;
    expect(goodput).toBeCloseTo(rps, 2);
  });

  it("THRU-002 never goes below 0 when failures exceed total requests", () => {
    const input = makeInput();
    input.k6Metrics["http_req_failed"]!.values!["passes"] = 99999;
    const r = calc.calculate(input).find((m) => m.id === "THRU-002")!;
    expect(r.value).toBeGreaterThanOrEqual(0);
  });

  // ── THRU-003: Transactions Per Second ─────────────────────────────────────

  it("THRU-003 value equals iterations / durationSec", () => {
    // 3000 iterations / 60 s = 50.00 TPS
    const r = calc.calculate(makeInput()).find((m) => m.id === "THRU-003")!;
    expect(r.value).toBeCloseTo(50, 2);
    expect(r.unit).toBe("TPS");
  });

  it("THRU-003 is 0 when durationMs is 0", () => {
    const input = makeInput({ durationMs: 0 });
    const r = calc.calculate(input).find((m) => m.id === "THRU-003")!;
    expect(r.value).toBe(0);
  });

  // ── THRU-004 / THRU-005: Data volume ──────────────────────────────────────

  it("THRU-004 total data sent is dataSent / 1_048_576 MB", () => {
    // 3_145_728 / 1_048_576 = 3.00 MB
    const r = calc.calculate(makeInput()).find((m) => m.id === "THRU-004")!;
    expect(r.value).toBeCloseTo(3.0, 1);
    expect(r.unit).toBe("MB");
  });

  it("THRU-005 total data received is dataReceived / 1_048_576 MB", () => {
    // 31_457_280 / 1_048_576 = 30.00 MB
    const r = calc.calculate(makeInput()).find((m) => m.id === "THRU-005")!;
    expect(r.value).toBeCloseTo(30.0, 1);
    expect(r.unit).toBe("MB");
  });

  // ── THRU-006 / THRU-007: Bandwidth ────────────────────────────────────────

  it("THRU-006 outbound bandwidth is (dataSent * 8) / 1_000_000 / durationSec Mbps", () => {
    // (3_145_728 * 8) / 1_000_000 / 60 ≈ 0.419 Mbps
    const expected = (3_145_728 * 8) / 1_000_000 / 60;
    const r = calc.calculate(makeInput()).find((m) => m.id === "THRU-006")!;
    expect(r.value).toBeCloseTo(expected, 2);
    expect(r.unit).toBe("Mbps");
  });

  it("THRU-007 inbound bandwidth is (dataReceived * 8) / 1_000_000 / durationSec Mbps", () => {
    // (31_457_280 * 8) / 1_000_000 / 60 ≈ 4.194 Mbps
    const expected = (31_457_280 * 8) / 1_000_000 / 60;
    const r = calc.calculate(makeInput()).find((m) => m.id === "THRU-007")!;
    expect(r.value).toBeCloseTo(expected, 2);
    expect(r.unit).toBe("Mbps");
  });

  // ── THRU-008: Throughput per VU ───────────────────────────────────────────

  it("THRU-008 is rps / vusMax", () => {
    // rps=50, vusMax=50 → 1.0 RPS/VU
    const r = calc.calculate(makeInput()).find((m) => m.id === "THRU-008")!;
    expect(r.value).toBeCloseTo(1.0, 2);
    expect(r.unit).toBe("RPS/VU");
  });

  it("THRU-008 is 0 when vusMax is 0 (zero-division guard)", () => {
    const input = makeInput({ vusMax: 0 });
    const r = calc.calculate(input).find((m) => m.id === "THRU-008")!;
    expect(r.value).toBe(0);
  });

  it("THRU-008 passes threshold when > 0.5 RPS/VU", () => {
    // rps=50, vusMax=50 → 1.0 RPS/VU which is > 0.5
    const r = calc.calculate(makeInput()).find((m) => m.id === "THRU-008")!;
    expect(r.status).toBe("pass");
  });

  it("THRU-008 fails threshold when efficiency is below 0.5 RPS/VU", () => {
    const input = makeInput({ vusMax: 200 });
    // rps=50, vusMax=200 → 0.25 RPS/VU which is < 0.5
    const r = calc.calculate(input).find((m) => m.id === "THRU-008")!;
    expect(r.status).toBe("fail");
  });

  // ── THRU-009: Peak-to-mean RPS Ratio ──────────────────────────────────────

  it("THRU-009 is N/A when no rps external series is provided", () => {
    const r = calc.calculate(makeInput()).find((m) => m.id === "THRU-009")!;
    expect(r.status).toBe("na");
    expect(r.value).toBeNull();
  });

  it("THRU-009 is N/A when rps series has fewer than 3 points", () => {
    const input = makeInput({
      externalMetrics: {
        rps: [
          { ts: 0, value: 50 },
          { ts: 1, value: 60 },
        ],
      },
    });
    const r = calc.calculate(input).find((m) => m.id === "THRU-009")!;
    expect(r.status).toBe("na");
  });

  it("THRU-009 computes peak/mean ratio when series has >= 3 points", () => {
    const input = makeInput({
      externalMetrics: {
        rps: [
          { ts: 0, value: 40 },
          { ts: 1, value: 50 },
          { ts: 2, value: 60 }, // peak=60, mean=50 → ratio=1.2
        ],
      },
    });
    const r = calc.calculate(input).find((m) => m.id === "THRU-009")!;
    expect(r.status).not.toBe("na");
    expect(r.value).toBeCloseTo(1.2, 1);
  });

  // ── THRU-011: Little's Law Deviation ──────────────────────────────────────

  it("THRU-011 computes deviation as |vusMax - N| / vusMax × 100%", () => {
    // rps=50, latency=0.2s → N = 50*0.2 = 10, vusMax=50
    // deviation = |50-10|/50 * 100 = 80%
    const r = calc.calculate(makeInput()).find((m) => m.id === "THRU-011")!;
    expect(r.value).toBeCloseTo(80, 0);
    expect(r.unit).toBe("%");
  });

  it("THRU-011 deviation is 0% when Little's Law holds exactly", () => {
    // N = λW: vusMax = rps * latency_s
    // rps = totalReqs / durationSec = 3000/60 = 50
    // For deviation=0: vusMax = 50 * (avgMs/1000) → avgMs = vusMax * 1000 / rps = 50*1000/50 = 1000ms
    const input = makeInput();
    input.k6Metrics["http_req_duration"]!.values!["avg"] = 1000; // 1s
    // N = 50 * 1.0 = 50 = vusMax → deviation = 0
    const r = calc.calculate(input).find((m) => m.id === "THRU-011")!;
    expect(r.value).toBeCloseTo(0, 0);
  });

  // ── THRU-012: Goodput Rate ────────────────────────────────────────────────

  it("THRU-012 is successReqs / totalReqs × 100%", () => {
    // (3000 - 30) / 3000 * 100 = 99.0%
    const r = calc.calculate(makeInput()).find((m) => m.id === "THRU-012")!;
    expect(r.value).toBeCloseTo(99.0, 1);
    expect(r.unit).toBe("%");
  });

  it("THRU-012 is 100% when there are no failures", () => {
    const input = makeInput();
    input.k6Metrics["http_req_failed"]!.values!["passes"] = 0;
    const r = calc.calculate(input).find((m) => m.id === "THRU-012")!;
    expect(r.value).toBe(100);
    expect(r.status).toBe("pass");
  });

  it("THRU-012 passes threshold >= 99% when failures are low", () => {
    const r = calc.calculate(makeInput()).find((m) => m.id === "THRU-012")!;
    expect(r.status).toBe("pass"); // 99.0% >= 99
  });

  it("THRU-012 fails threshold when error rate is high", () => {
    const input = makeInput();
    input.k6Metrics["http_req_failed"]!.values!["passes"] = 600; // 20% failures
    const r = calc.calculate(input).find((m) => m.id === "THRU-012")!;
    expect(r.status).toBe("fail");
  });

  it("THRU-012 defaults to 1 (100%) when totalReqs is 0", () => {
    const input = makeEmptyInput();
    const r = calc.calculate(input).find((m) => m.id === "THRU-012")!;
    expect(r.value).toBeCloseTo(100, 0); // 1 * 100
  });

  // ── THRU-013: Retry Amplification Factor ──────────────────────────────────

  it("THRU-013 is totalReqs / iterations", () => {
    // 3000 / 3000 = 1.0 (no amplification)
    const r = calc.calculate(makeInput()).find((m) => m.id === "THRU-013")!;
    expect(r.value).toBeCloseTo(1.0, 2);
    expect(r.unit).toBe("ratio");
    expect(r.status).toBe("pass"); // 1.0 < 1.5 threshold
  });

  it("THRU-013 detects amplification when requests > iterations", () => {
    const input = makeInput();
    input.k6Metrics["http_reqs"]!.values!["count"] = 6000; // 2x amplification
    const r = calc.calculate(input).find((m) => m.id === "THRU-013")!;
    expect(r.value).toBeCloseTo(2.0, 2);
    expect(r.status).toBe("fail"); // 2.0 > 1.5 threshold
  });

  it("THRU-013 defaults to 1 when iterations is 0", () => {
    const input = makeEmptyInput();
    const r = calc.calculate(input).find((m) => m.id === "THRU-013")!;
    expect(r.value).toBeCloseTo(1.0, 0);
  });

  // ── THRU-017: Rate-limit 429 rate ─────────────────────────────────────────

  it("THRU-017 is N/A when totalReqs is 0", () => {
    const input = makeEmptyInput();
    const r = calc.calculate(input).find((m) => m.id === "THRU-017")!;
    expect(r.status).toBe("na");
  });

  it("THRU-017 is 0% when no 429 requests observed", () => {
    // No http_req_duration{status:429} key in k6Metrics → 0 count
    const r = calc.calculate(makeInput()).find((m) => m.id === "THRU-017")!;
    expect(r.value).toBe(0);
    expect(r.unit).toBe("%");
    expect(r.status).toBe("pass");
  });

  // ── Workload N/A metrics (THRU-014 to THRU-016) ───────────────────────────

  it("THRU-014 through THRU-016 are always N/A (require tagged workload)", () => {
    const results = calc.calculate(makeInput());
    const naIds = ["THRU-014", "THRU-015", "THRU-016"];
    for (const id of naIds) {
      const r = results.find((m) => m.id === id);
      expect(r, `${id} should exist`).toBeDefined();
      expect(r!.status, `${id} should be na`).toBe("na");
      expect(r!.value).toBeNull();
    }
  });

  // ── Misc N/A metrics (THRU-018 to THRU-025) ──────────────────────────────

  it("THRU-018 through THRU-025 are always N/A (require specific scenarios)", () => {
    const results = calc.calculate(makeInput());
    const naIds = ["THRU-018", "THRU-019", "THRU-020", "THRU-021",
      "THRU-022", "THRU-023", "THRU-024", "THRU-025"];
    for (const id of naIds) {
      const r = results.find((m) => m.id === id);
      expect(r, `${id} should exist`).toBeDefined();
      expect(r!.status, `${id} should be na`).toBe("na");
      expect(r!.value).toBeNull();
    }
  });

  // ── Full output size ─────────────────────────────────────────────────────

  it("calculate() always produces exactly 25 results (THRU-001 to THRU-025)", () => {
    const results = calc.calculate(makeInput());
    expect(results.length).toBe(25);
  });

  // ── Empty metrics fallback ────────────────────────────────────────────────

  it("empty k6Metrics produces 0 RPS without throwing", () => {
    const results = calc.calculate(makeEmptyInput());
    const r = results.find((m) => m.id === "THRU-001")!;
    expect(r.value).toBe(0);
  });

  it("empty k6Metrics still returns 25 results", () => {
    const results = calc.calculate(makeEmptyInput());
    expect(results.length).toBe(25);
  });
});
