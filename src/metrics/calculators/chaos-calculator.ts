/**
 * Chaos Engineering Calculator (T-188)
 *
 * Calculates 20 CHAOS metrics (CHK-API-390 to CHK-API-409):
 * - Recovery time after fault injection (MTTR proxy)
 * - Circuit breaker activation and reset cycles
 * - Retry storm detection
 * - Bulkhead isolation effectiveness
 * - Graceful degradation score
 * - Resilience score (composite)
 * - Fault-specific error rates (network partition, CPU spike, etc.)
 * - Latency overhead from chaos agents
 */

import { MetricsCalculator, MetricsEngineInput, MetricResult, k6Stat } from "../types";
import { avg, m, na } from "./_helpers";

const CAT = "chaos" as const;

export class ChaosCalculator implements MetricsCalculator {
  readonly category = CAT;

  calculate(input: MetricsEngineInput): MetricResult[] {
    const { k6Metrics, externalMetrics = {}, durationMs, chaosConfig } = input;
    const results: MetricResult[] = [];

    const _durationSec = durationMs / 1000;
    const totalReqs = k6Stat(k6Metrics, "http_reqs", "count");
    const failedReqs = k6Stat(k6Metrics, "http_req_failed", "passes");
    const p95 = k6Stat(k6Metrics, "http_req_duration", "p(95)");
    const errorRate = totalReqs > 0 ? (failedReqs / totalReqs) * 100 : 0;

    // ── Is this a chaos test? ─────────────────────────────────────────────────
    const isChaosTest =
      !!chaosConfig || Object.keys(externalMetrics).some((k) => k.startsWith("chaos_"));

    results.push(
      m(
        "CHAOS-001",
        "Chaos Test Active",
        CAT,
        isChaosTest ? 1 : 0,
        "bool",
        undefined,
        isChaosTest
          ? `Chaos test active with ${chaosConfig?.faults?.length ?? "unknown"} fault type(s)`
          : "No chaos configuration detected. Provide chaosConfig in MetricsEngineInput for chaos analysis"
      )
    );

    // ── Error rate during chaos ────────────────────────────────────────────────
    const chaosErrSeries = externalMetrics["chaos_error_rate"] ?? [];
    const baselineErrSeries = externalMetrics["baseline_error_rate"] ?? [];

    results.push(
      m(
        "CHAOS-002",
        "Error Rate During Chaos (%)",
        CAT,
        parseFloat(errorRate.toFixed(3)),
        "%",
        "< 10",
        `Overall error rate during chaos test: ${errorRate.toFixed(2)}%`
      )
    );

    if (chaosErrSeries.length > 0 && baselineErrSeries.length > 0) {
      const chaosErr = avg(chaosErrSeries.map((p) => p.value));
      const baselineErr = avg(baselineErrSeries.map((p) => p.value));
      const chaosImpact = chaosErr - baselineErr;

      results.push(
        m(
          "CHAOS-003",
          "Chaos-Induced Error Uplift (%)",
          CAT,
          parseFloat(chaosImpact.toFixed(3)),
          "%",
          "< 5",
          `Additional errors caused by chaos vs baseline: +${chaosImpact.toFixed(2)}%. Baseline: ${baselineErr.toFixed(2)}%, Chaos: ${chaosErr.toFixed(2)}%`
        )
      );
    } else {
      results.push(
        na(
          "CHAOS-003",
          "Chaos-Induced Error Uplift",
          CAT,
          "%",
          "Requires chaos_error_rate + baseline_error_rate time-series in externalMetrics"
        )
      );
    }

    // ── Recovery time (MTTR proxy) ────────────────────────────────────────────
    const errTimeSeries = externalMetrics["error_rate_percent"] ?? [];

    if (errTimeSeries.length >= 4) {
      // Find fault injection moments: samples where error rate spikes > 2× mean
      const meanErr = avg(errTimeSeries.map((p) => p.value));
      const spikeThreshold = Math.max(meanErr * 2, 5); // at least 5% to count

      const recoveryTimes: number[] = [];
      let inFault = false;
      let faultStart = -1;

      for (let i = 0; i < errTimeSeries.length; i++) {
        const val = errTimeSeries[i].value;
        if (!inFault && val > spikeThreshold) {
          inFault = true;
          faultStart = i;
        } else if (inFault && val <= spikeThreshold * 0.5) {
          recoveryTimes.push(i - faultStart);
          inFault = false;
        }
      }

      if (recoveryTimes.length > 0) {
        const avgRecovery = avg(recoveryTimes);
        const maxRecovery = Math.max(...recoveryTimes);
        // Each sample ≈ 15s (typical Prometheus scrape interval)
        const scrapeIntervalSec =
          errTimeSeries.length > 1
            ? (errTimeSeries[errTimeSeries.length - 1].ts - errTimeSeries[0].ts) /
              (errTimeSeries.length - 1)
            : 15;
        const avgRecoverySec = avgRecovery * scrapeIntervalSec;
        const maxRecoverySec = maxRecovery * scrapeIntervalSec;

        results.push(
          m(
            "CHAOS-004",
            "Recovery Time — Avg (s)",
            CAT,
            parseFloat(avgRecoverySec.toFixed(0)),
            "s",
            "< 60",
            `Average time from fault-induced spike to recovery. ${recoveryTimes.length} recovery event(s) detected`
          ),
          m(
            "CHAOS-005",
            "Recovery Time — Max (s)",
            CAT,
            parseFloat(maxRecoverySec.toFixed(0)),
            "s",
            "< 120",
            `Maximum recovery time observed. Worst-case fault impact`
          )
        );
      } else {
        results.push(
          m(
            "CHAOS-004",
            "Recovery Time — Avg (s)",
            CAT,
            0,
            "s",
            "< 60",
            `No recoverable fault spikes detected in error_rate_percent series. Error rate mean: ${meanErr.toFixed(2)}%`
          ),
          m(
            "CHAOS-005",
            "Recovery Time — Max (s)",
            CAT,
            0,
            "s",
            "< 120",
            `No recoverable fault spikes detected`
          )
        );
      }
    } else {
      results.push(
        na(
          "CHAOS-004",
          "Recovery Time — Avg",
          CAT,
          "s",
          "Requires error_rate_percent time-series with ≥4 data points in externalMetrics"
        ),
        na(
          "CHAOS-005",
          "Recovery Time — Max",
          CAT,
          "s",
          "Requires error_rate_percent time-series in externalMetrics"
        )
      );
    }

    // ── Circuit breaker ───────────────────────────────────────────────────────
    const cbOpenSeries = externalMetrics["circuit_breaker_open"] ?? [];
    const cbResetSeries = externalMetrics["circuit_breaker_reset"] ?? [];

    if (cbOpenSeries.length > 0) {
      const cbOpenEvents = cbOpenSeries.filter((p) => p.value > 0).length;
      const cbOpenPercent = (cbOpenEvents / cbOpenSeries.length) * 100;
      results.push(
        m(
          "CHAOS-006",
          "Circuit Breaker Open Time (%)",
          CAT,
          parseFloat(cbOpenPercent.toFixed(1)),
          "%",
          "< 20",
          `Circuit breaker was open in ${cbOpenPercent.toFixed(1)}% of monitoring samples (${cbOpenEvents}/${cbOpenSeries.length} samples)`
        )
      );
    } else {
      results.push(
        na(
          "CHAOS-006",
          "Circuit Breaker Open Time",
          CAT,
          "%",
          "Requires circuit_breaker_open time-series (Resilience4j: resilience4j_circuitbreaker_state from Prometheus)"
        )
      );
    }

    if (cbResetSeries.length > 0) {
      const resetCount = cbResetSeries.reduce((s, p) => s + p.value, 0);
      results.push(
        m(
          "CHAOS-007",
          "Circuit Breaker Reset Cycles",
          CAT,
          resetCount,
          "cycles",
          "< 10",
          `Number of times circuit breaker completed an open→half-open→closed cycle`
        )
      );
    } else {
      results.push(
        na(
          "CHAOS-007",
          "Circuit Breaker Reset Cycles",
          CAT,
          "cycles",
          "Requires circuit_breaker_reset counter in externalMetrics"
        )
      );
    }

    // ── Retry storm detection ─────────────────────────────────────────────────
    const iterations = k6Stat(k6Metrics, "iterations", "count");
    const retryAmplification = iterations > 0 ? totalReqs / iterations : 1;
    const retryStorm = retryAmplification > 3;

    results.push(
      m(
        "CHAOS-008",
        "Retry Storm Indicator (req amplification)",
        CAT,
        parseFloat(retryAmplification.toFixed(2)),
        "req/iter",
        "< 3",
        `${retryAmplification.toFixed(2)}× requests per iteration. ${retryStorm ? "RETRY STORM: excessive amplification detected" : "Normal retry behavior"}`
      )
    );

    // ── Bulkhead isolation ────────────────────────────────────────────────────
    const bulkheadSeries = externalMetrics["bulkhead_rejected"] ?? [];
    const _bulkheadMaxSeries = externalMetrics["bulkhead_max_calls"] ?? [];

    if (bulkheadSeries.length > 0) {
      const totalRejected = bulkheadSeries.reduce((s, p) => s + p.value, 0);
      const rejectionRate = totalReqs > 0 ? (totalRejected / totalReqs) * 100 : 0;
      results.push(
        m(
          "CHAOS-009",
          "Bulkhead Rejection Rate (%)",
          CAT,
          parseFloat(rejectionRate.toFixed(2)),
          "%",
          "< 5",
          `${totalRejected} requests rejected by bulkhead (${rejectionRate.toFixed(1)}%). Bulkhead is protecting the system`
        )
      );
    } else {
      results.push(
        na(
          "CHAOS-009",
          "Bulkhead Rejection Rate",
          CAT,
          "%",
          "Requires bulkhead_rejected time-series (Resilience4j: resilience4j_bulkhead_available_concurrent_calls)"
        )
      );
    }

    // ── Latency overhead from chaos ────────────────────────────────────────────
    const chaosLatSeries = externalMetrics["chaos_latency_p95_ms"] ?? [];
    const baselineLatSeries = externalMetrics["baseline_latency_p95_ms"] ?? [];

    if (chaosLatSeries.length > 0 && baselineLatSeries.length > 0) {
      const chaosP95 = avg(chaosLatSeries.map((p) => p.value));
      const baselineP95 = avg(baselineLatSeries.map((p) => p.value));
      const overhead = baselineP95 > 0 ? ((chaosP95 - baselineP95) / baselineP95) * 100 : 0;

      results.push(
        m(
          "CHAOS-010",
          "Latency Overhead Under Chaos (%)",
          CAT,
          parseFloat(overhead.toFixed(1)),
          "%",
          "< 50",
          `p95 latency increase during chaos: ${baselineP95.toFixed(0)}ms → ${chaosP95.toFixed(0)}ms (+${overhead.toFixed(0)}%)`
        )
      );
    } else {
      results.push(
        m(
          "CHAOS-010",
          "Latency During Chaos — p95 (ms)",
          CAT,
          parseFloat(p95.toFixed(0)),
          "ms",
          "< 2000",
          `p95 latency during chaos test: ${p95.toFixed(0)}ms. Provide baseline_latency_p95_ms for comparison`
        )
      );
    }

    // ── Fault-specific metrics ────────────────────────────────────────────────
    const networkPartitionSeries = externalMetrics["chaos_network_partition_errors"] ?? [];
    const cpuSpikeSeries = externalMetrics["chaos_cpu_spike_errors"] ?? [];
    const memSpikeSeries = externalMetrics["chaos_mem_spike_errors"] ?? [];
    const _diskFaultSeries = externalMetrics["chaos_disk_fault_errors"] ?? [];

    if (networkPartitionSeries.length > 0) {
      const npErrors = networkPartitionSeries.reduce((s, p) => s + p.value, 0);
      const npErrRate = totalReqs > 0 ? (npErrors / totalReqs) * 100 : 0;
      results.push(
        m(
          "CHAOS-011",
          "Network Partition Error Rate (%)",
          CAT,
          parseFloat(npErrRate.toFixed(2)),
          "%",
          "< 1",
          `Errors during network partition fault injection: ${npErrors} errors (${npErrRate.toFixed(1)}% of requests)`
        )
      );
    } else {
      results.push(
        na(
          "CHAOS-011",
          "Network Partition Error Rate",
          CAT,
          "%",
          "Requires chaos_network_partition_errors time-series (Chaos Mesh: network fault annotations)"
        )
      );
    }

    if (cpuSpikeSeries.length > 0) {
      const cpuErrors = cpuSpikeSeries.reduce((s, p) => s + p.value, 0);
      const cpuErrRate = totalReqs > 0 ? (cpuErrors / totalReqs) * 100 : 0;
      results.push(
        m(
          "CHAOS-012",
          "CPU Spike Error Rate (%)",
          CAT,
          parseFloat(cpuErrRate.toFixed(2)),
          "%",
          "< 5",
          `Errors during CPU stress fault injection: ${cpuErrors} errors`
        )
      );
    } else {
      results.push(
        na(
          "CHAOS-012",
          "CPU Spike Error Rate",
          CAT,
          "%",
          "Requires chaos_cpu_spike_errors time-series in externalMetrics"
        )
      );
    }

    if (memSpikeSeries.length > 0) {
      const memErrors = memSpikeSeries.reduce((s, p) => s + p.value, 0);
      const memErrRate = totalReqs > 0 ? (memErrors / totalReqs) * 100 : 0;
      results.push(
        m(
          "CHAOS-013",
          "Memory Spike Error Rate (%)",
          CAT,
          parseFloat(memErrRate.toFixed(2)),
          "%",
          "< 5",
          `Errors during memory pressure fault injection: ${memErrors} errors`
        )
      );
    } else {
      results.push(
        na(
          "CHAOS-013",
          "Memory Spike Error Rate",
          CAT,
          "%",
          "Requires chaos_mem_spike_errors time-series in externalMetrics"
        )
      );
    }

    results.push(
      na(
        "CHAOS-014",
        "Disk Fault Error Rate",
        CAT,
        "%",
        "Requires chaos_disk_fault_errors time-series (Chaos Mesh: I/O fault injection)"
      )
    );

    // ── Graceful degradation ───────────────────────────────────────────────────
    const degradedResponseSeries = externalMetrics["degraded_response_count"] ?? [];

    if (degradedResponseSeries.length > 0) {
      const degradedCount = degradedResponseSeries.reduce((s, p) => s + p.value, 0);
      const gracefulRate = totalReqs > 0 ? (degradedCount / totalReqs) * 100 : 0;
      results.push(
        m(
          "CHAOS-015",
          "Graceful Degradation Rate (%)",
          CAT,
          parseFloat(gracefulRate.toFixed(1)),
          "%",
          "> 80",
          `Percentage of failure-mode requests that returned a degraded (partial) response instead of an error. ${gracefulRate.toFixed(1)}% graceful`
        )
      );
    } else {
      results.push(
        na(
          "CHAOS-015",
          "Graceful Degradation Rate",
          CAT,
          "%",
          "Requires degraded_response_count metric from application (custom k6 counter or response header check)"
        )
      );
    }

    // ── Composite Resilience Score ─────────────────────────────────────────────
    // Score 0-100 based on: error rate, recovery, cb behavior
    const errorPenalty = Math.min(errorRate * 5, 40); // up to -40 pts
    const retryPenalty = Math.min((retryAmplification - 1) * 5, 20); // up to -20 pts
    const cbPenalty =
      cbOpenSeries.length > 0
        ? Math.min((cbOpenSeries.filter((p) => p.value > 0).length / cbOpenSeries.length) * 20, 20)
        : 0;
    const resilience = Math.max(0, 100 - errorPenalty - retryPenalty - cbPenalty);

    results.push(
      m(
        "CHAOS-016",
        "Resilience Score (0-100)",
        CAT,
        parseFloat(resilience.toFixed(1)),
        "score",
        "> 70",
        `Composite resilience score. Deductions: errors(-${errorPenalty.toFixed(0)}), retries(-${retryPenalty.toFixed(0)}), CB(-${cbPenalty.toFixed(0)}). Score: ${resilience.toFixed(0)}/100`
      )
    );

    // ── Fallback activation rate ───────────────────────────────────────────────
    results.push(
      na(
        "CHAOS-017",
        "Fallback Activation Rate",
        CAT,
        "%",
        "Requires fallback_response_count counter in k6 scenario or response header detection"
      ),
      na(
        "CHAOS-018",
        "Cache Fallback Hit Rate",
        CAT,
        "%",
        "Requires cache_fallback_hits time-series from application instrumentation"
      ),
      na(
        "CHAOS-019",
        "Steady-State Hypothesis Met",
        CAT,
        "bool",
        "Requires baseline steady-state metrics + assertions from chaos test framework"
      ),
      na(
        "CHAOS-020",
        "Mean Time Between Failures (MTBF)",
        CAT,
        "s",
        "Requires fault injection timeline + recovery detection over multiple chaos cycles"
      )
    );

    return results;
  }
}
