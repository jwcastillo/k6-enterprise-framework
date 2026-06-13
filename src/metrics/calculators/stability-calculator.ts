/**
 * Stability / Soak Calculator (T-186)
 *
 * Calculates 20 STAB metrics (CHK-API-350 to CHK-API-369):
 * - Memory/handle/thread/connection leak detection via linear regression slope
 * - Latency drift over time (early vs late p95 comparison)
 * - Throughput drift (early vs late RPS comparison)
 * - Error rate drift and spike detection
 * - Soak test suitability assessment
 * - Performance degradation index
 * - Log volume anomaly
 */

import {
  MetricsCalculator,
  MetricsEngineInput,
  MetricResult,
  k6Stat,
  linearRegressionSlope,
  stddev,
} from "../types";
import { avg, m, na } from "./_helpers";

const CAT = "stability" as const;

export class StabilityCalculator implements MetricsCalculator {
  readonly category = CAT;

  calculate(input: MetricsEngineInput): MetricResult[] {
    const { k6Metrics, externalMetrics = {}, durationMs } = input;
    const results: MetricResult[] = [];

    const _durationHours = durationMs / 3_600_000;
    const durationMin = durationMs / 60_000;

    // ── Memory leak detection ──────────────────────────────────────────────────
    const memRssSeries = externalMetrics["memory_rss_bytes"] ?? [];

    if (memRssSeries.length >= 4) {
      const slope = linearRegressionSlope(memRssSeries.map((p, i) => ({ x: i, y: p.value })));
      const slopePerHour =
        durationMs > 0
          ? (slope * (memRssSeries.length / (durationMs / 1000)) * 3600) / 1_048_576
          : 0;

      results.push(
        m(
          "STAB-001",
          "Memory Leak Index (MB/hour)",
          CAT,
          parseFloat(slopePerHour.toFixed(3)),
          "MB/h",
          "< 5",
          `Linear regression slope of RSS memory over time. ${slopePerHour.toFixed(2)} MB/h — ${slopePerHour > 5 ? "potential memory leak" : slopePerHour > 1 ? "slight growth" : "stable"}`
        )
      );

      // Residual variance — how consistently memory grows (R² proxy)
      const meanMem = memRssSeries.reduce((s, p) => s + p.value, 0) / memRssSeries.length;
      const fitted = memRssSeries.map((_, i) => meanMem + slope * (i - memRssSeries.length / 2));
      const residuals = memRssSeries.map((p, i) => p.value - fitted[i]);
      const residualStddev = stddev(residuals) / 1_048_576;

      results.push(
        m(
          "STAB-002",
          "Memory Growth Consistency (MB stddev of residuals)",
          CAT,
          parseFloat(residualStddev.toFixed(2)),
          "MB",
          "< 20",
          `Standard deviation of residuals from linear fit. Low = smooth monotonic growth (leak). High = noisy/GC-driven`
        )
      );
    } else {
      results.push(
        na(
          "STAB-001",
          "Memory Leak Index",
          CAT,
          "MB/h",
          "Requires memory_rss_bytes time-series with ≥4 data points in externalMetrics"
        ),
        na(
          "STAB-002",
          "Memory Growth Consistency",
          CAT,
          "MB",
          "Requires memory_rss_bytes time-series in externalMetrics"
        )
      );
    }

    // ── Handle/FD leak ────────────────────────────────────────────────────────
    const fdSeries = externalMetrics["open_file_descriptors"] ?? [];

    if (fdSeries.length >= 4) {
      const fdSlope = linearRegressionSlope(fdSeries.map((p, i) => ({ x: i, y: p.value })));
      const fdGrowthPerHour =
        durationMs > 0 ? fdSlope * (fdSeries.length / (durationMs / 1000)) * 3600 : 0;

      results.push(
        m(
          "STAB-003",
          "File Descriptor Leak Rate (/hour)",
          CAT,
          parseFloat(fdGrowthPerHour.toFixed(1)),
          "FDs/h",
          "< 10",
          `Rate of file descriptor growth. ${fdGrowthPerHour.toFixed(1)} FDs/h — ${fdGrowthPerHour > 10 ? "FD leak detected" : "stable"}`
        )
      );
    } else {
      results.push(
        na(
          "STAB-003",
          "File Descriptor Leak Rate",
          CAT,
          "FDs/h",
          "Requires open_file_descriptors time-series in externalMetrics"
        )
      );
    }

    // ── Thread leak ───────────────────────────────────────────────────────────
    const threadSeries = externalMetrics["thread_count"] ?? [];

    if (threadSeries.length >= 4) {
      const threadSlope = linearRegressionSlope(threadSeries.map((p, i) => ({ x: i, y: p.value })));
      const threadGrowthPerHour =
        durationMs > 0 ? threadSlope * (threadSeries.length / (durationMs / 1000)) * 3600 : 0;

      results.push(
        m(
          "STAB-004",
          "Thread Leak Rate (/hour)",
          CAT,
          parseFloat(threadGrowthPerHour.toFixed(1)),
          "threads/h",
          "< 5",
          `Rate of thread count growth. ${threadGrowthPerHour.toFixed(1)} threads/h — ${threadGrowthPerHour > 5 ? "potential thread leak" : "stable"}`
        )
      );
    } else {
      results.push(
        na(
          "STAB-004",
          "Thread Leak Rate",
          CAT,
          "threads/h",
          "Requires thread_count time-series in externalMetrics"
        )
      );
    }

    // ── Connection leak ───────────────────────────────────────────────────────
    const connPoolSeries = externalMetrics["conn_pool_active"] ?? [];

    if (connPoolSeries.length >= 4) {
      const connSlope = linearRegressionSlope(connPoolSeries.map((p, i) => ({ x: i, y: p.value })));
      const connGrowthPerHour =
        durationMs > 0 ? connSlope * (connPoolSeries.length / (durationMs / 1000)) * 3600 : 0;

      results.push(
        m(
          "STAB-005",
          "Connection Count Drift (/hour)",
          CAT,
          parseFloat(connGrowthPerHour.toFixed(1)),
          "conns/h",
          "< 2",
          `Rate of active connection count growth. Indicates connection leak if positive and growing`
        )
      );
    } else {
      results.push(
        na(
          "STAB-005",
          "Connection Count Drift",
          CAT,
          "conns/h",
          "Requires conn_pool_active time-series in externalMetrics"
        )
      );
    }

    // ── Latency drift (early vs late p95) ─────────────────────────────────────
    const p95Series = externalMetrics["http_req_duration_p95"] ?? [];

    if (p95Series.length >= 6) {
      const quarterLen = Math.floor(p95Series.length / 4);
      const earlyP95 = avg(p95Series.slice(0, quarterLen).map((p) => p.value));
      const lateP95 = avg(p95Series.slice(-quarterLen).map((p) => p.value));
      const drift = earlyP95 > 0 ? ((lateP95 - earlyP95) / earlyP95) * 100 : 0;

      results.push(
        m(
          "STAB-006",
          "Latency Drift — p95 (%)",
          CAT,
          parseFloat(drift.toFixed(1)),
          "%",
          "< 20",
          `p95 latency change from first to last quarter. Early: ${earlyP95.toFixed(0)}ms → Late: ${lateP95.toFixed(0)}ms (${drift > 0 ? "+" : ""}${drift.toFixed(1)}%)`
        )
      );

      // Latency trend slope (ms per sample)
      const latSlope = linearRegressionSlope(p95Series.map((p, i) => ({ x: i, y: p.value })));
      results.push(
        m(
          "STAB-007",
          "Latency Trend Slope (ms/sample)",
          CAT,
          parseFloat(latSlope.toFixed(3)),
          "ms/sample",
          "< 0.5",
          `Linear regression slope of p95 latency. Positive = latency increasing over time. Slope: ${latSlope.toFixed(3)}`
        )
      );
    } else {
      // Fallback: use k6 raw stats — compare first-half vs second-half via rate metrics
      const p95val = k6Stat(k6Metrics, "http_req_duration", "p(95)");
      results.push(
        m(
          "STAB-006",
          "Latency Drift — p95 (single observation)",
          CAT,
          p95val,
          "ms",
          "< 2000",
          `Only single p95 value available. For drift analysis, provide http_req_duration_p95 time-series`
        ),
        na(
          "STAB-007",
          "Latency Trend Slope",
          CAT,
          "ms/sample",
          "Requires http_req_duration_p95 time-series with ≥6 data points"
        )
      );
    }

    // ── Throughput drift ──────────────────────────────────────────────────────
    const rpsSeries = externalMetrics["http_reqs_rate"] ?? [];

    if (rpsSeries.length >= 6) {
      const quarterLen = Math.floor(rpsSeries.length / 4);
      const earlyRPS = avg(rpsSeries.slice(0, quarterLen).map((p) => p.value));
      const lateRPS = avg(rpsSeries.slice(-quarterLen).map((p) => p.value));
      const rpsDrift = earlyRPS > 0 ? ((lateRPS - earlyRPS) / earlyRPS) * 100 : 0;

      results.push(
        m(
          "STAB-008",
          "Throughput Drift (%)",
          CAT,
          parseFloat(Math.abs(rpsDrift).toFixed(1)),
          "%",
          "< 15",
          `Throughput change from first to last quarter. Early: ${earlyRPS.toFixed(1)} RPS → Late: ${lateRPS.toFixed(1)} RPS (${rpsDrift > 0 ? "+" : ""}${rpsDrift.toFixed(1)}%)`
        )
      );
    } else {
      results.push(
        na(
          "STAB-008",
          "Throughput Drift",
          CAT,
          "%",
          "Requires http_reqs_rate time-series with ≥6 data points in externalMetrics"
        )
      );
    }

    // ── Error rate drift ──────────────────────────────────────────────────────
    const errSeries = externalMetrics["error_rate_percent"] ?? [];

    if (errSeries.length >= 4) {
      const errSlope = linearRegressionSlope(errSeries.map((p, i) => ({ x: i, y: p.value })));
      const maxSpike = Math.max(...errSeries.map((p) => p.value));
      const errStddev = stddev(errSeries.map((p) => p.value));

      results.push(
        m(
          "STAB-009",
          "Error Rate Trend Slope (%/sample)",
          CAT,
          parseFloat(errSlope.toFixed(5)),
          "%/sample",
          "< 0.01",
          `Linear regression slope of error rate over time. Positive slope = error rate increasing during soak`
        ),
        m(
          "STAB-010",
          "Error Rate Volatility (stddev)",
          CAT,
          parseFloat(errStddev.toFixed(3)),
          "%",
          "< 0.5",
          `Standard deviation of error rate. High volatility indicates intermittent failures`
        ),
        m(
          "STAB-011",
          "Error Rate Peak Spike (%)",
          CAT,
          parseFloat(maxSpike.toFixed(3)),
          "%",
          "< 5",
          `Maximum error rate spike in any time window during soak`
        )
      );
    } else {
      results.push(
        na(
          "STAB-009",
          "Error Rate Trend Slope",
          CAT,
          "%/sample",
          "Requires error_rate_percent time-series in externalMetrics"
        ),
        na(
          "STAB-010",
          "Error Rate Volatility",
          CAT,
          "%",
          "Requires error_rate_percent time-series in externalMetrics"
        ),
        na(
          "STAB-011",
          "Error Rate Peak Spike",
          CAT,
          "%",
          "Requires error_rate_percent time-series in externalMetrics"
        )
      );
    }

    // ── CPU drift ─────────────────────────────────────────────────────────────
    const cpuSeries = externalMetrics["cpu_app_percent"] ?? [];

    if (cpuSeries.length >= 4) {
      const cpuSlope = linearRegressionSlope(cpuSeries.map((p, i) => ({ x: i, y: p.value })));
      results.push(
        m(
          "STAB-012",
          "CPU Drift Slope (%/sample)",
          CAT,
          parseFloat(cpuSlope.toFixed(4)),
          "%/sample",
          "< 0.05",
          `Linear regression slope of CPU utilization. Growing CPU over time may indicate algorithmic degradation or accumulating state`
        )
      );
    } else {
      results.push(
        na(
          "STAB-012",
          "CPU Drift Slope",
          CAT,
          "%/sample",
          "Requires cpu_app_percent time-series in externalMetrics"
        )
      );
    }

    // ── Performance Degradation Index ─────────────────────────────────────────
    // Composite: compares early vs late window across latency + throughput + errors
    const hasP95 = p95Series.length >= 6;
    const hasRPS = rpsSeries.length >= 6;
    const hasErr = errSeries.length >= 4;

    if (hasP95 && hasRPS) {
      const qLen = Math.floor(Math.min(p95Series.length, rpsSeries.length) / 4);

      const earlyP95v = avg(p95Series.slice(0, qLen).map((p) => p.value));
      const lateP95v = avg(p95Series.slice(-qLen).map((p) => p.value));
      const latDegr = earlyP95v > 0 ? (lateP95v - earlyP95v) / earlyP95v : 0;

      const earlyRPSv = avg(rpsSeries.slice(0, qLen).map((p) => p.value));
      const lateRPSv = avg(rpsSeries.slice(-qLen).map((p) => p.value));
      const throughDegr = earlyRPSv > 0 ? (earlyRPSv - lateRPSv) / earlyRPSv : 0;

      let errDegr = 0;
      if (hasErr) {
        const qLenErr = Math.floor(errSeries.length / 4);
        const earlyErr = avg(errSeries.slice(0, qLenErr).map((p) => p.value));
        const lateErr = avg(errSeries.slice(-qLenErr).map((p) => p.value));
        errDegr = earlyErr > 0 ? (lateErr - earlyErr) / earlyErr : 0;
      }

      // Weighted composite: latency drift 40%, throughput drop 40%, error growth 20%
      const pdi =
        (Math.max(0, latDegr) * 0.4 + Math.max(0, throughDegr) * 0.4 + Math.max(0, errDegr) * 0.2) *
        100;

      results.push(
        m(
          "STAB-013",
          "Performance Degradation Index (%)",
          CAT,
          parseFloat(pdi.toFixed(2)),
          "%",
          "< 10",
          `Weighted composite of latency drift (40%), throughput drop (40%), error growth (20%). PDI=${pdi.toFixed(1)}%`
        )
      );
    } else {
      results.push(
        na(
          "STAB-013",
          "Performance Degradation Index",
          CAT,
          "%",
          "Requires http_req_duration_p95 + http_reqs_rate time-series in externalMetrics"
        )
      );
    }

    // ── Soak test suitability ─────────────────────────────────────────────────
    const soakMinutes = 30; // Minimum recommended soak duration
    const isSoakTest = durationMin >= soakMinutes;
    results.push(
      m(
        "STAB-014",
        "Soak Test Duration (min)",
        CAT,
        parseFloat(durationMin.toFixed(1)),
        "min",
        `>= ${soakMinutes}`,
        `Test duration: ${durationMin.toFixed(0)} min. ${isSoakTest ? "Qualifies as soak test." : `Minimum ${soakMinutes} min required for reliable stability analysis.`}`
      )
    );

    // ── Log volume anomaly ─────────────────────────────────────────────────────
    const logVolSeries = externalMetrics["log_lines_per_sec"] ?? [];

    if (logVolSeries.length >= 4) {
      const logSlope = linearRegressionSlope(logVolSeries.map((p, i) => ({ x: i, y: p.value })));
      const logVolStddev = stddev(logVolSeries.map((p) => p.value));
      const logVolMean = avg(logVolSeries.map((p) => p.value));
      const logCV = logVolMean > 0 ? (logVolStddev / logVolMean) * 100 : 0;

      results.push(
        m(
          "STAB-015",
          "Log Volume Drift Slope (lines/s per sample)",
          CAT,
          parseFloat(logSlope.toFixed(3)),
          "lines/s/sample",
          "< 0.1",
          `Increasing log volume may indicate growing error output, verbose failure traces, or retry storms`
        ),
        m(
          "STAB-016",
          "Log Volume Coefficient of Variation (%)",
          CAT,
          parseFloat(logCV.toFixed(1)),
          "%",
          "< 50",
          `CV of log rate. High variance = bursty logging (spikes on errors/retries)`
        )
      );
    } else {
      results.push(
        na(
          "STAB-015",
          "Log Volume Drift",
          CAT,
          "lines/s/sample",
          "Requires log_lines_per_sec time-series (Loki: rate query or Filebeat metrics)"
        ),
        na(
          "STAB-016",
          "Log Volume Coefficient of Variation",
          CAT,
          "%",
          "Requires log_lines_per_sec time-series in externalMetrics"
        )
      );
    }

    // ── GC stability ──────────────────────────────────────────────────────────
    const gcSeries = externalMetrics["gc_pause_ms"] ?? [];

    if (gcSeries.length >= 4) {
      const gcSlope = linearRegressionSlope(gcSeries.map((p, i) => ({ x: i, y: p.value })));
      const gcStddev = stddev(gcSeries.map((p) => p.value));
      results.push(
        m(
          "STAB-017",
          "GC Pause Trend Slope (ms/sample)",
          CAT,
          parseFloat(gcSlope.toFixed(3)),
          "ms/sample",
          "< 0.1",
          `Linear regression slope of GC pause durations. Increasing pauses over time indicate heap fragmentation or growing live set`
        ),
        m(
          "STAB-018",
          "GC Pause Volatility (stddev ms)",
          CAT,
          parseFloat(gcStddev.toFixed(1)),
          "ms",
          "< 100",
          `Standard deviation of GC pause times. High volatility = unpredictable stop-the-world events`
        )
      );
    } else {
      results.push(
        na(
          "STAB-017",
          "GC Pause Trend Slope",
          CAT,
          "ms/sample",
          "Requires gc_pause_ms time-series in externalMetrics"
        ),
        na(
          "STAB-018",
          "GC Pause Volatility",
          CAT,
          "ms",
          "Requires gc_pause_ms time-series in externalMetrics"
        )
      );
    }

    // ── k6-native stability indicators ────────────────────────────────────────
    const p95Final = k6Stat(k6Metrics, "http_req_duration", "p(95)");
    const p99Final = k6Stat(k6Metrics, "http_req_duration", "p(99)");
    const maxFinal = k6Stat(k6Metrics, "http_req_duration", "max");

    // P95 vs P99 ratio: high ratio indicates latency outliers (instability)
    const p99p95Ratio = p95Final > 0 ? p99Final / p95Final : 1;
    results.push(
      m(
        "STAB-019",
        "P99/P95 Latency Ratio",
        CAT,
        parseFloat(p99p95Ratio.toFixed(2)),
        "ratio",
        "< 3",
        `p99/p95 ratio: ${p99p95Ratio.toFixed(2)}×. High ratio indicates latency outliers/spikes (tail instability)`
      )
    );

    // Max vs P99 ratio: very high max vs p99 = occasional runaway requests
    const maxP99Ratio = p99Final > 0 ? maxFinal / p99Final : 1;
    results.push(
      m(
        "STAB-020",
        "Max/P99 Latency Ratio",
        CAT,
        parseFloat(maxP99Ratio.toFixed(1)),
        "ratio",
        "< 10",
        `max/p99 ratio: ${maxP99Ratio.toFixed(1)}×. Extremely high max vs p99 indicates runaway requests or timeouts`
      )
    );

    return results;
  }
}
