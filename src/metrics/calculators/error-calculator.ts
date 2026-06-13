/**
 * Error Calculator (T-183)
 *
 * Calculates 30 ERR metrics (CHK-API-250 to CHK-API-279):
 * - Overall error rate, 5xx, 429, 4xx, timeout, connection/DNS/TLS failures
 * - Error spike (max 1-min window), error trend slope, error budget burn
 * - Shannon entropy of error code distribution
 * - Retry success rate, circuit breaker indicators
 * - Cascade failure detection, error correlation
 */

import {
  MetricsCalculator,
  MetricsEngineInput,
  MetricResult,
  k6Stat,
  linearRegressionSlope,
} from "../types";
import { m, na } from "./_helpers";

const CAT = "error" as const;

export class ErrorCalculator implements MetricsCalculator {
  readonly category = CAT;

  calculate(input: MetricsEngineInput): MetricResult[] {
    const { k6Metrics, externalMetrics, durationMs } = input;
    const results: MetricResult[] = [];

    const _durationSec = durationMs / 1000;
    const totalReqs = k6Stat(k6Metrics, "http_reqs", "count");
    const failedReqs = k6Stat(k6Metrics, "http_req_failed", "passes");
    const iterations = k6Stat(k6Metrics, "iterations", "count");

    // ── Overall error rate ────────────────────────────────────────────────────
    const errorRate = totalReqs > 0 ? (failedReqs / totalReqs) * 100 : 0;
    results.push(
      m(
        "ERR-001",
        "Overall HTTP Error Rate",
        CAT,
        parseFloat(errorRate.toFixed(3)),
        "%",
        "< 1",
        "Percentage of HTTP requests that returned a non-2xx/3xx response"
      )
    );

    // ── Status code breakdown (k6 http_req_failed is 4xx+5xx) ─────────────────
    // k6 doesn't separate 4xx vs 5xx by default — use time-series if available
    const err4xxSeries = externalMetrics?.["http_errors_4xx"] ?? [];
    const err5xxSeries = externalMetrics?.["http_errors_5xx"] ?? [];
    const err429Series = externalMetrics?.["http_errors_429"] ?? [];

    if (err5xxSeries.length > 0) {
      const total5xx = err5xxSeries.reduce((s, p) => s + p.value, 0);
      const rate5xx = totalReqs > 0 ? (total5xx / totalReqs) * 100 : 0;
      results.push(
        m(
          "ERR-002",
          "5xx Server Error Rate",
          CAT,
          parseFloat(rate5xx.toFixed(3)),
          "%",
          "< 0.1",
          "HTTP 5xx responses / total requests"
        )
      );
    } else {
      // Approximate from failed requests (treat all as 5xx unless data available)
      results.push(
        m(
          "ERR-002",
          "5xx Server Error Rate (approx)",
          CAT,
          parseFloat(errorRate.toFixed(3)),
          "%",
          "< 0.1",
          "Approximated from http_req_failed. For exact breakdown, add http_errors_5xx to externalMetrics"
        )
      );
    }

    if (err429Series.length > 0) {
      const total429 = err429Series.reduce((s, p) => s + p.value, 0);
      const rate429 = totalReqs > 0 ? (total429 / totalReqs) * 100 : 0;
      results.push(
        m(
          "ERR-003",
          "HTTP 429 Rate Limit Rate",
          CAT,
          parseFloat(rate429.toFixed(3)),
          "%",
          "< 0.1",
          "HTTP 429 (Too Many Requests) / total requests"
        )
      );
    } else {
      results.push(
        na(
          "ERR-003",
          "HTTP 429 Rate Limit Rate",
          CAT,
          "%",
          "Requires http_errors_429 time-series in externalMetrics"
        )
      );
    }

    if (err4xxSeries.length > 0) {
      const total4xx = err4xxSeries.reduce((s, p) => s + p.value, 0);
      const rate4xx = totalReqs > 0 ? (total4xx / totalReqs) * 100 : 0;
      results.push(
        m(
          "ERR-004",
          "4xx Client Error Rate",
          CAT,
          parseFloat(rate4xx.toFixed(3)),
          "%",
          "< 1",
          "HTTP 4xx responses / total requests"
        )
      );
    } else {
      results.push(
        na(
          "ERR-004",
          "4xx Client Error Rate",
          CAT,
          "%",
          "Requires http_errors_4xx time-series in externalMetrics"
        )
      );
    }

    // ── Timeout rate (k6 http_req_duration_max proxy or dedicated metric) ────
    const timeoutMetric = k6Stat(k6Metrics, "http_req_failed{scenario:timeout}", "count");
    if (timeoutMetric > 0) {
      const timeoutRate = totalReqs > 0 ? (timeoutMetric / totalReqs) * 100 : 0;
      results.push(
        m(
          "ERR-005",
          "Timeout Rate",
          CAT,
          parseFloat(timeoutRate.toFixed(4)),
          "%",
          "< 0.5",
          "Requests that exceeded configured timeout / total requests"
        )
      );
    } else {
      // Infer: requests where duration ≈ configured timeout (heuristic via max duration)
      const maxDuration = k6Stat(k6Metrics, "http_req_duration", "max");
      const timeoutLikely = maxDuration > 29_000; // > 29s suggests timeout
      results.push(
        m(
          "ERR-005",
          "Timeout Indicator",
          CAT,
          timeoutLikely ? 1 : 0,
          "bool",
          "== 0",
          `Max observed duration is ${maxDuration.toFixed(0)}ms. ${timeoutLikely ? "Likely timeouts occurred." : "No timeout indicators."} Use k6 http.get() timeout option for exact tracking.`
        )
      );
    }

    // ── Connection-level errors ───────────────────────────────────────────────
    // k6 tracks http_req_connecting — connection errors show up as failed reqs
    const connectedAvg = k6Stat(k6Metrics, "http_req_connecting", "avg");
    const connectedMax = k6Stat(k6Metrics, "http_req_connecting", "max");
    results.push(
      m(
        "ERR-006",
        "Connection Establishment — Avg",
        CAT,
        parseFloat(connectedAvg.toFixed(2)),
        "ms",
        "< 100",
        "Average TCP connection establishment time. High values indicate connection-level failures"
      ),
      m(
        "ERR-007",
        "Connection Establishment — Max",
        CAT,
        parseFloat(connectedMax.toFixed(2)),
        "ms",
        "< 1000",
        "Maximum TCP connection time. Near-max suggests connection refused / reset under load"
      )
    );

    // ── TLS failure indicator ─────────────────────────────────────────────────
    const tlsMax = k6Stat(k6Metrics, "http_req_tls_handshaking", "max");
    const tlsAvg = k6Stat(k6Metrics, "http_req_tls_handshaking", "avg");
    results.push(
      m(
        "ERR-008",
        "TLS Handshake Failure Indicator",
        CAT,
        parseFloat(tlsMax.toFixed(2)),
        "ms",
        "< 2000",
        `TLS max=${tlsMax.toFixed(0)}ms avg=${tlsAvg.toFixed(0)}ms. Max > 2000ms suggests TLS failures or certificate issues`
      )
    );

    // ── Check failure rate ────────────────────────────────────────────────────
    const checksPasses = k6Stat(k6Metrics, "checks", "passes");
    const checksFails = k6Stat(k6Metrics, "checks", "fails");
    const checksTotal = checksPasses + checksFails;
    const checkFailRate = checksTotal > 0 ? (checksFails / checksTotal) * 100 : 0;
    results.push(
      m(
        "ERR-009",
        "Check Failure Rate",
        CAT,
        parseFloat(checkFailRate.toFixed(3)),
        "%",
        "< 1",
        `${checksFails} failed / ${checksTotal} total checks = ${checkFailRate.toFixed(2)}% failure rate`
      )
    );

    // ── Error spike (max 1-min window) ────────────────────────────────────────
    const errorSeries = externalMetrics?.["error_rate_percent"] ?? [];
    if (errorSeries.length >= 2) {
      const maxSpike = Math.max(...errorSeries.map((p) => p.value));
      results.push(
        m(
          "ERR-010",
          "Error Spike — Max 1-min Window",
          CAT,
          parseFloat(maxSpike.toFixed(3)),
          "%",
          "< 5",
          `Maximum error rate observed in any 1-minute window: ${maxSpike.toFixed(2)}%`
        )
      );

      // Error trend slope (linear regression)
      const points = errorSeries.map((p, i) => ({ x: i, y: p.value }));
      const slope = linearRegressionSlope(points);
      results.push(
        m(
          "ERR-011",
          "Error Rate Trend Slope",
          CAT,
          parseFloat(slope.toFixed(5)),
          "%/sample",
          "< 0.1",
          `Linear regression slope of error rate. Positive = increasing errors. Slope: ${slope.toFixed(4)}`
        )
      );
    } else {
      results.push(
        na(
          "ERR-010",
          "Error Spike — Max 1-min Window",
          CAT,
          "%",
          "Requires error_rate_percent time-series in externalMetrics"
        ),
        na(
          "ERR-011",
          "Error Rate Trend Slope",
          CAT,
          "%/sample",
          "Requires error_rate_percent time-series in externalMetrics"
        )
      );
    }

    // ── Error budget burn ─────────────────────────────────────────────────────
    // Error budget = 1 - SLO availability. Burn = current error rate / (1 - SLO target)
    const sloTarget = input.sloConfig?.availabilityTarget ?? 0.999;
    const errorBudget = (1 - sloTarget) * 100; // in %
    const burnRate = errorBudget > 0 ? errorRate / errorBudget : 0;
    const projectedMonthlyBurn = burnRate * 100; // % of monthly budget consumed at this rate

    results.push(
      m(
        "ERR-012",
        "Error Budget Burn Rate",
        CAT,
        parseFloat(burnRate.toFixed(3)),
        "×",
        "< 5",
        `Burn rate = current_error_rate / error_budget. SLO=${(sloTarget * 100).toFixed(2)}% → budget=${errorBudget.toFixed(3)}%. Current burn: ${burnRate.toFixed(2)}× (${projectedMonthlyBurn.toFixed(1)}% of monthly budget)`
      )
    );

    // ── Shannon entropy of status code distribution ────────────────────────────
    if (err4xxSeries.length > 0 && err5xxSeries.length > 0 && totalReqs > 0) {
      const total4xx = err4xxSeries.reduce((s, p) => s + p.value, 0);
      const total5xx = err5xxSeries.reduce((s, p) => s + p.value, 0);
      const successCount = Math.max(0, totalReqs - total4xx - total5xx);
      const probs = [successCount, total4xx, total5xx]
        .map((c) => c / totalReqs)
        .filter((p) => p > 0);
      const entropy = -probs.reduce((s, p) => s + p * Math.log2(p), 0);
      results.push(
        m(
          "ERR-013",
          "Error Distribution Entropy",
          CAT,
          parseFloat(entropy.toFixed(4)),
          "bits",
          "< 1",
          `Shannon entropy of status code distribution. High entropy = many different error types. Entropy: ${entropy.toFixed(3)} bits`
        )
      );
    } else {
      results.push(
        na(
          "ERR-013",
          "Error Distribution Entropy",
          CAT,
          "bits",
          "Requires http_errors_4xx + http_errors_5xx time-series in externalMetrics"
        )
      );
    }

    // ── Partial / malformed responses ─────────────────────────────────────────
    results.push(
      na(
        "ERR-014",
        "Partial Response Rate",
        CAT,
        "%",
        "Requires response completeness check in k6 scenario (check Content-Length vs body length)"
      ),
      na(
        "ERR-015",
        "Malformed JSON Rate",
        CAT,
        "%",
        "Requires JSON.parse() try/catch check in k6 scenario"
      ),
      na(
        "ERR-016",
        "Request Cancelled Rate",
        CAT,
        "%",
        "Requires custom k6 counter for cancelled requests"
      )
    );

    // ── Retry metrics ─────────────────────────────────────────────────────────
    const iterations2 = iterations;
    const retryAmplification = iterations2 > 0 ? totalReqs / iterations2 : 1;
    const retryRate =
      retryAmplification > 1 ? ((retryAmplification - 1) / retryAmplification) * 100 : 0;
    results.push(
      m(
        "ERR-017",
        "Estimated Retry Rate",
        CAT,
        parseFloat(retryRate.toFixed(2)),
        "%",
        "< 5",
        `Estimated from request amplification: ${retryAmplification.toFixed(2)}× requests/iteration. Retry rate ≈ ${retryRate.toFixed(1)}%`
      ),
      na(
        "ERR-018",
        "Retry Success Rate",
        CAT,
        "%",
        "Requires k6 custom counter tracking retry outcomes"
      ),
      na(
        "ERR-019",
        "Poison Message Rate",
        CAT,
        "%",
        "Requires message queue consumer scenario with dead-letter tracking"
      )
    );

    // ── Circuit breaker indicators ────────────────────────────────────────────
    const cbSeries = externalMetrics?.["circuit_breaker_open"] ?? [];
    if (cbSeries.length > 0) {
      const openEvents = cbSeries.filter((p) => p.value > 0).length;
      const totalSamples = cbSeries.length;
      const cbOpenPct = totalSamples > 0 ? (openEvents / totalSamples) * 100 : 0;
      results.push(
        m(
          "ERR-020",
          "Circuit Breaker Open %",
          CAT,
          parseFloat(cbOpenPct.toFixed(2)),
          "%",
          "< 5",
          `Circuit breaker was open in ${cbOpenPct.toFixed(1)}% of samples. ${openEvents} open events in ${totalSamples} total samples`
        )
      );
    } else {
      results.push(
        na(
          "ERR-020",
          "Circuit Breaker Open %",
          CAT,
          "%",
          "Requires circuit_breaker_open metric from SUT (e.g. Resilience4j, Hystrix via Prometheus)"
        )
      );
    }

    // ── Cascade failure ───────────────────────────────────────────────────────
    // Heuristic: if error rate grows faster than load (non-linear error growth)
    if (errorSeries.length >= 4) {
      const mid = Math.floor(errorSeries.length / 2);
      const firstHalf = errorSeries.slice(0, mid).reduce((s, p) => s + p.value, 0) / mid;
      const secondHalf = errorSeries.slice(mid).reduce((s, p) => s + p.value, 0) / mid;
      const growthFactor = firstHalf > 0 ? secondHalf / firstHalf : 1;
      const cascadeRisk = growthFactor > 3;
      results.push(
        m(
          "ERR-021",
          "Cascade Failure Indicator",
          CAT,
          parseFloat(growthFactor.toFixed(2)),
          "ratio",
          "< 3",
          `Error rate growth factor (second half vs first half): ${growthFactor.toFixed(2)}×. ${cascadeRisk ? "Cascade failure pattern detected." : "No cascade pattern."}`
        )
      );
    } else {
      results.push(
        na(
          "ERR-021",
          "Cascade Failure Indicator",
          CAT,
          "ratio",
          "Requires error_rate_percent time-series with ≥4 data points"
        )
      );
    }

    // ── N/A metrics requiring external tools ─────────────────────────────────
    const NA_EXTERNAL = "Requires SUT instrumentation or specialized test scenario";
    results.push(
      na(
        "ERR-022",
        "DNS Failure Rate",
        CAT,
        "%",
        "Requires DNS failure tracking in k6 scenario (custom counter on connection error)"
      ),
      na(
        "ERR-023",
        "Degraded Mode Activation Rate",
        CAT,
        "%",
        NA_EXTERNAL + " (circuit breaker / fallback tracking)"
      ),
      na(
        "ERR-024",
        "Fallback Response Rate",
        CAT,
        "%",
        NA_EXTERNAL + " (requires response header or body flag for fallback mode)"
      ),
      na(
        "ERR-025",
        "Exception Leak Rate",
        CAT,
        "%",
        "Requires application log parsing for stack traces (Loki query or log scraping)"
      ),
      na(
        "ERR-026",
        "Error Correlation (with CPU)",
        CAT,
        "corr",
        "Requires cpu_usage_percent + error_rate_percent time-series (Pearson correlation)"
      ),
      na(
        "ERR-027",
        "Error Payload Avg Size",
        CAT,
        "bytes",
        "Requires error response size tracking in k6 scenario"
      ),
      na(
        "ERR-028",
        "Log Completeness Rate",
        CAT,
        "%",
        "Requires log line counting: SUT logs vs k6 requests (Loki API)"
      ),
      na(
        "ERR-029",
        "Trace Completeness Rate",
        CAT,
        "%",
        "Requires trace span count vs request count (Tempo/Jaeger API)"
      ),
      na(
        "ERR-030",
        "Data Integrity Error Rate",
        CAT,
        "%",
        "Requires business-logic checks in k6 scenario (e.g. read-after-write validation)"
      )
    );

    return results;
  }
}
