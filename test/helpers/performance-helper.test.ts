import { describe, it, expect, vi, beforeEach } from "vitest";
import { PerformanceHelper } from "../../src/helpers/performance-helper";

describe("PerformanceHelper", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── percentiles ───────────────────────────────────────────────────────────

  describe("percentiles", () => {
    it("returns zeros for empty array", () => {
      const result = PerformanceHelper.percentiles([]);
      expect(result).toEqual({ p50: 0, p90: 0, p95: 0, p99: 0 });
    });

    it("calculates percentiles for a single value", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const result = PerformanceHelper.percentiles([100]);
      expect(result.p50).toBe(100);
      expect(result.p90).toBe(100);
      expect(result.p95).toBe(100);
      expect(result.p99).toBe(100);
      warnSpy.mockRestore();
    });

    it("calculates percentiles for sorted data", () => {
      // 100 values: 1, 2, 3, ..., 100
      const values = Array.from({ length: 100 }, (_, i) => i + 1);
      const result = PerformanceHelper.percentiles(values);
      expect(result.p50).toBeCloseTo(50.5, 1);
      expect(result.p90).toBeCloseTo(90.1, 0);
      expect(result.p95).toBeCloseTo(95.05, 0);
      expect(result.p99).toBeCloseTo(99.01, 0);
    });

    it("handles unsorted data correctly", () => {
      const values = [50, 10, 90, 30, 70, 20, 80, 40, 60, 100,
        5, 15, 25, 35, 45, 55, 65, 75, 85, 95,
        11, 22, 33, 44, 55, 66, 77, 88, 99, 1];
      const result = PerformanceHelper.percentiles(values);
      expect(result.p50).toBeGreaterThan(0);
      expect(result.p90).toBeGreaterThan(result.p50);
      expect(result.p95).toBeGreaterThanOrEqual(result.p90);
      expect(result.p99).toBeGreaterThanOrEqual(result.p95);
    });

    it("warns when sample count is below minimum", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      PerformanceHelper.percentiles([1, 2, 3]);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("only 3 samples")
      );
      warnSpy.mockRestore();
    });

    it("does not warn when sample count meets minimum", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const values = Array.from({ length: 30 }, (_, i) => i);
      PerformanceHelper.percentiles(values);
      expect(warnSpy).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it("rounds to 2 decimal places", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const values = [1.111, 2.222, 3.333];
      const result = PerformanceHelper.percentiles(values);
      const checkDecimalPlaces = (n: number) => {
        const decimals = n.toString().split(".")[1]?.length ?? 0;
        return decimals <= 2;
      };
      expect(checkDecimalPlaces(result.p50)).toBe(true);
      expect(checkDecimalPlaces(result.p90)).toBe(true);
      expect(checkDecimalPlaces(result.p95)).toBe(true);
      expect(checkDecimalPlaces(result.p99)).toBe(true);
      warnSpy.mockRestore();
    });
  });

  // ── aggregate ─────────────────────────────────────────────────────────────

  describe("aggregate", () => {
    it("returns zeros for empty array", () => {
      const result = PerformanceHelper.aggregate([]);
      expect(result).toEqual({ avg: 0, min: 0, max: 0, stddev: 0, count: 0 });
    });

    it("calculates correct statistics for a set of values", () => {
      const values = [10, 20, 30, 40, 50];
      const result = PerformanceHelper.aggregate(values);
      expect(result.count).toBe(5);
      expect(result.min).toBe(10);
      expect(result.max).toBe(50);
      expect(result.avg).toBe(30);
      // stddev for [10,20,30,40,50]: sqrt(((10-30)^2+(20-30)^2+(30-30)^2+(40-30)^2+(50-30)^2)/5) = sqrt(200) ≈ 14.14
      expect(result.stddev).toBeCloseTo(14.14, 1);
    });

    it("handles single value", () => {
      const result = PerformanceHelper.aggregate([42]);
      expect(result.count).toBe(1);
      expect(result.min).toBe(42);
      expect(result.max).toBe(42);
      expect(result.avg).toBe(42);
      expect(result.stddev).toBe(0);
    });

    it("handles identical values", () => {
      const result = PerformanceHelper.aggregate([5, 5, 5, 5]);
      expect(result.avg).toBe(5);
      expect(result.stddev).toBe(0);
    });

    it("rounds avg and stddev to 2 decimal places", () => {
      const values = [1, 2, 3];
      const result = PerformanceHelper.aggregate(values);
      const avgStr = result.avg.toString();
      const stddevStr = result.stddev.toString();
      const avgDecimals = avgStr.split(".")[1]?.length ?? 0;
      const stddevDecimals = stddevStr.split(".")[1]?.length ?? 0;
      expect(avgDecimals).toBeLessThanOrEqual(2);
      expect(stddevDecimals).toBeLessThanOrEqual(2);
    });
  });

  // ── compareBaseline ───────────────────────────────────────────────────────

  describe("compareBaseline", () => {
    it("calculates delta percent correctly", () => {
      const result = PerformanceHelper.compareBaseline("latency", 100, 110);
      expect(result.metric).toBe("latency");
      expect(result.baseline).toBe(100);
      expect(result.current).toBe(110);
      expect(result.deltaPercent).toBe(10);
      expect(result.withinThreshold).toBe(true); // exactly at 10% threshold
    });

    it("detects regression beyond threshold", () => {
      const result = PerformanceHelper.compareBaseline("latency", 100, 125, 10);
      expect(result.deltaPercent).toBe(25);
      expect(result.withinThreshold).toBe(false);
    });

    it("detects improvement within threshold", () => {
      const result = PerformanceHelper.compareBaseline("latency", 100, 95, 10);
      expect(result.deltaPercent).toBe(-5);
      expect(result.withinThreshold).toBe(true);
    });

    it("handles zero baseline", () => {
      const result = PerformanceHelper.compareBaseline("errors", 0, 5);
      expect(result.deltaPercent).toBe(0); // special case: baseline === 0
      expect(result.withinThreshold).toBe(true);
    });

    it("handles negative delta (improvement)", () => {
      const result = PerformanceHelper.compareBaseline("latency", 200, 150, 30);
      expect(result.deltaPercent).toBe(-25);
      expect(result.withinThreshold).toBe(true);
    });

    it("uses custom threshold", () => {
      const result = PerformanceHelper.compareBaseline("rps", 1000, 950, 3);
      expect(result.deltaPercent).toBe(-5);
      expect(result.withinThreshold).toBe(false); // 5% > 3% threshold
    });

    it("rounds deltaPercent to 2 decimal places", () => {
      const result = PerformanceHelper.compareBaseline("latency", 300, 301);
      const decimals = result.deltaPercent.toString().split(".")[1]?.length ?? 0;
      expect(decimals).toBeLessThanOrEqual(2);
    });
  });

  // ── evaluateThreshold ─────────────────────────────────────────────────────

  describe("evaluateThreshold", () => {
    it("evaluates less-than expression", () => {
      expect(PerformanceHelper.evaluateThreshold("p(95)<500", 400)).toBe(true);
      expect(PerformanceHelper.evaluateThreshold("p(95)<500", 500)).toBe(false);
      expect(PerformanceHelper.evaluateThreshold("p(95)<500", 600)).toBe(false);
    });

    it("evaluates less-than-or-equal expression", () => {
      expect(PerformanceHelper.evaluateThreshold("p(95)<=500", 500)).toBe(true);
      expect(PerformanceHelper.evaluateThreshold("p(95)<=500", 501)).toBe(false);
    });

    it("evaluates greater-than expression", () => {
      expect(PerformanceHelper.evaluateThreshold("rps>100", 200)).toBe(true);
      expect(PerformanceHelper.evaluateThreshold("rps>100", 100)).toBe(false);
    });

    it("evaluates greater-than-or-equal expression", () => {
      expect(PerformanceHelper.evaluateThreshold("rps>=100", 100)).toBe(true);
      expect(PerformanceHelper.evaluateThreshold("rps>=100", 99)).toBe(false);
    });

    it("handles decimal values in expressions", () => {
      expect(PerformanceHelper.evaluateThreshold("error_rate<0.01", 0.005)).toBe(true);
      expect(PerformanceHelper.evaluateThreshold("error_rate<0.01", 0.02)).toBe(false);
    });

    it("handles spaces around operator", () => {
      expect(PerformanceHelper.evaluateThreshold("p(95)< 500", 400)).toBe(true);
      expect(PerformanceHelper.evaluateThreshold("p(95)<  500", 400)).toBe(true);
    });

    it("throws on unsupported expression", () => {
      expect(() => PerformanceHelper.evaluateThreshold("invalid", 100)).toThrow(
        "unsupported threshold expression"
      );
    });
  });
});
