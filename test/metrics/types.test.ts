import { describe, it, expect } from "vitest";
import {
  k6Stat,
  naMetric,
  evalThreshold,
  linearRegressionSlope,
  stddev,
} from "../../src/metrics/types";
import type { K6MetricsMap } from "../../src/metrics/types";

// ── k6Stat ──────────────────────────────────────────────────────────────────
describe("k6Stat", () => {
  const metrics: K6MetricsMap = {
    http_req_duration: { values: { avg: 150, med: 120, "p(95)": 400, "p(99)": 800 } },
    http_reqs: { values: { count: 1000, rate: 50 } },
  };

  it("reads existing stat value", () => {
    expect(k6Stat(metrics, "http_req_duration", "avg")).toBe(150);
  });

  it("reads nested stat keys like p(95)", () => {
    expect(k6Stat(metrics, "http_req_duration", "p(95)")).toBe(400);
  });

  it("returns default when metric name does not exist", () => {
    expect(k6Stat(metrics, "nonexistent", "avg")).toBe(0);
  });

  it("returns default when stat does not exist", () => {
    expect(k6Stat(metrics, "http_req_duration", "p(75)")).toBe(0);
  });

  it("returns custom default value", () => {
    expect(k6Stat(metrics, "nonexistent", "avg", -1)).toBe(-1);
  });

  it("handles empty metrics map", () => {
    expect(k6Stat({}, "http_req_duration", "avg")).toBe(0);
  });

  it("handles metric without values", () => {
    expect(k6Stat({ m: { type: "trend" } }, "m", "avg")).toBe(0);
  });
});

// ── naMetric ────────────────────────────────────────────────────────────────
describe("naMetric", () => {
  it("creates a properly structured N/A metric", () => {
    const result = naMetric("PERF-001", "Response Time", "performance", "ms", "No data");
    expect(result).toEqual({
      id: "PERF-001",
      name: "Response Time",
      category: "performance",
      value: null,
      unit: "ms",
      status: "na",
      description: "No data",
      source: "external",
      naReason: "No data",
    });
  });
});

// ── evalThreshold ───────────────────────────────────────────────────────────
describe("evalThreshold", () => {
  // Less than operator
  it("passes when value < threshold", () => {
    expect(evalThreshold(400, "< 500")).toBe("pass");
  });

  it("fails when value >= threshold (< operator)", () => {
    expect(evalThreshold(600, "< 500")).toBe("fail");
  });

  it("warns when value is in warn zone (< operator)", () => {
    // Threshold: < 500, warn at < 550 (500 * 1.1). Value 520 < 550 = warn
    expect(evalThreshold(520, "< 500")).toBe("warn");
  });

  // Less than or equal operator
  it("passes when value <= threshold", () => {
    expect(evalThreshold(500, "<= 500")).toBe("pass");
  });

  it("fails when value > threshold (<= operator)", () => {
    expect(evalThreshold(600, "<= 500")).toBe("fail");
  });

  // Greater than operator
  it("passes when value > threshold", () => {
    expect(evalThreshold(0.95, "> 0.9")).toBe("pass");
  });

  it("fails when value <= threshold (> operator)", () => {
    expect(evalThreshold(0.8, "> 0.9")).toBe("fail");
  });

  // Greater than or equal operator
  it("passes when value >= threshold", () => {
    expect(evalThreshold(0.9, ">= 0.9")).toBe("pass");
  });

  it("fails when value < threshold (>= operator)", () => {
    expect(evalThreshold(0.8, ">= 0.9")).toBe("fail");
  });

  // Equal operator
  it("passes when value == threshold", () => {
    expect(evalThreshold(100, "== 100")).toBe("pass");
  });

  it("returns warn when value is close to == threshold", () => {
    // 99 vs == 100: not equal, but within warnMultiplier range => 'warn'
    expect(evalThreshold(99, "== 100")).toBe("warn");
  });

  it("fails when value is far from == threshold", () => {
    // 50 vs == 100: not equal, outside warnMultiplier range => 'fail'
    expect(evalThreshold(50, "== 100")).toBe("fail");
  });

  // Edge cases
  it("returns pass for invalid threshold expression", () => {
    expect(evalThreshold(500, "invalid")).toBe("pass");
  });

  it("handles custom warn multiplier", () => {
    // value=510, threshold=< 500, warnMultiplier=1.05 => warnN=525 => 510 < 525 => warn
    expect(evalThreshold(510, "< 500", 1.05)).toBe("warn");
  });

  it("fails when value exceeds warn zone", () => {
    // value=600, threshold=< 500, warnMultiplier=1.1 => warnN=550 => 600 > 550 => fail
    expect(evalThreshold(600, "< 500", 1.1)).toBe("fail");
  });
});

// ── linearRegressionSlope ───────────────────────────────────────────────────
describe("linearRegressionSlope", () => {
  it("returns 0 for empty array", () => {
    expect(linearRegressionSlope([])).toBe(0);
  });

  it("returns 0 for single point", () => {
    expect(linearRegressionSlope([{ x: 1, y: 2 }])).toBe(0);
  });

  it("calculates positive slope for ascending points", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 1, y: 2 },
      { x: 2, y: 4 },
      { x: 3, y: 6 },
    ];
    expect(linearRegressionSlope(points)).toBeCloseTo(2, 5);
  });

  it("calculates negative slope for descending points", () => {
    const points = [
      { x: 0, y: 10 },
      { x: 1, y: 8 },
      { x: 2, y: 6 },
      { x: 3, y: 4 },
    ];
    expect(linearRegressionSlope(points)).toBeCloseTo(-2, 5);
  });

  it("calculates slope for noisy data", () => {
    const points = [
      { x: 0, y: 1 },
      { x: 1, y: 3 },
      { x: 2, y: 2 },
      { x: 3, y: 5 },
    ];
    const slope = linearRegressionSlope(points);
    expect(slope).toBeGreaterThan(0);
    expect(slope).toBeLessThan(3);
  });

  it("returns 0 when all x values are the same", () => {
    const points = [
      { x: 5, y: 1 },
      { x: 5, y: 3 },
      { x: 5, y: 2 },
    ];
    expect(linearRegressionSlope(points)).toBe(0);
  });
});

// ── stddev ──────────────────────────────────────────────────────────────────
describe("stddev", () => {
  it("returns 0 for empty array", () => {
    expect(stddev([])).toBe(0);
  });

  it("returns 0 for single element", () => {
    expect(stddev([42])).toBe(0);
  });

  it("returns 0 for identical values", () => {
    expect(stddev([5, 5, 5, 5])).toBe(0);
  });

  it("calculates standard deviation correctly", () => {
    // Values: [2, 4, 4, 4, 5, 5, 7, 9], mean = 5, variance = 4, stddev = 2
    expect(stddev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2, 5);
  });

  it("handles two values", () => {
    // [0, 10], mean=5, variance=25, stddev=5
    expect(stddev([0, 10])).toBeCloseTo(5, 5);
  });
});
