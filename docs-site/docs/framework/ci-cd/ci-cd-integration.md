---
title: "CI/CD Integration Guide"
sidebar_position: 1
---
# CI/CD Integration Guide

<!-- T-102: Documentacion de integracion CI/CD -->

This guide covers integrating the k6 Enterprise Framework into your CI/CD pipelines using quality gates, nightly regression suites, and multi-channel notifications.

---

## Table of Contents

1. [Quality Gates — Concepts & Exit Codes](#1-quality-gates)
2. [GitHub Actions Integration](#2-github-actions)
3. [GitLab CI Integration](#3-gitlab-ci)
4. [Advanced Patterns](#4-advanced-patterns)
5. [Notifications](#5-notifications)
6. [Troubleshooting](#6-troubleshooting)
7. [Decision Tree: Which Mode to Use?](#7-decision-tree)

---

## 1. Quality Gates

A **quality gate** is a set of performance thresholds that must pass before a build can proceed. The framework exits with a standard code that CI/CD systems can act on.

### Exit Codes

| Code | Meaning | Recommended Action |
|------|---------|-------------------|
| `0`  | All thresholds passed | Allow merge / continue pipeline |
| `1`  | One or more thresholds failed | Block merge / notify team |
| `2`  | Execution error (service unavailable, config invalid) | Investigate infra / fix config |
| `99` | Threshold failure with partial data | Review partial results, decide manually |

### Threshold Configuration

Thresholds are defined in your client config:

```json
// clients/my-service/config/staging.json
{
  "thresholds": {
    "http_req_duration": ["p(95)<500", "p(99)<1000"],
    "http_req_failed": ["rate<0.01"],
    "http_reqs": ["rate>100"]
  }
}
```

### Runtime Override (per-pipeline)

Override thresholds without changing source code:

```yaml
# In your pipeline env vars
QG_THRESHOLDS_OVERRIDE: '{"http_req_duration[p95]": 800}'
```

This is useful for different environments with different SLAs (e.g., production is stricter than staging).

---

## 2. GitHub Actions

### 2.1 Manual Smoke Test (workflow_dispatch)

Use the reference workflow for ad-hoc manual execution from the GitHub Actions UI:

```yaml
# Reference: .github/workflows/perf-smoke.yml
# Already included in this repository
```

**Trigger from GitHub UI:**
1. Go to `Actions → Performance Smoke Test`
2. Click `Run workflow`
3. Fill in: Client, Environment, Profile, Notify channels

**Trigger via API (curl):**

```bash
curl -X POST \
  -H "Authorization: token $GITHUB_PAT" \
  -H "Accept: application/vnd.github.v3+json" \
  "https://api.github.com/repos/<owner>/<repo>/actions/workflows/perf-smoke.yml/dispatches" \
  -d '{
    "ref": "main",
    "inputs": {
      "client": "my-service",
      "env": "staging",
      "profile": "smoke",
      "notify": "slack"
    }
  }'
```

### 2.2 Pull Request Quality Gate (perf-gate.yml)

Automatically blocks PR merges when performance thresholds fail.

```yaml
# Reference: .github/workflows/perf-gate.yml
```

**Setup as required status check:**
1. `Settings → Branches → Branch protection rules`
2. Check `Require status checks to pass before merging`
3. Add: `Quality Gate`

The workflow automatically posts a PR comment with results and blocks merge on failure (exit code 1).

### 2.3 Nightly Regression (perf-regression.yml)

```yaml
# Reference: .github/workflows/perf-regression.yml
# Runs automatically at 02:00 UTC daily (configurable)
```

**Cross-workflow call** (call from another workflow):

```yaml
# In consumer repo's .github/workflows/deploy.yml
jobs:
  perf-check:
    uses: your-org/k6-framework/.github/workflows/perf-regression.yml@main
    with:
      client: my-service
      suite: nightly
      env: staging
    secrets:
      PERF_SLACK_WEBHOOK: ${{ secrets.PERF_SLACK_WEBHOOK }}
```

### 2.4 Required Secrets

Configure in `Settings → Secrets and variables → Actions`:

| Secret | Description |
|--------|-------------|
| `PERF_SLACK_WEBHOOK` | Slack incoming webhook URL |
| `PERF_EMAIL_TO` | Email notification recipient |
| `PERF_NOTIFY_WEBHOOK` | Generic webhook URL |

---

## 3. GitLab CI

### 3.1 Include the Reference Template

```yaml
# In your project's .gitlab-ci.yml
include:
  - project: 'your-org/k6-framework'
    ref: main
    file: 'ci-templates/.gitlab-ci-perf.yml'
```

### 3.2 Manual Smoke Test

```yaml
# Trigger from GitLab CI/CD → Pipelines → Run pipeline
# Set variables: CLIENT, ENV, PROFILE, NOTIFY
perf:smoke:
  extends: .perf-base
  when: manual
  variables:
    CLIENT: "my-service"
    ENV: "staging"
    PROFILE: "smoke"
```

**Trigger via API (curl with GitLab PAT):**

```bash
curl -X POST \
  -F "token=<trigger_token>" \
  -F "ref=main" \
  -F "variables[CLIENT]=my-service" \
  -F "variables[ENV]=staging" \
  -F "variables[PROFILE]=smoke" \
  "https://gitlab.com/api/v4/projects/<project_id>/trigger/pipeline"
```

To get a trigger token: `Settings → CI/CD → Pipeline triggers → Add new token`.

### 3.3 Merge Request Quality Gate

The `perf:gate` job in the template runs automatically on MR pipelines and blocks merge on failure. Results integrate with the GitLab MR test widget via JUnit XML artifacts.

### 3.4 Nightly Schedule

1. Go to `CI/CD → Schedules → New schedule`
2. Set cron: `0 2 * * *` (02:00 UTC)
3. Set variable: `PERF_SUITE=nightly`

The `perf:regression:nightly` job runs automatically on scheduled pipelines.

### 3.5 Cross-Pipeline Trigger

Trigger perf tests from a consumer repo:

```yaml
# In consumer repo's .gitlab-ci.yml
trigger-perf:
  stage: test
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
  variables:
    DOWNSTREAM_CLIENT: "my-service"
  trigger:
    project: "your-org/k6-framework"
    branch: main
    strategy: depend  # waits for downstream pipeline result
```

### 3.6 CI/CD Variables

Configure in `Settings → CI/CD → Variables` as **Protected** and **Masked**:

| Variable | Description |
|----------|-------------|
| `PERF_SLACK_WEBHOOK` | Slack webhook (masked) |
| `PERF_EMAIL_TO` | Email recipient |
| `PERF_QG_THRESHOLDS_OVERRIDE` | JSON threshold overrides |
| `REDIS_URL` | Redis connection URL (masked) |

---

## 4. Advanced Patterns

### 4.1 Inline Config via `TEST_CONFIG`

Pass the entire test configuration as a JSON environment variable — no file needed:

```bash
# GitHub Actions / GitLab CI
TEST_CONFIG='{"baseUrl":"https://api.example.com","thresholds":{"http_req_duration":["p(95)<500"]}}'
```

```yaml
# GitHub Actions
- name: Run with inline config
  env:
    TEST_CONFIG: '{"baseUrl":"https://api.example.com","thresholds":{"http_req_duration":["p(95)<500"]}}'
  run: bash bin/run-test.sh --quality-gate
```

The config is written to a secure temp file (0600 permissions) and cleaned up after execution.

**Validation errors** (malformed JSON) report the exact position:
```
Error: TEST_CONFIG contains invalid JSON: Unexpected token at position 42
```

### 4.2 Remote Config via `--config=<URL>`

```bash
bash bin/run-test.sh --config=https://config.example.com/perf-config.json
```

Only HTTPS URLs are supported. The config is downloaded, validated, and cleaned up after use.

### 4.3 Cross-Repo Quality Gateway

Use the framework as a quality gate from a completely separate repository, without setting up a client:

```dockerfile
# In any repo's Dockerfile or CI
docker run --rm \
  -v $(pwd)/perf-config.json:/config/perf-config.json \
  your-registry/k6-framework:latest \
  --config=/config/perf-config.json \
  --quality-gate
# Exit code: 0 = pass, 1 = fail
```

No `--client` required — uses a virtual `local` client.

### 4.4 Nightly Regression Script (direct cron)

```bash
# crontab -e
0 2 * * * /path/to/k6-framework/bin/run-regression.sh \
  --suite=nightly \
  --client=my-service \
  --env=staging \
  --notify=slack \
  >> /var/log/perf-regression.log 2>&1
```

Exit codes: `0` = no regressions, `1` = significant, `99` = critical.

---

## 5. Notifications

### 5.1 Slack

```json
// In clients/my-service/config/staging.json
{
  "notifications": {
    "channels": ["slack"],
    "conditions": "on_failure",
    "slack": { "webhook": "${NOTIFY_SLACK_WEBHOOK}" }
  }
}
```

Or via env var: `NOTIFY_SLACK_WEBHOOK=https://hooks.slack.com/services/...`

Slack messages use Block Kit formatting with:
- ✅/❌ pass/fail badge
- Key metrics table (p95, error rate, throughput)
- Direct link to HTML report

### 5.2 Email

```bash
NOTIFY_EMAIL_TO=team@example.com bash bin/run-test.sh --client=my-service --notify=email
```

Email includes: subject with verdict, HTML body with metrics table, and report link.

### 5.3 Generic Webhook

```bash
NOTIFY_WEBHOOK_URL=https://hooks.example.com/perf bash bin/run-test.sh --notify=webhook
```

POST payload (versioned JSON):
```json
{
  "version": "1.0",
  "verdict": "pass",
  "client": "my-service",
  "environment": "staging",
  "metrics": { "p95Ms": 245, "errorRatePct": 0.3, "throughputRps": 1240 },
  "reportUrl": "https://...",
  "timestamp": "2026-02-18T02:00:00Z"
}
```

### 5.4 Disable Notifications

```bash
bash bin/run-test.sh --notify=none
```

### 5.5 Notification Conditions

| Condition | When to send |
|-----------|-------------|
| `always` | Every execution |
| `on_failure` | Only when thresholds fail (default) |
| `on_regression` | Only when regression vs baseline detected |

---

## 6. Troubleshooting

### Problem: "Docker image not found"

```
Error: manifest for your-registry/k6-framework:latest not found
```

**Fix:** Build and push the image first, or use local build:
```bash
docker build -t k6-framework:local -f infrastructure/k8s/Dockerfile .
```

### Problem: "Permission denied on GITHUB_TOKEN"

```
Error: Resource not accessible by integration
```

**Fix:** Add `permissions` to your workflow:
```yaml
permissions:
  contents: read
  issues: write
  pull-requests: write
```

### Problem: Pipeline hangs indefinitely

The quality gate has a default 30-minute timeout (`CHK-API-017`). For long-running tests, increase it:
```yaml
jobs:
  perf-gate:
    timeout-minutes: 60  # Increase for soak/stress tests
```

### Problem: "TEST_CONFIG: Unexpected token at position N"

The JSON string is malformed. Common causes:
- Unescaped single quotes in YAML: use double quotes or block scalars
- Shell variable expansion: wrap in `'single quotes'` in shell, use YAML env blocks in GitHub Actions

### Problem: Exit code 2 (execution error)

```
k6: Error loading script
```

**Fix:** Verify the client/test path and that TypeScript is built:
```bash
npm run build   # build TypeScript before running
node bin/validate-config.js --client=my-service --env=staging
```

### Problem: Slack notifications not delivered

1. Test the webhook directly: `curl -X POST -d '{"text":"test"}' $NOTIFY_SLACK_WEBHOOK`
2. Verify the webhook URL is set as a secret (not plain text variable)
3. Check network egress rules allow outbound HTTPS

### Problem: "REDIS_URL not configured" when using Redis patterns

```
[RedisHelper] Failed to connect to redis://localhost:6379
```

**Fix options:**
- Local: `export REDIS_URL=redis://localhost:6379` and start Redis
- Docker: `docker compose --profile redis up -d`
- CI: set `REDIS_URL` as a pipeline variable

---

## 7. Decision Tree

```
What kind of performance testing do I need?
│
├── "I want to run a quick test manually"
│   └── Use: workflow_dispatch (perf-smoke.yml) or run-test.sh directly
│
├── "I want to block PRs on performance regressions"
│   └── Use: perf-gate.yml (GitHub Actions) or perf:gate job (GitLab CI)
│       └── Configure as required status check
│
├── "I want automated nightly regression detection"
│   └── Use: perf-regression.yml (schedule) or crontab + run-regression.sh
│       └── Configure notification channels for alerts
│
├── "I want to test from a different/consumer repository"
│   └── Use: Cross-pipeline trigger or docker run --rm with --config
│       └── No client setup required in the framework repo
│
├── "I want to pass config without files (dynamic environments)"
│   └── Use: TEST_CONFIG env var (inline JSON) or --config=https://...
│
└── "I want to test at scale in Kubernetes"
    └── Use: k8s/k6-testrun.yaml with Grafana k6 Operator
```
