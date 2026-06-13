---
title: "Metrics Engine Guide"
sidebar_position: 1
---
# Metrics Engine Guide

**Phase 9** · k6 Enterprise Framework

The Metrics Engine (`src/metrics/`) calculates 125+ performance metrics grouped by domain from k6 `handleSummary` data and optional external Prometheus metrics.

---

## Architecture

```
handleSummary data (k6)
        │
        ▼
MetricsEngine.calculate(input)
        │
        ├── PerformanceCalculator  → 50 PERF metrics (CHK-API-175–224)
        ├── ThroughputCalculator   → 25 THRU metrics (CHK-API-225–249)
        ├── ErrorCalculator        → 30 ERR  metrics (CHK-API-250–279)
        └── SlaCalculator          → 20 SLA  metrics (CHK-API-330–349)
                │
                ▼
        MetricsReport
        ├── byCategory: { performance: [...], throughput: [...], ... }
        ├── all: MetricResult[]
        └── summary: { total, pass, warn, fail, na }
```

---

## Quick Start

```typescript
import { MetricsEngine, buildMetricsInput } from "./src/metrics";

export function handleSummary(data) {
  const context = { client: "my-team", environment: "staging",
                    profile: "load", testName: "smoke-users",
                    startTime: new Date().toISOString() };

  const engine = MetricsEngine.withP1Calculators();
  const report = engine.calculate(buildMetricsInput(data, context, {
    sloConfig: {
      availabilityTarget: 0.999,
      latencyP95TargetMs: 500,
    },
  }));

  // report.summary → { total: 125, pass: 87, warn: 5, fail: 3, na: 30 }
  // report.byCategory.performance → MetricResult[]

  return generateHtmlReport(data, context, "./reports/report.html",
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    report  // metricsReport parameter
  );
}
```

---

## Metric Status

| Status | Meaning |
|--------|---------|
| `pass` | Value within threshold |
| `warn` | Value within warn zone (threshold × 1.1) |
| `fail` | Value exceeds threshold |
| `na`   | Cannot compute — requires external data |

---

## N/A Metrics: SUT Instrumentation

Many metrics require external data from your SUT. Add them to `externalMetrics`:

```typescript
const prometheusClient = new PrometheusClient("http://prometheus:9090");

// Fetch during/after test
const cpuSamples = await prometheusClient.queryRange(
  'avg(rate(process_cpu_seconds_total[1m])) * 100',
  startTs, endTs, "15s"
);

const input = buildMetricsInput(data, context, {
  externalMetrics: {
    "cpu_usage_percent":    PrometheusClient.timeSeries(cpuSamples),
    "http_req_duration_p95": PrometheusClient.timeSeries(p95Samples),
    "error_rate_percent":    PrometheusClient.timeSeries(errorSamples),
    "rps":                   PrometheusClient.timeSeries(rpsSamples),
  },
});
```

### Required Prometheus queries per domain

| `externalMetrics` key | Prometheus query | Unlocks |
|-----------------------|-----------------|---------|
| `cpu_usage_percent` | `avg(rate(process_cpu_seconds_total[1m])) * 100` | PERF-041, SAT metrics |
| `memory_usage_bytes` | `process_resident_memory_bytes` | PERF-042, STAB metrics |
| `http_req_duration_p95` | `histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[1m])) * 1000` | PERF-021, 023 |
| `rps` | `rate(http_requests_total[1m])` | THRU-009, 010 |
| `vus` | (from k6 cloud or custom metric) | THRU-010 |
| `error_rate_percent` | `rate(http_requests_total{status=~"5.."}[1m]) / rate(http_requests_total[1m]) * 100` | ERR-010, 011, 021 |
| `http_errors_4xx` | `increase(http_requests_total{status=~"4.."}[1m])` | ERR-004, 013 |
| `http_errors_5xx` | `increase(http_requests_total{status=~"5.."}[1m])` | ERR-002, 013 |
| `http_errors_429` | `increase(http_requests_total{status="429"}[1m])` | ERR-003 |
| `slo_breach` | `(rate(http_requests_total{status=~"5.."}[1m]) / rate(http_requests_total[1m])) > 0.001` | SLA-012–014 |
| `circuit_breaker_open` | `resilience4j_circuitbreaker_state{state="open"}` | ERR-020 |

---

## Configuration (`shared/schemas/metrics-config.json`)

```json
{
  "enabled": ["performance", "throughput", "error", "sla"],
  "prometheus": {
    "url": "http://prometheus:9090",
    "enabled": true,
    "queryTimeout": 10
  },
  "slo": {
    "availabilityTarget": 0.999,
    "latencyP95TargetMs": 500,
    "latencyP99TargetMs": 1000,
    "errorBudgetWindowDays": 30
  },
  "profiles": {
    "smoke": { "enabled": ["performance", "error"] },
    "load":  { "enabled": ["performance", "throughput", "error", "sla"] },
    "soak":  { "enabled": "all" }
  }
}
```

---

## Domain Calculators

| Calculator | Metrics | CHK-API range | Priority |
|-----------|---------|---------------|---------|
| `PerformanceCalculator` | 50 | CHK-API-175–224 | P1 |
| `ThroughputCalculator`  | 25 | CHK-API-225–249 | P1 |
| `ErrorCalculator`       | 30 | CHK-API-250–279 | P1 |
| `SlaCalculator`         | 20 | CHK-API-330–349 | P1 |

### Key metrics by calculator

**Performance** (k6-native):
- `PERF-001–007`: p50/p90/p95/p99/max/min/avg response time
- `PERF-010–012`: TTFB avg/p95/p99
- `PERF-013–019`: DNS, TCP, TLS, send, receive, content transfer, server processing
- `PERF-020`: Apdex score (T=500ms configurable)
- `PERF-024`: VU efficiency (RPS/VU)
- `PERF-035–038`: Payload sizes and total data transferred

**Throughput** (k6-native):
- `THRU-001–003`: RPS total, RPS successful (goodput), TPS
- `THRU-004–007`: Data sent/received in MB and Mbps
- `THRU-008`: Throughput per VU
- `THRU-011`: Little's Law deviation
- `THRU-012`: Goodput rate
- `THRU-013`: Retry amplification factor

**Errors** (k6-native + derived):
- `ERR-001`: Overall HTTP error rate
- `ERR-005`: Timeout indicator
- `ERR-006–007`: Connection establishment avg/max
- `ERR-009`: Check failure rate
- `ERR-012`: Error budget burn rate
- `ERR-017`: Estimated retry rate

**SLA** (k6-native + config):
- `SLA-001`: Availability (request-based)
- `SLA-002`: Availability (check-based)
- `SLA-003–004`: Error budget remaining + projected monthly burn
- `SLA-005–006`: p95/p99 SLO compliance
- `SLA-008`: Multi-SLI composite score (availability 40% + p95 35% + p99 15% + checks 10%)
- `SLA-011`: Correctness rate

---

## HTML Report Integration

The Extended Metrics section appears automatically in HTML reports when `metricsReport` is passed to `generateHtmlReport()`. It includes:

- **Summary bar**: Total / Pass / Warn / Fail / N/A counts
- **Domain tabs**: Click to switch between Performance, Throughput, Errors, SLA, etc.
- **Fail/warn badges** on tab buttons for quick scanning
- **N/A expandable section** per domain: lists prerequisites for each uncomputed metric

---

## JSON Report Integration

When `extendedMetrics` is passed to `generateJsonSummary()`, the output includes:

```json
{
  "$schema": "...",
  "schemaVersion": "2.0.0",
  "summary": { ... },
  "extendedMetrics": {
    "generatedAt": "2026-02-18T14:30:52Z",
    "durationMs": 300000,
    "byCategory": {
      "performance": [
        { "id": "PERF-001", "name": "Response Time — Average", "value": 245.3,
          "unit": "ms", "threshold": "< 500", "status": "pass", ... }
      ],
      "error": [ ... ],
      "sla": [ ... ]
    },
    "summary": { "total": 125, "pass": 87, "warn": 5, "fail": 3, "na": 30 }
  }
}
```

---

## Filtering by Domain

Use `--metrics=<domain,...>` when calling `engine.calculate()` to limit which
calculators run. Unknown domain names are silently ignored. Pass `all` or omit
the flag to run every registered calculator.

```typescript
import { MetricsEngine, buildMetricsInput } from "./src/metrics";

// Parse from CLI arg (e.g. K6_METRICS_FILTER="performance,error,sla")
const domains = MetricsEngine.parseDomainsArg(process.env["K6_METRICS_FILTER"]);

const report = MetricsEngine.withAllCalculators()
  .calculate(buildMetricsInput(data, context), domains);

// With a specific CSV string:
const domainsExplicit = MetricsEngine.parseDomainsArg("performance,error,sla");
// → ["performance", "error", "sla"]

// Run all (default):
const domainsAll = MetricsEngine.parseDomainsArg("all");
// → undefined  (all calculators execute)
```

Valid domain names: `performance`, `throughput`, `error`, `saturation`, `sla`,
`stability`, `scalability`, `chaos`, `security`, `observability`, `data-integrity`.

### N/A metrics grouping in reports

Metrics that cannot be computed (status `"na"`) are grouped at the bottom of
each domain section in the HTML report with a collapsible list of prerequisites:

> **23 metrics require SUT instrumentation.** See [docs/METRICS_ENGINE.md → N/A Metrics](#na-metrics-sut-instrumentation) for the required Prometheus queries per metric.

---

---

## Overall Results Score

The Metrics Engine attaches a GPT-inspired overall score to every `MetricsReport` (T-262).
The score is exposed as `MetricsReport.score` and, when the JSON summary is generated,
as `extendedMetrics.score` in the output file.

### Scoring formula

| Metric status | Weight |
|---------------|--------|
| `pass`        | 1.0    |
| `warn`        | 0.5    |
| `fail`        | 0      |
| `na`          | excluded from denominator |

```
value = round( (pass × 1.0 + warn × 0.5) / (pass + warn + fail) × 100 )
```

When no scorable metrics exist (all `na` or empty report) the value defaults to **100**.

### Grade table

| Grade | Minimum score |
|-------|--------------|
| A     | 90           |
| B     | 80           |
| C     | 70           |
| D     | 60           |
| F     | < 60         |

A score of 90 or above is considered **healthy** (`score.healthy === true`), following the
GPT healthy-instance convention.

### Programmatic access

```typescript
import { scoreFromCounts } from "../../src/metrics/score";

const score = scoreFromCounts({ pass: 85, warn: 5, fail: 10 });
// → { value: 91, grade: "A", healthy: true }

// The score is also on MetricsReport after engine.calculate():
// report.score === { value: 91, grade: "A", healthy: true }
```

The standalone `scoreFromCounts()` function is exported from `src/metrics/score.ts` so
the HTML report generator can derive a score from `BuiltSummary.checks` when
`extendedMetrics.score` is not available (see [Reporting → Overall score badge](#)).

---

## Custom Metrics Integration

The Metrics Engine supports integrating k6 custom metrics (Trend, Counter, Rate, Gauge) into the calculation pipeline. This allows your own application-specific metrics to be evaluated alongside the built-in 125+ metrics.

### Supported k6 Custom Metric Types

| k6 Type   | Description                          | Example Use Case                        |
|-----------|--------------------------------------|-----------------------------------------|
| `Trend`   | Collects time-series values (p50, p95, avg, etc.) | Custom response time for a specific endpoint |
| `Counter` | Monotonically increasing counter     | Total number of business transactions   |
| `Rate`    | Tracks the percentage of non-zero values | Success rate of a specific workflow     |
| `Gauge`   | Stores the last value                | Current queue depth or pool size        |

### Registering Custom Metrics

Pass custom metrics via the `customMetrics` field in `buildMetricsInput()`:

```typescript
import { Trend, Counter, Rate, Gauge } from "k6/metrics";

// Define in your test script
const loginDuration = new Trend("login_duration", true);
const bizTransactions = new Counter("biz_transactions");
const loginSuccess = new Rate("login_success_rate");
const activeConnections = new Gauge("active_connections");

// In handleSummary, pass them to the engine
const input = buildMetricsInput(data, context, {
  customMetrics: {
    "login_duration":      { type: "trend",   values: data.metrics["login_duration"] },
    "biz_transactions":    { type: "counter", values: data.metrics["biz_transactions"] },
    "login_success_rate":  { type: "rate",    values: data.metrics["login_success_rate"] },
    "active_connections":  { type: "gauge",   values: data.metrics["active_connections"] },
  },
  customThresholds: {
    "login_duration":      { p95: 800, p99: 1500, unit: "ms" },
    "biz_transactions":    { min: 1000, unit: "count" },
    "login_success_rate":  { min: 0.98, unit: "ratio" },
    "active_connections":  { max: 100, unit: "count" },
  },
});
```

### Custom Metrics in Reports

Custom metrics appear in a dedicated **"Custom"** tab in the HTML report and under `extendedMetrics.byCategory.custom` in the JSON output. They follow the same pass/warn/fail/na status model as built-in metrics.

*See also: [WORKFLOW.md](/docs/framework/workflow) · [TEST_TYPES.md](/docs/framework/test-types) · [DISTRIBUTED_TESTING.md](/docs/framework/observability/distributed-testing)*
