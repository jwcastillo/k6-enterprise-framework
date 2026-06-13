---
title: CLI Reference
sidebar_position: 2
---

# CLI Reference

k6-report provides 6 commands for report generation, analysis, and run management.

---

## `generate <input>`

Generate a report from a k6 JSON summary file.

```bash
npx k6-report generate summary.json -o report.html
```

| Flag | Description | Default |
|------|-------------|---------|
| `-o, --output <path>` | Output file path | auto-named |
| `-f, --format <type>` | Output format: `html`, `csv`, or `markdown` | `html` |
| `--store` | Save run to history after generation | -- |
| `--branding-org <name>` | Organization name for branding | -- |
| `--branding-color <hex>` | Primary hex color for branding | -- |
| `--branding-logo <path>` | Path to logo file (base64-encoded in report) | -- |
| `--compare <baseline>` | Baseline k6 JSON file for comparison | -- |
| `--k6-output <path>` | Path to k6 execution log to embed as annex | -- |
| `--artifact <label=path>` | Companion artifact link (repeatable) | -- |
| `--stages <stages>` | VU ramping stages as `duration:target,...` (e.g., `30s:10,1m:50,30s:0`) | -- |
| `--quiet` | Suppress non-error output | -- |
| `--no-color` | Disable colored output | -- |

### Report enrichment flags

The `--k6-output`, `--artifact`, and `--stages` flags add content to specific report sections:

| Flag | Report section |
|------|---------------|
| `--stages` | **VU Distribution** chart and **Load Profile** chart (ramp-up/steady/ramp-down phases) |
| `--k6-output` | **K6 Output** section (raw execution log embedded as annex) |
| `--artifact` | **Artifacts** bar with clickable links |

:::tip
If your k6 JSON already contains `options.stages` (e.g., via `generateJsonSummary` with `k6Options`), the charts render automatically without `--stages`.
:::

### Examples

```bash
# Basic HTML report
npx k6-report generate summary.json

# CSV export
npx k6-report generate summary.json -f csv -o metrics.csv

# Markdown report
npx k6-report generate summary.json -f markdown -o report.md

# Branded report with comparison
npx k6-report generate summary.json \
  --branding-org "Acme Corp" \
  --branding-color "#e11d48" \
  --branding-logo ./logo.png \
  --compare baseline.json \
  -o report.html

# Full report with VU charts, k6 output, and artifact links
npx k6-report generate summary.json \
  --stages "30s:10,1m:50,2m:50,30s:100,1m:100,30s:0" \
  --k6-output k6-execution.log \
  --artifact "Grafana=https://grafana.local/d/k6" \
  --artifact "CSV Metrics=./metrics.csv" \
  --compare baseline.json \
  -o report.html

# Generate and store for trend tracking
npx k6-report generate summary.json --store
```

---

## `compare <run-a> <run-b>`

Compare two k6 test runs side by side.

```bash
npx k6-report compare baseline.json current.json -o compare.html
```

| Flag | Description | Default |
|------|-------------|---------|
| `-o, --output <path>` | Output file path | auto-named |
| `-f, --format <type>` | Output format: `html`, `markdown`, or `json` | `html` |
| `--quiet` | Suppress non-error output | -- |
| `--no-color` | Disable colored output | -- |

### Examples

```bash
# HTML comparison report
npx k6-report compare before.json after.json -o comparison.html

# JSON diff for CI pipeline
npx k6-report compare before.json after.json -f json -o diff.json

# Markdown for PR comment
npx k6-report compare before.json after.json -f markdown
```

---

## `capacity <inputs...>`

Generate a capacity analysis report from multiple k6 runs at increasing load levels.

```bash
npx k6-report capacity run-50vus.json run-100vus.json run-200vus.json -o capacity.html
```

| Flag | Description | Default |
|------|-------------|---------|
| `-o, --output <path>` | Output file path | auto-named |
| `--threshold <ms>` | p95 latency threshold in ms | `2000` |
| `--growth-rate <decimal>` | Monthly growth rate for projection | `0.1` |
| `--quiet` | Suppress non-error output | -- |

### Examples

```bash
# Basic capacity analysis
npx k6-report capacity 50vus.json 100vus.json 200vus.json 400vus.json

# Custom threshold and growth projection
npx k6-report capacity *.json --threshold 1500 --growth-rate 0.15 -o capacity.html
```

---

## `trend <inputs...>`

Generate a trend analysis report from historical k6 runs.

```bash
npx k6-report trend run-jan.json run-feb.json run-mar.json -o trend.html
```

| Flag | Description | Default |
|------|-------------|---------|
| `-o, --output <path>` | Output file path | auto-named |
| `--window <days>` | Trend window: `30`, `60`, or `90` days | `30` |
| `--baseline-p95 <ms>` | Baseline p95 in ms (optional) | -- |
| `--quiet` | Suppress non-error output | -- |

### Examples

```bash
# 30-day trend
npx k6-report trend results/*.json -o trend.html

# 90-day trend with baseline reference
npx k6-report trend results/*.json --window 90 --baseline-p95 500
```

---

## `ticket <input>`

Generate Jira or GitHub ticket content from k6 results.

```bash
npx k6-report ticket summary.json --format jira --service-name "Payment API"
```

| Flag | Description | Default |
|------|-------------|---------|
| `-f, --format <type>` | Ticket format: `jira` or `github` | required |
| `-o, --output <path>` | Output file path | stdout |
| `--service-name <name>` | Service name for ticket | -- |
| `--environment <env>` | Test environment | -- |
| `--profile <name>` | Load test profile name | -- |
| `--quiet` | Suppress non-error output | -- |

### Examples

```bash
# Jira ticket to stdout
npx k6-report ticket summary.json -f jira --service-name "Auth API" --environment staging

# GitHub issue to file
npx k6-report ticket summary.json -f github \
  --service-name "Payment API" \
  --profile load \
  -o issue.md
```

---

## `list`

List historical test runs from storage.

```bash
npx k6-report list --limit 10
```

| Flag | Description | Default |
|------|-------------|---------|
| `--dir <path>` | Storage directory override | `.k6-report/` |
| `--json` | Output raw JSONL for machine processing | -- |
| `--limit <n>` | Number of entries to show | `20` |
| `--no-color` | Disable colored output | -- |

### Examples

```bash
# List last 10 runs
npx k6-report list --limit 10

# JSON output for scripting
npx k6-report list --json | jq '.verdict'

# Custom storage directory
npx k6-report list --dir /data/k6-runs
```
