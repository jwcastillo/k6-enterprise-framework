---
title: API Reference
sidebar_position: 3
---

# Programmatic API Reference

k6-report exports all functionality as typed functions and classes. It supports both CommonJS and ESM imports.

```typescript
// ESM
import { generateReport, parseK6Summary, checkSLA } from "k6-report";

// CommonJS
const { generateReport, parseK6Summary, checkSLA } = require("k6-report");
```

---

## Convenience API

### `generateReport(input, options?)`

The all-in-one function: parse, analyze, and generate HTML in a single call.

```typescript
import { readFileSync, writeFileSync } from "fs";
import { generateReport } from "k6-report";

const json = readFileSync("summary.json", "utf8");
const { html, summary, analysis } = generateReport(json, {
  branding: { orgName: "Acme Corp", primaryColor: "#e11d48" },
  compareData: previousSummary,
  apdexConfig: { satisfiedMs: 500, frustratedMs: 2000 },
});
writeFileSync("report.html", html);
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `input` | `string \| K6Summary` | Raw k6 JSON string or pre-parsed `K6Summary` object |
| `options.branding` | `ReportBranding` | Organization name, primary color, logo |
| `options.compareData` | `K6Summary` | Baseline summary for comparison section |
| `options.apdexConfig` | `ApdexConfig` | Custom APDEX thresholds |
| `options.slaThresholds` | `SLAThreshold[]` | Custom SLA threshold rules |
| `options.inputFile` | `string` | Input file path (used for report title) |
| `options.testScript` | `string` | k6 test script source code to embed in the report |
| `options.k6Output` | `string` | Raw k6 console output to embed as an annex |
| `options.artifacts` | `ArtifactLink[]` | Companion artifact links (`{ label, href }`) |

**Returns:** `GenerateResult`

| Field | Type | Description |
|-------|------|-------------|
| `html` | `string` | Complete HTML document string |
| `summary` | `K6Summary` | Parsed k6 summary |
| `analysis` | `AnalysisResult` | SLA, APDEX, anomalies, recommendations, comparison |

---

## Parser

### `parseK6Summary(data)`

Parse a raw k6 JSON value into a typed `K6Summary`.

```typescript
import { parseK6Summary } from "k6-report";

const raw = JSON.parse(readFileSync("summary.json", "utf8"));
const summary: K6Summary = parseK6Summary(raw);
```

### `detectK6Format(data)`

Detect whether input is a k6 JSON summary or raw metrics.

```typescript
import { detectK6Format } from "k6-report";

const format = detectK6Format(jsonData);
// Returns: "end-of-test" | "cloud" | "unknown"
```

---

## Report Generation

### `generateHtmlReport(summary, options?)`

Generate a self-contained HTML report from a parsed `K6Summary`.

```typescript
import { generateHtmlReport } from "k6-report";

const html = generateHtmlReport(summary, {
  branding: { orgName: "Acme", primaryColor: "#2563eb" },
  compareData: baselineSummary,
  inputFile: "smoke-test.json",
});
```

**Options:**

| Option | Type | Description |
|--------|------|-------------|
| `branding.orgName` | `string` | Organization name shown in header |
| `branding.primaryColor` | `string` | Hex color for theme accents |
| `branding.logoBase64` | `string` | Base64-encoded logo image |
| `compareData` | `K6Summary` | Baseline for comparison section |
| `inputFile` | `string` | File path used in the report title |
| `context` | `ReportContext` | Test name, environment metadata |
| `generatorHealth` | `GeneratorHealth` | CPU/memory metrics from the load generator |
| `testScript` | `string` | k6 test script source code to embed |
| `k6Output` | `string` | Raw k6 console output embedded as annex |
| `artifacts` | `ArtifactLink[]` | Companion artifact links for the Artifacts bar |

---

## Analysis

### `checkSLA(summary, thresholds?)`

Evaluate SLA thresholds and return pass/fail results.

```typescript
import { checkSLA } from "k6-report";

const result = checkSLA(summary, [
  { metric: "http_req_duration", stat: "p95", operator: "<", value: 500 },
  { metric: "http_req_failed", stat: "rate", operator: "<", value: 0.01 },
]);

console.log(result.overallPassed);  // true/false
console.log(result.passCount);      // number of passing thresholds
console.log(result.failCount);      // number of failing thresholds
```

### `calculateApdex(summary, config?)`

Calculate APDEX score with configurable threshold.

```typescript
import { calculateApdex } from "k6-report";

const apdex = calculateApdex(summary, {
  satisfiedMs: 500,    // default: 500
  frustratedMs: 2000,  // default: 2000
});

// apdex = { score: 0.92, label: "Good", color: "#2563eb" }
```

**APDEX bands:**

| Score Range | Label | Color |
|-------------|-------|-------|
| >= 0.94 | Excellent | `#16a34a` |
| >= 0.85 | Good | `#2563eb` |
| >= 0.70 | Fair | `#d97706` |
| >= 0.50 | Poor | `#ea580c` |
| < 0.50 | Unacceptable | `#dc2626` |

### `detectAnomalies(summary)`

Detect metric anomalies — outliers, spikes, and high error rates.

```typescript
import { detectAnomalies } from "k6-report";

const anomalies = detectAnomalies(summary);
// Returns: AnomalyItem[] — { metric, severity, description, actual, expected }
```

### `generateRecommendations(summary)`

Generate actionable recommendations based on test results.

```typescript
import { generateRecommendations } from "k6-report";

const recs = generateRecommendations(summary);
// Returns: Recommendation[] — { category, priority, title, description }
```

### `compareRuns(current, baseline)`

Compare two k6 runs and produce a diff table.

```typescript
import { compareRuns } from "k6-report";

const result = compareRuns(currentSummary, baselineSummary);
// result.rows: ComparisonRow[] — per-metric delta, pctChange, verdict
// result.summary: { improved, regressed, stable }
```

### `analyzeCapacity(dataPoints)`

Identify max sustainable load, inflection points, and breaking points.

```typescript
import { analyzeCapacity } from "k6-report";

const analysis = analyzeCapacity(dataPoints);
// analysis.maxSustainableVUs, analysis.inflectionPoint, analysis.breakingPoint
```

### `projectCapacity(analysis, growthRate)`

Project future capacity needs at a given monthly growth rate.

```typescript
import { projectCapacity } from "k6-report";

const projection = projectCapacity(analysis, 0.1); // 10% monthly growth
```

### `detectTrends(dataPoints, window?)`

Detect degrading, improving, stable, or volatile patterns over time.

```typescript
import { detectTrends } from "k6-report";

const trends = detectTrends(dataPoints, 30); // 30-day window
// Returns: TrendAnalysis — { patterns, overallDirection, alerts }
```

---

## Export

### `exportCSV(summary)`

Export k6 metrics to CSV format.

```typescript
import { exportCSV } from "k6-report";

const csv = exportCSV(summary);
writeFileSync("metrics.csv", csv);
```

### `generateMarkdown(summary, analysis?)`

Generate a Markdown analysis report.

```typescript
import { generateMarkdown } from "k6-report";

const md = generateMarkdown(summary, analysisResult);
writeFileSync("report.md", md);
```

### `generateTicket(summary, options, analysis?)`

Generate Jira wiki markup or GitHub Markdown ticket content.

```typescript
import { generateTicket } from "k6-report";

const ticket = generateTicket(summary, {
  format: "jira",         // or "github"
  service: "Payment API",
  environment: "staging",
  profile: "load",
});

// ticket.story: main ticket body
// ticket.comment: follow-up comment with metric details
```

### `generateMessage(summary, options, analysis?)`

Generate Slack Block Kit or Teams Adaptive Card messages.

```typescript
import { generateMessage } from "k6-report";

const slackMsg = generateMessage(summary, {
  platform: "slack",
  service: "Auth API",
  environment: "production",
  reportUrl: "https://reports.example.com/latest.html",
});

const teamsMsg = generateMessage(summary, {
  platform: "teams",
  service: "Auth API",
});
```

---

## Storage

### `RunStore`

Filesystem-based store for historical test run index.

```typescript
import { RunStore, generateRunId, parseK6Summary } from "k6-report";

const store = new RunStore({ dir: ".k6-report" });

// Append a run
const summary = parseK6Summary(JSON.parse(jsonString));
const id = generateRunId(summary);
store.append({ id, timestamp: new Date().toISOString(), verdict: "pass" }, summary);

// List runs
const runs = store.list(10); // most recent first, limit 10
```

### `generateRunId(summary)`

Generate a stable, deterministic run ID from a k6 JSON summary.

```typescript
import { generateRunId } from "k6-report";

const id = generateRunId(summary); // e.g., "a1b2c3d4"
```

---

## K6Summary.options — VU Distribution and Load Profile

The `K6Summary.options` field controls the **VU Distribution** and **Load Profile** report sections. If `options.stages` is present, both charts render automatically.

**How to populate `options` in the JSON:**

1. **From the framework** — pass `k6Options` to `generateJsonSummary`:

```typescript
// In your scenario's handleSummary:
export function handleSummary(data) {
  return generateJsonSummary(data, context, "./reports/summary.json", {
    k6Options: options, // the exported k6 options object
  });
}
```

2. **From the CLI** — use `--stages` when the JSON doesn't include options:

```bash
npx k6-report generate summary.json --stages "30s:10,1m:50,2m:50,30s:0"
```

3. **Manually in JSON** — add an `options` key at the root level:

```json
{
  "metrics": { ... },
  "root_group": { ... },
  "options": {
    "stages": [
      { "duration": "30s", "target": 10 },
      { "duration": "1m", "target": 50 },
      { "duration": "2m", "target": 50 },
      { "duration": "30s", "target": 0 }
    ],
    "thresholds": {
      "http_req_duration": ["p(95)<500"]
    }
  }
}
```

**`K6Options` fields:**

| Field | Type | Description |
|-------|------|-------------|
| `vus` | `number` | Maximum number of VUs |
| `duration` | `string` | Test duration (e.g., `"30s"`) |
| `stages` | `{ duration: string; target: number }[]` | VU ramping stages |
| `scenarios` | `Record<string, unknown>` | Scenario definitions |
| `thresholds` | `Record<string, string[]>` | Threshold definitions |

---

## Types

All types are exported and available for TypeScript consumers:

```typescript
import type {
  K6Summary,
  K6Options,
  K6Metric,
  K6MetricValues,
  K6Check,
  K6Group,
  K6Threshold,
  ReportContext,
  EnrichedSummary,
  GeneratorHealth,
  ReportOptions,
  ReportBranding,
  SLAThreshold,
  SLAResult,
  SLAComplianceResult,
  ApdexConfig,
  ApdexResult,
  AnomalyItem,
  Recommendation,
  ComparisonRow,
  ComparisonResult,
  CapacityAnalysis,
  CapacityProjection,
  TrendDataPoint,
  TrendAnalysis,
  TrendWindow,
  TicketOptions,
  TicketResult,
  MessageOptions,
  AnalysisResult,
  GenerateOptions,
  GenerateResult,
  RunIndexEntry,
  StoreOptions,
} from "k6-report";
```
