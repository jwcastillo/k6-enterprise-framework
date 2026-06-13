---
title: "k6 Enterprise Framework — Development Workflow"
sidebar_position: 4
---
# k6 Enterprise Framework — Development Workflow

T-178 (Phase 8): Step-by-step development workflow with visual diagram,
copyable commands, prerequisite guidance, directory structure, and profile reference.

---

## 5-Step Workflow

```
  ┌──────────────────────────────────────────────────────────────────┐
  │                                                                  │
  │  1. CREATE CLIENT  →  2. CONFIGURE  →  3. BUILD  →  4. RUN  →  5. ANALYZE  │
  │                                                                  │
  └──────────────────────────────────────────────────────────────────┘
```

### Step 1 — Create Client

Create a new product layer for your team or service.

```bash
./bin/create-client.sh my-team
```

This creates:
```
clients/my-team/
  config/
    default.json     ← base configuration
  scenarios/
    api/             ← place your test scenarios here
  data/              ← test data files (CSV, JSON)
  lib/               ← shared helpers for your team
```

### Step 2 — Configure

Edit `clients/my-team/config/default.json` with your service settings.

```bash
# Validate your configuration before running
node bin/validate-config.js --client=my-team
# Expected: ✓ Validated: default.json (JSON) — 1 scenario, 3 thresholds. All OK.

# Generate a complete example config as a starting point
node bin/validate-config.js --example > clients/my-team/config/default.yml
```

> **Prerequisite for Step 3**: Step 2 must succeed (valid config).
> If validation fails, fix errors before proceeding.

### Step 3 — Build

Compile TypeScript scenarios to JavaScript.

```bash
npm run build
# Expected output: webpack compilation success, dist/ updated
```

> **Prerequisite for Step 3**: `npm install` must have been run first.
> If you get "command not found", run `npm install` from the project root.

```bash
# Verify build output
ls dist/my-team/
```

### Step 4 — Run

Execute your test with the desired profile.

```bash
# Smoke test (fastest — ~1 min, verifies service is up)
./bin/run-test.sh --client=my-team --scenario=api/my-scenario --profile=smoke

# Quick CI test (fast — ~3 min, for pipeline gating)
./bin/run-test.sh --client=my-team --scenario=api/my-scenario --profile=quick

# Load test (normal load — ~14 min)
./bin/run-test.sh --client=my-team --scenario=api/my-scenario --profile=load --env=staging

# Run a consolidated test suite (from tests/ directory instead of scenarios/)
./bin/run-test.sh --client=my-team --test=artifacts/acl -- -e ARTIFACT=xp-acl-beta

# Skip build for faster iteration (when code hasn't changed)
./bin/run-test.sh --client=my-team --scenario=api/my-scenario --profile=smoke --skip-build

# With full observability (Prometheus + Loki + Tempo + OTEL)
./bin/run-test.sh --client=my-team --scenario=api/my-scenario --profile=smoke --observability
```

> **`--scenario` vs `--test`**: Use `--scenario` for files under `clients/<client>/scenarios/`. Use `--test` for consolidated suites under `clients/<client>/tests/` (auto-appends `.test` suffix).

> **Prerequisite for Step 4**: Step 3 (build) must complete successfully.
> If test fails with "bundle not found", run `npm run build` first.

### Step 5 — Analyze

Review results and compare with previous runs.

```bash
# View trend analysis (sparklines across last N runs)
node bin/trend-analysis.js --client=my-team --test=my-scenario --limit=10

# Export metrics to CSV for spreadsheet analysis
node bin/export-data.js --client=my-team --format=csv --out=reports/my-team.csv

# Open HTML report
open reports/my-team/api_my-scenario/html-report-*.html
```

---

## Directory Structure

```
k6-framework/
│
├── src/                        ← Generic layer (framework code — do not modify)
│   ├── core/                   ← Config loading, profile system, execution engine
│   ├── helpers/                ← Data helpers, request patterns, auth
│   ├── patterns/               ← Retry, correlation, pagination, chaos
│   ├── observability/          ← Generator health, tracing, Pyroscope
│   └── reporting/              ← HTML and JSON report generators
│
├── clients/                    ← Product layer (your team's code lives here)
│   ├── _reference/             ← Reference implementation (read-only template)
│   ├── examples/               ← Example scenarios for learning
│   └── <your-team>/            ← Your client directory
│       ├── config/             ← Environment-specific JSON configurations
│       ├── scenarios/          ← k6 TypeScript test scenarios (--scenario flag)
│       ├── tests/              ← Consolidated test suites (--test flag)
│       ├── data/               ← Test data (CSV, JSON, JSONL)
│       └── lib/                ← Team-specific helpers and services
│
├── shared/                     ← Shared resources (schemas, profiles, templates)
│   ├── profiles/               ← Load profile definitions (smoke.json, load.json, etc.)
│   ├── schemas/                ← JSON Schema files for validation
│   └── templates/              ← Scaffold templates for generate.js
│
├── bin/                        ← CLI tools
│   ├── run-test.sh             ← Main test runner (6-step pipeline)
│   ├── validate-config.js      ← Config validation CLI
│   ├── generate.js             ← Scaffold generator
│   ├── compare-results.js      ← Manual baseline comparator
│   ├── trend-analysis.js       ← Trend report generator
│   ├── export-data.js          ← Bulk data exporter
│   ├── mock-server.js          ← Local HTTP mock server
│   └── notify.js               ← Webhook notification sender
│
├── infrastructure/             ← Docker Compose observability stack
│   ├── docker-compose.yml      ← Base services (Grafana, Prometheus, Redis)
│   └── docker-compose.prod.yml ← Production hardening overrides
│
├── reports/                    ← Generated artifacts (gitignored)
│   └── <client>/<scenario>/    ← html-report-*, summary-*, metrics-*.csv
│
└── docs/                       ← Documentation
    ├── WORKFLOW.md             ← This file
    ├── LOAD_PROFILES.md        ← Profile reference
    ├── EXTENSION_POINTS.md     ← How to extend the framework
    └── DISTRIBUTED_TESTING.md  ← k6 Operator / Kubernetes guide
```

---

## Load Profile Reference

| Profile | VUs | Duration | Category | Use Case |
|---------|-----|----------|----------|----------|
| `smoke` | 1–2 | 1m | Sanity | Verify service is operational |
| `quick` | 5 | 3m | CI | Fast feedback in CI pipelines |
| `load` | 20 | 14m | Normal | Normal sustained traffic |
| `rampup` | 50 | 13m | Gradient | Gradual increment testing |
| `capacity` | 200 | 20m | Limit | Find maximum throughput |
| `stress` | 400 | 25m | Stress | Find breaking point |
| `spike` | 300↑ | 5m | Spike | Elasticity and recovery |
| `breakpoint` | 1000 | 1h | Extreme | Find absolute system limit |
| `soak` | 20 | 4h+ | Endurance | Memory leaks, slow degradation |

```bash
# List all profiles with details
./bin/run-test.sh --list-profiles

# Use a specific profile
./bin/run-test.sh --client=my-team --scenario=api/test --profile=load
```

### Profile not found?

```
Error: Invalid profile 'myprofile'.
```

Available profiles: `smoke quick load rampup capacity stress spike breakpoint soak`

---

## Threshold Hierarchy

Thresholds are applied in order of precedence (higher overrides lower):

```
1. Profile defaults       (shared/profiles/<name>.json)     ← lowest precedence
2. Client base config     (clients/<name>/config/default.json)
3. Environment overrides  (clients/<name>/config/staging.json)
4. Scenario overrides     (export const options in scenario.ts)
5. CLI --env flag         (K6_ENV=production)                ← highest precedence
```

---

## CI/CD Integration (T-173)

### GitHub Actions

```yaml
# .github/workflows/k6-load-test.yml
name: Load Tests

on:
  push:
    branches: [main]
  schedule:
    - cron: '0 6 * * *'  # nightly

jobs:
  validate-and-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Validate config
        run: node bin/validate-config.js --client=my-team

      - name: Build
        run: npm run build

      - name: Run smoke test
        run: ./bin/run-test.sh --client=my-team --scenario=api/smoke --profile=smoke
        env:
          K6_ENV: staging

      - name: Upload reports
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: k6-reports
          path: reports/
```

### GitLab CI

```yaml
# .gitlab-ci.yml
k6-smoke:
  stage: test
  script:
    - npm ci
    - node bin/validate-config.js --client=my-team
    - npm run build
    - ./bin/run-test.sh --client=my-team --scenario=api/smoke --profile=smoke
  artifacts:
    when: always
    paths:
      - reports/
    expire_in: 7 days
  variables:
    K6_ENV: staging
```

---

## Common Commands Reference

```bash
# New user onboarding (< 10 min)
npm install
./bin/run-test.sh --client=_reference --scenario=api/smoke-users --profile=smoke

# Validate then run (recommended CI pattern)
node bin/validate-config.js --client=my-team && \
  npm run build && \
  ./bin/run-test.sh --client=my-team --scenario=api/test --profile=smoke

# Run consolidated artifact test (from tests/ directory)
./bin/run-test.sh --client=my-team --test=artifacts/acl -- -e ARTIFACT=my-artifact

# Run all tests for a client
./bin/run-all-tests.sh --client=my-team --profile=smoke

# Compare two specific runs manually
node bin/compare-results.js \
  --baseline=reports/my-team/api_test/summary-20260217-143000.json \
  --current=reports/my-team/api_test/summary-20260218-090000.json

# Generate trend report
node bin/trend-analysis.js --client=my-team --test=api_test --limit=10

# Start local observability stack
docker compose --profile observability up -d

# Run with full observability pipeline
./bin/run-test.sh --client=examples --scenario=integration/16-sli-monitoring \
  --profile=smoke --observability
```
