# CI/CD performance gates

How to integrate performance testing into the deploy pipeline so regressions fail builds before they reach production.

> Sources synthesized: khanntm cicd-perf-testing, KimDoubleB operating-k6-in-ci-cd, rcampos09 k6-best-practices CI integration.

---

## Why automate perf in the pipeline

- Catch regressions before merge — cheaper than after deploy
- Enforce performance budgets without manual gating
- Establish a baseline that everyone agrees on
- Build a track record over time (perf over commit history)

---

## Pipeline stages and budgets

Different stages, different test types, different budgets:

| Stage | Test type | Duration | Threshold |
|-------|-----------|----------|-----------|
| **PR check** | Smoke (10 VUs / 50 RPS) | < 5 min | p95 < 500ms, error < 1% |
| **Pre-merge** | Light load (50 VUs / 200 RPS) | 5-10 min | p95 < SLO target × 1.2, error < 0.5% |
| **Nightly** | Full load (production peak) | 15-30 min | p95 < SLO, p99 < SLO × 1.5, error < 0.1% |
| **Weekly** | Stress + soak (3-8h) | hours | Find breaking point; no degradation in soak |
| **Release gate** | Full load on staging-prod-equivalent | 30-60 min | Must pass all SLOs with 20% margin |

**Don't run heavy tests on every PR.** PR-level smoke catches obvious regressions; nightly catches the rest. Heavy tests on every PR slow down developers and cost money.

---

## GitHub Actions — k6 example

```yaml
name: Performance Tests
on:
  pull_request:
    branches: [main]
  schedule:
    - cron: '0 2 * * 1-5'  # nightly Mon-Fri 02:00 UTC

jobs:
  smoke-test:
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Install k6
        run: |
          sudo gpg -k
          sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg \
            --keyserver hkp://keyserver.ubuntu.com:80 \
            --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D68
          echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" \
            | sudo tee /etc/apt/sources.list.d/k6.list
          sudo apt-get update && sudo apt-get install k6
      - name: Run smoke test
        run: k6 run --quiet --summary-export=summary.json tests/smoke.js
        env:
          BASE_URL: ${{ secrets.STAGING_URL }}
      - name: Upload summary
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: k6-summary-${{ github.run_id }}
          path: summary.json

  load-test:
    if: github.event_name == 'schedule'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Install k6
        run: |
          sudo apt-get update && sudo apt-get install -y k6
      - name: Run load test
        run: |
          k6 run --quiet \
            --summary-export=summary.json \
            --out experimental-prometheus-rw \
            tests/load.js
        env:
          BASE_URL: ${{ secrets.STAGING_URL }}
          K6_PROMETHEUS_RW_SERVER_URL: ${{ secrets.PROM_RW_URL }}
          K6_PROMETHEUS_RW_USERNAME: ${{ secrets.PROM_USER }}
          K6_PROMETHEUS_RW_PASSWORD: ${{ secrets.PROM_PASSWORD }}
      - name: Slack notify on failure
        if: failure()
        run: |
          curl -X POST ${{ secrets.SLACK_WEBHOOK }} \
            -H 'Content-Type: application/json' \
            -d '{"text": "Nightly perf test failed: ${{ github.run_id }}"}'
```

**Key points:**
- `--quiet` reduces noise; `--summary-export` produces machine-readable results.
- Stream to Prometheus for time-series history (don't only save artifacts).
- Smoke runs on every PR; load runs nightly via cron.
- Always upload the summary artifact — even on failure — for debugging.

---

## GitLab CI — k6 example

```yaml
stages:
  - test
  - perf

perf-smoke:
  stage: perf
  image: grafana/k6:latest
  script:
    - k6 run --summary-export=summary.json tests/smoke.js
  artifacts:
    when: always
    paths: [summary.json]
    expire_in: 30 days
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
```

---

## Threshold strategies — fail fast vs build trends

**Hard thresholds** (fail the build):
```javascript
thresholds: {
  'http_req_duration{name:critical}': ['p(95)<300', 'abortOnFail: true'],
  'http_req_failed': [{ threshold: 'rate<0.001', abortOnFail: true }],
}
```
Use for: critical user journeys, regulated SLAs.

**Soft thresholds** (warn, don't fail):
- Lower thresholds that record trends but don't fail the run.
- Compare today's run to a 7-day baseline programmatically.
- Fail the build only if regression > 20% sustained for 2 consecutive runs.

A common compromise: hard thresholds for critical journeys, soft thresholds for everything else. Don't fail builds on noise — but don't ignore drift either.

---

## Comparing runs — regression detection

Naive approach: hard threshold per run. Problem: noise causes flakes.

**Better:** compare to a rolling baseline.

```javascript
// In a custom analysis step (Node script that reads summary.json)
const current = require('./summary.json');
const baseline = await fetch('https://perf-baseline-store/api/last-7-days');

const regression = (current.p95 - baseline.p95_p90) / baseline.p95_p90;
if (regression > 0.20) {
  console.error(`p95 regressed ${(regression*100).toFixed(1)}% vs 7-day p90 baseline`);
  process.exit(1);
}
```

For Prometheus-stored results:
```promql
# Today's p95 vs 7-day average
(
  histogram_quantile(0.95, rate(http_req_duration_bucket{run_id="$CURRENT"}[1h]))
  /
  avg_over_time(
    histogram_quantile(0.95, rate(http_req_duration_bucket[1h]))[7d:]
  )
) > 1.2
```

---

## What to gate on

Don't gate on every metric — pick a tight set:

| Tier | Gate on |
|------|---------|
| Always | Error rate, p95 latency on critical journeys |
| Often | p99 latency, throughput sustained |
| Sometimes | p99.9 (very noisy unless you have huge sample size), saturation metrics |
| Rarely | Mean latency (use percentiles), individual endpoint p50 |

---

## Pre-deploy canary perf check

Beyond pipeline gates, validate in production with a canary:

1. Deploy to 1-5% of traffic.
2. Compare canary metrics vs control (same instance class, same endpoints) for 5-15 min.
3. Auto-rollback if:
   - Error rate increases > X%
   - p99 latency increases > Y%
   - Saturation metric (CPU, GC) degrades

Tools: Argo Rollouts (k8s), Spinnaker Kayenta, AWS CodeDeploy with CloudWatch alarms.

---

## Anti-patterns

- **Heavy load tests on every PR**: slows the team, costs money, doesn't catch enough extra to justify.
- **No baseline comparison**: every run is judged in isolation, so noise causes false fails.
- **Gating on means**: noise + tail-blindness = bad gates.
- **Ignoring soak in CI**: GC pathologies and leaks only appear in long runs. At least weekly.
- **Running tests against production without rate limiting**: customer impact and noisy data.
- **No artifact retention**: when a regression slips through, you can't go back and analyze.
- **Vague thresholds** ("fast enough"): every threshold must be measurable.

---

## Cost optimization for cloud-hosted perf testing

Performance testing in cloud is non-trivial cost. Common practices:

1. **Spot / preemptible instances for load generators** — interruption tolerance is fine for short tests.
2. **Scale up the SUT before the test, scale down after** — automate via IaC.
3. **AWS Performance Insights / similar APMs**: enable during test, disable after — they're billed by retention.
4. **Distribute load generators by AZ/region** for realistic geographic latency, but cap to avoid cross-AZ data transfer costs.
5. **Reuse generator infra**: a long-lived k6 cluster with scheduled jobs amortizes setup cost vs spinning up per-test.
