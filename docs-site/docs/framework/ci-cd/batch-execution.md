---
title: "Batch Execution — US20"
sidebar_position: 2
---
# Batch Execution — US20

Run multiple k6 scenarios in parallel with a single command, consolidated reporting, and CI/CD integration.

**Tasks:** T-055, T-056, T-057, T-058  
**Scripts:** `bin/testing/run-all-tests.sh`, `bin/testing/run-parallel.js`, `bin/testing/test-summary.sh`

---

## Quick Start

```bash
# Run all scenarios for a client (default: 2 parallel workers)
bin/testing/run-all-tests.sh --client=clienteA

# Run with 4 parallel workers
bin/testing/run-all-tests.sh --client=clienteA --concurrency=4

# Filter by pattern
bin/testing/run-all-tests.sh --client=clienteA --pattern="api/*.ts"

# Exclude integration tests (requires bash extglob)
bin/testing/run-all-tests.sh --client=clienteA --pattern="!(integration)/*.ts"

# Dry run (list scenarios without running)
bin/testing/run-all-tests.sh --client=clienteA --dry-run
```

---

## Architecture

```
run-all-tests.sh
  │
  ├── validates client config (shared/schemas/client.schema.json)
  ├── discovers scenarios via glob
  └── delegates to run-parallel.js
        │
        ├── spawns up to N child processes (default: 2)
        ├── each child: bin/run-test.sh --client=X --scenario=Y
        ├── captures stdout/stderr per scenario
        └── writes consolidated output to:
              reports/{client}/all-tests-{timestamp}/
                ├── summary.json       ← machine-readable
                ├── summary.md         ← human-readable (Markdown)
                ├── execution.log      ← raw logs per scenario
                └── {scenario}/        ← individual scenario reports
```

---

## run-all-tests.sh

### Options

| Flag | Default | Description |
|------|---------|-------------|
| `--client=NAME` | required | Client name (must exist in `clients/`) |
| `--pattern=GLOB` | `**/*.ts` | Glob pattern for scenario selection |
| `--concurrency=N` | `2` | Max parallel k6 processes |
| `--profile=NAME` | `smoke` | Load profile: smoke, quick, load, stress |
| `--env=NAME` | `default` | Environment config name |
| `--dry-run` | false | List scenarios without running |
| `--no-color` | false | Disable ANSI color output |

### Pattern negation (extglob)

Negation patterns require bash `extglob`:

```bash
# This works in bash ≥4 with extglob:
bin/testing/run-all-tests.sh --client=clienteA --pattern="!(integration)/**/*.ts"

# Fallback for shells without extglob:
bin/testing/run-all-tests.sh --client=clienteA --pattern="api/*.ts"
bin/testing/run-all-tests.sh --client=clienteA --pattern="mixed/*.ts"
```

The script prints a warning if `extglob` is not available in the current shell.

### Config validation

Before running, the script validates `clients/{client}/config/default.json` against  
`shared/schemas/client.schema.json`. Invalid config aborts immediately with a clear error.

---

## run-parallel.js

Node.js parallel runner — spawns child processes and manages the execution pool.

### Programmatic use

```javascript
// From another Node.js script
const { runParallel } = require("./bin/testing/run-parallel.js");

const results = await runParallel({
  client: "clienteA",
  scenarios: ["api/smoke-users.ts", "api/load-orders.ts"],
  concurrency: 3,
  profile: "load",
  env: "staging",
  outputDir: "reports/clienteA/custom-run",
});

console.log(`${results.passed}/${results.total} passed`);
```

### Concurrency and CPU cores

```
┌─────────────────────────────────────────────────────┐
│  Warning: concurrency > CPU cores detected          │
│  Requested: 8  │  Available: 4                      │
│  High concurrency may skew per-scenario metrics.    │
│  Recommended: --concurrency=4 (= CPU count)         │
└─────────────────────────────────────────────────────┘
```

The runner warns when `--concurrency` exceeds available CPU cores (EC-CLI-004).  
Each k6 process is CPU-intensive; over-subscription causes metric distortion.

### SIGTERM / SIGINT handling

On interrupt, the runner:
1. Sends `SIGTERM` to all running child processes
2. Waits up to 5 seconds for graceful exit
3. Writes a **partial summary** marking:
   - Completed scenarios as `pass` / `fail`
   - In-progress scenarios as `interrupted`
   - Pending scenarios as `skipped`
4. Exits with code `130` (SIGINT) or `143` (SIGTERM)

---

## Consolidated reports

After all scenarios complete, the runner writes to `reports/{client}/all-tests-{timestamp}/`:

### summary.json

```json
{
  "client": "clienteA",
  "timestamp": "2026-02-17T14:30:00.000Z",
  "duration": 142.3,
  "total": 5,
  "passed": 4,
  "failed": 1,
  "interrupted": 0,
  "skipped": 0,
  "scenarios": [
    {
      "name": "api/smoke-users",
      "status": "pass",
      "exitCode": 0,
      "duration": 28.1,
      "reportPath": "reports/clienteA/api/smoke-users/2026-02-17_143000"
    }
  ]
}
```

### summary.md

Human-readable table with pass/fail indicators, durations, and links to individual reports.

### execution.log

Raw stdout/stderr per scenario, prefixed with `[scenario-name]` for easy grep:

```
[api/smoke-users] ✓ checks.........................: 100.00%
[api/load-orders] ✗ checks.........................: 94.23%
```

---

## test-summary.sh (T-073)

Standalone regenerator — useful for re-displaying a past run's summary.

```bash
# From a report directory
bin/testing/test-summary.sh reports/clienteA/all-tests-2026-02-17_143000/

# From a specific summary.json
bin/testing/test-summary.sh reports/clienteA/smoke-users/2026-02-17_143000/k6-summary.json

# No args: print help
bin/testing/test-summary.sh
```

Exit code mirrors the test result: `0` = all pass, `1` = any fail.

---

## CI/CD integration

### GitHub Actions

```yaml
- name: Run load tests
  run: |
    bin/testing/run-all-tests.sh \
      --client=${{ inputs.client }} \
      --profile=smoke \
      --concurrency=2 \
      --no-color

- name: Upload test reports
  uses: actions/upload-artifact@v4
  if: always()
  with:
    name: k6-reports
    path: reports/${{ inputs.client }}/all-tests-*/
```

### Exit codes

| Code | Meaning |
|------|---------|
| `0` | All scenarios passed |
| `1` | One or more scenarios failed |
| `2` | Configuration or argument error |
| `130` | Interrupted (SIGINT) |
| `143` | Terminated (SIGTERM) |

---

## Edge cases

| Scenario | Behavior |
|----------|----------|
| Pattern matches no files | Error with suggestion to check pattern (EC-CLI-003) |
| Concurrency > CPU count | Warning displayed; execution continues (EC-CLI-004) |
| SIGTERM during run | Partial summary written; remaining marked as interrupted (EC-CLI-005) |
| Two runs at same millisecond | Timestamps use ms precision to avoid collision (EC-CLI-006) |
| Shell without extglob | Warning shown; negation pattern falls back to full scan (EC-CLI-007) |
| Terminal without ANSI | Output degrades to plain text automatically (EC-CLI-008) |
