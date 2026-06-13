/**
 * Memory Saturation sub-calculator — extracted from saturation-calculator.ts in Phase 4 ARC-07.
 * Implements the Memory/GC-specific portion of MetricsCalculator (sections c and d).
 * Metrics: SAT-010 to SAT-018 (RSS peak/growth/slope, OOM events, GC pause/overhead/frequency/heap).
 */

import { MetricsCalculator, MetricsEngineInput, MetricResult, linearRegressionSlope } from "../../types";
import { avg, m, na } from "../_helpers";

const CAT = "saturation" as const;

export class MemorySaturationCalculator implements MetricsCalculator {
  readonly category = CAT;

  calculate(input: MetricsEngineInput): MetricResult[] {
    const { externalMetrics = {}, durationMs } = input;
    const results: MetricResult[] = [];

    // ── (c) Memory ────────────────────────────────────────────────────────────
    const memRssSeries = externalMetrics["memory_rss_bytes"] ?? [];
    const _memHeapSeries = externalMetrics["memory_heap_bytes"] ?? [];
    const oomEventSeries = externalMetrics["oom_kill_events"] ?? [];

    if (memRssSeries.length > 0) {
      const memRssMax = Math.max(...memRssSeries.map((p) => p.value));
      const memRssStart = memRssSeries[0].value;
      const memRssEnd = memRssSeries[memRssSeries.length - 1].value;
      const memGrowthMB = (memRssEnd - memRssStart) / 1_048_576;

      results.push(
        m(
          "SAT-010",
          "Memory RSS — Peak (MB)",
          CAT,
          parseFloat((memRssMax / 1_048_576).toFixed(1)),
          "MB",
          undefined,
          `Peak RSS memory usage of SUT process: ${(memRssMax / 1_048_576).toFixed(0)} MB`
        ),
        m(
          "SAT-011",
          "Memory Growth Over Test (MB)",
          CAT,
          parseFloat(memGrowthMB.toFixed(1)),
          "MB",
          "< 100",
          `Memory growth from start to end: ${memGrowthMB.toFixed(0)} MB. Sustained growth indicates a memory leak`
        )
      );

      // Growth slope (bytes/sample)
      const slope = linearRegressionSlope(memRssSeries.map((p, i) => ({ x: i, y: p.value })));
      const slopeMBPerMin = slope > 0 ? (slope * 60) / 1_048_576 : 0; // approximate
      results.push(
        m(
          "SAT-012",
          "Memory Growth Slope (MB/min)",
          CAT,
          parseFloat(slopeMBPerMin.toFixed(3)),
          "MB/min",
          "< 1",
          `Linear regression slope of RSS memory. ${slopeMBPerMin.toFixed(2)} MB/min — ${slopeMBPerMin > 1 ? "potential memory leak" : "stable"}`
        )
      );
    } else {
      results.push(
        na(
          "SAT-010",
          "Memory RSS — Peak",
          CAT,
          "MB",
          "Requires memory_rss_bytes time-series (process_resident_memory_bytes from Prometheus)"
        ),
        na(
          "SAT-011",
          "Memory Growth Over Test",
          CAT,
          "MB",
          "Requires memory_rss_bytes time-series in externalMetrics"
        ),
        na(
          "SAT-012",
          "Memory Growth Slope",
          CAT,
          "MB/min",
          "Requires memory_rss_bytes time-series in externalMetrics"
        )
      );
    }

    if (oomEventSeries.length > 0) {
      const oomCount = oomEventSeries.reduce((s, p) => s + p.value, 0);
      results.push(
        m(
          "SAT-013",
          "OOM Kill Events",
          CAT,
          oomCount,
          "events",
          "== 0",
          `Out-of-memory kill events during test. ${oomCount} OOM events detected`
        )
      );
    } else {
      results.push(
        na(
          "SAT-013",
          "OOM Kill Events",
          CAT,
          "events",
          "Requires oom_kill_events time-series (kube_pod_container_status_restarts_total or kernel OOM log)"
        )
      );
    }

    // ── (d) GC ────────────────────────────────────────────────────────────────
    const gcPauseSeries = externalMetrics["gc_pause_ms"] ?? [];
    const gcFreqSeries = externalMetrics["gc_collections"] ?? [];
    const gcHeapSeries = externalMetrics["gc_heap_after_mb"] ?? [];

    if (gcPauseSeries.length > 0) {
      const sorted = [...gcPauseSeries.map((p) => p.value)].sort((a, b) => a - b);
      const p99idx = Math.ceil(sorted.length * 0.99) - 1;
      const gcP99 = sorted[Math.max(0, p99idx)] ?? 0;
      const gcAvg = avg(sorted);
      const gcTotal = sorted.reduce((s, v) => s + v, 0);
      const gcOverhead = durationMs > 0 ? (gcTotal / durationMs) * 100 : 0;

      results.push(
        m(
          "SAT-014",
          "GC Pause — p99 (ms)",
          CAT,
          parseFloat(gcP99.toFixed(1)),
          "ms",
          "< 200",
          `p99 garbage collection pause time. Long pauses cause latency spikes`
        ),
        m(
          "SAT-015",
          "GC Pause — Avg (ms)",
          CAT,
          parseFloat(gcAvg.toFixed(1)),
          "ms",
          "< 50",
          `Average GC pause time`
        ),
        m(
          "SAT-016",
          "GC Overhead (%)",
          CAT,
          parseFloat(gcOverhead.toFixed(2)),
          "%",
          "< 5",
          `Total GC pause time / test duration. ${gcOverhead.toFixed(1)}% overhead`
        )
      );
    } else {
      results.push(
        na(
          "SAT-014",
          "GC Pause — p99",
          CAT,
          "ms",
          "Requires gc_pause_ms time-series (JVM: jvm_gc_pause_seconds, Go: go_gc_duration_seconds, Node.js: v8 GC hook)"
        ),
        na(
          "SAT-015",
          "GC Pause — Avg",
          CAT,
          "ms",
          "Requires gc_pause_ms time-series in externalMetrics"
        ),
        na(
          "SAT-016",
          "GC Overhead",
          CAT,
          "%",
          "Requires gc_pause_ms time-series in externalMetrics"
        )
      );
    }

    if (gcFreqSeries.length > 0) {
      const totalCollections = gcFreqSeries.reduce((s, p) => s + p.value, 0);
      const freqPerSec = durationMs > 0 ? totalCollections / (durationMs / 1000) : 0;
      results.push(
        m(
          "SAT-017",
          "GC Collection Frequency (/s)",
          CAT,
          parseFloat(freqPerSec.toFixed(3)),
          "/s",
          "< 1",
          `GC collections per second. ${freqPerSec.toFixed(2)}/s — ${freqPerSec > 1 ? "high frequency may indicate memory pressure" : "normal"}`
        )
      );
    } else {
      results.push(
        na(
          "SAT-017",
          "GC Collection Frequency",
          CAT,
          "/s",
          "Requires gc_collections time-series in externalMetrics"
        )
      );
    }

    if (gcHeapSeries.length > 0) {
      const heapMax = Math.max(...gcHeapSeries.map((p) => p.value));
      results.push(
        m(
          "SAT-018",
          "GC Heap After Collection — Peak (MB)",
          CAT,
          parseFloat(heapMax.toFixed(0)),
          "MB",
          undefined,
          `Peak heap size after GC. Trending upward indicates retained object growth`
        )
      );
    } else {
      results.push(
        na(
          "SAT-018",
          "GC Heap After Collection — Peak",
          CAT,
          "MB",
          "Requires gc_heap_after_mb time-series in externalMetrics"
        )
      );
    }

    return results;
  }
}
