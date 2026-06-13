---
title: k6-report
sidebar_position: 1
slug: /k6-report
---

# k6-report

Transform k6 JSON output into high-quality HTML reports, analysis, and export formats. Zero runtime dependencies for the core API.

---

## Features

| Feature | Description |
|---------|-------------|
| **HTML Reports** | Self-contained, offline-capable dashboards with embedded SVG charts and dual theme (light/dark) |
| **Analysis Engine** | SLA compliance, APDEX scoring, anomaly detection, and actionable recommendations |
| **Capacity Analysis** | Multi-run analysis to identify max sustainable load, inflection points, and projections |
| **Trend Detection** | Historical trend analysis over 30/60/90-day windows |
| **Run Comparison** | Side-by-side diff of two k6 test runs with regression detection |
| **Export Formats** | CSV, Markdown, Jira wiki, GitHub Markdown, Slack Block Kit, Teams Adaptive Card |
| **Ticket Generation** | Auto-generate Jira or GitHub issues from test results |
| **Run Storage** | JSONL-based historical run index for trend tracking |

---

## Install

```bash
npm install k6-report
```

---

## Quick Start

### 1. Run your k6 test with `--summary-export`

```bash
k6 run script.js --summary-export=summary.json
```

### 2. Generate an HTML report

```bash
npx k6-report generate summary.json -o report.html
```

### 3. Open `report.html` in your browser

The generated report is fully self-contained — no CDN, works offline.

---

## How It Works

k6-report follows a pipeline architecture:

```
k6 JSON output
    |
    v
  Parser         -- parseK6Summary(): validates and normalizes the raw JSON
    |
    v
  Enrichment     -- enrichSummary(): adds schema version, generator health
    |
    v
  Analysis       -- checkSLA(), calculateApdex(), detectAnomalies(), generateRecommendations()
    |
    v
  Report/Export  -- generateHtmlReport(), exportCSV(), generateMarkdown(), generateTicket()
    |
    v
  Storage        -- RunStore.append(): persists run for historical tracking
```

### Convenience API

The `generateReport()` function runs the entire pipeline in a single call:

```typescript
import { readFileSync, writeFileSync } from "fs";
import { generateReport } from "k6-report";

const json = readFileSync("summary.json", "utf8");
const { html, analysis } = generateReport(json, {
  branding: { orgName: "Acme Corp", primaryColor: "#e11d48" },
});
writeFileSync("report.html", html);
```

---

## Requirements

- **Node.js** >= 18.0.0
- **k6** (for running tests — k6-report only needs the JSON output)

---

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | Error (invalid input, missing file, etc.) |
| `2` | Threshold violations detected |
