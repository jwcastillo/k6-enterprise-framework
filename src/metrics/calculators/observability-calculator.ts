/**
 * Observability Under Load Calculator (T-190)
 *
 * Calculates 20 OBS metrics (CHK-API-430 to CHK-API-449):
 * - Log ingestion rate and completeness
 * - Trace completeness and sampling rate
 * - Alert latency (time from breach to alert firing)
 * - Correlation ID propagation rate
 * - Dashboard refresh rate under load
 * - Metrics scrape success rate
 * - Structured logging compliance
 * - Distributed trace coverage
 * - Span error rate
 * - Observability overhead (latency cost of instrumentation)
 */

import { MetricsCalculator, MetricsEngineInput, MetricResult, k6Stat } from "../types";
import { avg, m, na, percentile } from "./_helpers";

const CAT = "observability" as const;

export class ObservabilityCalculator implements MetricsCalculator {
  readonly category = CAT;

  calculate(input: MetricsEngineInput): MetricResult[] {
    const { k6Metrics, externalMetrics = {}, durationMs } = input;
    const results: MetricResult[] = [];

    const _totalReqs = k6Stat(k6Metrics, "http_reqs", "count");
    const _durationSec = durationMs / 1000;
    const p95 = k6Stat(k6Metrics, "http_req_duration", "p(95)");

    // ── Log ingestion ──────────────────────────────────────────────────────────
    const logIngestionSeries = externalMetrics["log_ingestion_rate"] ?? [];
    const logDroppedSeries = externalMetrics["log_dropped_count"] ?? [];
    const logLinesPerReqSeries = externalMetrics["log_lines_per_request"] ?? [];

    if (logIngestionSeries.length > 0) {
      const avgIngestion = avg(logIngestionSeries.map((p) => p.value));
      const minIngestion = Math.min(...logIngestionSeries.map((p) => p.value));
      results.push(
        m(
          "OBS-001",
          "Log Ingestion Rate — Avg (lines/s)",
          CAT,
          parseFloat(avgIngestion.toFixed(1)),
          "lines/s",
          undefined,
          `Average log ingestion rate. Min observed: ${minIngestion.toFixed(1)} lines/s`
        )
      );
    } else {
      results.push(
        na(
          "OBS-001",
          "Log Ingestion Rate",
          CAT,
          "lines/s",
          "Requires log_ingestion_rate time-series (Loki: loki_ingester_streams_created_total rate, or Filebeat metrics)"
        )
      );
    }

    if (logDroppedSeries.length > 0) {
      const droppedTotal = logDroppedSeries.reduce((s, p) => s + p.value, 0);
      results.push(
        m(
          "OBS-002",
          "Log Dropped Events",
          CAT,
          droppedTotal,
          "events",
          "== 0",
          `Total log events dropped (pipeline backpressure). ${droppedTotal} dropped — observability data loss`
        )
      );
    } else {
      results.push(
        na(
          "OBS-002",
          "Log Dropped Events",
          CAT,
          "events",
          "Requires log_dropped_count counter (Loki: loki_ingester_dropped_streams or Fluentd buffer_overflow_count)"
        )
      );
    }

    // Log completeness: expected log lines = requests × expected logs/req
    if (logLinesPerReqSeries.length > 0) {
      const avgLinesPerReq = avg(logLinesPerReqSeries.map((p) => p.value));
      results.push(
        m(
          "OBS-003",
          "Avg Log Lines per Request",
          CAT,
          parseFloat(avgLinesPerReq.toFixed(2)),
          "lines/req",
          "> 0.5",
          `Average structured log lines generated per HTTP request. Low = under-logging`
        )
      );
    } else {
      results.push(
        na(
          "OBS-003",
          "Log Lines per Request",
          CAT,
          "lines/req",
          "Requires log_lines_per_request metric (application instrumentation or Loki query: count_over_time / k6 request count)"
        )
      );
    }

    // ── Distributed tracing ────────────────────────────────────────────────────
    const traceCoverageSeries = externalMetrics["trace_coverage_pct"] ?? [];
    const spanErrSeries = externalMetrics["trace_span_error_rate"] ?? [];
    const traceSamplingRateSeries = externalMetrics["trace_sampling_rate"] ?? [];
    const traceCompleteSeries = externalMetrics["trace_complete_rate"] ?? [];

    if (traceCoverageSeries.length > 0) {
      const avgCoverage = avg(traceCoverageSeries.map((p) => p.value));
      results.push(
        m(
          "OBS-004",
          "Distributed Trace Coverage (%)",
          CAT,
          parseFloat(avgCoverage.toFixed(1)),
          "%",
          "> 95",
          `Percentage of requests that have an associated trace. ${avgCoverage.toFixed(1)}% coverage`
        )
      );
    } else {
      results.push(
        na(
          "OBS-004",
          "Distributed Trace Coverage",
          CAT,
          "%",
          "Requires trace_coverage_pct time-series (Tempo/Jaeger: spans_received / requests * 100)"
        )
      );
    }

    if (spanErrSeries.length > 0) {
      const spanErrRate = avg(spanErrSeries.map((p) => p.value));
      results.push(
        m(
          "OBS-005",
          "Trace Span Error Rate (%)",
          CAT,
          parseFloat(spanErrRate.toFixed(2)),
          "%",
          "< 5",
          `Percentage of trace spans with error=true. High = application errors captured in traces`
        )
      );
    } else {
      results.push(
        na(
          "OBS-005",
          "Trace Span Error Rate",
          CAT,
          "%",
          "Requires trace_span_error_rate time-series (Tempo: rate(traces_spanmetrics_calls_total{status_code='Error'}) / total)"
        )
      );
    }

    if (traceSamplingRateSeries.length > 0) {
      const samplingRate = avg(traceSamplingRateSeries.map((p) => p.value));
      results.push(
        m(
          "OBS-006",
          "Trace Sampling Rate (%)",
          CAT,
          parseFloat(samplingRate.toFixed(1)),
          "%",
          "> 1",
          `Percentage of requests that are fully traced. Low under load = head-based sampling dropping traces`
        )
      );
    } else {
      results.push(
        na(
          "OBS-006",
          "Trace Sampling Rate",
          CAT,
          "%",
          "Requires trace_sampling_rate time-series from tracing SDK or Tempo/Jaeger collector"
        )
      );
    }

    if (traceCompleteSeries.length > 0) {
      const completeRate = avg(traceCompleteSeries.map((p) => p.value));
      results.push(
        m(
          "OBS-007",
          "Complete Trace Rate (%)",
          CAT,
          parseFloat(completeRate.toFixed(1)),
          "%",
          "> 95",
          `Percentage of traces with all expected spans. Incomplete traces indicate service-to-service propagation failures`
        )
      );
    } else {
      results.push(
        na(
          "OBS-007",
          "Complete Trace Rate",
          CAT,
          "%",
          "Requires trace_complete_rate time-series (compare root span count vs leaf span count in Tempo)"
        )
      );
    }

    // ── Correlation ID propagation ─────────────────────────────────────────────
    const correlationIdSeries = externalMetrics["correlation_id_propagation_rate"] ?? [];

    if (correlationIdSeries.length > 0) {
      const propRate = avg(correlationIdSeries.map((p) => p.value));
      results.push(
        m(
          "OBS-008",
          "Correlation ID Propagation Rate (%)",
          CAT,
          parseFloat(propRate.toFixed(1)),
          "%",
          "> 99",
          `Percentage of requests where correlation ID was present in response. ${propRate.toFixed(1)}% propagation`
        )
      );
    } else {
      results.push(
        na(
          "OBS-008",
          "Correlation ID Propagation Rate",
          CAT,
          "%",
          "Requires correlation_id_propagation_rate counter in k6 scenario (check response X-Correlation-ID or X-Request-ID header)"
        )
      );
    }

    // ── Metrics collection ─────────────────────────────────────────────────────
    const scrapeSuccessSeries = externalMetrics["metrics_scrape_success_rate"] ?? [];
    const scrapeLatencySeries = externalMetrics["metrics_scrape_duration_ms"] ?? [];

    if (scrapeSuccessSeries.length > 0) {
      const scrapeRate = avg(scrapeSuccessSeries.map((p) => p.value));
      results.push(
        m(
          "OBS-009",
          "Metrics Scrape Success Rate (%)",
          CAT,
          parseFloat(scrapeRate.toFixed(1)),
          "%",
          "> 99",
          `Prometheus scrape success rate. Failures = gaps in metrics (up metric from Prometheus target health)`
        )
      );
    } else {
      results.push(
        na(
          "OBS-009",
          "Metrics Scrape Success Rate",
          CAT,
          "%",
          "Requires metrics_scrape_success_rate time-series (Prometheus: avg(up) over target set)"
        )
      );
    }

    if (scrapeLatencySeries.length > 0) {
      const scrapeP95 = percentile(
        scrapeLatencySeries.map((p) => p.value),
        95
      );
      results.push(
        m(
          "OBS-010",
          "Metrics Scrape Duration — p95 (ms)",
          CAT,
          parseFloat(scrapeP95.toFixed(0)),
          "ms",
          "< 5000",
          `p95 time for Prometheus to scrape metrics endpoint. High = /metrics endpoint slow under load`
        )
      );
    } else {
      results.push(
        na(
          "OBS-010",
          "Metrics Scrape Duration",
          CAT,
          "ms",
          "Requires metrics_scrape_duration_ms time-series (Prometheus: scrape_duration_seconds target label)"
        )
      );
    }

    // ── Alerting ───────────────────────────────────────────────────────────────
    const alertLatencySeries = externalMetrics["alert_firing_latency_sec"] ?? [];
    const alertsFiredSeries = externalMetrics["alerts_fired"] ?? [];

    if (alertLatencySeries.length > 0) {
      const alertP95 = percentile(
        alertLatencySeries.map((p) => p.value),
        95
      );
      results.push(
        m(
          "OBS-011",
          "Alert Firing Latency — p95 (s)",
          CAT,
          parseFloat(alertP95.toFixed(0)),
          "s",
          "< 120",
          `p95 time from threshold breach to alert firing. Long latency = delayed incident response`
        )
      );
    } else {
      results.push(
        na(
          "OBS-011",
          "Alert Firing Latency",
          CAT,
          "s",
          "Requires alert_firing_latency_sec time-series (Alertmanager: track alert creation time vs breach time)"
        )
      );
    }

    if (alertsFiredSeries.length > 0) {
      const alertCount = alertsFiredSeries.reduce((s, p) => s + p.value, 0);
      results.push(
        m(
          "OBS-012",
          "Alerts Fired During Test",
          CAT,
          alertCount,
          "alerts",
          undefined,
          `Total alerts fired during test run. ${alertCount} alert(s). Review alert definitions for false positives`
        )
      );
    } else {
      results.push(
        na(
          "OBS-012",
          "Alerts Fired During Test",
          CAT,
          "alerts",
          "Requires alerts_fired counter from Alertmanager API or PagerDuty/OpsGenie webhook"
        )
      );
    }

    // ── Observability overhead ────────────────────────────────────────────────
    // Estimate: compare p95 with and without instrumentation
    const uninstrumentedP95Series = externalMetrics["uninstrumented_p95_ms"] ?? [];

    if (uninstrumentedP95Series.length > 0) {
      const uninstrP95 = avg(uninstrumentedP95Series.map((p) => p.value));
      const overhead = uninstrP95 > 0 ? ((p95 - uninstrP95) / uninstrP95) * 100 : 0;
      results.push(
        m(
          "OBS-013",
          "Observability Overhead (%)",
          CAT,
          parseFloat(overhead.toFixed(1)),
          "%",
          "< 5",
          `Latency overhead from instrumentation: uninstrumented p95=${uninstrP95.toFixed(0)}ms vs instrumented=${p95.toFixed(0)}ms (+${overhead.toFixed(1)}%)`
        )
      );
    } else {
      results.push(
        na(
          "OBS-013",
          "Observability Overhead",
          CAT,
          "%",
          "Requires uninstrumented_p95_ms from a baseline run without instrumentation for comparison"
        )
      );
    }

    // ── Dashboard / visualization ──────────────────────────────────────────────
    const dashRefreshSeries = externalMetrics["dashboard_refresh_latency_ms"] ?? [];

    if (dashRefreshSeries.length > 0) {
      const dashP95 = percentile(
        dashRefreshSeries.map((p) => p.value),
        95
      );
      results.push(
        m(
          "OBS-014",
          "Dashboard Refresh Latency — p95 (ms)",
          CAT,
          parseFloat(dashP95.toFixed(0)),
          "ms",
          "< 5000",
          `p95 Grafana/dashboard panel load time during test load. High = dashboards unusable during incidents`
        )
      );
    } else {
      results.push(
        na(
          "OBS-014",
          "Dashboard Refresh Latency",
          CAT,
          "ms",
          "Requires dashboard_refresh_latency_ms time-series (Grafana: grafana_http_request_duration_seconds{handler='/api/ds/query'})"
        )
      );
    }

    // ── Structured logging compliance ──────────────────────────────────────────
    const structuredLogSeries = externalMetrics["structured_log_compliance_pct"] ?? [];
    const logErrorRateSeries = externalMetrics["log_error_rate_per_req"] ?? [];

    if (structuredLogSeries.length > 0) {
      const compliance = avg(structuredLogSeries.map((p) => p.value));
      results.push(
        m(
          "OBS-015",
          "Structured Log Compliance (%)",
          CAT,
          parseFloat(compliance.toFixed(1)),
          "%",
          "> 95",
          `Percentage of log lines that are valid structured JSON. Low = unstructured lines breaking log parsing`
        )
      );
    } else {
      results.push(
        na(
          "OBS-015",
          "Structured Log Compliance",
          CAT,
          "%",
          "Requires structured_log_compliance_pct metric from log parser (Logstash: parsed vs total lines)"
        )
      );
    }

    if (logErrorRateSeries.length > 0) {
      const logErrRate = avg(logErrorRateSeries.map((p) => p.value));
      results.push(
        m(
          "OBS-016",
          "Log ERROR Rate per Request",
          CAT,
          parseFloat(logErrRate.toFixed(3)),
          "errors/req",
          "< 0.05",
          `Average ERROR-level log lines per request. High = application generating excessive errors`
        )
      );
    } else {
      results.push(
        na(
          "OBS-016",
          "Log ERROR Rate per Request",
          CAT,
          "errors/req",
          "Requires log_error_rate_per_req metric (Loki: rate({level='error'}) / k6 request rate)"
        )
      );
    }

    // ── Cardinality & storage ──────────────────────────────────────────────────
    const metricCardinalitySeries = externalMetrics["prometheus_active_series"] ?? [];
    if (metricCardinalitySeries.length > 0) {
      const seriesMax = Math.max(...metricCardinalitySeries.map((p) => p.value));
      results.push(
        m(
          "OBS-017",
          "Prometheus Active Series — Peak",
          CAT,
          seriesMax,
          "series",
          "< 1000000",
          `Peak Prometheus time series cardinality during test. High cardinality causes OOM and slow queries`
        )
      );
    } else {
      results.push(
        na(
          "OBS-017",
          "Prometheus Active Series",
          CAT,
          "series",
          "Requires prometheus_active_series time-series (prometheus_tsdb_head_series from Prometheus self-metrics)"
        )
      );
    }

    // ── Query performance ──────────────────────────────────────────────────────
    results.push(
      na(
        "OBS-018",
        "Prometheus Query Latency — p95",
        CAT,
        "ms",
        "Requires prometheus_query_latency_p95_ms time-series (prometheus_engine_query_duration_seconds)"
      ),
      na(
        "OBS-019",
        "Loki Query Latency — p95",
        CAT,
        "ms",
        "Requires loki_query_latency_p95_ms time-series (loki_request_duration_seconds)"
      ),
      na(
        "OBS-020",
        "Trace Query Latency — p95",
        CAT,
        "ms",
        "Requires trace_query_latency_p95_ms time-series (Tempo: tempo_request_duration_seconds)"
      )
    );

    return results;
  }
}
