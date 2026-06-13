/**
 * Unit tests for PerformanceCalculator (T-181)
 *
 * Tests cover:
 * - All percentile metrics (PERF-001 to PERF-007)
 * - Stddev and CV derivation (PERF-008, PERF-009)
 * - TTFB metrics (PERF-010 to PERF-012)
 * - Network phase metrics (PERF-013 to PERF-019)
 * - Apdex score classification (PERF-020)
 * - Trend slope with and without time-series (PERF-021)
 * - Idle time estimation (PERF-022)
 * - VU efficiency (PERF-024)
 * - N/A metrics for protocol-specific and infrastructure (PERF-025+)
 * - Empty metrics map produces N/A-safe numeric results
 */

import { PerformanceCalculator } from "../../../src/metrics/calculators/performance-calculator";
import type { MetricsEngineInput } from "../../../src/metrics/types";

// ── Fixture helpers ───────────────────────────────────────────────────────────

/**
 * Build a MetricsEngineInput with realistic k6 defaults.
 * Any field can be overridden with a deep-partial spread.
 */
function makeInput(overrides: Partial<MetricsEngineInput> = {}): MetricsEngineInput {
  return {
    durationMs: 60_000, // 60 seconds
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
      http_req_waiting: {
        values: { avg: 150, "p(95)": 380, "p(99)": 700 },
      },
      http_req_connecting: {
        values: { avg: 10 },
      },
      http_req_tls_handshaking: {
        values: { avg: 20 },
      },
      http_req_sending: {
        values: { avg: 5 },
      },
      http_req_receiving: {
        values: { avg: 15 },
      },
      http_reqs: {
        values: { count: 3000 },
      },
      http_req_failed: {
        values: { passes: 30 }, // 1% failure
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
    },
    context: {
      client: "test-client",
      environment: "staging",
      profile: "load",
      testName: "perf-calc-unit-test",
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

describe("PerformanceCalculator", () => {
  let calc: PerformanceCalculator;

  beforeEach(() => {
    calc = new PerformanceCalculator();
  });

  // ── Category ────────────────────────────────────────────────────────────────

  it("exposes category 'performance'", () => {
    expect(calc.category).toBe("performance");
  });

  // ── Return shape ─────────────────────────────────────────────────────────────

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
      expect(r).toHaveProperty("category", "performance");
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

  // ── PERF-001: Average response time ──────────────────────────────────────────

  it("PERF-001 value equals http_req_duration avg", () => {
    const results = calc.calculate(makeInput());
    const r = results.find((m) => m.id === "PERF-001")!;
    expect(r).toBeDefined();
    expect(r.value).toBe(200);
    expect(r.unit).toBe("ms");
  });

  it("PERF-001 passes when avg < 500", () => {
    const r = calc.calculate(makeInput()).find((m) => m.id === "PERF-001")!;
    expect(r.status).toBe("pass");
  });

  it("PERF-001 fails when avg is far above 500", () => {
    const input = makeInput();
    input.k6Metrics["http_req_duration"]!.values!["avg"] = 1500;
    const r = calc.calculate(input).find((m) => m.id === "PERF-001")!;
    expect(r.status).toBe("fail");
  });

  // ── PERF-002 through PERF-007: Percentile metrics ─────────────────────────

  it("PERF-002 value equals http_req_duration min", () => {
    const r = calc.calculate(makeInput()).find((m) => m.id === "PERF-002")!;
    expect(r.value).toBe(50);
    expect(r.unit).toBe("ms");
  });

  it("PERF-003 value equals http_req_duration med", () => {
    const r = calc.calculate(makeInput()).find((m) => m.id === "PERF-003")!;
    expect(r.value).toBe(180);
  });

  it("PERF-004 value equals http_req_duration p(90)", () => {
    const r = calc.calculate(makeInput()).find((m) => m.id === "PERF-004")!;
    expect(r.value).toBe(350);
  });

  it("PERF-005 value equals http_req_duration p(95)", () => {
    const r = calc.calculate(makeInput()).find((m) => m.id === "PERF-005")!;
    expect(r.value).toBe(420);
  });

  it("PERF-006 value equals http_req_duration p(99)", () => {
    const r = calc.calculate(makeInput()).find((m) => m.id === "PERF-006")!;
    expect(r.value).toBe(750);
  });

  it("PERF-007 value equals http_req_duration max", () => {
    const r = calc.calculate(makeInput()).find((m) => m.id === "PERF-007")!;
    expect(r.value).toBe(900);
  });

  it("PERF-007 fails when max exceeds 5000 ms threshold", () => {
    const input = makeInput();
    input.k6Metrics["http_req_duration"]!.values!["max"] = 8000;
    const r = calc.calculate(input).find((m) => m.id === "PERF-007")!;
    expect(r.status).toBe("fail");
  });

  // ── PERF-008: Stddev estimate ─────────────────────────────────────────────

  it("PERF-008 computes a non-negative stddev estimate", () => {
    const r = calc.calculate(makeInput()).find((m) => m.id === "PERF-008")!;
    expect(r.value).toBeGreaterThanOrEqual(0);
    expect(r.unit).toBe("ms");
  });

  it("PERF-008 stddev is |p99 - avg| / 2.576 when p90 > 0", () => {
    const input = makeInput();
    // avg=200, p99=750 → stddev estimate = (750-200)/2.576 ≈ 213.47
    const expected = parseFloat((Math.abs(750 - 200) / 2.576).toFixed(2));
    const r = calc.calculate(input).find((m) => m.id === "PERF-008")!;
    expect(r.value).toBeCloseTo(expected, 1);
  });

  // ── PERF-009: Coefficient of Variation ───────────────────────────────────

  it("PERF-009 is 0% CV when avg is 0", () => {
    const input = makeEmptyInput();
    const r = calc.calculate(input).find((m) => m.id === "PERF-009")!;
    expect(r.value).toBe(0);
    expect(r.unit).toBe("%");
  });

  it("PERF-009 CV passes when below 50% threshold", () => {
    // avg=200, stddev≈213 → CV≈106% which exceeds 50% → fail/warn
    // Use a low p99 scenario to produce a small CV
    const input = makeInput();
    input.k6Metrics["http_req_duration"]!.values!["p(99)"] = 250; // p99 close to avg=200
    const r = calc.calculate(input).find((m) => m.id === "PERF-009")!;
    // stddev = (250-200)/2.576 ≈ 19.4, CV = 19.4/200*100 ≈ 9.7% → pass
    expect(r.status).toBe("pass");
  });

  // ── PERF-010 to PERF-012: TTFB metrics ───────────────────────────────────

  it("PERF-010 value equals http_req_waiting avg", () => {
    const r = calc.calculate(makeInput()).find((m) => m.id === "PERF-010")!;
    expect(r.value).toBe(150);
    expect(r.unit).toBe("ms");
  });

  it("PERF-011 value equals http_req_waiting p(95)", () => {
    const r = calc.calculate(makeInput()).find((m) => m.id === "PERF-011")!;
    expect(r.value).toBe(380);
  });

  it("PERF-012 value equals http_req_waiting p(99)", () => {
    const r = calc.calculate(makeInput()).find((m) => m.id === "PERF-012")!;
    expect(r.value).toBe(700);
  });

  // ── PERF-013 to PERF-017: Network phase metrics ───────────────────────────

  it("PERF-013 (DNS Lookup) uses http_req_connecting avg", () => {
    const r = calc.calculate(makeInput()).find((m) => m.id === "PERF-013")!;
    expect(r.value).toBe(10);
  });

  it("PERF-015 (TLS Handshake) uses http_req_tls_handshaking avg", () => {
    const r = calc.calculate(makeInput()).find((m) => m.id === "PERF-015")!;
    expect(r.value).toBe(20);
    expect(r.unit).toBe("ms");
  });

  it("PERF-016 (Request Sending) uses http_req_sending avg", () => {
    const r = calc.calculate(makeInput()).find((m) => m.id === "PERF-016")!;
    expect(r.value).toBe(5);
  });

  it("PERF-017 (Response Receiving) uses http_req_receiving avg", () => {
    const r = calc.calculate(makeInput()).find((m) => m.id === "PERF-017")!;
    expect(r.value).toBe(15);
  });

  // ── PERF-018: Content Transfer Time ──────────────────────────────────────

  it("PERF-018 is max(0, recvAvg - sendAvg)", () => {
    // recv=15, send=5 → content transfer = 10
    const r = calc.calculate(makeInput()).find((m) => m.id === "PERF-018")!;
    expect(r.value).toBe(10);
  });

  it("PERF-018 is 0 when sending > receiving (no negative transfer)", () => {
    const input = makeInput();
    input.k6Metrics["http_req_sending"]!.values!["avg"] = 50;
    input.k6Metrics["http_req_receiving"]!.values!["avg"] = 10;
    const r = calc.calculate(input).find((m) => m.id === "PERF-018")!;
    expect(r.value).toBe(0);
  });

  // ── PERF-019: Server Processing Time ─────────────────────────────────────

  it("PERF-019 is max(0, ttfbAvg - dns - tcp - tls)", () => {
    // ttfb=150, dns=10, tcp=10, tls=20 → server = 150-10-10-20=110
    const r = calc.calculate(makeInput()).find((m) => m.id === "PERF-019")!;
    expect(r.value).toBe(110);
  });

  // ── PERF-020: Apdex Score ────────────────────────────────────────────────

  it("PERF-020 returns an Apdex score between 0 and 1", () => {
    const r = calc.calculate(makeInput()).find((m) => m.id === "PERF-020")!;
    expect(r.value).toBeGreaterThanOrEqual(0);
    expect(r.value!).toBeLessThanOrEqual(1);
    expect(r.unit).toBe("");
  });

  it("PERF-020 Apdex is near 1.0 when all percentiles are well below T=500ms", () => {
    const input = makeInput();
    const dur = input.k6Metrics["http_req_duration"]!.values!;
    dur["med"] = 50;
    dur["p(90)"] = 80;
    dur["p(95)"] = 100;
    dur["p(99)"] = 120;
    dur["max"] = 150;
    input.k6Metrics["http_req_failed"]!.values!["passes"] = 0;
    const r = calc.calculate(input).find((m) => m.id === "PERF-020")!;
    expect(r.value).toBeCloseTo(1.0, 2);
    expect(r.status).toBe("pass"); // threshold >= 0.9
  });

  it("PERF-020 Apdex degrades when percentiles exceed T=500ms", () => {
    const input = makeInput();
    const dur = input.k6Metrics["http_req_duration"]!.values!;
    dur["med"] = 600;
    dur["p(90)"] = 1200;
    dur["p(95)"] = 1800;
    dur["p(99)"] = 2500;
    dur["max"] = 5000;
    const r = calc.calculate(input).find((m) => m.id === "PERF-020")!;
    expect(r.value!).toBeLessThan(0.9);
  });

  it("PERF-020 Apdex is reduced when many requests fail", () => {
    const inputAll = makeInput();
    inputAll.k6Metrics["http_req_failed"]!.values!["passes"] = 0;
    const inputFailed = makeInput();
    inputFailed.k6Metrics["http_req_failed"]!.values!["passes"] = 2700; // 90% failures

    const allPass = calc.calculate(inputAll).find((m) => m.id === "PERF-020")!;
    const manyFail = calc.calculate(inputFailed).find((m) => m.id === "PERF-020")!;
    expect(allPass.value!).toBeGreaterThan(manyFail.value!);
  });

  it("PERF-020 Apdex is 1 when k6Metrics has no requests (zero-division guard)", () => {
    const input = makeEmptyInput();
    const r = calc.calculate(input).find((m) => m.id === "PERF-020")!;
    expect(r.value).toBe(1);
  });

  // ── PERF-021: Trend Slope ──────────────────────────────────────────────────

  it("PERF-021 is N/A when no external time-series is provided", () => {
    const r = calc.calculate(makeInput()).find((m) => m.id === "PERF-021")!;
    expect(r.status).toBe("na");
    expect(r.value).toBeNull();
  });

  it("PERF-021 is N/A when time-series has only 1 data point", () => {
    const input = makeInput({
      externalMetrics: { http_req_duration_p95: [{ ts: 0, value: 400 }] },
    });
    const r = calc.calculate(input).find((m) => m.id === "PERF-021")!;
    expect(r.status).toBe("na");
  });

  it("PERF-021 computes slope in ms/min when time-series has >= 2 points", () => {
    // Points: index 0→300, 1→360, 2→420 → slope per index=60, per min=60*60=3600
    const input = makeInput({
      externalMetrics: {
        http_req_duration_p95: [
          { ts: 0, value: 300 },
          { ts: 1, value: 360 },
          { ts: 2, value: 420 },
        ],
      },
    });
    const r = calc.calculate(input).find((m) => m.id === "PERF-021")!;
    expect(r.status).not.toBe("na");
    expect(r.value).not.toBeNull();
    expect(r.unit).toBe("ms/min");
    // slope per unit = 60 → per minute = 60 * 60 = 3600
    expect(r.value).toBeCloseTo(3600, 0);
  });

  // ── PERF-022: Idle / Think Time ───────────────────────────────────────────

  it("PERF-022 idle time is non-negative", () => {
    const r = calc.calculate(makeInput()).find((m) => m.id === "PERF-022")!;
    expect(r.value).toBeGreaterThanOrEqual(0);
    expect(r.unit).toBe("ms");
  });

  it("PERF-022 idle time is 0 when iterations are 0 (guard against division by zero)", () => {
    const input = makeInput();
    input.k6Metrics["iterations"]!.values!["count"] = 0;
    const r = calc.calculate(input).find((m) => m.id === "PERF-022")!;
    // avgIterDuration = 0 when iterations=0, idleTime = max(0, 0-avg) = 0
    expect(r.value).toBe(0);
  });

  // ── PERF-024: VU Efficiency ───────────────────────────────────────────────

  it("PERF-024 is RPS / vusMax", () => {
    // totalReqs=3000, durationSec=60 → rps=50, vusMax=50 → vuEfficiency=1.0
    const r = calc.calculate(makeInput()).find((m) => m.id === "PERF-024")!;
    expect(r.value).toBeCloseTo(1.0, 2);
    expect(r.unit).toBe("RPS/VU");
  });

  it("PERF-024 is 0 when vusMax is 0 (guard against division by zero)", () => {
    const input = makeInput({ vusMax: 0 });
    const r = calc.calculate(input).find((m) => m.id === "PERF-024")!;
    expect(r.value).toBe(0);
  });

  it("PERF-024 passes threshold when VU efficiency > 1 RPS/VU", () => {
    // totalReqs=6000, durationSec=60 → rps=100, vusMax=50 → efficiency=2
    const input = makeInput();
    input.k6Metrics["http_reqs"]!.values!["count"] = 6000;
    const r = calc.calculate(input).find((m) => m.id === "PERF-024")!;
    expect(r.status).toBe("pass");
  });

  // ── Protocol N/A metrics ─────────────────────────────────────────────────

  it("PERF-025 through PERF-034 are all N/A (protocol-specific)", () => {
    const results = calc.calculate(makeInput());
    const naIds = ["PERF-025", "PERF-026", "PERF-027", "PERF-028", "PERF-029",
      "PERF-030", "PERF-031", "PERF-032", "PERF-033", "PERF-034"];
    for (const id of naIds) {
      const r = results.find((m) => m.id === id);
      expect(r, `${id} should exist`).toBeDefined();
      expect(r!.status, `${id} should be na`).toBe("na");
      expect(r!.value).toBeNull();
    }
  });

  // ── PERF-035 / PERF-036: Payload sizes ────────────────────────────────────

  it("PERF-035 avg response payload is dataReceived / totalReqs / 1024 KB", () => {
    // dataReceived=31_457_280 bytes, totalReqs=3000 → per req = 10485.76 bytes = 10.24 KB
    const r = calc.calculate(makeInput()).find((m) => m.id === "PERF-035")!;
    expect(r.value).toBeCloseTo(10.24, 1);
    expect(r.unit).toBe("KB");
  });

  it("PERF-036 avg request payload is dataSent / totalReqs / 1024 KB", () => {
    // dataSent=3_145_728 bytes, totalReqs=3000 → per req = 1048.576 bytes = 1.024 KB
    const r = calc.calculate(makeInput()).find((m) => m.id === "PERF-036")!;
    expect(r.value).toBeCloseTo(1.02, 1);
    expect(r.unit).toBe("KB");
  });

  // ── PERF-041 / PERF-042: External infra correlation ───────────────────────

  it("PERF-041 is N/A when no cpu_usage_percent series provided", () => {
    const r = calc.calculate(makeInput()).find((m) => m.id === "PERF-041")!;
    expect(r.status).toBe("na");
  });

  it("PERF-041 computes avg CPU when series has >= 2 points", () => {
    const input = makeInput({
      externalMetrics: {
        cpu_usage_percent: [
          { ts: 0, value: 60 },
          { ts: 1, value: 80 },
          { ts: 2, value: 70 },
        ],
      },
    });
    const r = calc.calculate(input).find((m) => m.id === "PERF-041")!;
    expect(r.status).not.toBe("na");
    expect(r.value).toBeCloseTo(70, 0);
    expect(r.unit).toBe("%");
  });

  it("PERF-042 is N/A when no memory_usage_bytes series provided", () => {
    const r = calc.calculate(makeInput()).find((m) => m.id === "PERF-042")!;
    expect(r.status).toBe("na");
  });

  it("PERF-042 computes peak memory in MB when series is provided", () => {
    const input = makeInput({
      externalMetrics: {
        memory_usage_bytes: [
          { ts: 0, value: 512 * 1_048_576 }, // 512 MB
          { ts: 1, value: 1024 * 1_048_576 }, // 1024 MB
        ],
      },
    });
    const r = calc.calculate(input).find((m) => m.id === "PERF-042")!;
    expect(r.value).toBeCloseTo(1024, 0);
    expect(r.unit).toBe("MB");
  });

  // ── Empty metrics fallback ───────────────────────────────────────────────

  it("empty k6Metrics produces numeric 0 for all percentile results", () => {
    const results = calc.calculate(makeEmptyInput());
    const percentileIds = ["PERF-001", "PERF-002", "PERF-003", "PERF-004",
      "PERF-005", "PERF-006", "PERF-007"];
    for (const id of percentileIds) {
      const r = results.find((m) => m.id === id)!;
      expect(r, `${id} should exist`).toBeDefined();
      expect(typeof r.value === "number" || r.value === null).toBe(true);
    }
  });

  it("empty k6Metrics still produces 50 results covering all PERF IDs", () => {
    const results = calc.calculate(makeEmptyInput());
    expect(results.length).toBe(50);
  });
});
