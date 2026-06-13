---
title: "Groups Analysis & Custom Metrics"
sidebar_position: 4
---
# Groups Analysis & Custom Metrics

Automatic group timing with synthetic threshold injection, custom metric definitions (Trend, Counter, Rate, Gauge), Prometheus naming conventions, and Grafana auto-detection.

---

## Table of Contents

1. [Groups Analysis](#groups-analysis)
   - [How Groups Work](#how-groups-work)
   - [Synthetic Threshold Injection](#synthetic-threshold-injection)
   - [Groups in Reports](#groups-in-reports)
   - [Groups in Grafana](#groups-in-grafana)
2. [Custom Metrics](#custom-metrics)
   - [Metric Types](#metric-types)
   - [Defining Custom Metrics](#defining-custom-metrics)
   - [Prometheus Naming](#prometheus-naming)
   - [Custom Metrics in Grafana](#custom-metrics-in-grafana)
   - [Custom Metrics in Reports](#custom-metrics-in-reports)
3. [Full Dashboard Demo](#full-dashboard-demo)

---

## Groups Analysis

### How Groups Work

k6 groups (`group()`) organize test logic into named blocks. The framework automatically tracks timing and checks for every group in your test, providing detailed per-group performance analysis.

```typescript
import { group, check } from "k6";
import http from "k6/http";

export default function () {
  group("Browse Catalog", () => {
    const res = http.get("https://api.example.com/products");
    check(res, {
      "browse: status 200": (r) => r.status === 200,
    });
  });

  group("Add to Cart", () => {
    const res = http.post("https://api.example.com/cart", JSON.stringify({ productId: "123" }));
    check(res, {
      "cart: status 200": (r) => r.status === 200,
      "cart: echoed json": (r) => r.json("json") !== undefined,
    });
  });

  group("Checkout", () => {
    const res = http.post("https://api.example.com/checkout", JSON.stringify({ cartId: "abc" }));
    check(res, {
      "checkout: order confirmed": (r) => r.status === 200,
    });
  });
}
```

### Synthetic Threshold Injection

The framework automatically injects `group_duration` thresholds for every group detected in your test. You only need to define thresholds for groups where you want custom values — the framework handles the rest.

#### How It Works

1. At test startup, the framework scans all groups referenced in your code
2. For any group **without** an explicit `group_duration` threshold, a synthetic threshold is injected (default: `p(95)<5000`)
3. This ensures all groups appear in the results with timing data, even if you didn't define thresholds for them

#### Example

```typescript
export const options = {
  thresholds: {
    // Only define threshold for Checkout (the critical path)
    "group_duration{group:::Checkout}": ["p(95)<3000"],
    // Browse Catalog and Add to Cart get automatic synthetic thresholds
  },
};
```

After synthetic injection, the effective thresholds become:

```
group_duration{group:::Browse Catalog}  → p(95)<5000  (synthetic)
group_duration{group:::Add to Cart}     → p(95)<5000  (synthetic)
group_duration{group:::Checkout}        → p(95)<3000  (user-defined)
```

#### Configuration

```bash
# Change default synthetic threshold
export K6_SYNTHETIC_GROUP_THRESHOLD="p(95)<10000"

# Disable synthetic injection entirely
export K6_DISABLE_SYNTHETIC_THRESHOLDS=true
```

#### root_group.groups Supplementation

k6's `root_group.groups` in the JSON summary sometimes omits groups that were executed. The framework supplements this data by tracking all group executions independently, ensuring complete group data in reports even when k6's native reporting is incomplete.

### Groups in Reports

The HTML report includes a **"Groups Analysis"** section with:

| Column | Description |
|--------|-------------|
| Group Name | Name of the group |
| Duration (p95) | 95th percentile of group execution time |
| Duration (avg) | Average group execution time |
| Checks | Number of checks in the group (pass/total) |
| Status | Pass/Fail based on threshold |

Groups with failing thresholds are highlighted in red.

### Groups in Grafana

The **Load Test Overview** and **Enterprise Analytics** dashboards include a **Groups Analysis** row with:

- **Groups Duration** panel: bar chart showing p95 duration per group
- **Groups Checks** panel: pass/fail check counts per group
- Template variable `$group` for filtering by specific group

---

## Custom Metrics

### Metric Types

k6 provides four custom metric types. The framework auto-detects all custom metrics and surfaces them in reports and Grafana dashboards.

| Type | Description | Use Case | Example |
|------|-------------|----------|---------|
| **Counter** | Cumulative count | Total business transactions, error counts | `new Counter("business_transactions")` |
| **Trend** | Distribution of values (avg, min, max, p90, p95, p99) | API latency, payload sizes | `new Trend("api_latency_ms")` |
| **Rate** | Percentage of non-zero values | Success rate, conversion rate | `new Rate("business_success_rate")` |
| **Gauge** | Last recorded value | Active users, queue depth | `new Gauge("active_users_gauge")` |

### Defining Custom Metrics

Custom metrics are defined at module scope (init context) and used inside test functions:

```typescript
import { Counter, Trend, Rate, Gauge } from "k6/metrics";

// Define at module scope
const businessTransactions = new Counter("business_transactions");
const apiLatency = new Trend("api_latency_ms");
const successRate = new Rate("business_success_rate");
const activeUsers = new Gauge("active_users_gauge");

export default function () {
  const res = http.get("https://api.example.com/data");
  
  // Record values
  businessTransactions.add(1);
  apiLatency.add(res.timings.duration);
  successRate.add(res.status === 200 ? 1 : 0);
  activeUsers.add(__VU);
}
```

### Setting Thresholds for Custom Metrics

```typescript
export const options = {
  thresholds: {
    business_success_rate: ["rate>0.95"],
    api_latency_ms: ["p(95)<2500"],
    business_transactions: ["count>100"],
  },
};
```

### Prometheus Naming

When metrics are exported to Prometheus (via the observability stack), the framework applies naming conventions:

| k6 Metric Name | Prometheus Name | Labels |
|----------------|-----------------|--------|
| `business_transactions` | `k6_business_transactions_total` | `client`, `service`, `env` |
| `api_latency_ms` | `k6_api_latency_ms` | `client`, `service`, `env`, `quantile` |
| `business_success_rate` | `k6_business_success_rate` | `client`, `service`, `env` |
| `active_users_gauge` | `k6_active_users_gauge` | `client`, `service`, `env` |

Rules:
- Counter metrics get `_total` suffix
- All metrics get `k6_` prefix
- Labels are sanitized per Prometheus specification (see [Security](/docs/framework/security/#prometheus-label-sanitization-t-135))

### Custom Metrics in Grafana

All three Grafana dashboards auto-detect custom metrics and display them in dedicated panels:

#### Load Test Overview Dashboard

- **Custom Metrics — Trends**: time series chart for all Trend-type custom metrics
- **Custom Metrics — Counters**: bar chart for all Counter-type custom metrics
- **Custom Metrics — Rates & Gauges**: combined panel for Rate and Gauge metrics

#### Enterprise Analytics Dashboard

- **Custom Metrics** row with detailed panels including percentile breakdowns for Trends

#### Web Vitals Dashboard

- Focuses on browser metrics but includes custom metric overlay if defined

### Custom Metrics in Reports

The HTML report includes a **"Custom Metrics"** section with:

| Metric Type | Displayed Values |
|-------------|-----------------|
| Counter | Total count, rate per second |
| Trend | avg, min, max, p90, p95, p99 |
| Rate | Percentage (0-100%) |
| Gauge | Last value, min, max |

---

## Full Dashboard Demo

The `99-full-dashboard-demo` scenario exercises all report panels in a single test:

```bash
./bin/run-test.sh --client=examples --scenario=mixed/99-full-dashboard-demo --profile=smoke
```

### What It Includes

| Feature | Detail |
|---------|--------|
| **5 Groups** | Browse Catalog, Search Products, View Product, Add to Cart, Checkout |
| **6 Custom Metrics** | 2 Counters (`business_transactions`, `business_errors`), 2 Trends (`api_latency_ms`, `response_payload_bytes`), 1 Rate (`business_success_rate`), 1 Gauge (`active_users_gauge`) |
| **Web Vitals** | LCP, FCP, CLS, TTFB, INP via Chromium browser scenario |
| **SLA Thresholds** | Mix of pass/fail for SLA panel demonstration |
| **Two Scenarios** | `api_flow` (HTTP groups + custom metrics) + `browser_vitals` (Chromium Web Vitals) |

### Expected Panels Populated

After running the demo, these report/dashboard panels should show data:

- KPI strip (Checks, Avg, p95, p99, Error Rate, Throughput, APDEX, SLA)
- APDEX gauge
- SLA compliance table
- Percentile distribution chart
- Anomaly / Recommendation alerts
- Groups Analysis (5 groups with timing + checks)
- Custom Metrics (6 custom metrics across all 4 types)
- Web Vitals (LCP, FCP, CLS, TTFB, INP)
- Historical Comparison (on re-runs)

---

## Related Documentation

- [Reporting System](/docs/framework/reporting/) — HTML reports, PDF/PNG export, LLM analysis
- [Grafana Dashboards](/docs/framework/observability/grafana) — real-time visualization with 3 dashboards
- [Metrics Engine](/docs/framework/metrics/metrics-engine) — 125+ built-in metrics
- [Test Types](/docs/framework/test-types) — all test types including Web Vitals browser tests
