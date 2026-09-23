# Evidence-based performance engineering

The foundational discipline of this skill: **no recommendation without evidence, no claim without measurement, every change verified with before/after data.** When the data doesn't exist yet, the agent either requests it from the user or executes the measurement directly.

This is not optional. Every mode of this skill (diagnosis, design, code review, FinOps audit, campaign reporting, etc.) carries the evidence requirement. This reference documents the methodology, the supporting frameworks, the workflow, and the templates.

---

## The principle

> **A performance recommendation without baseline + post-change measurement is an opinion, not engineering.**

Three corollaries:

1. **No baseline → no improvement.** "p99 was high, now it's better" is not a result. "p99 was 1,180ms (n=10,000 requests over 24h), now 700ms (same window, same conditions)" is a result.
2. **No control → no causation.** Correlation with a deploy doesn't prove the deploy caused it. Multiple unrelated changes ship in the same window. Either isolate the change or accept that the conclusion is provisional.
3. **No statistical rigor → no confidence.** A single 10-minute test on a noisy system, comparing two runs, may show a 20% "improvement" that is pure variance. Multiple runs, confidence intervals, and percentile-aware comparisons are the floor.

The agent's job is to enforce this discipline kindly but firmly. When a user asks "should we add a Redis cache?", the right response is not "yes, here's how" — it's "what's the current cache miss rate and DB query latency, and what target are we aiming at?"

---

## Supporting frameworks

There is no single canonical "Evidence-Based Performance Engineering" framework. Multiple disciplines have converged on the same core idea. Reference these by name when defending the methodology to stakeholders — naming the framework makes the discipline defensible.

### Evidence-Based Software Engineering (EBSE)

Kitchenham, Dybå, and Jørgensen (2004) imported the evidence-based medicine framework into software engineering. The five-step EBSE workflow:

1. **Convert the question into a structured form** (population, intervention, comparison, outcome)
2. **Search for the best evidence** (literature, prior experiments, internal data)
3. **Critically appraise the evidence** (validity, applicability)
4. **Apply the evidence** (decide on action)
5. **Evaluate performance** (did the action achieve the predicted outcome?)

For PE engagements: "should we adopt Redis cache for our catalog reads?" becomes "for our catalog read workload (population), does Redis caching (intervention) vs current DB-direct (comparison) reduce p99 by ≥40% (outcome)?" — and that becomes a measurable question.

Reference: Kitchenham et al., *Evidence-Based Software Engineering* (2004 ICSE paper).

### The scientific method applied to performance

The classic loop adapted:

```
1. Observation     — symptom (slow checkout, high cost, throttling)
2. Hypothesis      — proposed cause OR proposed fix, stated precisely
3. Prediction      — quantitative outcome the hypothesis implies
4. Experiment      — controlled measurement designed to falsify
5. Comparison      — measured outcome vs prediction
6. Conclusion      — accept / reject / refine hypothesis
7. Iterate
```

The discipline is in step 3: a hypothesis that doesn't make a quantitative prediction is not testable. "Adding cache will improve performance" is a claim, not a hypothesis. "Adding a 5-minute TTL Redis cache on catalog reads will reduce checkout p99 from 1,180ms to ≤ 800ms, with cache hit rate > 90% after 5-minute warmup" is a hypothesis.

### Six Sigma DMAIC

Define-Measure-Analyze-Improve-Control. Originally for manufacturing quality, but the loop is directly applicable to perf:

| Phase | PE adaptation |
|-------|---------------|
| **Define** | What's the SLO? What's the gap? Who cares? |
| **Measure** | Establish baseline with statistical rigor. Document conditions. |
| **Analyze** | Identify root cause via diagnostic methodology (USE, RED, span analysis, flame graphs) |
| **Improve** | Apply change. Verify against prediction. |
| **Control** | Set up monitoring/alerts so the improvement doesn't regress. SLO + burn-rate alerts. |

DMAIC is particularly useful for **multi-week engagements** where the work is structured and the deliverable is a sustained improvement, not a one-shot fix.

### Statistical Process Control (SPC)

Shewhart and Deming established the discipline of distinguishing **special-cause variation** (something changed) from **common-cause variation** (random noise) using control charts and statistical bounds.

For PE: a p99 latency dashboard with mean + 3σ control bands lets you tell "perf regressed" from "perf is noisy as usual." This is the foundation of regression detection in production.

Reference: Deming, *Out of the Crisis*.

### DORA / Accelerate

Forsgren, Humble, and Kim (2018) established four metrics as the measurement basis for software delivery performance:
- Deployment frequency
- Lead time for changes
- Change failure rate
- Mean time to recovery (MTTR)

Already cross-referenced in `cicd-pipeline-optimization.md`. The DORA discipline: track these metrics monthly, compare against industry benchmarks, use them to defend or challenge process changes.

### Google SRE: SLI/SLO/error budgets

Service Level Indicators measured against Service Level Objectives produce an error budget — the amount of unreliability you can afford. Decisions about feature velocity vs reliability investment become evidence-based: are we under budget (push features) or over (invest in reliability)?

Reference: Beyer et al., *Site Reliability Engineering* (Google SRE book).

### Brendan Gregg's "Methodology First"

The USE method (`bottleneck-patterns.md`, `diagnostic-playbooks.md`) is explicitly a methodology to **enforce systematic measurement** before drawing conclusions. The premise: ad hoc diagnosis misses common bottlenecks. Following a methodology guarantees coverage.

The implication: a perf engineer who diagnoses "by intuition" without a checklist is operating below state of the art.

---

## The before/after workflow

The mandatory loop for any proposed change:

```
1. State the SLO sentence (what success looks like)
2. Establish baseline (current state, measured with rigor)
3. State the hypothesis (what we predict will change, by how much)
4. Decide on measurement plan (what we'll measure, how, for how long)
5. Apply the change (one variable, isolated)
6. Measure post-change (same conditions as baseline)
7. Compare (statistical rigor — not just point estimates)
8. Verdict (success / failure / inconclusive)
9. Document (the result, the conditions, what was learned)
10. Control (set monitoring to detect regression)
```

If any step is skipped, the change is not engineering — it's hope.

### Step 1 — SLO sentence

The form (from `agent-team-orchestration.md`):

> *"Min N transactions/s with ≤ M ms latency at p{99|999} on {specified hardware/conditions}."*

Examples:
- *"Min 1,000 txns/s with ≤ 500ms p99 on Aurora db.r6g.2xlarge."*
- *"Min 10 completions/s with ≤ 2s p99 TTFT on Sonnet 4.6 with prompt caching active."*
- *"Min 95% cache hit rate after 5-min warmup on Redis cluster mode disabled."*

The SLO sentence is the **contract**. Without it, success is undefined and every result is debatable.

### Step 2 — Baseline

What "baseline" means concretely:

| Field | Required content |
|-------|------------------|
| **Metric** | The exact metric being measured (e.g., `histogram_quantile(0.99, sum by (le)(rate(http_request_duration_seconds_bucket{service="checkout"}[5m])))`) |
| **Value** | The current measured value |
| **Window** | The time window over which it was measured (e.g., "24h, 2026-05-08 → 2026-05-09") |
| **Conditions** | Load profile (RPS, traffic shape), any active feature flags, time of day, deployment version |
| **Source** | Where the data came from (Grafana dashboard URL, k6 run ID, log query, JFR file) |
| **Sample size** | Number of observations (for synthetic tests) or window duration (for prod telemetry) |
| **Statistical treatment** | p50, p99, p99.9, and which one is the SLI |

Without all six fields, the baseline is incomplete and the "improvement" cannot be defended.

### Step 3 — Hypothesis

The form:

> *"Hypothesis H1: <change> will improve <metric> from <baseline> to <target>, because <mechanism>."*

Examples:
- *"H1: Batching ShipEngine calls in CartEnricher will reduce checkout p99 from 1,180ms to ≤ 700ms, because the current 25-item cart issues 25 sequential API calls dominating latency."*
- *"H1: Enabling prompt caching on the system prompt will reduce input token cost by ~85%, because cached reads cost ~10% of fresh reads and the system prompt accounts for 95% of input tokens per call."*
- *"H1: Right-sizing dev cluster nodes from m5.4xlarge to m5.xlarge will save $4,800/month with no perf regression, because dev p95 CPU is 22% over 30 days."*

Each predicts a magnitude. "Will improve perf" is not a hypothesis.

### Step 4 — Measurement plan

Defines what success looks like and how we'll know:

```
Primary metric:       checkout p99 latency (histogram_quantile q=0.99)
Secondary metrics:    p99.9, error rate (5xx %), throughput (RPS)
Measurement method:   k6 scenario `checkout-baseline.js` at 200 RPS
Duration:             30-minute sustained load
Replications:         3 independent runs (different days, same time of day)
Confidence target:    p99 improvement > 30% must hold across all 3 runs
Confounds to control: deployed version, downstream service version,
                      DB cache state (warm before measurement), time of day
Stop conditions:      error rate > 1% → abort, do not report misleading data
```

### Step 5 — Apply the change

**One variable at a time.** This is the single most-violated rule in informal perf work. Two changes deployed together cannot be attributed individually.

If the change cannot be isolated (e.g., a refactor that touches many files), state this explicitly in the verdict and treat the result as suggestive, not conclusive.

### Step 6 — Measure post-change

Same conditions as baseline. **Same** means:
- Same load profile (RPS, scenario, data shape)
- Same hardware (instance type, cluster size, region)
- Same time of day if traffic-of-day matters
- Same DB cache state (warm vs cold start)
- Same feature flag state

If conditions differ, document and analyze whether the difference invalidates the comparison.

### Step 7 — Compare

Don't compare single numbers. Compare distributions:

| What to report | Wrong: single point | Right: distribution |
|----------------|---------------------|---------------------|
| Latency | "p99: 1180ms → 700ms" | "p99: 1180ms (n=10,234) → 700ms (n=11,891) across 3 runs; 95% CI [680, 720]ms" |
| Throughput | "RPS: 150 → 250" | "Sustained RPS: 250 ± 8 (3 runs, σ=8); previous 150 ± 12 (3 runs, σ=12)" |
| Cost | "Saved $4,800/mo" | "Apr cost $4,820 → projected May $1,650 based on first 14 days × 30 (CI ± $200)" |

Statistical floors:
- **Multiple runs** to estimate variance — minimum 3 independent runs for any reported number
- **Percentile-aware comparison** — don't compare means when the SLO is on p99
- **Confidence intervals** where the math supports it (not always — but state when it doesn't)
- **Coordinated omission** check (see `tool-selection-guide.md`) — if the load gen runs back off when the server is slow, latency is underreported

### Step 8 — Verdict

Three honest outcomes:

| Verdict | When | Action |
|---------|------|--------|
| **Success** | Hypothesis predicted X, measured X (within CI), no negative side effects | Keep change. Move to next priority. |
| **Failure** | Predicted X, measured significantly less | Revert. Re-diagnose. Either the hypothesis was wrong or the mechanism is different. |
| **Inconclusive** | Predicted X, measured something close-but-noisy, or other variables changed | Re-run with better control. Don't claim victory. |

"Partial success" usually means "the engineer was uncomfortable saying failure" — be honest.

### Step 9 — Document

The result lives beyond the engagement. Document:
- Hypothesis, baseline, post-change, verdict (all four fields)
- Conditions and confounds
- Surprises and side effects
- What you'd do differently next time

Use the verification report template (below). This is the durable artifact of an engagement.

### Step 10 — Control

Set up monitoring so the improvement doesn't regress silently:
- SLO + multi-window multi-burn-rate alert on the improved metric
- Dashboard with mean + 3σ control bands (Shewhart-style)
- Regression detection job in CI (see `cicd-perf-gates.md`)

Without control, the improvement decays. Most "improved 6 months ago" wins quietly regress.

---

## Getting evidence: request or execute

When the engagement starts, baseline data may or may not be available. The agent has two paths:

### Path A — Request from user

When the agent should ask:
- User's environment is not directly accessible (no MCP, no shared dashboard)
- Test would impact production (load test against prod, etc.)
- Access permissions don't allow direct measurement
- User is faster (they know where the data lives, can pull it in seconds)

**Request template:**

```markdown
Before I can recommend a fix for this <symptom>, I need baseline data.
Please share:

1. <Specific metric, ideally as a PromQL query or dashboard panel>
   - Window: <recent 24h / 7d>
   - Aggregation: p50, p99, p99.9
   - Source: Grafana / Datadog / etc.

2. <Load profile if applicable>
   - Typical RPS
   - Peak RPS
   - Daily/weekly shape

3. <Resource context>
   - Instance / pod size
   - Replica count
   - Relevant config flags

Once I have this, I can propose specific changes with predicted impact.
Without it, any recommendation is guesswork.
```

Be specific about what's needed. "Send me your dashboards" is too vague — name the metrics.

### Path B — Execute directly

When the agent should run the measurement:
- MCP tools available (Grafana MCP → query Prometheus directly)
- The measurement is in scope and safe (read-only queries, dev environment)
- User has explicitly asked for the analysis end-to-end
- Faster than asking and waiting

**Execution patterns:**

```
For PromQL queries via Grafana MCP:
  1. Call tool_search to confirm Grafana MCP is connected
  2. Issue the query
  3. Report the result with the query for reproducibility

For k6 in dev/staging via filesystem + bash:
  1. Confirm scenario file exists, is current
  2. Run baseline scenario, capture output
  3. Run post-change scenario
  4. Compare with statistical rigor (multiple runs!)

For log analysis via filesystem MCP:
  1. Confirm logs are accessible
  2. Aggregate with awk / jq / log-specific tooling
  3. Report distribution, not just point estimates
```

**Safety rules when executing:**
- Read-only queries are usually fine (Prometheus query, log read)
- Synthetic load against staging is fine
- **Anything that mutates production state requires explicit per-instance user authorization** — same rules as `code-review-commit-workflow.md`
- Cost-incurring queries (BigQuery slot consumption, large k6 cloud runs) → confirm cost expectation first

### Hybrid path

Most common in real engagements: request some, execute some. Example:
- Request: "share your Grafana dashboard URL for the checkout service"
- Execute: once URL is shared, agent queries via Grafana MCP for specific metrics, returns the analysis

---

## Statistical rigor — the floor

You don't need a stats PhD, but you do need a working knowledge of the floor. The agent should never produce or accept analyses that violate these.

### Percentiles vs means

Latency is heavy-tailed. The mean is dominated by outliers; the p50 ignores them; the p99 captures user experience for the slowest 1%. **For SLOs, percentiles are the right metric.** Mean latency is for capacity planning, not user experience.

| Metric | What it tells you | When to use |
|--------|-------------------|-------------|
| Mean | Total time / total requests | Capacity (CPU-seconds), cost-per-request |
| Median (p50) | Typical user | "Most users have an OK time" |
| p95 | "Bad enough to notice" tail | UX baseline for many products |
| **p99** | "Bad enough to complain" tail | Standard SLO target for user-facing |
| **p99.9** | "Bad enough to leave" tail | High-reliability services |
| Max | The single worst | Anomaly detection only — too noisy for SLO |

### Sample size

A single run is a single sample. Variance is unknown. Don't draw conclusions.

**Floor for credible comparison:**
- **3 independent runs minimum** for synthetic comparison (different times, same conditions)
- **More for noisy systems** — if runs vary by 20%, you need ~10 to detect a 20% effect
- **Long-enough windows for prod telemetry** — 24h minimum, 7 days better, to capture traffic-of-day

### Confidence intervals

When the math supports it (sample size adequate, distribution roughly known), report intervals:

```
p99: 700ms (n=11,891, 95% CI [680, 720]ms across 3 runs)
```

If you can't compute a CI, say "n=X runs, range [Y, Z]" — at least communicate the spread.

### Coordinated omission

(Detailed coverage in `tool-selection-guide.md`.) When the load generator slows down because the server is slow, it under-reports tail latency. The reported p99 of 50ms might be 5000ms in reality.

**Defenses:**
- Use load generators that compensate (k6's open model executors, wrk2)
- Cross-check load-gen results against server-side histograms — they should match
- Be suspicious of "improvements" that look impossibly large

### Multiple comparison problem

If you test 10 different changes and one shows a "significant" 20% improvement, it might be the one true winner — or it might be the one false positive you'd expect by chance. Be skeptical of "we tried 10 things and X worked!"

For PE engagements: change one thing at a time. The multiple-comparison problem disappears.

### Confounds

A change ships in the same window as:
- A traffic pattern shift (lunch hour, BFCM, marketing campaign)
- Another deploy (different service, different team)
- Infrastructure change (autoscaler kicked in, node was replaced)
- Downstream service change (third-party API latency improved)

Any of these can produce a "result" that's not your change. Document confounds; control where possible; treat results as suggestive when controls fail.

---

## Templates

### Hypothesis statement template

```markdown
**Hypothesis H<n>**: <one-sentence summary>

**Rationale**: <why we expect this — the mechanism>

**Baseline metric**: <metric name and current value>
**Baseline source**: <Grafana URL / k6 run / log query>
**Baseline window**: <when it was measured, conditions>

**Predicted post-change metric**: <expected value>
**Magnitude of improvement**: <% or absolute>

**What would falsify this**: <conditions under which we'd reject>
**Risk if false**: <cost of being wrong>

**Measurement plan**: <how we'll know — see measurement template>
```

### Measurement plan template

```markdown
**What we're measuring**: <metric, e.g., checkout p99 latency>
**Method**: <tool, e.g., k6 scenario `checkout-baseline.js` at 200 RPS>
**Source of data**: <Grafana / k6 output / log aggregation>

**Sample size / duration**: <e.g., 3 independent runs of 30 minutes>
**Statistical treatment**: <p50, p99, p99.9, CI calculation>

**Conditions to control**:
- Deployed version: <specific SHA or tag>
- Hardware: <instance type, count>
- Time of day: <if traffic-of-day matters>
- Feature flag state: <list relevant flags>
- DB cache state: <warm vs cold>

**Confounds and mitigations**:
- <Confound 1>: <how we'll handle>
- <Confound 2>: <how we'll handle>

**Stop conditions** (when to abort the test): <e.g., error rate > 1%>

**Decision rule**: <when do we declare success / failure / inconclusive>
```

### A/B test design template

```markdown
**Variant A (control)**: <current state>
**Variant B (treatment)**: <proposed change>

**Traffic split**: <% A / % B>
**Duration**: <min to reach statistical significance — calculate from
              expected effect size and sample variance>

**Primary metric (single decision metric)**: <one metric>
**Direction**: <higher is better / lower is better>
**Minimum detectable effect**: <smallest change worth detecting>

**Secondary metrics (tracked, not decision)**:
- <metric 1>
- <metric 2>

**Stop conditions (early abort)**:
- Error rate on B > X% — kill B
- Cost spike on B > Y% — kill B
- Customer-reported issue tracable to B — kill B

**Decision rule**: <when do we declare a winner; what's the statistical threshold>

**Sample size justification**: <calculation; how many requests/sessions
                                needed for the chosen significance level>

**Rollback procedure**: <how to revert if B is worse>
```

### Verification report template

```markdown
# Change verification: <change description>

**Date**: <YYYY-MM-DD>
**Hypothesis**: <H<n>: short summary>
**Change applied**: <commit SHA, PR link>

## Baseline (before)

| Field | Value |
|-------|-------|
| Metric | <e.g., checkout p99 latency> |
| Value | <e.g., 1,180ms> |
| Window | <e.g., 2026-05-08 → 2026-05-09, 24h> |
| Sample size | <n requests / runs> |
| Source | <Grafana URL or file> |
| Conditions | <load, hardware, flags> |

## Post-change (after)

| Field | Value |
|-------|-------|
| Metric | <same metric> |
| Value | <e.g., 700ms> |
| Window | <e.g., 2026-05-12 → 2026-05-13, 24h> |
| Sample size | <n> |
| Source | <link or file> |
| Conditions | <same as baseline; document any differences> |

## Comparison

- **Delta**: <e.g., −480ms, −41%>
- **Confidence interval**: <e.g., 95% CI [−500, −460]ms across 3 runs>
- **Statistical test (if performed)**: <e.g., paired t-test, p < 0.001>

## Side effects observed

- <Metric Y also changed: <how>>
- <Or: "No significant change in other tracked metrics">

## Confounds

- <Confound 1: handled / suggestive>
- <Confound 2: handled / suggestive>

## Verdict

**<Success / Failure / Inconclusive>**

Rationale: <one or two sentences>

## Recommendation

<Keep / Revert / Iterate>. <Rationale.>

## What was learned

<For the durable record — surprising findings, gotchas, things future
 engineers should know.>

## Monitoring set up

- SLO alert: <link / config>
- Regression detection in CI: <yes/no, link>
- Dashboard updated: <yes/no, link>
```

---

## Anti-patterns

The agent should call these out when seen in the engagement:

| Anti-pattern | What it looks like | Why it's wrong |
|--------------|---------------------|----------------|
| **Single-point comparison** | "Was 100ms, now 80ms" | No variance estimate; no statistical confidence; might be noise |
| **Mean for SLO** | "Mean latency improved!" while SLO is on p99 | Wrong metric for the question |
| **No baseline** | Change deployed, "looks faster" | No falsifiable claim; correlation ≠ causation |
| **Multiple changes** | Three commits, one deploy, attribute to favorite | Cannot isolate cause |
| **Cherry-picked window** | "Look at this 5-minute slice" | Survivorship bias; cherry-picked timeframe |
| **Production vs staging** | Baseline on staging, claim victory on prod | Different traffic, different scale, different result |
| **Coordinated omission** | Load gen p99 of 50ms while server-side shows 5,000ms | Under-reports tail latency systematically |
| **Confusing correlation** | Cache deployed Monday, traffic dropped Tuesday | Drop might be unrelated |
| **No control** | "Faster than last week" without holding conditions | Last week had different load; not comparable |
| **Hypothesis fishing** | Tried 10 things, one looked good | Multiple comparison problem; almost certainly false positive |
| **Means without distribution** | "Average improvement: 30%" | Hides skew, outliers, tail behavior |
| **Stale baseline** | Baseline from 6 months ago, "still applies" | Workload drifted; baseline no longer relevant |
| **"Trust the dashboard"** | Believing a dashboard without verifying the query | Dashboard might be wrong; histogram bucket saturation, see `tool-selection-guide.md` |
| **Self-reported by stakeholder** | "The team says it's faster" | Subjective, unfalsifiable; ask for measurement |
| **No post-change verification** | Shipped fix, never measured outcome | Improvement assumed, not proven; regression unnoticed |

---

## Composing with skill modes

Every mode of this skill carries the evidence requirement. Cross-references:

### Diagnosis mode

`diagnostic-playbooks.md` Step 0 ("Build a feedback loop") IS evidence discipline applied to diagnosis. The diagnostic feedback loop ends with "did the change fix it?" — which is the verification step here. Evidence-based diagnosis means: establish baseline → form hypothesis → confirm hypothesis via measurement → only then propose fix.

### Design mode

Architectural changes are harder to verify (the alternative isn't easy to test). Discipline: identify analogous prior art with measurement, define explicit hypotheses about the new design, instrument heavily from day one, plan for canary / shadow / A/B to gather evidence post-deploy.

### Campaign reporting mode

The k6 campaign deliverable IS the evidence document. Every campaign report should follow the verification report template — baseline, hypothesis, results, verdict. See `references/deliverable-templates.md` and `cicd-perf-gates.md`.

### Code review mode

Per the `code-review-commit-workflow.md` workflow: every proposed commit must include expected impact (the hypothesis) with concrete numbers. Post-commit verification is recommended; the commit message body has space for it. Evidence-based code review: refuse to propose a perf commit without a quantified hypothesis.

### FinOps audit mode

Every cost recommendation in `finops-cloud-cost.md` carries the joint cost-perf discipline: state both axes. Evidence-based FinOps: every "save $X" claim has a measured baseline cost and a projected post-change cost, plus a perf impact estimate or verification plan.

### Agent team mode

The Engagement Brief (PM artifact) must include the SLO sentence. Sprint Definition of Done explicitly requires evidence — verification report or equivalent — for any perf claim. See `agent-team-orchestration.md`.

### Ticket generation mode

Every ticket from `ticket-generation.md` must have an "Expected impact" section with measurable predictions and a "Verification plan" — these are evidence requirements embedded in the ticket structure.

### LLM perf mode

`llm-perf-and-tokens.md` patterns require token / cost / latency baselines. Evidence-based LLM perf: never "the cost is too high" — always "the cost was $X/month at Y RPS with Z input tokens average; predicted savings $A".

### CI/CD pipeline mode

DORA metrics are evidence baselines. Every pipeline improvement should target a specific DORA metric movement with measurement plan. See `cicd-pipeline-optimization.md`.

### Skill self-maintenance mode

Audit findings must cite sources (which is evidence about evidence — the discipline applies to skill maintenance itself).

---

## When evidence is insufficient

Sometimes the right answer is "we cannot decide yet." Honest postures:

| Situation | Honest response |
|-----------|-----------------|
| User asks for recommendation; no baseline exists | "I need baseline data first. Here's what I need: <specific requests>." |
| Baseline noisy, change effect smaller than noise | "Current measurement variance is ±X. To detect Y% effect with confidence, we need <larger sample / longer window / more runs>." |
| Pre-deploy hypothesis with no way to A/B test | "Without canary or shadow, this is a one-shot deploy. Post-deploy verification: <metrics to watch>, rollback trigger: <threshold>. The hypothesis is unproven until we ship and measure." |
| User pushes for answer despite evidence gap | Push back kindly: "I can give you my best guess, but it's a guess. Stating it as engineering would be misleading. Here's what we'd need to know with confidence: <evidence required>." |

The agent's value is not in producing an answer at all costs. It's in producing **correct answers** and saying "I don't know yet" when correctness isn't supportable.

---

## Tools that produce evidence

| Tool | Evidence type |
|------|---------------|
| Grafana / Prometheus / Mimir | Production telemetry, baselines, SLO measurement, regression detection |
| k6 / JMeter / Gatling / Locust | Synthetic load → reproducible measurement |
| Datadog / New Relic / Dynatrace | APM traces, code-level profiling, comparison views |
| Tempo / Jaeger | Distributed traces — find slow path |
| Pyroscope / async-profiler / pprof | Profiling — flame graphs as evidence of CPU/alloc hotspots |
| OpenLLMetry / Helicone / Langfuse | LLM-specific evidence (token counts, latencies, cost per call) |
| `git log`, `git diff` | Change provenance — which commit ships when |
| Statistical packages (R, Python scipy.stats) | Confidence intervals, hypothesis tests |
| Infracost in CI | Cost-change evidence at PR time |
| Lighthouse CI | Frontend perf budget evidence |
| Custom in-app metrics (RED, USE) | Bespoke baselines for unique workloads |

---

## Honest scope notes

- **Statistical rigor is a continuum** — the floor described here (3 runs, percentiles, CI when feasible) is the working minimum. Formal statistical testing (paired t-tests, Mann-Whitney U for non-normal distributions, Bayesian methods) is appropriate for high-stakes decisions but not required for every change.
- **Evidence-Based Software Engineering is a real academic discipline** — for deeper methodology, see Kitchenham et al. and Wohlin's *Experimentation in Software Engineering*.
- **Statistics is a deep field** — this reference does not substitute for formal training. For PE work that crosses into A/B testing at significant scale, partner with someone with stats training.
- **Some evidence is qualitative** — user reports, usability findings, post-mortem narratives have value. Treat them as evidence with a different validation discipline (triangulation, interview methodology) rather than ignoring them.
- **Speed/rigor trade-off is real** — perfect evidence at the cost of paralysis serves nobody. State confidence honestly, ship when the evidence supports it, retain ability to revert.
