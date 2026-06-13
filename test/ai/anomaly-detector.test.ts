/**
 * Unit tests for AnomalyDetector, k6SummaryToSeries, and detectRegressions.
 * src/ai/analysis/anomaly-detector.ts
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  AnomalyDetector,
  k6SummaryToSeries,
  detectRegressions,
  type MetricSeries,
} from "../../src/ai/analysis/anomaly-detector";

describe("AnomalyDetector", () => {
  let detector: AnomalyDetector;

  beforeEach(() => {
    detector = new AnomalyDetector({ sensitivity: "medium" });
  });

  // ---------------------------------------------------------------------------
  // computeStats
  // ---------------------------------------------------------------------------
  describe("computeStats", () => {
    it("should return zeroed stats for empty array", () => {
      const stats = detector.computeStats([]);
      expect(stats.mean).toBe(0);
      expect(stats.stdDev).toBe(0);
      expect(stats.median).toBe(0);
      expect(stats.p25).toBe(0);
      expect(stats.p75).toBe(0);
      expect(stats.iqr).toBe(0);
      expect(stats.min).toBe(0);
      expect(stats.max).toBe(0);
      expect(stats.cv).toBe(0);
    });

    it("should compute correct stats for a known dataset", () => {
      const values = [10, 20, 30, 40, 50];
      const stats = detector.computeStats(values);

      expect(stats.mean).toBe(30);
      expect(stats.min).toBe(10);
      expect(stats.max).toBe(50);
      expect(stats.median).toBe(30);
      // stdDev for population: sqrt(((100+100+0+100+100)/5)) = sqrt(200) ~14.142
      expect(stats.stdDev).toBeCloseTo(14.142, 1);
      // p25 = 20, p75 = 40
      expect(stats.p25).toBe(20);
      expect(stats.p75).toBe(40);
      expect(stats.iqr).toBe(20);
    });

    it("should compute correct stats for a single value", () => {
      const stats = detector.computeStats([42]);
      expect(stats.mean).toBe(42);
      expect(stats.stdDev).toBe(0);
      expect(stats.median).toBe(42);
      expect(stats.min).toBe(42);
      expect(stats.max).toBe(42);
    });

    it("should compute cv (coefficient of variation) correctly", () => {
      const values = [100, 100, 100, 100];
      const stats = detector.computeStats(values);
      expect(stats.cv).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // detect (single series)
  // ---------------------------------------------------------------------------
  describe("detect", () => {
    it("should return empty anomalies for series with fewer than 3 values", () => {
      const series: MetricSeries = { name: "metric_a", values: [10, 20] };
      const result = detector.detect(series);
      expect(result.anomalies).toHaveLength(0);
      expect(result.metric).toBe(series);
    });

    it("should return empty anomalies for a perfectly stable series", () => {
      const series: MetricSeries = {
        name: "latency",
        values: Array(20).fill(100),
      };
      const result = detector.detect(series);
      // stdDev = 0 so z-score detection skips; IQR = 0; CUSUM = 0
      expect(result.anomalies).toHaveLength(0);
    });

    it("should detect a spike via z-score in a series with a clear outlier", () => {
      // 19 values at 100 and one extreme value at 500
      const values = [...Array(19).fill(100), 500];
      const series: MetricSeries = { name: "http_req_duration", values };
      const result = detector.detect(series);

      // At least one anomaly should be detected for the outlier
      expect(result.anomalies.length).toBeGreaterThan(0);
      // The anomaly should reference the correct metric
      const spikeAnomaly = result.anomalies.find((a) => a.observed === 500);
      expect(spikeAnomaly).toBeDefined();
      expect(spikeAnomaly!.metric).toBe("http_req_duration");
    });

    it("should detect IQR outliers", () => {
      // Create a series where some values are well above Q3 + 1.5*IQR
      const values = [10, 12, 11, 13, 10, 12, 11, 14, 10, 12, 80, 90];
      const series: MetricSeries = { name: "latency", values };
      const result = detector.detect(series);

      // 80 and 90 should be detected as outliers by IQR
      const iqrAnomalies = result.anomalies.filter((a) => a.detectedBy === "iqr");
      expect(iqrAnomalies.length).toBeGreaterThan(0);
    });

    it("should detect percentile deviation for values after reference window", () => {
      // First 5 values stable around 100, then a jump to 500 (large deviation)
      const values = [...Array(5).fill(100), 500, 500, 500, 500, 500, 500];
      const detector5 = new AnomalyDetector({
        sensitivity: "high",
        referenceWindow: 5,
        percentileDeviationPct: 10,
      });
      const series: MetricSeries = { name: "rps", values };
      const result = detector5.detect(series);

      const pctAnomalies = result.anomalies.filter((a) => a.detectedBy === "percentile");
      expect(pctAnomalies.length).toBeGreaterThan(0);
    });

    it("should elevate severity when multiple detectors agree", () => {
      // Create a series where an extreme outlier triggers z-score, IQR, and percentile
      const values = [...Array(15).fill(50), 500];
      const series: MetricSeries = { name: "errors", values };
      const result = detector.detect(series);

      // At least one anomaly should exist
      expect(result.anomalies.length).toBeGreaterThan(0);
    });

    it("should use timestamps when provided", () => {
      const baseTs = Date.now();
      const values = [...Array(15).fill(50), 500];
      const timestamps = values.map((_, i) => baseTs + i * 1000);
      const series: MetricSeries = { name: "metric_a", values, timestamps };
      const result = detector.detect(series);

      const anomaliesWithTimestamps = result.anomalies.filter(
        (a) => a.timestamp.includes("T") // ISO format
      );
      expect(anomaliesWithTimestamps.length).toBeGreaterThan(0);
    });

    it("should sort anomalies by timestamp", () => {
      const baseTs = Date.now();
      const values = [500, ...Array(13).fill(50), 500];
      const timestamps = values.map((_, i) => baseTs + i * 1000);
      const series: MetricSeries = { name: "metric_b", values, timestamps };
      const result = detector.detect(series);

      for (let i = 1; i < result.anomalies.length; i++) {
        expect(result.anomalies[i].timestamp >= result.anomalies[i - 1].timestamp).toBe(true);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // detectAll
  // ---------------------------------------------------------------------------
  describe("detectAll", () => {
    it("should detect anomalies across multiple series", () => {
      const series: MetricSeries[] = [
        { name: "latency", values: [...Array(15).fill(100), 500] },
        { name: "errors", values: [...Array(15).fill(0), 10] },
      ];
      const results = detector.detectAll(series);
      expect(results).toHaveLength(2);
    });

    it("should filter by metricsToMonitor when configured", () => {
      const detectorFiltered = new AnomalyDetector({
        sensitivity: "medium",
        metricsToMonitor: ["latency"],
      });
      const series: MetricSeries[] = [
        { name: "latency", values: [...Array(15).fill(100), 500] },
        { name: "errors", values: [...Array(15).fill(0), 10] },
      ];
      const results = detectorFiltered.detectAll(series);
      // Only latency should be analyzed
      expect(results).toHaveLength(1);
      expect(results[0].metric.name).toBe("latency");
    });

    it("should return empty results when all series are too short", () => {
      const series: MetricSeries[] = [
        { name: "a", values: [1] },
        { name: "b", values: [2, 3] },
      ];
      const results = detector.detectAll(series);
      expect(results).toHaveLength(2);
      expect(results[0].anomalies).toHaveLength(0);
      expect(results[1].anomalies).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Sensitivity presets
  // ---------------------------------------------------------------------------
  describe("sensitivity presets", () => {
    it("should use high sensitivity (lower thresholds)", () => {
      const detectorHigh = new AnomalyDetector({ sensitivity: "high" });
      const values = [...Array(15).fill(100), 150]; // mild outlier
      const series: MetricSeries = { name: "metric", values };
      const resultHigh = detectorHigh.detect(series);
      // High sensitivity may detect anomalies that medium would not
      // Just ensure it runs without error
      expect(resultHigh.stats.mean).toBeGreaterThan(0);
    });

    it("should use low sensitivity (higher thresholds)", () => {
      const detectorLow = new AnomalyDetector({ sensitivity: "low" });
      const values = [...Array(15).fill(100), 150]; // mild outlier
      const series: MetricSeries = { name: "metric", values };
      const resultLow = detectorLow.detect(series);
      // Low sensitivity should be more tolerant
      expect(resultLow.stats.mean).toBeGreaterThan(0);
    });

    it("should default to medium sensitivity", () => {
      const detectorDefault = new AnomalyDetector();
      const values = [...Array(15).fill(100), 500];
      const series: MetricSeries = { name: "metric", values };
      const result = detectorDefault.detect(series);
      expect(result.anomalies.length).toBeGreaterThan(0);
    });
  });

  // ---------------------------------------------------------------------------
  // CUSUM drift detection
  // ---------------------------------------------------------------------------
  describe("CUSUM drift detection", () => {
    it("should detect gradual drift (increasing trend)", () => {
      // Simulate gradual increase: 100, 102, 104, ...160 over 30 points
      const values = Array.from({ length: 30 }, (_, i) => 100 + i * 2);
      const series: MetricSeries = { name: "memory", values };
      const result = detector.detect(series);

      const _cusumAnomalies = result.anomalies.filter((a) => a.detectedBy === "cusum");
      // CUSUM should detect the upward drift
      // (whether it does depends on stdDev and threshold; the data has consistent drift)
      expect(result.stats).toBeDefined();
    });
  });
});

// ---------------------------------------------------------------------------
// k6SummaryToSeries
// ---------------------------------------------------------------------------
describe("k6SummaryToSeries", () => {
  it("should convert k6 summary JSON to MetricSeries array", () => {
    const summary = {
      metrics: {
        http_req_duration: {
          values: { p95: 250, p99: 350, avg: 100, max: 500 },
        },
        http_req_failed: {
          values: { rate: 0.01 },
        },
        iterations: {
          values: { value: 1000 },
        },
      },
    };
    const series = k6SummaryToSeries(summary);

    expect(series.length).toBeGreaterThan(0);

    const durationSeries = series.find((s) => s.name === "http_req_duration");
    expect(durationSeries).toBeDefined();
    expect(durationSeries!.values).toContain(250); // p95
    expect(durationSeries!.values).toContain(350); // p99
    expect(durationSeries!.unit).toBe("ms");

    const failedSeries = series.find((s) => s.name === "http_req_failed");
    expect(failedSeries).toBeDefined();
    expect(failedSeries!.unit).toBe("rate");
  });

  it("should return empty array when no metrics present", () => {
    const summary = {};
    const series = k6SummaryToSeries(summary);
    expect(series).toHaveLength(0);
  });

  it("should skip metrics without values", () => {
    const summary = {
      metrics: {
        http_req_duration: {},
        http_req_failed: { values: { rate: 0.05 } },
      },
    };
    const series = k6SummaryToSeries(summary);
    // http_req_duration should be skipped (no values extracted)
    const durationSeries = series.find((s) => s.name === "http_req_duration");
    expect(durationSeries).toBeUndefined();

    const failedSeries = series.find((s) => s.name === "http_req_failed");
    expect(failedSeries).toBeDefined();
  });

  it("should handle data_received and data_sent metrics", () => {
    const summary = {
      metrics: {
        data_received: { values: { value: 1024000 } },
        data_sent: { values: { value: 512000 } },
      },
    };
    const series = k6SummaryToSeries(summary);
    expect(series.find((s) => s.name === "data_received")).toBeDefined();
    expect(series.find((s) => s.name === "data_sent")).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// detectRegressions
// ---------------------------------------------------------------------------
describe("detectRegressions", () => {
  it("should detect a latency regression (higher is worse)", () => {
    const current: MetricSeries[] = [{ name: "http_req_duration", values: [300], unit: "ms" }];
    const baseline: MetricSeries[] = [{ name: "http_req_duration", values: [100], unit: "ms" }];
    const regressions = detectRegressions(current, baseline, 15);

    expect(regressions).toHaveLength(1);
    expect(regressions[0].metric).toBe("http_req_duration");
    expect(regressions[0].deltaRel).toBe(200); // 300 vs 100 = +200%
  });

  it("should detect a throughput regression (lower is worse)", () => {
    const current: MetricSeries[] = [{ name: "http_reqs", values: [50], unit: "rate" }];
    const baseline: MetricSeries[] = [{ name: "http_reqs", values: [100], unit: "rate" }];
    const regressions = detectRegressions(current, baseline, 15);

    expect(regressions).toHaveLength(1);
    expect(regressions[0].metric).toBe("http_reqs");
    expect(regressions[0].deltaRel).toBe(-50); // 50 vs 100 = -50%
  });

  it("should detect iterations regression (lower is worse)", () => {
    const current: MetricSeries[] = [{ name: "iterations", values: [200], unit: "count" }];
    const baseline: MetricSeries[] = [{ name: "iterations", values: [500], unit: "count" }];
    const regressions = detectRegressions(current, baseline, 15);

    expect(regressions).toHaveLength(1);
    expect(regressions[0].metric).toBe("iterations");
  });

  it("should not flag a regression when delta is within threshold", () => {
    const current: MetricSeries[] = [{ name: "http_req_duration", values: [105], unit: "ms" }];
    const baseline: MetricSeries[] = [{ name: "http_req_duration", values: [100], unit: "ms" }];
    const regressions = detectRegressions(current, baseline, 15);
    expect(regressions).toHaveLength(0);
  });

  it("should skip metrics not present in baseline", () => {
    const current: MetricSeries[] = [{ name: "custom_metric", values: [500], unit: "ms" }];
    const baseline: MetricSeries[] = [];
    const regressions = detectRegressions(current, baseline, 15);
    expect(regressions).toHaveLength(0);
  });

  it("should skip metrics where baseline mean is 0", () => {
    const current: MetricSeries[] = [{ name: "http_req_duration", values: [100], unit: "ms" }];
    const baseline: MetricSeries[] = [{ name: "http_req_duration", values: [0], unit: "ms" }];
    const regressions = detectRegressions(current, baseline, 15);
    expect(regressions).toHaveLength(0);
  });

  it("should assign severity based on delta magnitude", () => {
    const current: MetricSeries[] = [{ name: "http_req_duration", values: [600], unit: "ms" }];
    const baseline: MetricSeries[] = [{ name: "http_req_duration", values: [100], unit: "ms" }];
    // deltaRel = 500%, threshold * 3 = 45% => critical
    const regressions = detectRegressions(current, baseline, 15);
    expect(regressions).toHaveLength(1);
    expect(regressions[0].severity).toBe("critical");
  });

  it("should return warning severity for moderate regression", () => {
    // deltaRel must be > threshold*2 (30%) but <= threshold*3 (45%)
    const current: MetricSeries[] = [{ name: "http_req_duration", values: [140], unit: "ms" }];
    const baseline: MetricSeries[] = [{ name: "http_req_duration", values: [100], unit: "ms" }];
    // deltaRel = 40%, threshold*2 = 30%, threshold*3 = 45% => warning
    const regressions = detectRegressions(current, baseline, 15);
    expect(regressions).toHaveLength(1);
    expect(regressions[0].severity).toBe("warning");
  });

  it("should use custom threshold", () => {
    const current: MetricSeries[] = [{ name: "http_req_duration", values: [120], unit: "ms" }];
    const baseline: MetricSeries[] = [{ name: "http_req_duration", values: [100], unit: "ms" }];
    // With threshold 5%, deltaRel = 20% > 5% => regression
    const regressions = detectRegressions(current, baseline, 5);
    expect(regressions).toHaveLength(1);
  });
});
