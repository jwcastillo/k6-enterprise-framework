---
title: Analysis Engine
sidebar_position: 5
---

# Analysis Engine

k6-report includes a built-in analysis engine that evaluates test results across four dimensions: SLA compliance, APDEX scoring, anomaly detection, and actionable recommendations.

---

## SLA Compliance

### How It Works

`checkSLA()` evaluates two sources of thresholds:

1. **k6 native thresholds** — defined in `options.thresholds` and evaluated by k6 during the test run
2. **Custom SLA thresholds** — additional rules passed programmatically

For k6 native thresholds, the function reads the `thresholds` field in the summary JSON. k6 marks each threshold as `true` when it **fails** (the convention is "tainted = failed").

### Custom Thresholds

Define additional rules beyond what k6 evaluates:

```typescript
const result = checkSLA(summary, [
  { metric: "http_req_duration", stat: "p95", operator: "<", value: 500 },
  { metric: "http_req_duration", stat: "avg", operator: "<", value: 200 },
  { metric: "http_req_failed", stat: "rate", operator: "<", value: 0.01 },
  { metric: "http_reqs", stat: "count", operator: ">", value: 1000 },
]);
```

### Result Structure

```typescript
interface SLAComplianceResult {
  results: SLAResult[];    // Per-threshold pass/fail
  overallPassed: boolean;  // All thresholds passed
  passCount: number;
  failCount: number;
}

interface SLAResult {
  rule: string;          // Threshold expression
  metric: string;        // Metric name
  actual: number | null; // Measured value
  threshold: number;     // Target value
  passed: boolean;
}
```

---

## APDEX Scoring

[Application Performance Index (APDEX)](https://en.wikipedia.org/wiki/Apdex) classifies user satisfaction into three zones based on response time:

| Zone | Condition | Weight |
|------|-----------|--------|
| **Satisfied** | Response time <= T | 1.0 |
| **Tolerating** | T < Response time <= 4T | 0.5 |
| **Frustrated** | Response time > 4T | 0.0 |

### Configuration

```typescript
const apdex = calculateApdex(summary, {
  satisfiedMs: 500,    // T threshold (default: 500ms)
  frustratedMs: 2000,  // 4T threshold (default: 2000ms)
});
```

### Score Bands

| Score | Label | Meaning |
|-------|-------|---------|
| >= 0.94 | Excellent | Nearly all users satisfied |
| >= 0.85 | Good | Most users satisfied |
| >= 0.70 | Fair | Noticeable performance issues |
| >= 0.50 | Poor | Many users frustrated |
| < 0.50 | Unacceptable | Majority of users frustrated |

### Algorithm

Since k6 doesn't expose individual request latencies, the scoring uses a weighted approximation from percentile distribution (p50, p90, p99):

1. Classify p50 (median) into the three zones
2. Weight by the proportion of requests in each percentile band
3. Apply APDEX formula: `(Satisfied + 0.5 * Tolerating) / Total`

---

## Anomaly Detection

`detectAnomalies()` scans all metrics for statistical anomalies:

### Detection Rules

| Anomaly Type | Detection Logic |
|-------------|-----------------|
| **High error rate** | `http_req_failed` rate > 5% |
| **Latency outlier** | p99/p50 ratio > 10x (extreme tail latency) |
| **Latency spike** | p95 > 3x average (sudden degradation) |
| **High variability** | Coefficient of variation > 100% |
| **Zero throughput** | `http_reqs` count = 0 |

### Result

```typescript
interface AnomalyItem {
  metric: string;       // Metric where anomaly was detected
  severity: "high" | "medium" | "low";
  description: string;  // Human-readable explanation
  actual: number;       // Observed value
  expected: number;     // Normal range reference
}
```

---

## Recommendations

`generateRecommendations()` produces actionable suggestions based on detected patterns:

### Categories

| Category | Triggers |
|----------|----------|
| **Performance** | High latency, slow percentiles, inefficient request patterns |
| **Reliability** | High error rates, check failures, threshold violations |
| **Scalability** | VU-to-throughput ratio issues, connection limits |
| **Configuration** | Missing thresholds, suboptimal test setup |

### Result

```typescript
interface Recommendation {
  category: string;    // "performance" | "reliability" | "scalability" | "configuration"
  priority: "high" | "medium" | "low";
  title: string;       // Short actionable title
  description: string; // Detailed explanation with context
}
```

### Example Output

```
[HIGH] Performance: Optimize p95 latency
  p95 latency (2,340ms) exceeds the 2,000ms threshold. Consider:
  - Adding response caching for frequently accessed endpoints
  - Reviewing database query performance
  - Scaling application instances horizontally

[MEDIUM] Configuration: Add error rate thresholds
  No threshold defined for http_req_failed. Add:
  thresholds: { "http_req_failed": ["rate<0.01"] }
```

---

## Using the Full Pipeline

The `generateReport()` convenience function runs all analysis steps automatically:

```typescript
import { generateReport } from "k6-report";

const { html, analysis } = generateReport(jsonString, {
  slaThresholds: [
    { metric: "http_req_duration", stat: "p95", operator: "<", value: 500 },
  ],
  apdexConfig: { satisfiedMs: 300, frustratedMs: 1200 },
});

// Access individual analysis results
console.log("SLA passed:", analysis.sla?.overallPassed);
console.log("APDEX score:", analysis.apdex?.score, analysis.apdex?.label);
console.log("Anomalies:", analysis.anomalies?.length);
console.log("Recommendations:", analysis.recommendations?.length);
```
