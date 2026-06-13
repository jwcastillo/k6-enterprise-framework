/**
 * Throughput Calculator (T-182)
 *
 * Calculates 25 THRU metrics (CHK-API-225 to CHK-API-249):
 * - RPS achieved, bytes in/out, TPS
 * - Peak-to-mean ratio, throughput per VU
 * - Ceiling detection, Little's Law validation
 * - Goodput, retry amplification factor
 * - Rate-limit headroom, connection limit proximity
 */

import { MetricsCalculator, MetricsEngineInput, MetricResult, k6Stat } from "../types";
import { m, na } from "./_helpers";

const CAT = "throughput" as const;

export class ThroughputCalculator implements MetricsCalculator {
  readonly category = CAT;

  calculate(input: MetricsEngineInput): MetricResult[] {
    const { k6Metrics, externalMetrics, durationMs, vusMax } = input;
    const results: MetricResult[] = [];

    const durationSec = durationMs / 1000;
    const totalReqs = k6Stat(k6Metrics, "http_reqs", "count");
    const failedReqs = k6Stat(k6Metrics, "http_req_failed", "passes");
    const iterations = k6Stat(k6Metrics, "iterations", "count");
    const dataSent = k6Stat(k6Metrics, "data_sent", "count");
    const dataRecv = k6Stat(k6Metrics, "data_received", "count");
    const avgLatencyMs = k6Stat(k6Metrics, "http_req_duration", "avg");

    // ── Core RPS / TPS ────────────────────────────────────────────────────────
    const rps = durationSec > 0 ? totalReqs / durationSec : 0;
    const tps = durationSec > 0 ? iterations / durationSec : 0;
    const successReqs = Math.max(0, totalReqs - failedReqs);
    const goodput = durationSec > 0 ? successReqs / durationSec : 0;

    results.push(
      m(
        "THRU-001",
        "Achieved RPS — Total",
        CAT,
        parseFloat(rps.toFixed(2)),
        "RPS",
        undefined,
        "Total requests per second: http_reqs / test_duration"
      ),
      m(
        "THRU-002",
        "Achieved RPS — Successful",
        CAT,
        parseFloat(goodput.toFixed(2)),
        "RPS",
        undefined,
        "Successful (non-failed) requests per second (goodput)"
      ),
      m(
        "THRU-003",
        "Transactions Per Second",
        CAT,
        parseFloat(tps.toFixed(2)),
        "TPS",
        undefined,
        "Completed k6 iterations per second"
      )
    );

    // ── Bytes in / out ────────────────────────────────────────────────────────
    const mbIn = dataSent / 1_048_576;
    const mbOut = dataRecv / 1_048_576;
    const mbpsIn = durationSec > 0 ? (dataSent * 8) / 1_000_000 / durationSec : 0;
    const mbpsOut = durationSec > 0 ? (dataRecv * 8) / 1_000_000 / durationSec : 0;

    results.push(
      m(
        "THRU-004",
        "Total Data Sent",
        CAT,
        parseFloat(mbIn.toFixed(2)),
        "MB",
        undefined,
        "Total MB sent to SUT"
      ),
      m(
        "THRU-005",
        "Total Data Received",
        CAT,
        parseFloat(mbOut.toFixed(2)),
        "MB",
        undefined,
        "Total MB received from SUT"
      ),
      m(
        "THRU-006",
        "Throughput — Outbound",
        CAT,
        parseFloat(mbpsIn.toFixed(3)),
        "Mbps",
        undefined,
        "Average outbound bandwidth (upload to SUT)"
      ),
      m(
        "THRU-007",
        "Throughput — Inbound",
        CAT,
        parseFloat(mbpsOut.toFixed(3)),
        "Mbps",
        undefined,
        "Average inbound bandwidth (download from SUT)"
      )
    );

    // ── Throughput per VU ─────────────────────────────────────────────────────
    const rpsPerVu = vusMax > 0 ? rps / vusMax : 0;
    results.push(
      m(
        "THRU-008",
        "Throughput Per VU",
        CAT,
        parseFloat(rpsPerVu.toFixed(3)),
        "RPS/VU",
        "> 0.5",
        "RPS divided by peak VU count. Low values indicate VU bottleneck"
      )
    );

    // ── Peak-to-mean ratio ────────────────────────────────────────────────────
    const rpsSeries = externalMetrics?.["rps"] ?? [];
    if (rpsSeries.length >= 3) {
      const mean = rpsSeries.reduce((s, p) => s + p.value, 0) / rpsSeries.length;
      const peak = Math.max(...rpsSeries.map((p) => p.value));
      const ratio = mean > 0 ? peak / mean : 1;
      results.push(
        m(
          "THRU-009",
          "Peak-to-Mean RPS Ratio",
          CAT,
          parseFloat(ratio.toFixed(2)),
          "ratio",
          "< 3",
          "Peak RPS / mean RPS. High ratio indicates bursty traffic patterns"
        )
      );
    } else {
      results.push(
        na(
          "THRU-009",
          "Peak-to-Mean RPS Ratio",
          CAT,
          "ratio",
          "Requires rps time-series in externalMetrics (at least 3 data points)"
        )
      );
    }

    // ── Ceiling detection ─────────────────────────────────────────────────────
    // Detected when RPS plateaus while VUs increase (from time-series)
    const vuSeries = externalMetrics?.["vus"] ?? [];
    if (rpsSeries.length >= 5 && vuSeries.length >= 5) {
      // Split into first/last halves and compare RPS growth vs VU growth
      const half = Math.floor(rpsSeries.length / 2);
      const rpsFirst = rpsSeries.slice(0, half).reduce((s, p) => s + p.value, 0) / half;
      const rpsLast = rpsSeries.slice(-half).reduce((s, p) => s + p.value, 0) / half;
      const vuFirst = vuSeries.slice(0, half).reduce((s, p) => s + p.value, 0) / half;
      const vuLast = vuSeries.slice(-half).reduce((s, p) => s + p.value, 0) / half;
      const rpsGrowth = rpsFirst > 0 ? (rpsLast - rpsFirst) / rpsFirst : 0;
      const vuGrowth = vuFirst > 0 ? (vuLast - vuFirst) / vuFirst : 0;
      // If VUs grew >20% but RPS grew <5% → ceiling detected
      const ceilingDetected = vuGrowth > 0.2 && rpsGrowth < 0.05;
      results.push(
        m(
          "THRU-010",
          "Throughput Ceiling Detected",
          CAT,
          ceilingDetected ? 1 : 0,
          "bool",
          "== 0",
          ceilingDetected
            ? `Ceiling detected: VUs grew ${(vuGrowth * 100).toFixed(0)}% but RPS grew only ${(rpsGrowth * 100).toFixed(0)}%. SUT is saturated.`
            : "No throughput ceiling detected — RPS scales with VU increase"
        )
      );
    } else {
      results.push(
        na(
          "THRU-010",
          "Throughput Ceiling Detected",
          CAT,
          "bool",
          "Requires rps + vus time-series (≥5 points each) in externalMetrics"
        )
      );
    }

    // ── Little's Law validation ───────────────────────────────────────────────
    // N = λ × W  →  concurrent = throughput × latency
    // Valid if |N - λW| / N <= 0.05
    const latencySeconds = avgLatencyMs / 1000;
    const littlesN = rps * latencySeconds;
    const littlesDev = vusMax > 0 ? Math.abs(vusMax - littlesN) / vusMax : 0;
    results.push(
      m(
        "THRU-011",
        "Little's Law Deviation",
        CAT,
        parseFloat((littlesDev * 100).toFixed(2)),
        "%",
        "< 20",
        `Little's Law: N=λW → expected concurrent=${littlesN.toFixed(1)}, actual VUs=${vusMax}. Deviation=${(littlesDev * 100).toFixed(1)}%`
      )
    );

    // ── Goodput ───────────────────────────────────────────────────────────────
    const goodputRate = totalReqs > 0 ? successReqs / totalReqs : 1;
    results.push(
      m(
        "THRU-012",
        "Goodput Rate",
        CAT,
        parseFloat((goodputRate * 100).toFixed(2)),
        "%",
        ">= 99",
        "Successful non-retried requests / total requests × 100"
      )
    );

    // ── Retry amplification ────────────────────────────────────────────────────
    // If k6 retries are enabled, total_requests > successful_iterations indicates amplification
    const retryAmplification = iterations > 0 ? totalReqs / iterations : 1;
    results.push(
      m(
        "THRU-013",
        "Retry Amplification Factor",
        CAT,
        parseFloat(retryAmplification.toFixed(3)),
        "ratio",
        "< 1.5",
        "Total HTTP requests / k6 iterations. Values > 1 indicate retries or multiple requests per iteration"
      )
    );

    // ── Write/Read breakdown (N/A without workload profile) ──────────────────
    const NA_WORKLOAD = "Requires tagged workload (add k6 group() tags: 'write', 'read')";
    results.push(
      na("THRU-014", "Write TPS", CAT, "TPS", NA_WORKLOAD),
      na("THRU-015", "Read TPS", CAT, "TPS", NA_WORKLOAD),
      na("THRU-016", "Write/Read Ratio", CAT, "ratio", NA_WORKLOAD)
    );

    // ── Rate-limit headroom ────────────────────────────────────────────────────
    // Detect 429 responses as proxy for rate-limit proximity
    const status429Count = k6Stat(k6Metrics, "http_req_duration{status:429}", "count");
    if (totalReqs > 0) {
      const throttledPct = (status429Count / totalReqs) * 100;
      results.push(
        m(
          "THRU-017",
          "Rate-Limit 429 Rate",
          CAT,
          parseFloat(throttledPct.toFixed(3)),
          "%",
          "< 0.1",
          "Percentage of requests returning HTTP 429 (rate limited)"
        )
      );
    } else {
      results.push(
        na("THRU-017", "Rate-Limit 429 Rate", CAT, "%", "No requests recorded — run a test first")
      );
    }

    // ── Misc throughput metrics (N/A without specific test setups) ────────────
    const NA_SETUP = "Requires specific test scenario configuration";
    results.push(
      na("THRU-018", "Batch Throughput", CAT, "TPS", NA_SETUP + " (batch endpoint test)"),
      na("THRU-019", "Async Dispatch Rate", CAT, "msg/s", NA_SETUP + " (async messaging test)"),
      na("THRU-020", "Async Completion Rate", CAT, "msg/s", NA_SETUP + " (async messaging test)"),
      na(
        "THRU-021",
        "Webhook Delivery Rate",
        CAT,
        "evt/s",
        NA_SETUP + " (webhook receiver scenario)"
      ),
      na("THRU-022", "File Upload Throughput", CAT, "MB/s", NA_SETUP + " (file upload scenario)"),
      na(
        "THRU-023",
        "File Download Throughput",
        CAT,
        "MB/s",
        NA_SETUP + " (file download scenario)"
      ),
      na(
        "THRU-024",
        "Pagination Throughput",
        CAT,
        "pages/s",
        NA_SETUP + " (paginated list scenario)"
      ),
      na(
        "THRU-025",
        "Connection Pool Headroom",
        CAT,
        "connections",
        "Requires DB/service connection pool metrics (Prometheus pgbouncer_pool_size, etc.)"
      )
    );

    return results;
  }
}
