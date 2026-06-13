---
title: "Reporting System"
sidebar_position: 1
---
# Reporting System

Interactive HTML reports, PDF/PNG export, LLM analysis reports, automatic comparison, trend analysis, branding, and PII redaction.

---

## Table of Contents

1. [Overview](#overview)
2. [HTML Report Sections](#html-report-sections)
3. [Generating Reports](#generating-reports)
4. [PDF and PNG Export](#pdf-and-png-export)
5. [LLM Analysis Reports](#llm-analysis-reports)
6. [Automatic Comparison](#automatic-comparison)
7. [Trend Analysis](#trend-analysis)
8. [Branding and Customization](#branding-and-customization)
9. [PII Redaction](#pii-redaction)
10. [Report Artifacts](#report-artifacts)

---

## Overview

The framework generates comprehensive, offline-capable HTML reports after every test execution. Reports are self-contained (zero CDN dependencies), WCAG-accessible, and include interactive Chart.js visualizations with tooltips, zoom, and pan.

Key capabilities:
- **17+ report sections** covering KPIs, SLAs, latency, throughput, errors, groups, custom metrics, web vitals, and more
- **PDF/PNG export** via Puppeteer headless rendering
- **LLM analysis** using Claude for intelligent performance insights
- **Automatic comparison** with previous executions (delta tables with color badges)
- **Trend analysis** across multiple historical runs
- **Custom branding** with organization logo, colors, and naming
- **PII redaction** of sensitive tag values

---

## HTML Report Sections

Each generated HTML report includes the following sections:

| # | Section | Description |
|---|---------|-------------|
| 1 | **Header** | Test metadata: client, service, environment, profile, user, execution ID, timestamp |
| 2 | **KPI Strip** | Key metrics at a glance: checks pass rate, avg/p95/p99 latency, error rate, throughput, APDEX, SLA status |
| 3 | **APDEX Gauge** | Visual gauge (0-1) with color-coded satisfaction rating |
| 4 | **SLA/SLO Compliance** | Traffic light table (green/yellow/red) per SLO metric with actual vs target values |
| 5 | **Latency Distribution** | Interactive chart with p50, p95, p99 latency lines over time |
| 6 | **Throughput Chart** | Requests per second over time with VU overlay |
| 7 | **Error Distribution** | 4xx vs 5xx error breakdown chart |
| 8 | **Groups Analysis** | Timing and checks per group with pass/fail indicators |
| 9 | **Custom Metrics** | Trends, Counters, Rates, and Gauges panels for user-defined metrics |
| 10 | **Web Vitals** | LCP, FCP, CLS, TTFB, INP scores with good/needs-improvement/poor ratings |
| 11 | **Checks Detail** | All k6 checks with pass/fail counts and success rates |
| 12 | **Thresholds** | All thresholds with pass/fail status and actual values |
| 13 | **Performance Comparison** | Delta table vs previous execution with absolute and percentage changes, color badges, evolution sparkline |
| 14 | **Generator Health** | CPU and memory graphs of the load generator during the test |
| 15 | **Anomaly Alerts** | Detected anomalies and auto-generated recommendations |
| 16 | **HTTP Details** | Request/response details per endpoint |
| 17 | **Executive Summary** | High-level summary for non-technical stakeholders |

---

## Generating Reports

Reports are generated automatically after each test execution:

```bash
./bin/run-test.sh --client=acme --service=users --test=load

# Report location:
# reports/acme/users/YYYY-MM-DD_HHMMSS/
#   report.html        # Interactive HTML report
#   summary.json       # Machine-readable JSON summary
#   metrics.json       # Raw metrics data
```

### Including k6 Options in Summary JSON

To enable **VU Distribution** and **Load Profile** charts in reports, pass the k6 `options` object when generating the summary inside `handleSummary()`:

```typescript
import { generateJsonSummary } from "../../../../src/reporting/json-summary-generator";

export const options: Options = {
  stages: [
    { duration: "30s", target: 10 },
    { duration: "1m", target: 50 },
    { duration: "2m", target: 50 },
    { duration: "30s", target: 0 },
  ],
  thresholds: { ... },
};

export function handleSummary(data) {
  return generateJsonSummary(data, context, "./reports/summary.json", {
    k6Options: options, // enables VU Distribution and Load Profile charts
  });
}
```

The `k6Options` parameter accepts `stages`, `vus`, `duration`, `scenarios`, and `thresholds`. All fields are optional.

### Manual Report Generation

```bash
# Regenerate report from existing JSON data
node bin/generate-report.js \
  --input=reports/acme/users/2026-02-18_100000/summary.json \
  --output=reports/acme/users/2026-02-18_100000/report.html
```

---

## PDF and PNG Export

Export reports to PDF or PNG for sharing in emails, presentations, or documentation.

### PDF Export

```bash
# Export HTML report to PDF
node bin/export-report.js \
  --input=reports/acme/users/2026-02-18_100000/report.html \
  --format=pdf \
  --output=reports/acme/users/2026-02-18_100000/report.pdf
```

### PNG Export

```bash
# Export HTML report to PNG (full-page screenshot)
node bin/export-report.js \
  --input=reports/acme/users/2026-02-18_100000/report.html \
  --format=png \
  --output=reports/acme/users/2026-02-18_100000/report.png
```

### Requirements

- Puppeteer must be installed: `npm install puppeteer`
- Chromium is downloaded automatically on first use
- PDF/PNG rendering uses the same styling as the interactive HTML

### Options

| Option | Description | Default |
|--------|-------------|---------|
| `--format` | `pdf` or `png` | `pdf` |
| `--width` | Viewport width in pixels | `1200` |
| `--scale` | PDF scale factor | `1.0` |
| `--landscape` | Landscape orientation | `false` |

---

## LLM Analysis Reports

The framework can generate intelligent performance analysis using Claude LLM, producing detailed markdown reports with insights, anomaly explanations, and actionable recommendations.

### Generated Files

After each LLM analysis, two files are created:

| File | Description |
|------|-------------|
| `analysis-{timestamp}.md` | Technical analysis with anomalies, root causes, correlations, and recommendations |
| `message-{timestamp}.md` | Executive summary suitable for Slack/Teams/email distribution |

### Running LLM Analysis

```bash
# Analyze the latest execution
node bin/analyze-report.js \
  --client=acme \
  --service=users \
  --latest

# Analyze a specific execution
node bin/analyze-report.js \
  --input=reports/acme/users/2026-02-18_100000/summary.json
```

### Analysis Report Contents

The `analysis-*.md` file includes:

- **Performance summary**: overall health assessment
- **Anomaly detection**: statistical anomalies identified via z-score, IQR, CUSUM
- **Root cause analysis**: correlations between metrics (e.g., CPU spike + latency increase)
- **SLO compliance assessment**: current status and risk projections
- **Comparison with historical data**: regression detection against best historical run
- **Actionable recommendations**: prioritized list of improvements with expected impact

### Message Report Contents

The `message-*.md` file includes:

- **One-line verdict**: pass/fail/at-risk with key metric
- **Traffic light summary**: red/yellow/green indicators per category
- **Top 3 findings**: most critical observations
- **Recommended actions**: immediate steps for the team

### Configuration

```bash
# Environment variables
export ANTHROPIC_API_KEY=sk-ant-...
export AI_ANALYSIS_MODEL=claude-sonnet-4-6  # default
export AI_MAX_TOKENS=4096                    # max output tokens
```

---

## Automatic Comparison

Every execution is automatically compared with the previous run of the same client/service/profile combination.

### Comparison Table

The HTML report includes a "Performance Comparison" section with:

| Column | Description |
|--------|-------------|
| Metric | Metric name (e.g., `http_req_duration p95`) |
| Previous | Value from previous execution |
| Current | Value from current execution |
| Delta | Absolute change |
| Delta % | Percentage change |
| Status | Color badge: green (improved), yellow (stable), red (degraded) |

### Sparkline

A mini sparkline chart shows the evolution of key metrics across the last 10 executions.

### First Execution Fallback

If no previous execution exists, the comparison section shows "First execution — no baseline available" instead of empty data.

### Force Comparison

```bash
# Compare against a specific previous execution
./bin/run-test.sh --client=acme --service=users --test=load \
  --compare-with=reports/acme/users/2026-02-15_100000/summary.json
```

---

## Trend Analysis

The `TrendVisualizer` (`src/reporting/trend-visualizer.ts`) aggregates data from multiple historical executions to identify trends.

### Trend Indicators

| Trend | Criteria | Action |
|-------|----------|--------|
| Improving | 3+ consecutive improvements | None |
| Stable | Variance < 5% over last 5 runs | None |
| Degrading | 3+ consecutive degradations | Investigate |
| Volatile | Variance > 20% over last 5 runs | Stabilize environment |

### Generating Trend Reports

```bash
# Generate trend analysis for the last 30 days
node bin/trend-report.js \
  --client=acme \
  --service=users \
  --days=30
```

---

## Branding and Customization

Customize report appearance with your organization's branding.

### Configuration

Place branding assets in `clients/{name}/branding/`:

```
clients/acme/branding/
  logo.png           # or logo.svg, logo.jpg
  branding.json      # branding configuration
```

### branding.json

```json
{
  "orgName": "Acme Corp",
  "primaryColor": "#0066cc",
  "logoMaxBytes": 512000
}
```

### Supported Logo Formats

| Format | Max Size | Notes |
|--------|----------|-------|
| PNG | 512 KB | Recommended for best compatibility |
| JPG | 512 KB | Supported |
| SVG | 512 KB | Sanitized for security (no scripts, event handlers) |

---

## PII Redaction

The report generator automatically redacts tag values that may contain personally identifiable information.

### Redacted Tag Patterns

Tags matching these patterns have their values replaced with `****`:

- `email`, `phone`, `ssn`, `user_id`, `ip_addr`, `userid`, `username`, `personal`

### Example

```
# Original tag: user_email=alice@example.com
# In report:    user_email=****
```

The generated HTML includes the comment `<!-- Tags (PII fields redacted) -->` for audit traceability.

---

## Report Artifacts

### Directory Structure

```
reports/{client}/{service}/{timestamp}/
  report.html              # Interactive HTML report
  summary.json             # Machine-readable summary
  metrics.json             # Raw metrics
  report.pdf               # (optional) PDF export
  report.png               # (optional) PNG export
  analysis-{ts}.md         # (optional) LLM analysis
  message-{ts}.md          # (optional) LLM executive message
  comparison.json          # (optional) Comparison data
```

### Allowed File Extensions

For security, only these extensions are allowed when writing report artifacts:

`.html` `.json` `.jsonl` `.csv` `.txt` `.md`

### CI/CD Integration

Reports can be uploaded as CI/CD artifacts:

```yaml
# GitHub Actions
- name: Upload test report
  uses: actions/upload-artifact@v4
  with:
    name: k6-report-${{ github.run_id }}
    path: reports/acme/users/*/report.html

# GitLab CI
artifacts:
  paths:
    - reports/acme/users/*/report.html
  expire_in: 30 days
```

---

## Overall Score Badge

Every HTML report renders an **Overall** KPI cell in the metrics strip (T-262). The value is
a 0–100 integer and the color threshold follows the GPT healthy-instance convention:

| Score range | Color  | Meaning                     |
|-------------|--------|-----------------------------|
| ≥ 90        | Green  | Healthy — all or nearly all checks pass |
| 70–89       | Amber  | Degraded — some warnings or failures   |
| < 70        | Red    | Unhealthy — significant failures       |

### Score resolution order

The report prefers the richer engine score when available; otherwise it falls back to a
checks-only derivation so that a badge is always rendered:

1. **`extendedMetrics.score`** — if `MetricsEngine` ran and the JSON summary contains
   `extendedMetrics.score`, that value (weighted pass/warn/fail across all metric categories)
   is used as-is.
2. **Checks-only fallback** — if `extendedMetrics.score` is absent, the generator calls
   `scoreFromCounts({ pass: checks.pass, warn: 0, fail: checks.fail })` using the raw k6
   checks data. This formula counts only pass and fail (no warn weight) and always produces
   a grade.
3. **Empty fallback** — if neither source is available, `scoreFromCounts({ pass:0, warn:0, fail:0 })`
   returns 100/A so the cell is never blank.

See [Metrics Engine → Overall Results Score](/docs/framework/metrics/metrics-engine#overall-results-score)
for the full grade table and `scoreFromCounts` API.

---

## Related Documentation

- [Grafana Dashboards](/docs/framework/observability/grafana) — real-time visualization during test execution
- [SLA/SLO](/docs/framework/metrics/sla-slo) — SLO definitions and evaluation
- [Groups & Custom Metrics](/docs/framework/helpers/groups-custom-metrics) — groups analysis and custom metrics in reports
- [Metrics Engine](/docs/framework/metrics/metrics-engine) — 125+ metrics collected by the framework
