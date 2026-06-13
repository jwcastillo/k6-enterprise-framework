/**
 * Performance Calculator — Response Time & Latency (T-181)
 *
 * Calculates 50 PERF metrics (CHK-API-175 to CHK-API-224):
 * - Response time percentiles (p50/p90/p95/p99/max/min/avg/stddev/CV)
 * - TTFB, DNS, TCP, TLS, server processing, content transfer
 * - Apdex score (configurable T)
 * - Response time trend slope (linear regression)
 * - Idle time, warm-up stabilisation indicator
 * - Protocol-specific markers (N/A when external data not available)
 */

import {
  MetricsCalculator,
  MetricsEngineInput,
  MetricResult,
  k6Stat,
  naMetric,
  evalThreshold,
  linearRegressionSlope,
  stddev,
} from "../types";

const CAT = "performance" as const;

export class PerformanceCalculator implements MetricsCalculator {
  readonly category = CAT;

  calculate(input: MetricsEngineInput): MetricResult[] {
    const { k6Metrics, externalMetrics, durationMs } = input;
    const results: MetricResult[] = [];

    // ── Percentile metrics (k6-native) ───────────────────────────────────────

    const avg = k6Stat(k6Metrics, "http_req_duration", "avg");
    const min = k6Stat(k6Metrics, "http_req_duration", "min");
    const med = k6Stat(k6Metrics, "http_req_duration", "med");
    const max = k6Stat(k6Metrics, "http_req_duration", "max");
    const p90 = k6Stat(k6Metrics, "http_req_duration", "p(90)");
    const p95 = k6Stat(k6Metrics, "http_req_duration", "p(95)");
    const p99 = k6Stat(k6Metrics, "http_req_duration", "p(99)");

    results.push(
      metric(
        "PERF-001",
        "Response Time — Average",
        CAT,
        avg,
        "ms",
        "< 500",
        "Average HTTP response time across all requests"
      ),
      metric(
        "PERF-002",
        "Response Time — Minimum",
        CAT,
        min,
        "ms",
        undefined,
        "Minimum observed response time"
      ),
      metric(
        "PERF-003",
        "Response Time — Median (p50)",
        CAT,
        med,
        "ms",
        "< 300",
        "Median (50th percentile) response time"
      ),
      metric(
        "PERF-004",
        "Response Time — p90",
        CAT,
        p90,
        "ms",
        "< 500",
        "90th percentile response time"
      ),
      metric(
        "PERF-005",
        "Response Time — p95",
        CAT,
        p95,
        "ms",
        "< 500",
        "95th percentile response time (primary SLO indicator)"
      ),
      metric(
        "PERF-006",
        "Response Time — p99",
        CAT,
        p99,
        "ms",
        "< 1000",
        "99th percentile response time"
      ),
      metric(
        "PERF-007",
        "Response Time — Maximum",
        CAT,
        max,
        "ms",
        "< 5000",
        "Maximum observed response time"
      )
    );

    // Stddev and CV (derived)
    // Approximate stddev from k6 if available, else derive from p99/avg heuristic
    const k6Stddev =
      k6Stat(k6Metrics, "http_req_duration", "p(90)") > 0
        ? Math.abs(p99 - avg) / 2.576 // rough estimate from p99 z-score
        : 0;
    const cv = avg > 0 ? (k6Stddev / avg) * 100 : 0;

    results.push(
      metric(
        "PERF-008",
        "Response Time — Std Deviation",
        CAT,
        parseFloat(k6Stddev.toFixed(2)),
        "ms",
        undefined,
        "Standard deviation of response time (derived estimate from p99-avg spread)"
      ),
      metric(
        "PERF-009",
        "Response Time — Coefficient of Variation",
        CAT,
        parseFloat(cv.toFixed(2)),
        "%",
        "< 50",
        "CV = stddev/avg × 100. High CV indicates inconsistent response times"
      )
    );

    // ── TTFB (Time To First Byte) — k6 http_req_waiting ─────────────────────
    const ttfbAvg = k6Stat(k6Metrics, "http_req_waiting", "avg");
    const ttfbP95 = k6Stat(k6Metrics, "http_req_waiting", "p(95)");
    const ttfbP99 = k6Stat(k6Metrics, "http_req_waiting", "p(99)");

    results.push(
      metric(
        "PERF-010",
        "TTFB — Average",
        CAT,
        ttfbAvg,
        "ms",
        "< 300",
        "Time To First Byte: server processing time (http_req_waiting)"
      ),
      metric("PERF-011", "TTFB — p95", CAT, ttfbP95, "ms", "< 400", "95th percentile TTFB"),
      metric("PERF-012", "TTFB — p99", CAT, ttfbP99, "ms", "< 800", "99th percentile TTFB")
    );

    // ── Network phase breakdown ──────────────────────────────────────────────
    const dnsAvg = k6Stat(k6Metrics, "http_req_connecting", "avg");
    const tcpAvg = k6Stat(k6Metrics, "http_req_connecting", "avg");
    const tlsAvg = k6Stat(k6Metrics, "http_req_tls_handshaking", "avg");
    const sendAvg = k6Stat(k6Metrics, "http_req_sending", "avg");
    const recvAvg = k6Stat(k6Metrics, "http_req_receiving", "avg");

    results.push(
      metric(
        "PERF-013",
        "DNS Lookup — Average",
        CAT,
        dnsAvg,
        "ms",
        "< 50",
        "Average DNS resolution time (http_req_connecting proxy)"
      ),
      metric(
        "PERF-014",
        "TCP Handshake — Average",
        CAT,
        tcpAvg,
        "ms",
        "< 100",
        "Average TCP connection time (http_req_connecting)"
      ),
      metric(
        "PERF-015",
        "TLS Handshake — Average",
        CAT,
        tlsAvg,
        "ms",
        "< 200",
        "Average TLS negotiation time (http_req_tls_handshaking)"
      ),
      metric(
        "PERF-016",
        "Request Sending — Average",
        CAT,
        sendAvg,
        "ms",
        "< 50",
        "Average time to send request bytes (http_req_sending)"
      ),
      metric(
        "PERF-017",
        "Response Receiving — Average",
        CAT,
        recvAvg,
        "ms",
        "< 100",
        "Average time to receive response bytes (http_req_receiving)"
      )
    );

    // Content transfer (receiving - sending)
    const contentTransfer = Math.max(0, recvAvg - sendAvg);
    results.push(
      metric(
        "PERF-018",
        "Content Transfer Time",
        CAT,
        parseFloat(contentTransfer.toFixed(2)),
        "ms",
        "< 100",
        "Estimated content transfer: http_req_receiving − http_req_sending"
      )
    );

    // Server processing time estimate (TTFB - DNS - TCP - TLS)
    const serverProcessing = Math.max(0, ttfbAvg - dnsAvg - tcpAvg - tlsAvg);
    results.push(
      metric(
        "PERF-019",
        "Server Processing Time",
        CAT,
        parseFloat(serverProcessing.toFixed(2)),
        "ms",
        "< 200",
        "Estimated server-side processing: TTFB − (DNS + TCP + TLS)"
      )
    );

    // ── Apdex Score (T = 500ms by default) ──────────────────────────────────
    // Apdex = (satisfied + tolerating × 0.5) / total
    // Percentile-bin approximation: classify each bin by its upper-bound value
    //   Bin 0–p50  (50%): use med   | Bin p50–p90 (40%): use p90
    //   Bin p90–p95 (5%): use p95   | Bin p95–p99 (4%): use p99
    //   Bin p99–max (1%): use max
    // Classification: ≤ T → satisfied (weight 1), T..4T → tolerating (weight 0.5), >4T → frustrated (0)
    // Failed requests are always frustrated (weight 0).
    const apdexT = 500; // configurable
    const toleratingT = apdexT * 4;
    const totalReqs = k6Stat(k6Metrics, "http_reqs", "count");
    const failedReqs = k6Stat(k6Metrics, "http_req_failed", "passes");
    const successFraction = totalReqs > 0 ? Math.max(0, totalReqs - failedReqs) / totalReqs : 1;

    const binWeight = (value: number): number => {
      if (value <= apdexT) return 1;
      if (value <= toleratingT) return 0.5;
      return 0;
    };

    const bins = [
      { fraction: 0.5, value: med },
      { fraction: 0.4, value: p90 },
      { fraction: 0.05, value: p95 },
      { fraction: 0.04, value: p99 },
      { fraction: 0.01, value: max },
    ];

    let apdexLatency = 0;
    for (const bin of bins) {
      apdexLatency += bin.fraction * binWeight(bin.value);
    }
    // Failed requests count as frustrated (weight 0) — scale by success fraction
    const apdex = totalReqs > 0 ? Math.min(1, apdexLatency * successFraction) : 1;

    results.push(
      metric(
        "PERF-020",
        "Apdex Score",
        CAT,
        parseFloat(apdex.toFixed(3)),
        "",
        ">= 0.9",
        `Apdex(T=${apdexT}ms): (satisfied + tolerating×0.5) / total. 1.0=excellent, 0.7=poor`
      )
    );

    // ── Response time trend (linear regression slope) ────────────────────────
    // Use external time-series if available, else N/A
    const durationTimeSeries = externalMetrics?.["http_req_duration_p95"] ?? [];
    if (durationTimeSeries.length >= 2) {
      const points = durationTimeSeries.map((s, i) => ({ x: i, y: s.value }));
      const slope = linearRegressionSlope(points);
      const slopePerMin = slope * 60;
      results.push(
        metric(
          "PERF-021",
          "Response Time Trend — p95 Slope",
          CAT,
          parseFloat(slopePerMin.toFixed(3)),
          "ms/min",
          "< 10",
          "Linear regression slope of p95 response time over test duration. Positive = degrading."
        )
      );
    } else {
      results.push(
        naMetric(
          "PERF-021",
          "Response Time Trend — p95 Slope",
          CAT,
          "ms/min",
          "Requires http_req_duration_p95 time-series in externalMetrics (e.g. from Prometheus)"
        )
      );
    }

    // ── Idle / think time ────────────────────────────────────────────────────
    const durationSec = durationMs / 1000;
    const iterations = k6Stat(k6Metrics, "iterations", "count");
    const avgIterDuration =
      iterations > 0 && durationSec > 0
        ? (durationSec / iterations) * 1000 // ms per iteration per VU approximation
        : 0;
    const idleTime = Math.max(0, avgIterDuration - avg);
    results.push(
      metric(
        "PERF-022",
        "Estimated Idle / Think Time",
        CAT,
        parseFloat(idleTime.toFixed(2)),
        "ms",
        undefined,
        "Estimated time VUs spend idle between requests (iteration_duration − avg_response_time)"
      )
    );

    // ── Warm-up stabilisation ────────────────────────────────────────────────
    // Detected by checking if p50 time series stabilises (variance in last 20% < 10%)
    if (durationTimeSeries.length >= 5) {
      const lastQuarter = durationTimeSeries.slice(-Math.ceil(durationTimeSeries.length * 0.2));
      const vals = lastQuarter.map((s) => s.value);
      const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
      const sd = stddev(vals);
      const stabCV = mean > 0 ? (sd / mean) * 100 : 0;
      const stabilised = stabCV < 10;
      results.push(
        metric(
          "PERF-023",
          "Warm-up Stabilisation",
          CAT,
          parseFloat(stabCV.toFixed(2)),
          "%",
          "< 10",
          `CV of p95 in last 20% of test: ${stabCV.toFixed(1)}%. ${stabilised ? "Stable" : "Still warming up or unstable"}`
        )
      );
    } else {
      results.push(
        naMetric(
          "PERF-023",
          "Warm-up Stabilisation",
          CAT,
          "%",
          "Requires p95 time-series with ≥5 data points in externalMetrics"
        )
      );
    }

    // ── VU efficiency ─────────────────────────────────────────────────────────
    const vusMax = input.vusMax;
    const rps = durationSec > 0 ? totalReqs / durationSec : 0;
    const vuEfficiency = vusMax > 0 ? rps / vusMax : 0;
    results.push(
      metric(
        "PERF-024",
        "VU Efficiency — RPS per VU",
        CAT,
        parseFloat(vuEfficiency.toFixed(3)),
        "RPS/VU",
        "> 1",
        "Requests per second per virtual user. Low values indicate VUs spending too much time waiting"
      )
    );

    // ── Protocol-specific (N/A without external data) ─────────────────────────
    const NA_PROTO = "Requires SUT instrumentation (e.g. Prometheus gRPC metrics, APM)";
    results.push(
      naMetric("PERF-025", "gRPC Stream Duration — p95", CAT, "ms", NA_PROTO),
      naMetric("PERF-026", "GraphQL Query Time — p95", CAT, "ms", NA_PROTO),
      naMetric("PERF-027", "GraphQL Resolver Time — p95", CAT, "ms", NA_PROTO),
      naMetric(
        "PERF-028",
        "CDN Cache Hit Ratio",
        CAT,
        "%",
        "Requires CDN metrics (Cloudflare, Fastly, etc.)"
      ),
      naMetric("PERF-029", "CDN Offload Rate", CAT, "%", "Requires CDN metrics"),
      naMetric(
        "PERF-030",
        "HTTP/2 Multiplexing Efficiency",
        CAT,
        "%",
        "Requires HTTP/2 connection metrics from server"
      ),
      naMetric(
        "PERF-031",
        "Service Mesh Overhead — p95",
        CAT,
        "ms",
        "Requires Istio/Envoy Prometheus metrics (envoy_cluster_upstream_rq_time)"
      ),
      naMetric(
        "PERF-032",
        "API Gateway Overhead — p95",
        CAT,
        "ms",
        "Requires gateway latency metrics (Kong, AWS API GW, etc.)"
      ),
      naMetric(
        "PERF-033",
        "Geo-Region Delta — Max vs Min",
        CAT,
        "ms",
        "Requires multi-region k6 cloud or distributed test setup"
      ),
      naMetric(
        "PERF-034",
        "Keep-Alive Reuse Rate",
        CAT,
        "%",
        "Requires connection reuse metrics from server"
      )
    );

    // ── Payload metrics ───────────────────────────────────────────────────────
    const dataSent = k6Stat(k6Metrics, "data_sent", "count");
    const dataReceived = k6Stat(k6Metrics, "data_received", "count");
    const avgPayloadIn = totalReqs > 0 ? dataReceived / totalReqs : 0;
    const avgPayloadOut = totalReqs > 0 ? dataSent / totalReqs : 0;

    results.push(
      metric(
        "PERF-035",
        "Avg Response Payload Size",
        CAT,
        parseFloat((avgPayloadIn / 1024).toFixed(2)),
        "KB",
        "< 500",
        "Average response body size per request"
      ),
      metric(
        "PERF-036",
        "Avg Request Payload Size",
        CAT,
        parseFloat((avgPayloadOut / 1024).toFixed(2)),
        "KB",
        undefined,
        "Average request body size per request"
      ),
      metric(
        "PERF-037",
        "Total Data Received",
        CAT,
        parseFloat((dataReceived / 1_048_576).toFixed(2)),
        "MB",
        undefined,
        "Total bytes received from SUT"
      ),
      metric(
        "PERF-038",
        "Total Data Sent",
        CAT,
        parseFloat((dataSent / 1_048_576).toFixed(2)),
        "MB",
        undefined,
        "Total bytes sent to SUT"
      )
    );

    // N/A payload metrics
    results.push(
      naMetric(
        "PERF-039",
        "Compression Ratio",
        CAT,
        "ratio",
        "Requires Content-Encoding metrics from SUT"
      ),
      naMetric(
        "PERF-040",
        "Large Payload Frequency",
        CAT,
        "%",
        "Requires response size histogram from SUT"
      )
    );

    // ── Infrastructure correlation ─────────────────────────────────────────────
    const cpuSeries = externalMetrics?.["cpu_usage_percent"] ?? [];
    if (cpuSeries.length >= 2) {
      const avgCpu = cpuSeries.reduce((s, p) => s + p.value, 0) / cpuSeries.length;
      results.push(
        metric(
          "PERF-041",
          "SUT CPU During Test — Avg",
          CAT,
          parseFloat(avgCpu.toFixed(1)),
          "%",
          "< 80",
          "Average CPU utilization of SUT during the test (from Prometheus)"
        )
      );
    } else {
      results.push(
        naMetric(
          "PERF-041",
          "SUT CPU During Test — Avg",
          CAT,
          "%",
          "Requires cpu_usage_percent time-series in externalMetrics (Prometheus node_exporter)"
        )
      );
    }

    const memSeries = externalMetrics?.["memory_usage_bytes"] ?? [];
    if (memSeries.length >= 2) {
      const peakMem = Math.max(...memSeries.map((s) => s.value));
      results.push(
        metric(
          "PERF-042",
          "SUT Memory Peak",
          CAT,
          parseFloat((peakMem / 1_048_576).toFixed(1)),
          "MB",
          "< 2048",
          "Peak memory usage of SUT during the test (from Prometheus)"
        )
      );
    } else {
      results.push(
        naMetric(
          "PERF-042",
          "SUT Memory Peak",
          CAT,
          "MB",
          "Requires memory_usage_bytes time-series in externalMetrics (Prometheus process_resident_memory_bytes)"
        )
      );
    }

    // N/A infrastructure metrics
    const NA_INFRA = "Requires SUT infrastructure metrics via Prometheus";
    results.push(
      naMetric(
        "PERF-043",
        "DB Query Latency — p95",
        CAT,
        "ms",
        NA_INFRA + " (e.g. pg_stat_statements)"
      ),
      naMetric(
        "PERF-044",
        "Cache Hit Latency — p95",
        CAT,
        "ms",
        NA_INFRA + " (e.g. redis_command_duration_seconds)"
      ),
      naMetric(
        "PERF-045",
        "Message Queue Latency — p95",
        CAT,
        "ms",
        NA_INFRA + " (e.g. kafka_consumer_fetch_manager_fetch_latency)"
      ),
      naMetric(
        "PERF-046",
        "External API Latency — p95",
        CAT,
        "ms",
        "Requires per-dependency tracing (OpenTelemetry span analysis)"
      ),
      naMetric(
        "PERF-047",
        "GC Pause — p99",
        CAT,
        "ms",
        "Requires JVM/Go runtime metrics (jvm_gc_pause_seconds, go_gc_duration_seconds)"
      ),
      naMetric(
        "PERF-048",
        "Event Loop Lag — p95",
        CAT,
        "ms",
        "Requires Node.js metrics (nodejs_eventloop_lag_seconds via prom-client)"
      ),
      naMetric(
        "PERF-049",
        "Thread Pool Queue Wait",
        CAT,
        "ms",
        "Requires thread pool metrics (java.util.concurrent.ThreadPoolExecutor JMX)"
      ),
      naMetric(
        "PERF-050",
        "Network RTT to SUT",
        CAT,
        "ms",
        "Requires network path analysis (ping, traceroute) from k6 generator to SUT"
      )
    );

    return results;
  }
}

// ── Helper ────────────────────────────────────────────────────────────────────

function metric(
  id: string,
  name: string,
  category: typeof CAT,
  value: number,
  unit: string,
  threshold: string | undefined,
  description: string
): MetricResult {
  const status = threshold ? evalThreshold(value, threshold) : "pass";
  return {
    id,
    name,
    category,
    value,
    unit,
    threshold,
    status,
    description,
    source: "k6",
  };
}
