---
title: Run Storage
sidebar_position: 8
---

# Run Storage

k6-report includes a lightweight, filesystem-based storage system for tracking historical test runs. This enables trend analysis, run comparison, and audit trails without requiring external databases.

---

## How It Works

When you pass `--store` to `k6-report generate`, the run is saved locally:

```bash
npx k6-report generate summary.json --store
```

### Directory Layout

```
.k6-report/
  index.jsonl        -- One JSON line per run (append-only)
  runs/
    a1b2c3d4.json    -- Full K6Summary for each stored run
    e5f6g7h8.json
```

- **`index.jsonl`** — Append-only JSONL file for fast listing without loading full summaries
- **`runs/<id>.json`** — Pretty-printed K6Summary for each run (used by comparison and trend commands)

### Run ID Generation

Each run gets a deterministic ID based on a SHA-256 hash of the summary content. This means:
- Identical test results produce the same ID (deduplication)
- Different runs always get unique IDs

---

## CLI Usage

### Store a Run

```bash
# Store during report generation
npx k6-report generate summary.json --store

# Custom storage directory
npx k6-report generate summary.json --store --dir /data/k6-runs
```

### List Stored Runs

```bash
# List recent runs (default: 20)
npx k6-report list

# Limit to last 5
npx k6-report list --limit 5

# JSON output for scripting
npx k6-report list --json

# Custom directory
npx k6-report list --dir /data/k6-runs
```

### Use Stored Runs for Analysis

```bash
# Trend from stored runs (use the stored JSON files directly)
npx k6-report trend .k6-report/runs/*.json --window 30

# Compare two stored runs
npx k6-report compare .k6-report/runs/a1b2c3d4.json .k6-report/runs/e5f6g7h8.json
```

---

## Programmatic API

### `RunStore`

```typescript
import { RunStore, generateRunId, parseK6Summary } from "k6-report";

// Initialize store (defaults to .k6-report/ in cwd)
const store = new RunStore();

// Or with custom directory
const store = new RunStore({ dir: "/data/k6-runs" });
```

### Storing a Run

```typescript
const raw = JSON.parse(readFileSync("summary.json", "utf8"));
const summary = parseK6Summary(raw);
const id = generateRunId(summary);

store.append(
  {
    id,
    timestamp: new Date().toISOString(),
    verdict: summary.state?.isStdErrTainted ? "fail" : "pass",
  },
  summary,
);
```

### Listing Runs

```typescript
// Most recent first, limited to 10
const runs = store.list(10);

for (const run of runs) {
  console.log(`${run.id} | ${run.timestamp} | ${run.verdict}`);
}
```

### Index Entry Schema

```typescript
interface RunIndexEntry {
  /** Deterministic hash-based run ID */
  id: string;
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Test verdict: "pass" or "fail" */
  verdict: string;
}
```

---

## Environment Variable

Set `K6_REPORT_DIR` to override the default storage directory globally:

```bash
export K6_REPORT_DIR=/data/k6-runs
npx k6-report generate summary.json --store
npx k6-report list
```

Priority order:
1. `--dir` CLI flag (highest)
2. `K6_REPORT_DIR` environment variable
3. `.k6-report/` in current working directory (default)

---

## Corruption Recovery

The JSONL index file uses append-only writes. If a line is malformed (e.g., due to interrupted write), `RunStore.list()` skips the bad line and continues reading. No manual intervention is needed.

---

## CI/CD Integration

Store runs in CI to build historical data:

```yaml
# GitHub Actions example
- name: Run k6 test
  run: k6 run script.js --summary-export=summary.json

- name: Generate report and store
  run: npx k6-report generate summary.json --store -o report.html

- name: Upload report
  uses: actions/upload-artifact@v4
  with:
    name: k6-report
    path: report.html

- name: Persist run storage
  uses: actions/cache/save@v4
  with:
    path: .k6-report
    key: k6-runs-${{ github.sha }}
```
