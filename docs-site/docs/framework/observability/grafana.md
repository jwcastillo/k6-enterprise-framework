---
title: "Grafana Observability Guide"
sidebar_position: 1
---
> Espanol | **English**

# Grafana Observability Guide

k6 Enterprise Framework — Grafana dashboards, template variables, and PromQL reference.

---

## Quick Start

```bash
# 1. Start the observability stack
docker compose --profile observability up -d

# 2. Open Grafana
open http://localhost:3000
# Default credentials: admin / admin

# 3. Run a test with full observability (metrics + logs + traces + profiling)
./bin/run-test.sh --client=examples --scenario=integration/16-sli-monitoring \
  --profile=smoke --observability

# 4. Navigate to: Dashboards → k6 Load Test Overview
# Metrics appear within ~15 seconds of test start
```

> **New:** Use `--observability` to send data to Prometheus, Loki, Tempo, and Pyroscope in a single command.

---

## Prerequisites: Enable Prometheus Export

Add `metricsBackends` to your client `config.json` (or `config.yaml`):

```json
{
  "scenarios": { ... },
  "metricsBackends": [
    { "type": "prometheus" }
  ]
}
```

This exports all k6 metrics to Prometheus on port `5656` (scrape target pre-configured in the stack).

The framework automatically injects **4 custom labels** into every exported metric:

| Label | Source env var | Example value |
|-------|---------------|---------------|
| `test_name` | `K6_TEST_NAME` | `auth-flow` |
| `test_timestamp` | `K6_TEST_TIMESTAMP` | `20260218-143052` |
| `client` | `K6_CLIENT` | `my-team` |
| `environment` | `K6_ENVIRONMENT` | `staging` |

These labels are set automatically by `run-test.sh` — no manual configuration needed.

---

## Dashboards

The framework ships with **3 pre-built dashboards**, each designed for a different use case. All dashboards are provisioned automatically and share the same template variables.

| Dashboard | File | Best For |
|-----------|------|----------|
| **k6 Load Test Overview** | `k6-load-test-overview.json` | Day-to-day load test monitoring |
| **k6 Enterprise Analytics** | `k6-enterprise-analytics.json` | SLA compliance, executive reporting, anomaly detection |
| **k6 Web Vitals** | `k6-web-vitals.json` | Browser-based tests with Core Web Vitals |

---

### Dashboard 1: k6 Load Test Overview

The primary operational dashboard. Provides a comprehensive view of a load test execution with real-time metrics.

**File:** `infrastructure/grafana/dashboards/k6-load-test-overview.json`

#### Overview Row

Top-level summary stats displayed as stat panels and gauges:

| Panel | Type | Description |
|-------|------|-------------|
| Active VUs | stat | Current number of active virtual users |
| HTTP Request Rate | stat | Requests per second |
| p95 Response Time | stat | 95th percentile response time (ms) |
| Error Rate | stat | Percentage of failed HTTP requests |
| Check Pass Rate | gauge | Percentage of k6 checks passing |

#### Virtual Users & Throughput Row

| Panel | Description |
|-------|-------------|
| Virtual Users Over Time | Time series of active VUs throughout the test |
| Iterations Over Time | Completed iterations per second |
| HTTP Request Rate | RPS time series with rolling window |

#### Latency Percentiles Row

| Panel | Description |
|-------|-------------|
| Response Time Percentiles | p50, p90, p95, p99 overlaid on a single chart |
| Request Duration Breakdown | Breakdown by request phase: DNS, TLS, connect, waiting, receiving |

#### Errors & Checks Row

| Panel | Description |
|-------|-------------|
| HTTP Error Rate | Failed requests as a percentage over time |
| Check Pass / Fail Rate | Pass and fail check rates over time |

#### Data Transfer Row

| Panel | Description |
|-------|-------------|
| Network Throughput | Data sent and received (bytes/s) over time |

#### Groups Analysis Row (collapsed)

Auto-detected group performance. Expand to view:

| Panel | Description |
|-------|-------------|
| Group Duration -- p95 by Group | Bar gauge showing p95 latency per group |
| Group Duration -- Avg by Group | Bar gauge showing average latency per group |
| Group Performance Breakdown | Table with avg, p90, p95, p99 per group |
| Group Duration Over Time | Time series of p95 per group over time |

#### Custom Metrics Row (collapsed)

Auto-detected custom metrics. Expand to view:

| Panel | Description |
|-------|-------------|
| Custom Trends -- p95 | Bar gauge of p95 values for custom Trend metrics |
| Custom Counters | Bar gauge of totals for custom Counter metrics |
| Custom Rates & Gauges | Bar gauge of custom Rate and Gauge metric values |
| Custom Metrics Over Time | Time series of all custom metrics over time |

---

### Dashboard 2: k6 Enterprise Analytics

An advanced analytics dashboard aimed at engineering leads and stakeholders. Adds SLA compliance tracking, APDEX scoring, and anomaly detection on top of core metrics.

**File:** `infrastructure/grafana/dashboards/k6-enterprise-analytics.json`

#### Executive Summary Row

| Panel | Type | Description |
|-------|------|-------------|
| Active VUs | gauge | Current virtual users with visual threshold |
| Request Rate | stat | Current RPS |
| p95 Response | stat | 95th percentile latency |
| p99 Response | stat | 99th percentile latency |
| Error Rate % | stat | Percentage of failed requests |
| Check Pass % | gauge | Check pass rate with threshold indicators |
| APDEX Score | gauge | Application Performance Index (0-1) |
| Throughput | stat | Total data throughput |

#### SLA Compliance & Anomaly Detection Row

| Panel | Description |
|-------|-------------|
| SLA Compliance | Table showing metric, target, actual, and compliance status |
| Anomaly Detection -- Latency vs SLA | Time series overlaying actual latency against SLA threshold lines |

#### Latency Analysis Row

| Panel | Description |
|-------|-------------|
| Percentiles Over Time | p50, p90, p95, p99 time series |
| Latency Distribution | Bar gauge showing the spread of latency percentiles |
| Request Phase Breakdown | Time series breakdown: DNS lookup, TLS handshake, connect, waiting, receiving |

#### Errors & Checks Row

| Panel | Description |
|-------|-------------|
| Error Rate Over Time | HTTP error percentage time series |
| Check Pass Rate Over Time | Check pass rate time series |
| Per-Check Breakdown | Table listing each check name with pass/fail counts |

#### Virtual Users & Throughput Row

| Panel | Description |
|-------|-------------|
| VUs Over Time | Active VUs time series |
| Request Rate Over Time | RPS time series |
| Iteration Duration | Time per iteration over time |

#### Network & Connection Row

| Panel | Description |
|-------|-------------|
| Data Transfer | Bytes sent/received over time |
| Connection Overhead | TLS handshake and TCP connect times |

#### Groups Analysis Row (collapsed)

Same group analysis panels as the Overview dashboard:

| Panel | Description |
|-------|-------------|
| Group Duration -- p95 by Group | Bar gauge of p95 per group |
| Group Duration -- Avg by Group | Bar gauge of average per group |
| Group Performance Breakdown | Table with avg, p90, p95, p99 per group |
| Group Duration Over Time | p95 per group over time |

#### Custom Metrics Row (collapsed)

Same custom metrics panels as the Overview dashboard:

| Panel | Description |
|-------|-------------|
| Custom Trends -- p95 | p95 values for custom Trend metrics |
| Custom Counters | Totals for custom Counter metrics |
| Custom Rates & Gauges | Custom Rate and Gauge values |
| Custom Metrics Over Time | All custom metrics over time |

---

### Dashboard 3: k6 Web Vitals

Designed for browser-based load tests using the k6 browser module. Tracks Core Web Vitals alongside standard load metrics.

**File:** `infrastructure/grafana/dashboards/k6-web-vitals.json`

> **Note:** This dashboard requires tests that use the k6 browser module and emit web vitals metrics (`browser_web_vital_lcp`, `browser_web_vital_fcp`, etc.).

#### Core Web Vitals -- Gauges (p90) Row

Each metric is displayed as a gauge with color-coded thresholds (Good / Needs Improvement / Poor):

| Panel | Metric | Good | Needs Improvement | Poor |
|-------|--------|------|-------------------|------|
| LCP (Largest Contentful Paint) | `browser_web_vital_lcp` | < 2500ms | 2500-4000ms | > 4000ms |
| FCP (First Contentful Paint) | `browser_web_vital_fcp` | < 1800ms | 1800-3000ms | > 3000ms |
| INP (Interaction to Next Paint) | `browser_web_vital_inp` | < 200ms | 200-500ms | > 500ms |
| CLS (Cumulative Layout Shift) | `browser_web_vital_cls` | < 0.1 | 0.1-0.25 | > 0.25 |
| TTFB (Time to First Byte) | `browser_web_vital_ttfb` | < 800ms | 800-1800ms | > 1800ms |

#### Web Vitals Over Time Row

| Panel | Description |
|-------|-------------|
| LCP & FCP Over Time | Largest Contentful Paint and First Contentful Paint trends |
| INP Over Time | Interaction to Next Paint over time |
| TTFB Over Time | Time to First Byte over time |
| CLS Over Time | Cumulative Layout Shift over time |

#### Web Vitals by Page URL Row

| Panel | Description |
|-------|-------------|
| Web Vitals Breakdown by URL | Table showing LCP, FCP, INP, CLS, TTFB per page URL |

#### Concurrent Load Metrics Row

Standard load metrics for context alongside web vitals:

| Panel | Description |
|-------|-------------|
| VUs & Iterations | Virtual users and iterations over time |
| HTTP Request Rate | Requests per second |
| HTTP Response Times (p90, p95) | Response time percentiles |
| Error Rate (%) | HTTP error percentage over time |

---

## Template Variables

All three dashboards share the same 4 dropdown filters at the top. Use them to slice and compare executions:

| Variable | Label | Description |
|----------|-------|-------------|
| `$test_name` | Test Name | Filter by scenario name (e.g. `auth-flow`) |
| `$client` | Client | Filter by client directory (e.g. `my-team`) |
| `$environment` | Environment | Filter by target env (e.g. `staging`, `production`) |
| `$test_timestamp` | Timestamp | Filter by execution timestamp — supports multi-select |

**How the variables are populated**: Each dropdown uses a `label_values()` query against Prometheus. They populate automatically after the first test run that exports metrics.

> **No data in the dropdowns?**
>
> No test executions found. Run a test with Prometheus tags to populate this dashboard:
> ```bash
> ./bin/run-test.sh --client=_reference --scenario=api/smoke-users --profile=smoke
> ```
> Then wait ~15 seconds for Prometheus to scrape the first metrics.

### Comparing Two Executions

1. Click the **Timestamp** dropdown
2. Enable **multi-value** (the toggle in the variable editor, or hold Ctrl/Cmd and click two values)
3. All panels display both executions overlaid — the legend shows the timestamp of each series

---

## Custom Metrics in Dashboards

The Custom Metrics row (present in both the Overview and Enterprise Analytics dashboards) **auto-detects** any custom metrics you define in your tests and displays them without any dashboard configuration.

### How k6 Exports Custom Metrics to Prometheus

When k6 exports metrics to Prometheus, each metric type produces specific time series:

| k6 Metric Type | Prometheus Series | Example |
|----------------|-------------------|---------|
| `Trend` | `k6_<name>_avg`, `k6_<name>_min`, `k6_<name>_med`, `k6_<name>_max`, `k6_<name>_p90`, `k6_<name>_p95`, `k6_<name>_p99` | `k6_my_api_latency_p95` |
| `Counter` | `k6_<name>_total` | `k6_payment_count_total` |
| `Rate` | `k6_<name>_rate` | `k6_login_success_rate` |
| `Gauge` | `k6_<name>` | `k6_queue_depth` |

### Auto-Detection Panels

Three bar gauge panels auto-detect custom metrics using `__name__` regex matching:

| Panel | Matches | Query Pattern |
|-------|---------|---------------|
| **Custom Trends -- p95** | `k6_*_p95` (excluding built-ins) | `{__name__=~"k6_.+_p95", __name__!~"k6_http_req.*\|k6_iteration.*\|..."}` |
| **Custom Counters** | `k6_*_total` (excluding built-ins) | `{__name__=~"k6_.+_total", __name__!~"k6_http_req.*\|k6_http_reqs.*\|..."}` |
| **Custom Rates & Gauges** | `k6_*_rate` + raw gauges (excluding built-ins) | `{__name__=~"k6_.+_rate", __name__!~"..."}` combined with raw gauge query |

### Exclusion Regex

The exclusion regex filters out all built-in k6 metrics so only your custom metrics appear:

```
k6_http_req.*|k6_http_reqs.*|k6_iteration.*|k6_group_duration.*|k6_browser.*|k6_vus.*|k6_data_.*|k6_checks.*|k6_grpc_.*|k6_ws_.*
```

### Display Transformation

The Custom Rates & Gauges panel uses a `renameByRegex` transformation to produce clean display names:

- **Regex:** `k6_(.+?)(?:_rate)?$`
- **Rename pattern:** `$1`

This strips the `k6_` prefix and optional `_rate` suffix so that `k6_login_success_rate` displays as `login_success`.

---

## Groups Analysis in Dashboards

The Groups Analysis row (present in both the Overview and Enterprise Analytics dashboards) **auto-detects** k6 groups and visualizes their timing.

### How Groups Are Detected

k6 groups produce `group_duration` metrics with a `group` label. When exported to Prometheus, these become:

```
k6_group_duration_avg{group="Login Flow", ...}
k6_group_duration_p90{group="Login Flow", ...}
k6_group_duration_p95{group="Login Flow", ...}
k6_group_duration_p99{group="Login Flow", ...}
```

The panels query for `group=~".+"` to auto-detect all groups.

### Panels

| Panel | PromQL | Description |
|-------|--------|-------------|
| Group Duration -- p95 by Group | `avg by (group)(last_over_time(k6_group_duration_p95{...}[$__range]))` | Bar gauge of p95 per group |
| Group Duration -- Avg by Group | `avg by (group)(last_over_time(k6_group_duration_avg{...}[$__range]))` | Bar gauge of average per group |
| Group Performance Breakdown | Multiple queries: avg, p90, p95, p99 | Table with all percentiles per group |
| Group Duration Over Time | `avg by (group)(k6_group_duration_p95{...})` | Time series tracking p95 per group |

### Prerequisite: Synthetic Threshold Injection

For group metrics to be exported to Prometheus, k6 requires at least one threshold referencing `group_duration`. The `run-test.sh` script handles this automatically by injecting a synthetic threshold:

```javascript
// Injected by run-test.sh when Prometheus export is enabled
thresholds: {
  'group_duration': ['avg>=0']  // Always-passing threshold to ensure export
}
```

Without this threshold, k6 does not export `group_duration` metrics to the Prometheus endpoint. If you run tests with `k6 run` directly (bypassing `run-test.sh`), you must add this threshold manually to your test options.

---

## PromQL Reference

All queries below use the 4 custom labels for filtering. Copy and paste directly into Grafana's **Explore** view or a panel editor.

### 1. p95 Response Time by Test Run

```promql
histogram_quantile(
  0.95,
  sum by (le, test_name, test_timestamp) (
    rate(k6_http_req_duration_bucket{
      test_name=~"$test_name",
      client=~"$client",
      environment=~"$environment",
      test_timestamp=~"$test_timestamp"
    }[1m])
  )
)
```

> Shows the 95th percentile response time in milliseconds. Use this to detect latency regressions between runs.

---

### 2. HTTP Request Rate (RPS)

```promql
sum by (test_name, test_timestamp) (
  rate(k6_http_reqs_total{
    test_name=~"$test_name",
    client=~"$client",
    environment=~"$environment",
    test_timestamp=~"$test_timestamp"
  }[1m])
)
```

> Requests per second over a 1-minute rolling window, grouped by test run. Compare throughput between executions.

---

### 3. HTTP Error Rate (%)

```promql
100 * sum by (test_name, test_timestamp) (
  rate(k6_http_req_failed_total{
    test_name=~"$test_name",
    client=~"$client",
    environment=~"$environment",
    test_timestamp=~"$test_timestamp"
  }[1m])
)
/
sum by (test_name, test_timestamp) (
  rate(k6_http_reqs_total{
    test_name=~"$test_name",
    client=~"$client",
    environment=~"$environment",
    test_timestamp=~"$test_timestamp"
  }[1m])
)
```

> Error percentage (0-100). Alert when this exceeds your SLO threshold (e.g. `> 1`).

---

### 4. Active Virtual Users Over Time

```promql
k6_vus{
  test_name=~"$test_name",
  client=~"$client",
  environment=~"$environment",
  test_timestamp=~"$test_timestamp"
}
```

> Current number of active VUs. Useful for correlating latency spikes with ramp-up/ramp-down phases.

---

### 5. Check Pass Rate (%)

```promql
100 * sum by (test_name, test_timestamp) (
  rate(k6_checks_total{
    result="pass",
    test_name=~"$test_name",
    client=~"$client",
    environment=~"$environment",
    test_timestamp=~"$test_timestamp"
  }[1m])
)
/
sum by (test_name, test_timestamp) (
  rate(k6_checks_total{
    test_name=~"$test_name",
    client=~"$client",
    environment=~"$environment",
    test_timestamp=~"$test_timestamp"
  }[1m])
)
```

> Percentage of k6 checks (assertions) that passed. A value below 100% indicates business logic failures — not just HTTP errors.

---

### 6. Custom Trend Metric (p95)

```promql
max by (__name__)(
  last_over_time({
    __name__=~"k6_.+_p95",
    __name__!~"k6_http_req.*|k6_iteration.*|k6_group_duration.*|k6_browser.*|k6_vus.*|k6_data_.*|k6_checks.*|k6_grpc_.*|k6_ws_.*|k6_http_reqs.*",
    test_name=~"$test_name",
    client=~"$client",
    environment=~"$environment",
    test_timestamp=~"$test_timestamp"
  }[$__range])
)
```

> Returns the p95 value for every custom Trend metric, excluding all built-in k6 metrics. Each result series is labeled by `__name__`.

---

### 7. Group Duration (p95) by Group

```promql
avg by (group)(
  last_over_time(
    k6_group_duration_p95{
      test_name=~"$test_name",
      client=~"$client",
      environment=~"$environment",
      test_timestamp=~"$test_timestamp",
      group=~".+"
    }[$__range]
  )
)
```

> Returns the p95 group duration for each detected group. Replace `_p95` with `_avg`, `_p90`, or `_p99` for other percentiles.

---

### Additional Useful Queries

**p50 / p99 latency comparison:**
```promql
histogram_quantile(0.50, sum by (le, test_timestamp) (rate(k6_http_req_duration_bucket{test_name=~"$test_name", client=~"$client"}[1m])))
histogram_quantile(0.99, sum by (le, test_timestamp) (rate(k6_http_req_duration_bucket{test_name=~"$test_name", client=~"$client"}[1m])))
```

**Data received / sent (bytes/s):**
```promql
rate(k6_data_received_total{test_name=~"$test_name", client=~"$client", test_timestamp=~"$test_timestamp"}[1m])
rate(k6_data_sent_total{test_name=~"$test_name", client=~"$client", test_timestamp=~"$test_timestamp"}[1m])
```

**Custom Counter totals:**
```promql
sum by (__name__)(
  last_over_time({
    __name__=~"k6_.+_total",
    __name__!~"k6_http_req.*|k6_http_reqs.*|k6_data_.*|k6_iterations.*|k6_iteration_duration.*|k6_browser_.*|k6_vus.*|k6_checks.*|k6_grpc_.*|k6_ws_.*|k6_group_duration.*",
    test_name=~"$test_name",
    client=~"$client",
    environment=~"$environment",
    test_timestamp=~"$test_timestamp"
  }[$__range])
)
```

**Group performance table (all percentiles):**
```promql
avg by (group)(last_over_time(k6_group_duration_avg{test_name=~"$test_name", group=~".+"}[$__range]))
avg by (group)(last_over_time(k6_group_duration_p90{test_name=~"$test_name", group=~".+"}[$__range]))
avg by (group)(last_over_time(k6_group_duration_p95{test_name=~"$test_name", group=~".+"}[$__range]))
avg by (group)(last_over_time(k6_group_duration_p99{test_name=~"$test_name", group=~".+"}[$__range]))
```

**Verify custom labels are present (sanity check):**
```promql
{test_name!=""}
```
> Returns all metrics that have a `test_name` label — confirms Prometheus is receiving tagged metrics from k6.

---

## Observability Data Flow

The framework sends data to four backends via `run-test.sh` CLI flags:

```
┌──────────┐     --prometheus     ┌─────────────┐
│          │ ──────────────────── │ Prometheus   │ ── Metrics (PromQL)
│          │     --loki           ├─────────────┤
│   k6     │ ──────────────────── │ Loki         │ ── Logs (LogQL)
│  runner  │     --tempo          ├─────────────┤
│          │ ──────────────────── │ Tempo        │ ── Traces (TraceQL)
│          │     (headers)        ├─────────────┤
│          │ ──────────────────── │ Pyroscope    │ ── Profiles
└──────────┘                      └──────┬──────┘
                                         │
                                    ┌────▼────┐
                                    │ Grafana  │ ── Unified view
                                    └─────────┘
```

### Enabling Each Output

| Flag | k6 Mechanism | Backend | Data Type |
|------|-------------|---------|-----------|
| `--prometheus` | `--out experimental-prometheus-rw` | Prometheus | Metrics (remote-write) |
| `--loki` | `--log-output loki=URL,...` | Loki | Structured logs with labels |
| `--tempo` | `--traces-output otel` (OTLP gRPC) | Tempo | Distributed traces |
| `--otel` | `--out experimental-opentelemetry` | OTEL collector | Metrics via OTLP |
| `--observability` | All of the above | All backends | Full pipeline |

### Cross-Linking Between Datasources

Grafana datasources are pre-configured for cross-referencing:

| From | To | Mechanism |
|------|----|-----------|
| Loki → Tempo | `trace_id` field in JSON logs | Derived fields regex: `"trace_id":"([^"]+)"` |
| Tempo → Loki | Trace context labels | `tracesToLogsV2` with `client`, `environment` tags |
| Prometheus → Tempo | Exemplar trace IDs | `exemplarTraceIdDestinations` → `trace_id` |

### Example: Full Observability Run

```bash
# Start the stack
docker compose --profile observability up -d

# Run with all outputs enabled
./bin/run-test.sh --client=examples --scenario=integration/16-sli-monitoring \
  --profile=smoke --observability

# Check data in Grafana:
#   Explore → Prometheus: query k6_* metrics
#   Explore → Loki: {client="examples"} to see test logs
#   Explore → Tempo: search traces by service name
#   Explore → Pyroscope: view profiling data
```

### Stack Versions

| Component | Version |
|-----------|---------|
| Grafana | 12.4.0 |
| Prometheus | v3.10.0 |
| Loki | 3.6.7 |
| Tempo | 2.10.1 |
| Pyroscope | 1.18.1 |
| k6 | 1.6.1 |

---

## "No Data" Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Dropdowns empty | No test run yet | Run a test: `./bin/run-test.sh --client=_reference --scenario=api/smoke-users --profile=smoke` |
| Dropdowns empty after run | `metricsBackends` not configured | Add `"metricsBackends": [{"type": "prometheus"}]` to `config.json` |
| Panels show "No data" | Wrong variable filter | Set all dropdowns to `All` and check the Prometheus data source in Explore |
| Metrics missing labels | `K6_CLIENT` / `K6_ENVIRONMENT` not set | These are set automatically by `run-test.sh`; verify you're using the runner, not calling `k6 run` directly |
| Prometheus not scraping | Stack not running | Run `docker compose --profile observability ps` — all services should be `running` |
| Data stops appearing | Test ended; `refresh` is `5s` | Normal — panels show last known values after test completes |
| Groups row empty | No groups in test | Add `group()` calls in your test script, or verify `run-test.sh` injected the synthetic threshold |
| Custom Metrics row empty | No custom metrics defined | Define custom metrics in your test (`new Trend(...)`, `new Counter(...)`, etc.) |
| Web Vitals empty | No browser metrics | Ensure your test uses `chromium.launch()` via the k6 browser module |
| Loki shows no logs | `--loki` flag not used | Add `--loki` or `--observability` to run-test.sh |
| Tempo shows no traces | `--tempo` flag not used | Add `--tempo` or `--observability` to run-test.sh |
| Loki/Tempo/Pyroscope unreachable | Observability profile not active | Start with `docker compose --profile observability up -d` |
| Loki container restarting | Missing `delete_request_store` config | Add `delete_request_store: filesystem` to loki-config.yml compactor section |

---

## Grafana Provisioning

The dashboards and datasource are provisioned automatically via:

```
infrastructure/grafana/
├── provisioning/
│   ├── dashboards/     <- dashboard.yaml (points to dashboards/ dir)
│   └── datasources/    <- prometheus.yaml (configures Prometheus datasource)
└── dashboards/
    ├── k6-load-test-overview.json
    ├── k6-enterprise-analytics.json
    └── k6-web-vitals.json
```

To **add a custom dashboard**: drop a `.json` file into `infrastructure/grafana/dashboards/` and restart Grafana:

```bash
docker compose --profile observability restart grafana
```

To **export a modified dashboard**: in Grafana, go to Dashboard settings > JSON Model > copy and save to the `dashboards/` directory.

---

## Observability Stack Ports

| Service | Internal Port | Host Exposed | Purpose |
|---------|--------------|--------------|---------|
| Grafana | 3000 | Yes (3000) | Dashboard UI (admin/admin) |
| Prometheus | 9090 | No (internal only) | Metrics query / targets |
| Loki | 3100 | No (internal only) | Log aggregation (queried via Grafana) |
| Tempo | 3200, 4317, 4318 | No (internal only) | Distributed traces (OTLP gRPC/HTTP) |
| Pyroscope | 4040 | No (internal only) | Continuous profiling (queried via Grafana) |
| k6 API | 6565 | Yes (6565) | k6 REST API (only when `run` profile active) |

> Only Grafana and k6 API are exposed to the host. All other services are internal-only on the `k6-net` Docker network. Use `docker-compose.override.yml` to expose them for local debugging.

Start the full stack:

```bash
docker compose --profile observability up -d
```

Stop without losing data:

```bash
docker compose --profile observability stop
```
