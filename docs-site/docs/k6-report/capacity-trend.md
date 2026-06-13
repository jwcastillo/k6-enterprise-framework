---
title: Capacity & Trend Analysis
sidebar_position: 7
---

# Capacity & Trend Analysis

k6-report provides two advanced analysis modes that work with multiple test runs: capacity analysis (scaling behavior) and trend analysis (performance over time).

---

## Capacity Analysis

Capacity analysis takes multiple k6 runs at **increasing load levels** and determines your system's limits.

### What It Finds

| Metric | Description |
|--------|-------------|
| **Max Sustainable Load** | Highest VU count where p95 stays below threshold |
| **Inflection Point** | VU level where latency starts increasing non-linearly |
| **Breaking Point** | VU level where errors spike or latency exceeds threshold |
| **Saturation Curve** | How throughput scales relative to VUs |

### CLI Usage

```bash
# Run tests at different load levels
k6 run script.js -u 50  --summary-export=run-50.json
k6 run script.js -u 100 --summary-export=run-100.json
k6 run script.js -u 200 --summary-export=run-200.json
k6 run script.js -u 400 --summary-export=run-400.json

# Generate capacity analysis
npx k6-report capacity run-50.json run-100.json run-200.json run-400.json \
  --threshold 2000 \
  --growth-rate 0.1 \
  -o capacity.html
```

### Options

| Flag | Description | Default |
|------|-------------|---------|
| `--threshold <ms>` | p95 latency threshold in milliseconds | `2000` |
| `--growth-rate <decimal>` | Monthly growth rate for capacity projection | `0.1` (10%) |

### Programmatic API

```typescript
import {
  analyzeCapacity,
  projectCapacity,
  generateCapacityReportHtml,
} from "k6-report";

// Prepare data points from multiple runs
const dataPoints = [
  { vus: 50,  rps: 120,  p95: 180,  errorRate: 0.001 },
  { vus: 100, rps: 230,  p95: 220,  errorRate: 0.002 },
  { vus: 200, rps: 410,  p95: 480,  errorRate: 0.008 },
  { vus: 400, rps: 520,  p95: 2100, errorRate: 0.05 },
];

// Analyze
const analysis = analyzeCapacity(dataPoints);
console.log("Max sustainable VUs:", analysis.maxSustainableVUs);
console.log("Inflection point:", analysis.inflectionPoint);
console.log("Breaking point:", analysis.breakingPoint);

// Project growth
const projection = projectCapacity(analysis, 0.1); // 10% monthly growth
console.log("Months until capacity limit:", projection.monthsRemaining);

// Generate HTML report
const html = generateCapacityReportHtml(analysis, {
  threshold: 2000,
  growthRate: 0.1,
});
```

### Capacity Report Sections

The capacity HTML report includes:
- **Scaling curve chart** — VUs vs. throughput (RPS) with diminishing returns visualization
- **Latency curve** — VUs vs. p95 latency with threshold line
- **Error rate curve** — VUs vs. error percentage
- **Capacity summary table** — Max sustainable, inflection, and breaking points
- **Growth projection** — How many months until you hit your limit at the given growth rate

---

## Trend Analysis

Trend analysis takes multiple k6 runs **over time** and detects performance patterns.

### What It Finds

| Pattern | Description |
|---------|-------------|
| **Degrading** | Metrics getting progressively worse over time |
| **Improving** | Metrics getting progressively better |
| **Stable** | No significant change |
| **Volatile** | Large swings without clear direction |

### CLI Usage

```bash
# Generate trend analysis from historical runs
npx k6-report trend \
  results/2026-01-*.json \
  results/2026-02-*.json \
  results/2026-03-*.json \
  --window 90 \
  --baseline-p95 500 \
  -o trend.html
```

### Options

| Flag | Description | Default |
|------|-------------|---------|
| `--window <days>` | Analysis window: `30`, `60`, or `90` days | `30` |
| `--baseline-p95 <ms>` | Reference p95 value for comparison | -- |

### Programmatic API

```typescript
import {
  detectTrends,
  extractTrendPoint,
  generateTrendHtml,
} from "k6-report";

// Extract data points from run summaries
const dataPoints = summaries.map((s) => extractTrendPoint(s));

// Detect trends
const trends = detectTrends(dataPoints, 30);

console.log("Overall direction:", trends.overallDirection);
// "degrading" | "improving" | "stable" | "volatile"

for (const pattern of trends.patterns) {
  console.log(`${pattern.metric}: ${pattern.direction} (${pattern.confidence}%)`);
}

// Check for alerts
for (const alert of trends.alerts) {
  console.log(`ALERT: ${alert.message}`);
}

// Generate HTML report
const html = generateTrendHtml(trends, { baselineP95: 500 });
```

### Trend Report Sections

The trend HTML report includes:
- **Latency trend chart** — p95 over time with baseline reference line
- **Throughput trend** — RPS over time
- **Error rate trend** — Error percentage over time
- **Pattern table** — Per-metric trend direction with confidence level
- **Alerts** — Automatically generated alerts for concerning patterns

---

## Combining Capacity and Trend

For comprehensive capacity planning, combine both analyses:

1. **Weekly trend analysis** — detect if performance is degrading
2. **Monthly capacity analysis** — measure current headroom
3. **Growth projection** — predict when you need to scale

```bash
# Weekly trend (automated via CI)
npx k6-report trend results/week-*.json --window 30 -o trend-weekly.html

# Monthly capacity (after load test suite)
npx k6-report capacity \
  results/capacity-50.json \
  results/capacity-100.json \
  results/capacity-200.json \
  --growth-rate 0.15 \
  -o capacity-monthly.html
```
