---
title: Export Formats
sidebar_position: 6
---

# Export Formats

k6-report can output test results in 7 formats. HTML is the primary output; the other formats serve specific integration and workflow needs.

---

## HTML

Self-contained HTML dashboard with embedded CSS, JavaScript, and SVG charts. Works offline with no external dependencies.

```bash
npx k6-report generate summary.json -f html -o report.html
```

```typescript
import { generateHtmlReport } from "k6-report";
const html = generateHtmlReport(summary, { branding: { orgName: "Acme" } });
```

**Features:**
- 18 report sections organized into 4 blocks
- Dark/light theme toggle
- Custom branding (org name, color, logo)
- Baseline comparison when `--compare` is used
- Embedded SVG charts (no CDN)
- Print-friendly light mode

---

## CSV

Flat metrics export for spreadsheet analysis or data pipeline ingestion.

```bash
npx k6-report generate summary.json -f csv -o metrics.csv
```

```typescript
import { exportCSV } from "k6-report";
const csv = exportCSV(summary);
```

**Output columns:**
- Metric name
- Metric type (counter, gauge, rate, trend)
- Statistical values (avg, min, max, med, p90, p95, p99, count, rate)

---

## Markdown

Human-readable analysis report in Markdown format. Useful for documentation, PR comments, and wiki pages.

```bash
npx k6-report generate summary.json -f markdown -o report.md
```

```typescript
import { generateMarkdown } from "k6-report";
const md = generateMarkdown(summary, analysisResult);
```

**Includes:**
- Test overview and configuration
- Key metrics summary table
- SLA compliance status
- APDEX score (when analysis is provided)
- Anomalies and recommendations

---

## Jira Wiki Markup

Generate ticket content formatted in Jira wiki markup, ready to paste into Jira issues.

```bash
npx k6-report ticket summary.json -f jira \
  --service-name "Payment API" \
  --environment staging \
  --profile load
```

```typescript
import { generateTicket } from "k6-report";

const { story, comment } = generateTicket(summary, {
  format: "jira",
  service: "Payment API",
  environment: "staging",
  profile: "load",
  reportUrl: "https://reports.internal/latest.html",
});

// story: main ticket description (wiki markup)
// comment: follow-up comment with detailed metrics
```

**Ticket structure:**
- **Story**: Test summary, verdict, key findings, environment details
- **Comment**: Full metric table, threshold results, anomalies

---

## GitHub Markdown

Generate ticket content formatted for GitHub issues and pull requests.

```bash
npx k6-report ticket summary.json -f github \
  --service-name "Auth API" \
  --environment production
```

```typescript
const { story, comment } = generateTicket(summary, {
  format: "github",
  service: "Auth API",
  environment: "production",
});
```

Same structure as Jira but formatted with GitHub-flavored Markdown — collapsible sections, task lists, and status badges.

---

## Slack Block Kit

Generate a formatted notification message for Slack channels using [Block Kit](https://api.slack.com/block-kit) JSON.

```typescript
import { generateMessage } from "k6-report";

const message = generateMessage(summary, {
  platform: "slack",
  service: "Payment API",
  environment: "production",
  reportUrl: "https://reports.internal/latest.html",
});

// Post to Slack via webhook or API
await fetch(webhookUrl, {
  method: "POST",
  body: message,
  headers: { "Content-Type": "application/json" },
});
```

**Includes:**
- Pass/fail verdict with color
- Key metrics (requests, error rate, p95)
- Link to full HTML report

---

## Microsoft Teams Adaptive Card

Generate a formatted notification for Microsoft Teams using [Adaptive Cards](https://adaptivecards.io/).

```typescript
const message = generateMessage(summary, {
  platform: "teams",
  service: "Auth API",
  environment: "staging",
});

// Post to Teams via webhook
await fetch(teamsWebhookUrl, {
  method: "POST",
  body: message,
  headers: { "Content-Type": "application/json" },
});
```

---

## Format Comparison

| Format | Use Case | Output | Analysis |
|--------|----------|--------|----------|
| HTML | Visual dashboards, stakeholder sharing | Complete report | Built-in |
| CSV | Spreadsheets, data pipelines | Metrics table | No |
| Markdown | Documentation, PR comments | Text report | Optional |
| Jira | Bug/issue tracking | Story + comment | Optional |
| GitHub | Issue tracking, PR comments | Story + comment | Optional |
| Slack | Team notifications | Block Kit JSON | Summary |
| Teams | Team notifications | Adaptive Card JSON | Summary |
