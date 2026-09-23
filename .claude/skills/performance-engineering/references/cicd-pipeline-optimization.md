# CI/CD pipeline performance optimization

How to optimize the **pipeline itself** for speed, reliability, and cost. The pipeline is a perf-critical system: slow CI = slow developer feedback = slow delivery; slow CD = slow rollback = bigger outages.

Distinct from `cicd-perf-gates.md` (which covers running perf tests *as gates* in the pipeline). This reference is about making the CI/CD system fast, reliable, and cheap.

---

## Why pipeline perf matters

Developer feedback loop dominates productivity:

| CI time | Developer pattern | Cost |
|---------|-------------------|------|
| < 2 min | Stay in flow, iterate fast | Optimal |
| 2-10 min | Context switch to other work, return | Productive but distracted |
| 10-30 min | Significant context loss, batching commits | Quality degrades |
| > 30 min | Wait avoidance: large PRs, "I'll fix it later", stale CI | Quality, velocity, morale all suffer |

For a team of 10 engineers running CI 5×/day, every minute of CI runtime = ~50 dev-minutes/day = ~200h/year. **Pipeline speed has direct, measurable team-wide impact.**

CD speed matters differently — it gates rollback. Slow deploy = slow incident recovery = bigger MTTR = more SLO budget burn.

### DORA metrics — the canonical pipeline KPIs

| Metric | Definition | Targets (Elite team) |
|--------|------------|----------------------|
| **Deployment frequency** | How often successful deploys to prod | Multiple times per day |
| **Lead time for changes** | Commit → production | Less than one hour |
| **Change failure rate** | % of deploys causing production issues | 0-15% |
| **Mean time to recover (MTTR)** | Time to recover from prod incident | Less than one hour |

State these in the engagement brief when CI/CD is in scope. Surface current values and gap to target.

---

## CI optimization

### Build caching — the single biggest lever

| Cache type | What | Where |
|------------|------|-------|
| **Dependency cache** | Maven `.m2`, npm `node_modules`, pip wheels, Gradle cache | Per project, hash on lockfile |
| **Build output cache** | Compiled artifacts, transpiled code | Per project + commit hash for compiled outputs |
| **Test result cache** | Skip tests with unchanged inputs | Bazel/Nx/Turborepo handle this natively |
| **Docker layer cache** | Each `RUN`/`COPY` layer | BuildKit + registry-backed cache |
| **Toolchain cache** | JDK / Node / Go binaries | OS-level or runner-level |

**Rule**: a cold build should be the exception, not the default. Every minute of cached-vs-uncached delta compounds across CI runs.

### Test parallelization

```yaml
# GitHub Actions matrix example — split test suite across 4 runners
strategy:
  matrix:
    shard: [1, 2, 3, 4]
steps:
  - run: ./gradlew test -Dshard=${{ matrix.shard }} -DshardTotal=4
```

| Strategy | When |
|----------|------|
| **Test class parallelization** (JVM) | JUnit 5 `@Execution(CONCURRENT)`, Surefire forkCount |
| **Test shard parallelization** (Jest, pytest, Go test) | Split test files across N workers |
| **Cross-runner parallelization** (matrix) | Different OS / Node version / DB engine in parallel |
| **Parallel build modules** (monorepo) | Bazel / Nx / Turborepo task graphs |

**Common mistake**: parallelizing tests that share state (DB, files) → flakiness. Isolation discipline is required: per-test transactional rollback, per-worker DB schemas, ephemeral file roots.

### Docker layer caching with BuildKit

```dockerfile
# syntax=docker/dockerfile:1.6

FROM node:22-alpine AS base
WORKDIR /app

# Layer 1: package files (changes rarely)
COPY package.json package-lock.json ./

# Mount cache for npm
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev

# Layer 2: source (changes frequently)
COPY . .
RUN npm run build

FROM gcr.io/distroless/nodejs22-debian12
COPY --from=base /app/dist /app
USER nonroot
CMD ["/app/server.js"]
```

Cache hit on layer 1 (package files unchanged) skips the slow `npm ci`. Most builds reduce to "rebuild layer 2" — seconds instead of minutes.

**Registry-backed cache** (`--cache-from`, `--cache-to`) shares cache across runners — even ephemeral CI runners can benefit.

### Monorepo strategies

For monorepos, the question is: which targets changed? Don't rebuild the entire repo on every commit.

| Tool | Language focus | Approach |
|------|----------------|----------|
| **Bazel** | Language-agnostic | Hermetic builds, content-addressed cache, native remote build execution |
| **Nx** | JS/TS-first | Affected target detection from git diff, distributed task execution |
| **Turborepo** | JS-first | Incremental build, remote caching via Vercel or self-host |
| **Pants** | Python + others | Like Bazel, Python-focused initially |
| **Pulumi automation API** | Infra | "Cross-stack" change detection for IaC |

For most teams: `nx affected` or `turbo run --filter=...[origin/main]` in CI reduces full builds to "only what changed."

### Self-hosted vs cloud runners

| Aspect | Cloud (GitHub-hosted, GitLab.com runners) | Self-hosted |
|--------|-------------------------------------------|--------------|
| **Setup** | Zero | Significant |
| **Cold start** | New VM each run (~30s) | Reuse runners (~0s) |
| **Cache locality** | Limited (mostly registry-backed) | Excellent (local disk) |
| **Cost at scale** | Linear with CI volume | Mostly fixed + variable for spikes |
| **Custom hardware** | Limited (GPU, ARM in some) | Full control |
| **Security boundary** | Vendor-managed | Customer-managed |
| **Maintenance** | None | Patching, monitoring, scaling |

**Hybrid model** (most mature shops): cloud runners for default, self-hosted for hot-path workflows (huge builds, GPU jobs, security-isolated workloads).

For self-hosted: **autoscaling on K8s** (Actions Runner Controller, GitLab Kubernetes executor) — spot-pool nodes, scale-to-zero when idle.

### Skip work that doesn't matter

- **Path filters**: `paths:` in workflow — only run frontend tests on frontend changes
- **Draft PRs**: skip full pipeline on `pull_request` if `draft: true`
- **Commit message hints**: `[skip ci]` or `[ci skip]` to bypass full pipeline for docs-only commits (consistent convention)
- **Branch-specific workflows**: full suite on `main`, smoke suite on feature branches

---

## CD optimization

### Deployment strategies

| Strategy | What | When |
|----------|------|------|
| **Rolling update** | Replace pods/instances incrementally | Default for stateless services |
| **Blue/green** | Stand up parallel environment, switch traffic atomically | When zero-downtime atomic switch matters; tested with load |
| **Canary** | Route N% traffic to new version, ramp up | New version risk needs validation under real traffic |
| **Progressive delivery** | Canary + automated promotion based on metrics | Mature platform; metrics-driven gates |
| **Feature flags** | Code deployed but inactive; toggle on/off independently | Decouple deploy from release; risky features |
| **Shadow / mirror** | Send copy of traffic to new version, don't return response | Validate new version with prod traffic without risk |

**Combination patterns**: feature flags + canary is the modern stack — flag controls feature; canary controls deploy. Each rolls back independently.

### GitOps (Argo CD, Flux)

For K8s deployments, declarative GitOps is the dominant pattern:

```
Developer commits → Git → Argo CD watches → Reconciles cluster state
```

Performance characteristics:
- **Sync interval** matters: default 3min Argo CD sync = up to 3min between commit and apply. Tune for prod-critical paths.
- **Webhook-driven sync** for low-latency: GitHub/GitLab webhook → Argo CD sync NOW instead of polling
- **App-of-apps pattern** scales to many services
- **Sync waves** for ordered deployment (e.g., DB migration → app → load balancer)

### Pre-deploy / post-deploy hooks

| Hook | Purpose |
|------|---------|
| **Pre-deploy** | DB migrations, secrets refresh, dependency check |
| **Post-deploy smoke test** | Verify the new version actually serves traffic |
| **Post-deploy soak** | Watch metrics for N minutes; auto-rollback on anomaly |
| **Manual gate** | For prod, require human approval before full traffic shift |

### Rollback automation

- **Argo Rollouts** for K8s: progressive delivery with auto-rollback on metrics breach
- **Spinnaker** for multi-cloud canary with built-in metric gates
- **GitOps revert**: `git revert` triggers re-sync — rollback as a normal commit
- **Database migration rollback**: trickier — every schema change must have a documented downgrade path; use tools that enforce (Flyway, Liquibase)

**Critical**: rollback must be tested. A rollback procedure that's never run will fail when you need it. Periodic chaos drill: deploy a known-bad version to staging, verify auto-rollback. See `resilience-chaos-testing.md`.

### Deploy gates

Common gates that should be in the pipeline (not just docs):

- [ ] Unit tests pass
- [ ] Integration tests pass
- [ ] Code coverage above threshold (only if measured meaningfully)
- [ ] Static analysis / linter passes
- [ ] Security scan passes (Snyk, Trivy, GitHub Advanced Security)
- [ ] Container image vulnerability scan
- [ ] License compliance check
- [ ] Cost diff in PR (Infracost, if applicable)
- [ ] Performance regression check vs baseline (k6 smoke, see `cicd-perf-gates.md`)
- [ ] Manual approval for prod (humans in the loop for high-risk changes)

**Anti-pattern**: gates that always pass (rubber-stamp). A "100% passing" gate that's never failed is suspicious. Either the gate is too lax (let everything through) or actually working (never breaks). Verify.

---

## Pipeline observability

### Metrics to track

| Metric | Where |
|--------|-------|
| Build duration (p50/p95/p99) | Per workflow, per job |
| Test duration (top 20 slowest) | Track over time; flag regressions |
| Cache hit rate | Validates caching strategy |
| Flaky test rate | Catch flakiness early; flag for fix |
| Pipeline cost ($) | Especially on cloud runners; per workflow |
| Deploy frequency | DORA metric |
| Lead time (commit → prod) | DORA metric |
| Change failure rate | DORA metric — % of deploys that caused incident |
| MTTR | DORA metric — incident detection → resolution |
| Queue depth | Time a job waits before a runner picks it up |
| Concurrent jobs | Capacity utilization on self-hosted |

### Tooling

| Tool | What |
|------|------|
| **GitHub Actions Insights** | Native: build duration, failure rate |
| **GitLab CI/CD Analytics** | Similar built-in |
| **Jenkins build time analyzer** | Plugin |
| **Datadog CI Visibility** | Cross-CI observability |
| **CircleCI Insights** | If on CircleCI |
| **Honeycomb for CI** | Trace-based pipeline observability |
| **Dora-DX (open-source)** | Computes DORA metrics from git + deploy logs |
| **DX, LinearB** | Developer productivity metrics including pipeline |

---

## Platform-specific

### GitHub Actions

**Performance levers:**
- Action caching: `actions/cache@v4` for dependencies (always include lockfile hash in cache key)
- Artifact upload/download for cross-job state — but compress; uploads are slow at GB scale
- **Concurrency**: `concurrency:` block prevents queue pile-up — cancel-in-progress for PR workflows
- **Reusable workflows**: extract common steps; reduce duplication, improve cache reuse
- **Matrix limits**: `max-parallel: N` prevents accidentally saturating runners
- **Larger runners** (paid): GitHub-hosted with more CPU/RAM for compute-heavy jobs

**Cost levers:**
- Public repo: free
- Private repo: minutes-based pricing; ARM and Linux are cheapest; Windows and macOS expensive (multipliers)
- Self-hosted: only marketplace costs, none for compute (you bring the infra)
- **`runs-on`** choice matters: `ubuntu-latest` cheapest, `macos-latest` most expensive (10×)

### GitLab CI

- **Pipeline caching**: configure `cache:key:files:` to invalidate on lockfile change
- **Parent-child pipelines**: split monolithic pipeline into smaller, conditionally triggered ones
- **DAG pipelines** (`needs:`): explicit dependencies, parallel where possible
- **Auto-cancel redundant pipelines**: when pushing twice to same branch, cancel old
- **GitLab Kubernetes executor**: scale runners on K8s with autoscaling

### Jenkins

- **Parallel stages**: `parallel { ... }` for concurrent steps
- **Agent allocation**: don't tie up master; offload to agent nodes
- **Pipeline libraries**: shared library reduces duplication
- **Build agents on K8s**: same autoscaling pattern as GitHub/GitLab self-hosted

### Argo CD / Flux

- **Sync waves**: ordered deployment for dependent resources
- **Sync windows**: deploy only in approved time windows
- **App-of-apps**: hierarchical management for hundreds of services
- **Resource hooks**: pre-sync (migrations), sync (deploy), post-sync (smoke), sync-fail (rollback)
- **Auto-prune**: remove resources that no longer exist in Git (with caution in prod)

### Spinnaker

- **Pipeline templates**: reusable across services
- **Built-in canary gates**: Kayenta automated analysis
- **Multi-cloud**: deploy to AWS + GCP + Azure from one pipeline
- **Slow for small teams**: high operational cost; consider Argo Rollouts instead for K8s-only

---

## Common pipeline anti-patterns

- **Cache key includes timestamp** → invalidates every run, defeats caching
- **Tests run sequentially** when they could parallelize (esp. integration tests with isolated DBs)
- **Same pipeline runs on every commit** to long-running branches → wasted compute
- **Full E2E suite on every PR** → 30min pipeline scares off contributors; move to nightly + smoke for PRs
- **Docker layer ordering wrong** → `COPY .` before `npm install` invalidates cache on every code change
- **Tests have side effects** → flakiness as the suite grows; isolation discipline required
- **Secrets re-fetched every step** → use job-level setup once
- **Re-pulling base images** → caching base image in registry
- **No artifact reuse between jobs** → compile in CI, recompile in test, recompile in deploy
- **Pipeline failure doesn't fail loud** → silent green builds with skipped tests are dangerous
- **No flaky test quarantine** → flakiness erodes trust; quarantine + dedicated fix lane
- **Self-hosted runners always-on** → pay for idle compute; use autoscaling
- **`docker run --rm` for testing** when `docker-compose` would parallelize → wasted setup time

---

## CI/CD optimization workflow for PE engagements

### Audit phase (week 1)

1. **Measure baseline**: pipeline duration p95, deploy frequency, lead time, change failure rate
2. **Identify hot path workflows** — which 3-5 workflows account for 80% of CI minutes?
3. **Cache hit rate**: are caches working? If hit rate < 70%, that's the first fix
4. **Test duration profile**: top 20 slowest tests — these contain most of the optimization potential
5. **Cost analysis**: runner cost per month; cost per build; cost trend

### Quick wins (week 2)

1. **Fix obvious cache misses** (lockfile hash in key, restore-keys properly ordered)
2. **Parallelize the longest test suite**
3. **Move slow tests to a nightly job** (E2E, browser tests with slow startup)
4. **Skip workflows on doc-only commits**
5. **Move deps install to a cached step**

### Structural improvements (week 3+)

1. **Migrate to BuildKit + registry-backed Docker cache**
2. **Adopt monorepo tooling** if a monorepo: Nx, Turborepo, Bazel
3. **Self-hosted runners** for hot-path workflows
4. **Concurrency limits** to prevent runner saturation
5. **Reusable workflows** for shared logic
6. **Artifact-based handoff** between jobs (build once, test in parallel)

### CD improvements (week 4+)

1. **GitOps adoption** if not already
2. **Canary deployment** for high-traffic services
3. **Feature flag platform** integration
4. **Auto-rollback on metrics breach** (Argo Rollouts, Spinnaker, custom)
5. **Database migration discipline** with downgrade paths

### Observability for the pipeline

1. **DORA metrics dashboard** — visible to engineering leadership
2. **Per-team pipeline cost** — surface in monthly reviews
3. **Slowest tests dashboard** — kept fresh weekly
4. **Flaky test report** — auto-quarantine + dedicated fix lane

---

## Cost optimization for CI/CD

Pipelines are surprisingly expensive at scale. Common waste:

- **Always-on self-hosted runners** when usage is bursty → autoscale or use cloud runners
- **Slow tests on expensive runners** (macOS for non-Apple-only work)
- **Full E2E suite on every PR** at $0.10/min × 30min × 100 PRs/day = $9k/month
- **Idle Docker registries** (storage costs) → lifecycle policies on old image versions
- **Untargeted nightly builds** (build everything overnight regardless of changes) → use change detection

### CI/CD cost as DevEx metric

Surface "$ per build" and "$ per developer per month" — relates pipeline cost to productivity. A team running 100 builds/dev/month at $5/build = $500/dev/month — visible at engineering leadership level.

---

## Honest scope notes

- **Tools and platforms evolve fast** — exact recipes for GitHub Actions / GitLab CI / Jenkins / Argo / Flux change with new versions
- **Self-hosted runner discipline is significant ops work** — small teams often better off paying for cloud runners
- **DORA metrics measure flow, not quality** — pair with quality metrics (defect rate, customer-facing issue rate) for full picture
- **Not a GitOps tutorial** — covered at the perf-engineering relevant level; for deep GitOps see Argo CD / Flux docs
- **Pipeline observability tooling moves fast** — Datadog CI Visibility, Honeycomb for CI, DX, LinearB all evolve; evaluate current capabilities
