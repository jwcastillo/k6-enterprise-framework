---
title: Consumer Pipelines
sidebar_position: 3
description: Copy-paste GitHub Actions and GitLab CI recipes for product teams consuming the k6 framework Docker image
---

# Consumer Pipelines

This guide is for a product team that wants to run load tests against **its own application** by pulling the framework's published Docker image. Every example uses the placeholder `registry.example.com/k6-framework:VERSION` — substitute your registry, repository, and tag. The image source lives at `infrastructure/k8s/Dockerfile`.

If you are looking for the framework's **self-test** patterns (the `perf-smoke.yml`, `perf-gate.yml`, `perf-regression.yml` workflows, the Quality Gates exit-code table, and the `include`-template pattern for testing the framework itself), see [`./ci-cd-integration.md`](./ci-cd-integration.md) — this document deliberately does not repeat that material.

> **Scenario buckets**: every `--scenario=` argument **must** start with one of the canonical buckets — `api`, `flow`, `domain`, `chaos`, or `perf`. The framework's `bin/run-test.sh` validates the prefix and errors on non-canonical buckets. See the **Client Scenarios Taxonomy** section of `CLAUDE.md` for the full canon.

---

## 1. Quick start — running the framework image (local docker run)

Pull the image and run a smoke test against your application from any host with Docker:

```bash
docker run --rm \
  -e K6_CLIENT=my-team \
  -e K6_ENV=staging \
  -e K6_PROFILE=smoke \
  -e K6_REPORTS_DIR=/scripts/reports \
  -e REDIS_HOST=redis.internal \
  -e REDIS_PORT=6379 \
  -e REDIS_PASSWORD=changeme \
  -v "$(pwd)/clients/my-team:/scripts/clients/my-team:ro" \
  -v "$(pwd)/reports:/scripts/reports:rw" \
  registry.example.com/k6-framework:VERSION \
  ./bin/run-test.sh \
    --client=my-team \
    --scenario=api/smoke-users \
    --profile=smoke
```

Mount conventions:

- **Source as read-only** (`:ro`) — the container should never mutate your scenarios on disk.
- **Reports as read-write** (`:rw`) — k6 writes JSON, JUnit, and HTML artifacts here.
- Container paths anchor on `/scripts/`; host paths anchor on `./reports`.

Exit codes from `./bin/run-test.sh`:

| Code | Meaning             | Recommended action          |
|------|---------------------|-----------------------------|
| `0`  | Pass                | Continue pipeline           |
| `1`  | Error               | Investigate infra or config |
| `99` | Thresholds failed   | Block merge / notify team   |
| `107`| Build error         | Fix build, re-run           |

---

## 2. GitHub Actions — Manual parameterized run (workflow_dispatch)

Drop this file at `.github/workflows/manual-load-test.yml` in your **product** repo. It exposes a form in the Actions UI so a developer can pick client, scenario, profile, env, and override VUs or duration:

```yaml
name: Manual Load Test

on:
  workflow_dispatch:
    inputs:
      client:
        description: Client name (matches clients/<name>/)
        type: string
        required: true
        default: my-team
      scenario:
        description: Scenario path (must start with api/|flow/|domain/|chaos/|perf/)
        type: string
        required: true
        default: api/smoke-users
      profile:
        description: Load profile
        type: choice
        required: true
        default: smoke
        options: [smoke, quick, load, capacity, stress, soak]
      env:
        description: Target environment
        type: choice
        required: true
        default: staging
        options: [default, staging, production]
      vus_override:
        description: Override VUs (optional integer)
        type: string
        required: false
        default: ""
      duration_override:
        description: Override duration (e.g. 5m, optional)
        type: string
        required: false
        default: ""

jobs:
  run:
    runs-on: ubuntu-latest
    container:
      image: registry.example.com/k6-framework:VERSION
    steps:
      - uses: actions/checkout@v4

      - name: Run k6
        env:
          K6_CLIENT: ${{ inputs.client }}
          K6_ENV: ${{ inputs.env }}
          K6_PROFILE: ${{ inputs.profile }}
          K6_REPORTS_DIR: ./reports
          K6_VUS_OVERRIDE: ${{ inputs.vus_override }}
          K6_DURATION_OVERRIDE: ${{ inputs.duration_override }}
        run: |
          ./bin/run-test.sh \
            --client=${{ inputs.client }} \
            --scenario=${{ inputs.scenario }} \
            --profile=${{ inputs.profile }} \
            --env=${{ inputs.env }}

      - name: Upload reports
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: k6-reports-${{ github.run_id }}
          path: ./reports
          retention-days: 14
```

Matrix variant — sweep multiple scenarios and environments in a single dispatch:

```yaml
jobs:
  matrix-run:
    runs-on: ubuntu-latest
    container:
      image: registry.example.com/k6-framework:VERSION
    strategy:
      fail-fast: false
      matrix:
        scenario: [api/smoke-users, flow/checkout, domain/orders/lifecycle]
        env: [staging, production]
    steps:
      - uses: actions/checkout@v4
      - name: Run k6
        env:
          K6_CLIENT: my-team
          K6_ENV: ${{ matrix.env }}
          K6_PROFILE: smoke
          K6_REPORTS_DIR: ./reports
        run: |
          ./bin/run-test.sh \
            --client=my-team \
            --scenario=${{ matrix.scenario }} \
            --profile=smoke \
            --env=${{ matrix.env }}
      - uses: actions/upload-artifact@v4
        with:
          name: k6-reports-${{ matrix.env }}-${{ strategy.job-index }}
          path: ./reports
```

---

## 3. GitHub Actions — Post-deploy hook (workflow_call)

Pattern: your product repo's `deploy.yml` calls a reusable load-test workflow that lives in a **shared** k6-tests repo. The smoke job always runs first; only if it passes does the configured perf-gate scenario run.

Caller side — in your product repo's `.github/workflows/deploy.yml`:

```yaml
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Deploy app
        run: ./deploy.sh

  load-test:
    needs: deploy
    uses: org/k6-tests-repo/.github/workflows/post-deploy-load.yml@main
    with:
      deployed_version: ${{ github.sha }}
      target_env: staging
      base_url: https://staging.example.com
      scenario: flow/checkout
      profile: load
    secrets: inherit
```

Receiver side — at `org/k6-tests-repo/.github/workflows/post-deploy-load.yml`:

```yaml
name: Post-Deploy Load Test

on:
  workflow_call:
    inputs:
      deployed_version:
        type: string
        required: true
      target_env:
        type: string
        required: true
      base_url:
        type: string
        required: true
      scenario:
        type: string
        required: true
      profile:
        type: string
        required: true

jobs:
  smoke:
    runs-on: ubuntu-latest
    container:
      image: registry.example.com/k6-framework:VERSION
    steps:
      - uses: actions/checkout@v4
      - name: Smoke against deployed version
        env:
          K6_CLIENT: my-team
          K6_ENV: ${{ inputs.target_env }}
          K6_PROFILE: smoke
          K6_REPORTS_DIR: ./reports
        run: |
          ./bin/run-test.sh \
            --client=my-team \
            --scenario=api/smoke-users \
            --profile=smoke \
            --env=${{ inputs.target_env }}
      - uses: actions/upload-artifact@v4
        with:
          name: smoke-${{ inputs.deployed_version }}
          path: ./reports

  perf-gate:
    needs: smoke
    runs-on: ubuntu-latest
    container:
      image: registry.example.com/k6-framework:VERSION
    steps:
      - uses: actions/checkout@v4
      - name: Perf gate
        env:
          K6_CLIENT: my-team
          K6_ENV: ${{ inputs.target_env }}
          K6_PROFILE: ${{ inputs.profile }}
          K6_REPORTS_DIR: ./reports
        run: |
          ./bin/run-test.sh \
            --client=my-team \
            --scenario=${{ inputs.scenario }} \
            --profile=${{ inputs.profile }} \
            --env=${{ inputs.target_env }}
      - uses: actions/upload-artifact@v4
        with:
          name: perf-${{ inputs.deployed_version }}
          path: ./reports
```

---

## 4. GitHub Actions — Scheduled cron

GitHub Actions cron expressions evaluate in **UTC only** (per the GitHub Actions documentation on scheduled events). Convert local time to UTC before encoding the schedule, and document the human-friendly interpretation in a comment.

```yaml
name: Scheduled Load Tests

on:
  schedule:
    # Nightly load against staging — 02:00 UTC daily
    - cron: "0 2 * * *"
    # Weekly capacity test — Sundays at 03:00 UTC
    - cron: "0 3 * * 0"
    # Business-hours soak — Mon–Fri at 13:00 UTC ≈ 08:00 America/New_York
    - cron: "0 13 * * 1-5"

jobs:
  scheduled:
    runs-on: ubuntu-latest
    container:
      image: registry.example.com/k6-framework:VERSION
    env:
      TZ: America/New_York
      K6_CLIENT: my-team
      K6_ENV: staging
      K6_REPORTS_DIR: ./reports
    steps:
      - uses: actions/checkout@v4

      - name: Nightly load
        if: github.event.schedule == '0 2 * * *'
        env:
          K6_PROFILE: load
        run: |
          ./bin/run-test.sh \
            --client=my-team \
            --scenario=flow/checkout \
            --profile=load \
            --env=staging

      - name: Weekly capacity
        if: github.event.schedule == '0 3 * * 0'
        env:
          K6_PROFILE: capacity
        run: |
          ./bin/run-test.sh \
            --client=my-team \
            --scenario=perf/capacity \
            --profile=capacity \
            --env=staging

      - name: Business-hours soak
        if: github.event.schedule == '0 13 * * 1-5'
        env:
          K6_PROFILE: soak
        run: |
          ./bin/run-test.sh \
            --client=my-team \
            --scenario=perf/soak \
            --profile=soak \
            --env=staging

      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: scheduled-${{ github.run_id }}
          path: ./reports
```

---

## 5. GitLab CI — Manual parameterized job

Add this snippet to your product repo's `.gitlab-ci.yml`. The job stays idle until a developer clicks **Run** in the Pipelines UI and supplies the variables.

```yaml
load-test:manual:
  image: registry.example.com/k6-framework:VERSION
  when: manual
  variables:
    CLIENT: my-team
    SCENARIO: api/smoke-users
    PROFILE: smoke
    ENV: staging
    K6_REPORTS_DIR: reports
  script:
    - ./bin/run-test.sh --client=$CLIENT --scenario=$SCENARIO --profile=$PROFILE --env=$ENV
  artifacts:
    when: always
    expire_in: 30 days
    paths:
      - reports/
    reports:
      # If the framework emits JUnit XML, GitLab will surface it in the pipeline UI
      junit: reports/**/junit.xml
```

---

## 6. GitLab CI — Multi-project pipeline (post-deploy trigger)

Caller side — in your product repo's `.gitlab-ci.yml`:

```yaml
trigger-load-test:
  stage: post-deploy
  needs: [deploy]
  variables:
    DEPLOYED_VERSION: $CI_COMMIT_SHA
    TARGET_ENV: staging
    BASE_URL: https://staging.example.com
    SCENARIO: flow/checkout
    PROFILE: load
  trigger:
    project: org/k6-tests-repo
    branch: main
    strategy: depend
```

Receiver side — in `org/k6-tests-repo/.gitlab-ci.yml`:

```yaml
post-deploy-load:
  image: registry.example.com/k6-framework:VERSION
  variables:
    K6_CLIENT: my-team
    K6_REPORTS_DIR: reports
  script:
    - echo "Testing version $DEPLOYED_VERSION against $BASE_URL"
    - ./bin/run-test.sh --client=$K6_CLIENT --scenario=$SCENARIO --profile=$PROFILE --env=$TARGET_ENV
  artifacts:
    when: always
    expire_in: 30 days
    paths:
      - reports/
```

---

## 7. GitLab CI — Scheduled pipelines

GitLab cron schedules live in the Pipeline Schedules UI (project → **Build** → **Pipeline Schedules**), **not** in YAML. Set a custom CI variable on each schedule — by convention, `SCHEDULE_NAME` — and fan out the jobs by matching it in `rules:`.

```yaml
workflow:
  rules:
    - if: $CI_PIPELINE_SOURCE == "schedule"

.scheduled_base:
  image: registry.example.com/k6-framework:VERSION
  variables:
    K6_CLIENT: my-team
    K6_ENV: staging
    K6_REPORTS_DIR: reports
  artifacts:
    when: always
    expire_in: 30 days
    paths:
      - reports/

nightly-load:
  extends: .scheduled_base
  rules:
    - if: $SCHEDULE_NAME == "nightly"
  script:
    - ./bin/run-test.sh --client=$K6_CLIENT --scenario=flow/checkout --profile=load --env=$K6_ENV

weekly-capacity:
  extends: .scheduled_base
  rules:
    - if: $SCHEDULE_NAME == "weekly-capacity"
  script:
    - ./bin/run-test.sh --client=$K6_CLIENT --scenario=perf/capacity --profile=capacity --env=$K6_ENV

business-hours-soak:
  extends: .scheduled_base
  rules:
    - if: $SCHEDULE_NAME == "business-hours-soak"
  variables:
    TZ: America/New_York
  script:
    - ./bin/run-test.sh --client=$K6_CLIENT --scenario=perf/soak --profile=soak --env=$K6_ENV
```

> The three cron cadences (nightly, weekly, business-hours) are configured in the GitLab UI, identical to the GitHub schedule expressions in section 4.

---

## 8. Publishing results to a bucket

The container writes artifacts to the directory pointed at by `K6_REPORTS_DIR` (default `./reports`). After the test step, sync that directory to S3, GCS, or Azure Blob. Use a per-run prefix (`$GITHUB_RUN_ID` or `$CI_PIPELINE_ID`) so historical runs stay separable. `actions/upload-artifact@v4` with `retention-days:` is still useful for transient pull-request artifacts even when you archive to a bucket.

### GitHub Actions

```yaml
      - name: Publish reports to S3
        uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-region: us-east-1
          role-to-assume: ${{ secrets.AWS_ROLE_ARN }}
      - run: aws s3 sync ./reports s3://bucket-name/$GITHUB_RUN_ID/
```

```yaml
      - name: Publish reports to GCS
        uses: google-github-actions/auth@v2
        with:
          workload_identity_provider: ${{ secrets.GCP_WIP }}
          service_account: ${{ secrets.GCP_SA_EMAIL }}
      - run: gsutil -m rsync -r ./reports gs://bucket-name/$GITHUB_RUN_ID/
```

```yaml
      - name: Publish reports to Azure Blob
        uses: azure/login@v2
        with:
          creds: ${{ secrets.AZURE_CREDENTIALS }}
      - run: az storage blob upload-batch --source ./reports --destination bucket-name --destination-path $GITHUB_RUN_ID
```

### GitLab CI

Use masked CI/CD variables (project → **Settings** → **CI/CD** → **Variables**, mark them **Masked** and **Protected**).

```yaml
publish-s3:
  image: registry.example.com/k6-framework:VERSION
  script:
    - aws s3 sync reports/ s3://bucket-name/$CI_PIPELINE_ID/
```

```yaml
publish-gcs:
  image: registry.example.com/k6-framework:VERSION
  script:
    - echo "$GCP_SA_KEY" | gcloud auth activate-service-account --key-file=-
    - gsutil -m rsync -r reports/ gs://bucket-name/$CI_PIPELINE_ID/
```

```yaml
publish-azure:
  image: registry.example.com/k6-framework:VERSION
  script:
    - az storage blob upload-batch --source reports --destination bucket-name --destination-path $CI_PIPELINE_ID --account-key $AZURE_STORAGE_KEY
```

---

## 9. Posting results as PR/MR comments

Both platforms can post a one-line table back to the pull request or merge request. Extract `p(95)`, error rate, and SLO status from the framework's JSON summary (the exact schema is defined in `src/reporting/json-summary-generator.ts` — the JSON paths shown below are illustrative).

Rendered table both platforms produce (one canonical example):

```markdown
| Metric         | Value   | Threshold | Status |
|----------------|---------|-----------|--------|
| p95 latency    | 312 ms  | < 500 ms  | pass   |
| Error rate     | 0.42 %  | < 1.00 %  | pass   |
| SLO            | met     | —         | pass   |
```

### GitHub Actions

```yaml
      - name: Build summary
        id: summary
        run: |
          P95=$(jq -r '.metrics.http_req_duration.values["p(95)"] | tonumber | floor' reports/summary.json)
          ERR=$(jq -r '.metrics.http_req_failed.values.rate * 100 | tonumber | . * 100 | floor / 100' reports/summary.json)
          SLO=$(jq -r '.slo.status // "unknown"' reports/summary.json)
          {
            echo "| Metric | Value | Threshold | Status |"
            echo "|--------|-------|-----------|--------|"
            echo "| p95 latency | ${P95} ms | < 500 ms | $( [ "$P95" -lt 500 ] && echo pass || echo fail ) |"
            echo "| Error rate | ${ERR} % | < 1.00 % | $( awk "BEGIN{print ($ERR<1)?\"pass\":\"fail\"}" ) |"
            echo "| SLO | ${SLO} | — | ${SLO} |"
          } > pr-comment.md

      - name: Upsert sticky PR comment
        uses: marocchino/sticky-pull-request-comment@v2
        with:
          header: load-test
          path: pr-comment.md
```

### GitLab CI

```yaml
post-mr-note:
  image: registry.example.com/k6-framework:VERSION
  rules:
    - if: $CI_MERGE_REQUEST_IID
  script:
    - |
      P95=$(jq -r '.metrics.http_req_duration.values["p(95)"] | tonumber | floor' reports/summary.json)
      ERR=$(jq -r '.metrics.http_req_failed.values.rate * 100' reports/summary.json)
      SLO=$(jq -r '.slo.status // "unknown"' reports/summary.json)
      NOTE_BODY=$(printf '<!-- load-test -->\n| Metric | Value | Threshold | Status |\n|--------|-------|-----------|--------|\n| p95 latency | %s ms | < 500 ms | %s |\n| Error rate | %s %% | < 1.00 %% | %s |\n| SLO | %s | — | %s |' "$P95" "$( [ "$P95" -lt 500 ] && echo pass || echo fail )" "$ERR" "$( awk "BEGIN{print ($ERR<1)?\"pass\":\"fail\"}" )" "$SLO" "$SLO")
    - |
      curl --request POST \
        --header "PRIVATE-TOKEN: $GITLAB_TOKEN" \
        "$CI_API_V4_URL/projects/$CI_PROJECT_ID/merge_requests/$CI_MERGE_REQUEST_IID/notes" \
        --form "body=$NOTE_BODY"
```

Optional — instead of appending a fresh note every run, search for the previous comment by its marker (`<!-- load-test -->`) and update it in place:

```yaml
      - |
        EXISTING=$(curl --silent --header "PRIVATE-TOKEN: $GITLAB_TOKEN" \
          "$CI_API_V4_URL/projects/$CI_PROJECT_ID/merge_requests/$CI_MERGE_REQUEST_IID/notes?per_page=100" \
          | jq -r '.[] | select(.body | startswith("<!-- load-test -->")) | .id' | head -n 1)
        if [ -n "$EXISTING" ]; then
          curl --request PUT \
            --header "PRIVATE-TOKEN: $GITLAB_TOKEN" \
            "$CI_API_V4_URL/projects/$CI_PROJECT_ID/merge_requests/$CI_MERGE_REQUEST_IID/notes/$EXISTING" \
            --form "body=$NOTE_BODY"
        else
          curl --request POST \
            --header "PRIVATE-TOKEN: $GITLAB_TOKEN" \
            "$CI_API_V4_URL/projects/$CI_PROJECT_ID/merge_requests/$CI_MERGE_REQUEST_IID/notes" \
            --form "body=$NOTE_BODY"
        fi
```

Appending a fresh note every run is simpler; the search-then-`PUT` pattern is only worth it when reviewers complain about comment noise.

---

## 10. Notifications (Slack / Teams / Webhook)

After a test run finishes, you usually want to push a one-line verdict (pass/fail, p95, error rate) to Slack, Microsoft Teams, or a generic webhook. The framework gives you two entry points and a small set of canonical env vars — pick the one that matches *where* the notification needs to fire.

### 10.1 Architecture overview

Two entry points the framework provides:

- **`bin/notify.js`** — Node.js CLI for **post-run** notifications. Reads the JSON summary written by `bin/run-test.sh`, formats it for the target platform, and POSTs it to a Slack / Teams / generic incoming webhook. Use this from CI as the **last step** of a pipeline (after the test step, with `if: always()` / `when: always`) so the verdict is sent even on failure.
- **`src/integrations/notification-service.ts`** (`NotificationService` class) — **runtime**, in-k6 multi-channel sender. Supports Block Kit formatting, retries (1–3, exponential backoff), conditions (`always | on_failure | on_regression`), and is SSRF-guarded via `src/integrations/webhook-validator.ts` before every send. Use this from inside a scenario's `teardown()` when the notification must originate from the test process itself.

Both paths share the same canonical `NOTIFY_*` env vars (see 10.2) so the same CI secret can feed either entry point.

### 10.2 Canonical env vars

| Var | Purpose |
|---|---|
| `NOTIFY_SLACK_WEBHOOK` | Slack incoming webhook URL |
| `NOTIFY_EMAIL_TO` | Recipient address for the email channel |
| `NOTIFY_EMAIL_ENDPOINT` | HTTP endpoint that delivers the email |
| `NOTIFY_WEBHOOK_URL` | Generic webhook URL |

> **Note:** CI secret names can be anything — the framework reads `NOTIFY_*` only when invoked directly with no `--webhook` override. In CI you typically pass `--webhook=$WHATEVER_SECRET_NAME` to `bin/notify.js` (for example `--webhook=${{ secrets.NOTIFY_SLACK_WEBHOOK }}`) and the CLI never reads the env var at all.

### 10.3 GitHub Actions example

Append a `notify` step after your existing test step. The step uses `if: always()` so it runs even when the upstream test step failed; the framework image is invoked the same way as in section 2, but the entrypoint is `node bin/notify.js`:

```yaml
jobs:
  run:
    runs-on: ubuntu-latest
    container:
      image: registry.example.com/k6-framework:VERSION
    steps:
      - uses: actions/checkout@v4

      - name: Run k6
        env:
          K6_CLIENT: my-team
          K6_ENV: staging
          K6_PROFILE: smoke
          K6_REPORTS_DIR: ./reports
        run: |
          ./bin/run-test.sh \
            --client=my-team \
            --scenario=api/smoke-users \
            --profile=smoke \
            --env=staging

      - name: Notify Slack
        if: always()
        env:
          WEBHOOK: ${{ secrets.NOTIFY_SLACK_WEBHOOK }}
        run: |
          node bin/notify.js \
            --result=./reports/summary.json \
            --webhook=$WEBHOOK \
            --platform=slack
```

If you prefer the standalone-`docker run` pattern from section 1 (host-side, not `jobs.<id>.container`), the same call looks like:

```bash
docker run --rm \
  -v $PWD/reports:/work/reports \
  registry.example.com/k6-framework:VERSION \
  node bin/notify.js \
    --result=/work/reports/summary.json \
    --webhook=$WEBHOOK \
    --platform=slack
```

`bin/notify.js` exits `0` on success or `--dry-run`, and `1` on error. Keep the step's `if: always()` so a failing test still triggers the notification.

### 10.4 GitLab CI example

Put the notify call in a separate job in a later stage with `when: always`, and pull the test artifacts via `dependencies:` so `reports/summary.json` is available:

```yaml
stages:
  - test
  - notify

load-test:
  stage: test
  image: registry.example.com/k6-framework:VERSION
  variables:
    K6_CLIENT: my-team
    K6_REPORTS_DIR: reports
  script:
    - ./bin/run-test.sh --client=my-team --scenario=api/smoke-users --profile=smoke --env=staging
  artifacts:
    when: always
    expire_in: 30 days
    paths:
      - reports/

notify-slack:
  stage: notify
  image: registry.example.com/k6-framework:VERSION
  when: always
  dependencies:
    - load-test
  variables:
    # Configure NOTIFY_SLACK_WEBHOOK as a masked, protected CI/CD variable
    # (Settings → CI/CD → Variables → Masked + Protected).
    PLATFORM: slack
  script:
    - node bin/notify.js --result=reports/summary.json --webhook=$NOTIFY_SLACK_WEBHOOK --platform=$PLATFORM
```

The masked `NOTIFY_SLACK_WEBHOOK` variable is read straight from the GitLab CI/CD settings — no need to pass it through the script.

### 10.5 Conditions

Two layers control "when does a notification fire":

- **CI layer** — `if: failure()` / `if: success()` / `if: always()` (GitHub Actions) and `when: on_failure | on_success | always` (GitLab CI). Use this layer when calling `bin/notify.js` from a CI step. It is the simplest path: the verdict is computed by the upstream test step's exit code, and CI decides whether the notify step runs.
- **Framework layer (runtime)** — `NotificationConfig.conditions = "always" | "on_failure" | "on_regression"`. Use this layer when invoking `NotificationService` from a scenario's `teardown()`. The condition is evaluated against the payload's `verdict` field inside the k6 process:

```typescript
import { NotificationService } from "../../src/integrations/notification-service";

export function teardown(data: { payload: NotificationPayload }): void {
  const svc = new NotificationService({ channels: ["slack"], conditions: "on_failure" });
  svc.notify(data.payload);
}
```

`on_regression` is the same predicate as `on_failure` from the service's perspective — the regression decision is made upstream and reflected in `payload.verdict`.

### 10.6 Multi-channel fan-out

- **CLI** — chain one `bin/notify.js` invocation per channel:

  ```bash
  node bin/notify.js --result=reports/summary.json --webhook=$NOTIFY_SLACK_WEBHOOK   --platform=slack
  node bin/notify.js --result=reports/summary.json --webhook=$NOTIFY_TEAMS_WEBHOOK   --platform=teams
  node bin/notify.js --result=reports/summary.json --webhook=$NOTIFY_WEBHOOK_URL     --platform=generic
  ```

- **Runtime** — a single `NotificationService` call fans out across all configured channels in one go:

  ```typescript
  const svc = new NotificationService({
    channels: ["slack", "email", "webhook"],
    conditions: "on_failure",
  });
  svc.notify(payload);
  ```

  A failure on one channel is logged but does not block the other channels.

### 10.7 Block Kit preview

The Slack message rendered by `bin/notify.js` (and by `SlackFormatter` inside `NotificationService`) is a Block Kit message. The rendered preview looks like:

```
┌─ k6 Load Test Result ────────────────────────────────┐
│ ❌  FAIL                                              │
├──────────────────────────────────────────────────────┤
│ verdict       fail                                   │
│ p95           812 ms       (threshold < 500 ms)      │
│ error rate    1.42 %       (threshold < 1.00 %)      │
├──────────────────────────────────────────────────────┤
│ run_id   42 · client my-team · scenario api/smoke-users · profile smoke │
└──────────────────────────────────────────────────────┘
```

The mockup is illustrative — the actual field set comes from `SlackFormatter` in `src/integrations/notification-service.ts`.

See also [ci-cd-integration.md § 5.1 Slack](./ci-cd-integration.md#51-slack) for field-level Block Kit details.

### 10.8 Security

- **`webhook-validator.ts` blocks SSRF targets** — RFC1918 (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16), loopback (127.0.0.0/8, `::1`), link-local 169.254.0.0/16 (cloud metadata service), and IPv6 ULA `fc00::/7`. A POST to any of those addresses fails at the `assertWebhookAllowed` check before the request leaves the process.
- **Mask webhook URLs as CI secrets** — GitHub: `Settings → Secrets and variables → Actions`; GitLab: mark each `NOTIFY_*` variable **Masked** and **Protected**. Never inline a webhook URL in YAML or commit it to a `.env` file.
- **Pin the framework image by digest in production** — same rule as the rest of this guide (see § 11 Security notes for the digest-pinning command).

---

## 11. Security notes

- **Secrets live in CI/CD masked variables only** — never inline tokens, registry credentials, or `REDIS_PASSWORD` into YAML.
- **Pin the image by SHA256 digest in production** — replace the tag with `registry.example.com/k6-framework@sha256:<digest>`. Fetch the digest with:

  ```bash
  docker buildx imagetools inspect registry.example.com/k6-framework:VERSION
  ```

- **Mount strategy**: source as read-only (`:ro`), reports as writable (`:rw`); avoid `--network=host` unless the target service requires it.
- **Pin third-party Actions to commit SHA in protected workflows** — e.g. `marocchino/sticky-pull-request-comment@<sha>` instead of `@v2`, and the same for `aws-actions/configure-aws-credentials`, `google-github-actions/auth`, `azure/login`.
- **Canonical scenario buckets are enforced by `bin/run-test.sh`** — non-canonical prefixes (anything other than `api/`, `flow/`, `domain/`, `chaos/`, `perf/`) cause the script to exit with code `1`. See the Quality Gates section in [`./ci-cd-integration.md`](./ci-cd-integration.md) and the **Client Scenarios Taxonomy** in `CLAUDE.md`.
- **Run as the non-root UID baked into the image** — the Dockerfile drops to `USER 65534` (nobody/nogroup) per SEC-07. Do not override `USER` in your pipeline, and do not add `--user 0` to `docker run`.

---

### See also

- [`./ci-cd-integration.md`](./ci-cd-integration.md) — framework self-test patterns (Quality Gates, `perf-smoke.yml`, `perf-gate.yml`, `perf-regression.yml`, GitLab `include` template).
- `CLAUDE.md` — Client Scenarios Taxonomy (canonical buckets, full canon).
- `infrastructure/k8s/Dockerfile` — image source (SEC-07 USER 65534, SEC-08 digest pinning, build arg `CLIENT`).
