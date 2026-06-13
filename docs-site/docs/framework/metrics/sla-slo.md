---
title: "SLA / SLO"
sidebar_position: 2
---
# SLA / SLO

Service Level Objective definitions per service, automatic evaluation per execution, and monthly compliance reports.

---

## Table of Contents

1. [Concepts](#concepts)
2. [Defining SLOs](#defining-slos)
3. [Automatic Evaluation](#automatic-evaluation)
4. [Three-State Classification](#three-state-classification)
5. [APDEX Scoring](#apdex-scoring)
6. [Monthly Reports](#monthly-reports)
7. [Best Practices](#best-practices)

---

## Concepts

- **SLA (Service Level Agreement)**: contractual agreement between a provider and a client about the expected service level.
- **SLO (Service Level Objective)**: internal technical objective that defines when a service is meeting its SLA. An at-risk SLO is an early warning before breaching the SLA.
- **Error budget**: allowed margin of non-compliance per period (e.g., 99.9% availability = 8.7 hours of downtime/year).
- **APDEX (Application Performance Index)**: standardized score (0-1) measuring user satisfaction based on response time thresholds.

In this framework, SLOs are defined per service and automatically evaluated at the end of each test execution.

---

## Defining SLOs

SLOs are defined in `clients/{name}/config/slos.json`:

```json
{
  "version": "1.0",
  "services": [
    {
      "serviceName": "users",
      "metrics": [
        {
          "name": "http_req_duration_p95",
          "target": 500,
          "riskMargin": 0.1,
          "unit": "ms",
          "description": "P95 latency must not exceed 500ms"
        },
        {
          "name": "http_req_failed_rate",
          "target": 0.01,
          "riskMargin": 0.1,
          "unit": "ratio",
          "description": "Error rate must not exceed 1%"
        },
        {
          "name": "http_req_duration_p99",
          "target": 1000,
          "riskMargin": 0.05,
          "unit": "ms",
          "description": "P99 latency must not exceed 1000ms"
        }
      ]
    },
    {
      "serviceName": "payments",
      "metrics": [
        {
          "name": "http_req_duration_p95",
          "target": 300,
          "riskMargin": 0.1,
          "unit": "ms"
        },
        {
          "name": "http_req_failed_rate",
          "target": 0.001,
          "riskMargin": 0.1,
          "unit": "ratio"
        }
      ]
    }
  ]
}
```

### Available Metrics

| Metric Name                  | Description                      | Unit   |
|------------------------------|----------------------------------|--------|
| `http_req_duration_avg`      | Average latency                  | ms     |
| `http_req_duration_p90`      | 90th percentile latency          | ms     |
| `http_req_duration_p95`      | 95th percentile latency          | ms     |
| `http_req_duration_p99`      | 99th percentile latency          | ms     |
| `http_req_failed_rate`       | Failed requests rate             | ratio  |
| `http_req_duration_max`      | Maximum latency                  | ms     |
| `iterations_rate`            | Iterations per second            | rps    |

### The `riskMargin` Field

Defines the alert threshold as a fraction of the target. If `target=500ms` and `riskMargin=0.1`, the risk range is `[450ms, 500ms]`. A value between 450ms and 500ms is classified as `en_riesgo`.

---

## Automatic Evaluation

The `SloEvaluator` (`src/core/slo-evaluator.ts`) runs automatically at the end of each test if SLOs are defined for the service under test.

```bash
./bin/run-test.sh --client=acme --service=users --test=load

# Upon completion, the evaluator prints:
# [SLO] users — http_req_duration_p95: 420ms (target: 500ms) → CUMPLE
# [SLO] users — http_req_failed_rate: 0.008 (target: 0.01)   → EN RIESGO ⚠
# [SLO] users — http_req_duration_p99: 850ms (target: 1000ms) → CUMPLE
```

If an SLO is `en_riesgo`, a preventive warning is emitted in the console before the SLA is breached.

### Integration with Reports

SLO results are automatically included in:

- **HTML report**: "SLA/SLO" section with visual traffic light indicators (green/yellow/red).
- **JSON summary**: `sloCompliance` field with structure:

```json
{
  "sloCompliance": [
    {
      "service": "users",
      "metric": "http_req_duration_p95",
      "target": 500,
      "actual": 420,
      "unit": "ms",
      "status": "cumple"
    },
    {
      "service": "users",
      "metric": "http_req_failed_rate",
      "target": 0.01,
      "actual": 0.008,
      "unit": "ratio",
      "status": "en_riesgo"
    }
  ]
}
```

---

## Three-State Classification

| Status     | Condition                                      | Visual  | Recommended Action              |
|------------|------------------------------------------------|---------|--------------------------------|
| `cumple`     | `actual < target × (1 − riskMargin)`             | Green   | None                            |
| `en_riesgo`  | `target × (1 − riskMargin) ≤ actual ≤ target`   | Yellow  | Investigate trend               |
| `incumple`   | `actual > target`                                | Red     | Immediate alert, open ticket    |

Example with `target=500ms` and `riskMargin=0.1`:

- `actual=400ms` → `cumple` (< 450ms)
- `actual=460ms` → `en_riesgo` (between 450ms and 500ms)
- `actual=510ms` → `incumple` (> 500ms)

---

## APDEX Scoring

The framework calculates the **APDEX** (Application Performance Index) score for each test execution, providing a standardized measure of user satisfaction.

### Formula

```
APDEX = (satisfied_count + tolerating_count / 2) / total_count
```

Where:
- **Satisfied**: response time <= T (target threshold)
- **Tolerating**: T < response time <= 4T
- **Frustrated**: response time > 4T

### Configuration

APDEX thresholds are derived from SLO targets or can be set explicitly:

```json
{
  "apdex": {
    "threshold": 500,
    "toleratingMultiplier": 4
  }
}
```

### Score Interpretation

| APDEX Score | Rating      | Meaning                         |
|-------------|-------------|---------------------------------|
| 0.94 - 1.00 | Excellent  | Users are very satisfied        |
| 0.85 - 0.93 | Good       | Most users are satisfied        |
| 0.70 - 0.84 | Fair       | Some users are dissatisfied     |
| 0.50 - 0.69 | Poor       | Many users are dissatisfied     |
| 0.00 - 0.49 | Unacceptable | Most users are frustrated     |

### Grafana Integration

The APDEX score is displayed as a gauge panel in the **Load Test Overview** dashboard, with color-coded thresholds matching the rating table above.

---

## Monthly Reports

The `bin/slo-report.js` command aggregates results from all executions in the month and generates a compliance report.

```bash
# February 2026 report for client acme
bin/slo-report.js --client=acme --month=2026-02

# Output in: reports/acme/slo-compliance/2026-02/
#   slo-compliance-2026-02.html
#   slo-compliance-2026-02.json
```

### Monthly Report Contents

- **Compliance percentage per SLO**: `(passing executions / total) * 100`
- **Trend**: `improving`, `stable`, or `degrading` (based on the last 3 months)
- **Non-compliance periods**: date, time, and link to individual report of each execution
- **Automatic recommendations**: suggestions based on observed patterns

### Insufficient Data Warning

If there are fewer than 5 executions in the month, the report warns that data is insufficient for statistical analysis.

---

## SLI Monitoring Example

The framework includes a dedicated SLI monitoring scenario at `clients/examples/scenarios/integration/16-sli-monitoring.ts` that demonstrates:

- **Custom SLI metrics**: `sli_availability` (Rate), `sli_latency_ms` (Trend), `sli_correctness` (Rate), `sli_throughput_total` (Counter), `sli_errors_total` (Counter), `sli_active_vus` (Gauge)
- **SLO-aligned thresholds**: with `abortOnFail` circuit breaker for critical SLOs
- **Full observability**: tracing (W3C), Pyroscope profiling labels, structured logging

```bash
# Run the SLI monitoring scenario with full observability
./bin/run-test.sh --client=examples --scenario=integration/16-sli-monitoring \
  --profile=smoke --observability

# SLO definitions for this scenario are in:
# clients/examples/config/slos.json
```

The scenario tracks SLIs across 4 operation types (read, write, status validation, latency-sensitive) and produces metrics visible in both the k6 summary and Grafana dashboards.

---

## Best Practices

**Define conservative SLOs initially**: start with more relaxed targets than the contractual SLA. Adjust gradually based on the observed baseline.

**Use 10% `riskMargin`**: allows detecting degradations before breaching the SLA. A `riskMargin` of 0.05 is stricter; 0.2 is more permissive.

**Run load tests periodically**: the SLO evaluator only acts if there are executions. Automate tests with cron or CI/CD pipeline to obtain continuous data.

**Don't define SLOs only for smoke tests**: `smoke` and `quick` profiles have fewer VUs and can give optimistic results. Define SLOs based on the `load` profile or higher.

**Review monthly report before each SLA meeting**: the report automatically aggregates compliance and trends, ready to present to the client.
