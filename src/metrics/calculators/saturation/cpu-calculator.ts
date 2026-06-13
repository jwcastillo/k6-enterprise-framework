/**
 * CPU Saturation sub-calculator — extracted from saturation-calculator.ts in Phase 4 ARC-07.
 * Implements the CPU-specific portion of MetricsCalculator (sections b).
 * Metrics: SAT-005 to SAT-009 (CPU app process avg/peak, host avg/peak, throttle rate).
 */

import { MetricsCalculator, MetricsEngineInput, MetricResult } from "../../types";
import { avg, m, na } from "../_helpers";

const CAT = "saturation" as const;

export class CpuSaturationCalculator implements MetricsCalculator {
  readonly category = CAT;

  calculate(input: MetricsEngineInput): MetricResult[] {
    const { externalMetrics = {}, durationMs } = input;
    const results: MetricResult[] = [];

    // ── (b) CPU ───────────────────────────────────────────────────────────────
    const cpuAppSeries = externalMetrics["cpu_app_percent"] ?? [];
    const cpuHostSeries = externalMetrics["cpu_host_percent"] ?? [];
    const cpuThrottleSeries = externalMetrics["cpu_throttled_seconds"] ?? [];

    if (cpuAppSeries.length > 0) {
      const cpuAppAvg = avg(cpuAppSeries.map((p) => p.value));
      const cpuAppMax = Math.max(...cpuAppSeries.map((p) => p.value));
      results.push(
        m(
          "SAT-005",
          "CPU — App Process Avg",
          CAT,
          parseFloat(cpuAppAvg.toFixed(1)),
          "%",
          "< 80",
          `Average CPU utilization of the SUT process. Max observed: ${cpuAppMax.toFixed(1)}%`
        ),
        m(
          "SAT-006",
          "CPU — App Process Peak",
          CAT,
          parseFloat(cpuAppMax.toFixed(1)),
          "%",
          "< 95",
          `Peak CPU utilization of the SUT process`
        )
      );
    } else {
      results.push(
        na(
          "SAT-005",
          "CPU — App Process Avg",
          CAT,
          "%",
          "Requires cpu_app_percent time-series (process_cpu_seconds_total from Prometheus node_exporter or JVM metrics)"
        ),
        na(
          "SAT-006",
          "CPU — App Process Peak",
          CAT,
          "%",
          "Requires cpu_app_percent time-series in externalMetrics"
        )
      );
    }

    if (cpuHostSeries.length > 0) {
      const cpuHostAvg = avg(cpuHostSeries.map((p) => p.value));
      const cpuHostMax = Math.max(...cpuHostSeries.map((p) => p.value));
      results.push(
        m(
          "SAT-007",
          "CPU — Host System Avg",
          CAT,
          parseFloat(cpuHostAvg.toFixed(1)),
          "%",
          "< 70",
          `Average host CPU utilization (all processes). Max observed: ${cpuHostMax.toFixed(1)}%`
        ),
        m(
          "SAT-008",
          "CPU — Host System Peak",
          CAT,
          parseFloat(cpuHostMax.toFixed(1)),
          "%",
          "< 90",
          `Peak host CPU utilization`
        )
      );
    } else {
      results.push(
        na(
          "SAT-007",
          "CPU — Host System Avg",
          CAT,
          "%",
          "Requires cpu_host_percent time-series (node_cpu_seconds_total from node_exporter)"
        ),
        na(
          "SAT-008",
          "CPU — Host System Peak",
          CAT,
          "%",
          "Requires cpu_host_percent time-series in externalMetrics"
        )
      );
    }

    if (cpuThrottleSeries.length > 0) {
      const throttleTotal = cpuThrottleSeries.reduce((s, p) => s + p.value, 0);
      const throttleRate = durationMs > 0 ? (throttleTotal / (durationMs / 1000)) * 100 : 0;
      results.push(
        m(
          "SAT-009",
          "CPU Throttle Rate",
          CAT,
          parseFloat(throttleRate.toFixed(2)),
          "%",
          "< 5",
          `CPU throttling rate (cgroup quota). ${throttleTotal.toFixed(1)}s throttled over ${(durationMs / 1000).toFixed(0)}s test`
        )
      );
    } else {
      results.push(
        na(
          "SAT-009",
          "CPU Throttle Rate",
          CAT,
          "%",
          "Requires cpu_throttled_seconds time-series (container_cpu_cfs_throttled_seconds_total from cAdvisor)"
        )
      );
    }

    return results;
  }
}
