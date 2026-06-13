---
title: HTML Report Sections
sidebar_position: 4
---

# HTML Report Sections

The HTML report is organized into 4 logical blocks containing 18 sections. Every section is conditionally rendered — if the data is missing, the section is omitted. The report is fully self-contained with embedded CSS, JS, and SVG charts.

---

## Report Layout

```
Overview Block
  Header                  -- Test name, timestamp, verdict badge, branding
  Threshold Alert         -- Red banner when thresholds fail
  Executive Summary       -- Natural language performance assessment
  KPI Strip               -- 4 key metrics at a glance
  Test Overview           -- Scenario config, VUs, duration, iterations

Latency Block
  Latency Distribution    -- p50/p90/p95/p99 bar chart with threshold overlay
  Latency Components      -- DNS, TLS, connect, wait, receive breakdown

Traffic Block
  VU Distribution         -- Virtual user allocation across scenarios
  Load Profile            -- Stage ramp-up/down visualization
  Error Breakdown         -- HTTP error codes with counts and percentages

Quality Block
  SLA Compliance          -- Pass/fail table for all k6 thresholds
  Checks Detail           -- k6 check() results grouped by check group
  Business Metrics        -- Custom business metrics with thresholds
  Custom Metrics          -- All non-standard metrics (counters, gauges, rates, trends)
  Resource Monitoring     -- Generator CPU/memory when health data is available

Analysis Block
  Anomaly Detection       -- Outliers, spikes, and suspicious patterns
  Recommendations         -- Actionable suggestions based on results
  Comparison              -- Side-by-side baseline diff (when --compare is used)

Annex Block
  K6 Output               -- Raw k6 execution log (when --k6-output is used)
  Artifacts               -- Companion file links (when --artifact is used)
```

---

## Section Details

### Header

Displays at the top of the report with:
- Test name (from input file name or `context.testName`)
- Timestamp of report generation
- Pass/fail verdict badge (green/red)
- Organization branding (name, logo, primary color) when configured

### Threshold Alert

A prominent red banner shown only when k6 thresholds have failed. Immediately draws attention to SLA violations.

### Executive Summary

A natural language paragraph summarizing the test outcome. Includes:
- Overall verdict (pass/fail)
- Key performance indicators in context
- Notable findings (high error rates, slow endpoints, etc.)

### KPI Strip

Four key metrics displayed as large numbers:
- **Total Requests** — `http_reqs` count
- **Avg Response Time** — `http_req_duration` average
- **Error Rate** — `http_req_failed` rate
- **p95 Latency** — `http_req_duration` p(95)

Color-coded: green when healthy, amber/red when thresholds are breached.

### Test Overview

Configuration details of the test run:
- Scenario name and executor type
- Number of VUs (min/max)
- Test duration
- Total iterations completed
- Data sent/received

### Latency Distribution

Bar chart visualization of latency percentiles:
- p50 (median), p90, p95, p99
- Threshold line overlay when `http_req_duration` thresholds are defined
- Color gradient from green (p50) to red (p99)

### Latency Components

Breakdown of where time is spent in each HTTP request:
- DNS lookup
- TLS handshake
- TCP connect
- Waiting (TTFB)
- Receiving

### VU Distribution

SVG area chart showing virtual user allocation over time based on ramping stages.

**Data source:** `options.stages` in the k6 JSON summary. If the JSON doesn't include it, pass `--stages` to the CLI:

```bash
npx k6-report generate summary.json --stages "30s:10,1m:50,2m:50,30s:0"
```

To include `options.stages` automatically in the JSON, pass the k6 `options` object when generating the summary in your scenario:

```typescript
export function handleSummary(data) {
  return generateJsonSummary(data, context, "./reports/summary.json", {
    k6Options: options,
  });
}
```

### Load Profile

SVG area chart with color-coded phase annotations (blue = ramp-up, green = steady state, amber = ramp-down).

Uses the same `options.stages` data source as VU Distribution. See above for how to provide it.

### Error Breakdown

Table of HTTP error responses:
- Status codes (4xx, 5xx)
- Count per status code
- Percentage of total requests
- Ordered by frequency

### SLA Compliance

Pass/fail table for every k6 threshold:
- Threshold expression
- Metric name
- Actual value vs. threshold
- Pass/fail status

### Checks Detail

Results from `check()` calls grouped by check group:
- Check name
- Pass count / total
- Pass rate percentage
- Failure details

### Business Metrics

Custom business-level metrics (tagged with `business:true` or custom naming convention) displayed with their threshold status.

### Custom Metrics

All non-standard metrics collected during the test:
- Counters, Gauges, Rates, Trends
- Full statistical summary (avg, min, max, p90, p95, p99)

### Resource Monitoring

Generator machine health when `GeneratorHealth` data is available:
- CPU usage
- Memory usage
- Network I/O

### Anomaly Detection

Automatically detected anomalies:
- Statistical outliers (metrics far outside normal range)
- Sudden spikes in latency or error rate
- High coefficient of variation

### Recommendations

Actionable suggestions generated from test results:
- Performance optimization opportunities
- Infrastructure scaling recommendations
- Configuration improvements
- Prioritized by impact (high/medium/low)

### Comparison

Side-by-side diff with a baseline run (when `--compare` is used):
- Per-metric delta and percentage change
- Regression/improvement indicators
- Summary: improved, regressed, stable metric counts

### K6 Output

Embeds the raw k6 execution log (stdout/stderr) as a collapsible annex in the report. Useful for debugging threshold failures or viewing k6's built-in summary output.

**Data source:** `--k6-output <path>` CLI flag pointing to the captured k6 log file.

```bash
# Capture k6 output during test run
k6 run script.js --summary-export=summary.json 2>&1 | tee k6-execution.log

# Embed it in the report
npx k6-report generate summary.json --k6-output k6-execution.log
```

### Artifacts

A horizontal bar with clickable links to companion files (Grafana dashboards, CSV exports, Jira tickets, etc.).

**Data source:** `--artifact <label=url>` CLI flag (repeatable).

```bash
npx k6-report generate summary.json \
  --artifact "Grafana=https://grafana.local/d/k6-dashboard" \
  --artifact "CSV Metrics=./metrics.csv" \
  --artifact "Jira Ticket=https://jira.local/browse/PERF-456"
```

---

## Themes

The report supports dual themes:
- **Dark mode** (default) — optimized for screen viewing
- **Light mode** — optimized for printing and PDF export

Users can toggle between themes using the button in the report header.

---

## Branding

Customize the report appearance via CLI flags or API options:

```bash
npx k6-report generate summary.json \
  --branding-org "Acme Corp" \
  --branding-color "#e11d48" \
  --branding-logo ./logo.png
```

```typescript
generateReport(json, {
  branding: {
    orgName: "Acme Corp",
    primaryColor: "#e11d48",
    logoBase64: "data:image/png;base64,..."
  }
});
```

The primary color is applied to:
- Header background gradient
- KPI strip accent
- Chart colors
- Link colors
