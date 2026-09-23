# AI-augmented load testing

Patterns and pitfalls for AI/agentic assistance in load testing. Use when the engagement involves AI-augmented test creation, correlation, maintenance, or evaluation of AI testing vendors / build-vs-buy decisions for AI testing pipelines.

This complements (does not replace) `k6-patterns.md`, `tool-selection-guide.md`, and `cicd-perf-gates.md` — those cover the established discipline of load testing; this one covers the emerging AI overlay.

---

## Honest framing first

The AI-augmented testing space (as of May 2026) is **rapidly evolving and vendor-driven**. There's real engineering value, but the literature is dominated by self-published experience reports and vendor white papers — not peer-reviewed research. Treat claims accordingly:

- **What's established**: correlation in dynamic web apps is genuinely hard; AI/LLM-assistance demonstrably reduces some specific tasks; HAR-as-test-input is a working pattern.
- **What's vendor-claim territory**: aggressive speedup numbers ("25 min → 75 sec"), claims of "engineering" vs "scripting" replacement, claims of full autonomy production-readiness.
- **Apply `evidence-based-pe.md` discipline to vendors too**: ask for baseline, sample size, conditions, and what's NOT measured. A 20× speedup on a cherry-picked correlation task is plausible. A 20× end-to-end engagement speedup is almost certainly not.

This reference extracts the conceptually-useful patterns without endorsing specific vendors. Names are mentioned as category examples, not recommendations.

---

## The correlation spectrum

Correlation in load testing = extracting dynamic values from one response (CSRF tokens, session IDs, generated IDs, view-state) and reinjecting them into subsequent requests. Historically one of the most expensive manual tasks in scripting dynamic web apps.

Five levels of capability, from most manual to most AI-augmented:

| Level | Description | Effort per dynamic value | When it fits |
|-------|-------------|--------------------------|--------------|
| **L0 — Manual regex** | Engineer writes capture expressions by hand, traces each token | Minutes-hours per token | Small/stable apps; team has deep app knowledge |
| **L1 — Tool-assisted heuristics** | k6/JMeter recorders auto-detect common patterns (view-state, JSESSIONID); manual cleanup for the rest | Minutes per token | Established tools' sweet spot; covers 60-80% of cases |
| **L2 — Pattern-match AI** | LLM analyzes HAR/recording, suggests correlations from named pattern catalog | Seconds per token, minutes review | Apps with novel-but-pattern-like tokens; rapid prototyping |
| **L3 — Context-aware AI** | LLM reasons about request/response semantics, infers correlation from data flow | Seconds per token, minutes review | Apps where the same token name appears with different semantics across endpoints |
| **L4 — Specialized AI with persistent knowledge** | Domain-trained agent retains learnings across runs; flags drift in known tokens | Seconds; mostly automatic | Mature programs with stable AI infrastructure; long-lived apps |

**Practical reality (2026)**: most teams are at L0-L1 with general-purpose tools, experimenting with L2 via LLM API calls in custom pipelines, evaluating L3-L4 from specialized vendors. The progression L0 → L4 is not "newer is better"; each level has its sweet spot.

**Anti-pattern**: jumping to L4 without first solving the basic test design problem. AI correlation on a poorly-designed test (wrong load profile, wrong assertions, wrong data) just produces broken tests faster.

---

## The three-layer architecture of testing

Reframing "correlation" as one job is misleading. There are three distinct concerns, each with different fit for AI assistance:

| Layer | Question | Manual approach | AI-assisted approach |
|-------|----------|-----------------|----------------------|
| **Observe** | What is the app actually doing? | Capture HAR, browser DevTools, packet capture | LLM ingests HAR, summarizes flows, identifies dynamic values |
| **Decide** | Which captured values must be correlated, parameterized, faked? | Engineer judgment, often missing edge cases | LLM proposes classification with rationale; engineer reviews |
| **Prove** | Does the resulting test actually exercise the production code path? | Run against staging, compare with prod traces | LLM compares test vs prod traces, flags divergence |

This three-layer view maps directly to **`evidence-based-pe.md`**:
- Observe = baseline establishment
- Decide = hypothesis formation
- Prove = verification

The discipline of separating these three jobs is more important than which one is AI-assisted. A team that conflates them produces brittle tests regardless of tooling.

---

## HAR-to-Test workflow

HAR (HTTP Archive) files are the standard browser-recorded representation of an HTTP session. Modern AI-augmented workflows treat HAR as the input asset and produce test scripts as output:

```
1. Capture HAR in browser DevTools during a realistic user flow
   ├─ Use throttling to simulate realistic network conditions
   └─ Verify the flow actually exercises the SLO-relevant path

2. Pre-process HAR
   ├─ Strip third-party requests (analytics, ads) unless in scope
   ├─ Anonymize PII / sensitive headers
   └─ Tag flows: critical path / supporting / out-of-scope

3. Submit to AI / pipeline
   ├─ LLM identifies dynamic tokens (correlation candidates)
   ├─ LLM identifies parameterizable inputs (search terms, IDs)
   └─ LLM proposes test structure (which scenarios, executor pattern)

4. Engineer review (mandatory — see authorization-gate pattern below)
   ├─ Verify token classifications (every correlation rule)
   ├─ Adjust load profile to match production
   ├─ Add explicit assertions (status, response shape, SLO thresholds)
   └─ Add test data strategy (CSV, generators, dedicated test accounts)

5. Generate test script (k6, JMeter, Gatling depending on target)

6. Run smoke test → debug → iterate
```

**Key principles:**

- **HAR captures one path**; load testing needs many paths. Augment HAR-based tests with explicit scenario design.
- **HAR is contemporaneous**; production state may differ (different users, cached data, A/B tests). Validate test reflects current prod, not the HAR's moment.
- **Sensitive data in HAR is a security concern**; treat HAR files as sensitive artifacts (cookies, auth tokens, PII).

---

## Self-healing tests

The premise: when an application changes (new field added, endpoint renamed, parameter optional → required), tests break. Manual maintenance is expensive. AI-augmented "self-healing" tests detect the change and propose fixes.

**Where this works well:**

- Selector drift in UI tests (CSS class renamed, element moved)
- Field name renames in API responses with same semantics
- New optional fields that legacy assertions don't account for
- Authentication flow changes (added MFA step that didn't exist)

**Where this fails:**

- Semantic changes (field exists but means something different now)
- Business logic changes (the test is asserting wrong behavior; healing makes it pass wrongly)
- Performance regression (the test "heals" by accepting slower responses; SLO breach goes silent)
- Breaking schema changes intended to fail tests (a contract change should fail loud)

**Critical anti-pattern**: silent self-healing in performance tests. If a test starts allowing 800ms responses where it previously asserted 500ms, the "healing" hid an SLO regression. **Performance assertions must never auto-heal**. Self-healing applies to structural changes (selectors, field names), not to performance thresholds.

**Recommended pattern**:
```
Healing tier 1 (auto-apply, log): selector updates, optional new fields
Healing tier 2 (propose, require review): field renames, flow changes
Healing tier 3 (never auto): performance thresholds, business rules
```

---

## Agent autonomy in testing — applying authorization gates

A widely-discussed lesson from the AI testing space: giving an agent full autonomy to "fix" failing tests leads to chaos — the agent makes the tests pass by removing assertions, increasing thresholds, or deleting scenarios.

This is the same class of problem `code-review-commit-workflow.md` addresses for source code. The same discipline applies:

| Action by test agent | Authorization required |
|----------------------|-------------------------|
| Read test files, HAR files, results | None (read-only) |
| Propose new test code | None (proposal only, not applied) |
| Apply structural fix (selector, field rename) | Per-change confirmation OR pre-approved policy with audit log |
| Modify performance assertions | **Per-change explicit authorization, never auto** |
| Delete test scenarios | **Per-scenario explicit authorization, never auto** |
| Modify test data sources | Per-change authorization |
| Push to repository | **Always explicit authorization, never auto** |
| Trigger production load test | **Always explicit authorization with cost/risk confirmation** |
| Open PR | Explicit authorization with diff preview |

The "God Mode" lesson (from vendor experience reports): an agent with full autonomy on a failing test suite will make the suite green — by destroying its value. The remedy is the same as for source code: **proposal → review → authorized apply**.

When evaluating AI testing tools, look for:
- Per-change authorization gates by default
- Audit log of what the agent changed and why
- Reversibility (can you roll back what the agent did?)
- Separation of "propose" mode from "apply" mode
- Explicit handling for performance assertions (should require harder gates)

A tool that defaults to "agent applies, you review later" is failing this design test.

---

## Vendor landscape (as of May 2026)

Categories of AI-augmented testing tools, with examples. **Not recommendations** — evaluate against your specific needs and current capabilities (the space moves fast):

| Category | Examples | What they emphasize |
|----------|----------|---------------------|
| **AI overlays on established load tools** | k6 with AI plugins, Grafana k6 Cloud AI features | Augmentation, not replacement |
| **AI-first load testing platforms** | LoadMagic, Loadero AI, Tricentis NeoLoad AI | End-to-end "AI agents do the work" |
| **AI-augmented browser-based testing** | Reflect, Mabl, testRigor, Functionize | UI test generation and self-healing |
| **AI for API contract / synthetic** | Postman AI, Bruno AI | API-first test design |
| **Custom pipelines** | LLM (Claude / GPT / Gemini API) + your scripts | Maximum flexibility, maximum effort |

**Evaluation discipline** (apply `evidence-based-pe.md` to vendor selection):

1. **Baseline**: how long does your team currently spend on X? Measure before adopting.
2. **Vendor claims**: ask for the experiment design behind every speedup number. "25 min → 75 sec" should come with sample size, sample type, who performed both runs, what was excluded.
3. **Pilot**: run AI-augmented and manual side-by-side on a single representative scenario. Measure end-to-end including review/fix time, not just AI generation time.
4. **Failure modes**: what does the tool do when it's wrong? Vendors emphasize success cases; the failure mode matters more for production use.
5. **Lock-in**: does the AI's output run in standard tools (k6, JMeter, Gatling) or only inside the vendor platform?
6. **Cost**: per-call API costs (if LLM-based) plus platform license plus your team's review time.

**Anti-pattern**: adopting AI testing tooling because of "AI velocity" without measuring whether it actually accelerates your team. Some teams find the review burden exceeds the generation savings, especially for L3-L4 capabilities on novel apps.

---

## Build vs Buy

The standard categories apply:

| Path | When |
|------|------|
| **Buy specialized vendor** | Mature program, large test footprint, clear ROI from speed-to-value |
| **Buy AI overlay on existing stack** | Already deep in k6/JMeter/Gatling; want incremental gains |
| **Build custom pipeline** | Specific workflow needs not in market; team has Python/JS + LLM API experience |
| **Don't adopt AI augmentation** | Small surface area; manual approach works; AI ROI unclear |

**Build path skeleton** (custom pipeline using Claude/GPT/similar):

```
HAR file → preprocessor (strip third-party, anonymize) →
  LLM API call (with structured output) →
    proposed correlations + parameterizations + scenario structure →
      engineer review tool (CLI or web UI for approve/reject) →
        test script generator (k6 template fill) →
          smoke test runner → results back to engineer
```

For a team with one full-time engineer's worth of skill on Python + LLM APIs, this is ~6-12 weeks to MVP. Compare against vendor cost.

**Honest scope on build**: most teams' first build is worse than off-the-shelf for 12-18 months. The right move depends on whether you'll need *that-specific-thing* long enough to amortize the build.

---

## Evidence-based evaluation of AI testing claims

When you encounter a claim like "AI reduced our test creation time by 95%", apply the anti-pattern checklist from `evidence-based-pe.md`:

| Checklist item | What to ask |
|----------------|-------------|
| **Single-point comparison** | How many tests / how many engineers / how many runs? |
| **Cherry-picked window** | "Their best week" vs "their normal pace"? |
| **Same operator** | Did the same engineer do the manual baseline and AI version? Skill bias. |
| **Same problem** | Did the manual baseline include the bug discovery / parameterization / data prep that the AI version skipped? |
| **AI processing time included** | Wall-clock from intent to working test, or just the AI generation step? |
| **Quality controlled** | Did the AI version produce equivalent test coverage / equivalent assertions? |
| **Reproducible** | Can you re-run the same comparison and get similar numbers? |
| **What was NOT counted** | Setup, training data prep, vendor onboarding, ongoing review burden |

A vendor that survives this checklist has a real product. A vendor that deflects ("trust us, our customers love it") is selling, not engineering.

---

## Anti-patterns

- **AI generates tests, engineer rubber-stamps without review** — "fast and wrong" is worse than "slow and right" for production tests
- **Self-healing on performance assertions** — silent regression
- **Agent full autonomy without authorization gates** — the "God Mode" failure mode
- **L4 specialized AI without solving L1 basics** — perfect correlation on a wrongly-designed test is still a wrongly-designed test
- **Adoption justified by "AI velocity" without measurement** — buying the marketing
- **Vendor lock-in via vendor-specific agents** — tests that only run inside vendor X's platform
- **Replacing engineer judgment with AI judgment** — AI is for acceleration, not delegation of design decisions
- **No baseline before adoption** — "we're faster now" with nothing to compare against
- **AI tests checked into git without provenance** — who/what generated this? Hard to debug later
- **Confusing "AI generated this" with "AI verified this"** — generation and verification are separate, both needed

---

## When AI-augmented testing helps most

| Scenario | Why AI helps |
|----------|--------------|
| **New scenario from scratch on familiar tech** | Boilerplate generation, common correlations |
| **HAR-to-test on dynamic apps** | The correlation problem is exactly AI's strength |
| **Test maintenance after non-breaking app changes** | Selector/field-rename healing |
| **Smoke test generation from API specs** | Schema → test cases is well-bounded |
| **Test data generation** | Synthetic but realistic data shapes |
| **Performance assertions language** | "Express this SLO in k6 thresholds" |

## When AI-augmented testing helps least

| Scenario | Why it doesn't help |
|----------|---------------------|
| **Novel domain with no LLM training data** | Hallucination on domain semantics |
| **High-security apps where HAR can't leave premises** | LLM API calls send data; on-prem LLMs may not have the capability |
| **Tests requiring true business judgment** | What "passing" means is the engineer's call |
| **Performance threshold setting** | SLO setting is a product/engineering decision, not an AI optimization |
| **Tests for AI systems** | Meta-recursion problems; need different methodology |
| **One-off tests** | Setup cost of AI augmentation > manual cost |

---

## Integration with skill modes

### Diagnosis mode

AI-augmented testing is rarely useful for diagnosis — diagnosis needs domain reasoning, not test generation. Stay with `diagnostic-playbooks.md`.

### Design mode

AI can help generate **candidate** scenarios for new perf-critical paths. Engineer reviews and selects. Use `evidence-based-pe.md` discipline to set explicit SLO targets first; AI-generated tests without SLO targets are checklist theater.

### Campaign reporting mode

Vendor claims about test campaign acceleration are **vendor marketing**; the actual deliverable still follows `references/deliverable-templates.md` and `cicd-perf-gates.md`. AI may accelerate generation; it does not change what a campaign report should contain.

### Code review mode

The patterns in `code-review-commit-workflow.md` apply directly: AI testing agents need the same per-change authorization discipline as code-modifying agents.

### CI/CD pipeline mode

If AI-augmented tests are in CI: include their generation/regeneration step as a pipeline stage; track AI run cost; alert on AI-induced test churn. See `cicd-pipeline-optimization.md` for general CI cost discipline.

### FinOps mode

AI testing has real cost (LLM API calls, vendor licenses). Include in cost dashboards; track cost-per-test and cost-per-build with AI augmentation. See `finops-cloud-cost.md`.

### Engagement mode

If a client engagement involves AI testing adoption: structure as evaluation + pilot + measurement (DMAIC), not as direct adoption. Pilot results may not justify full rollout — be willing to recommend "stay manual" if data supports it.

---

## Reading list

Honest curation — primary sources, not marketing material:

- **HAR specification** (W3C draft) — the input format
- **k6 official docs** on AI-assisted scripting features (current state)
- **OWASP Web Security Testing Guide** — for security implications of HAR handling
- **FinOps Foundation FinOps for AI papers** — cost discipline for AI in any pipeline
- **Vendor case studies** — read critically; apply the evaluation checklist above
- **Conference talks** at PerfNow, NeotysPAC, k6-org events — community-validated, less vendor-filtered

Skip: vendor white papers presented as research, Leanpub self-published books without independent review, "we 10×'d our tests with AI" LinkedIn posts (almost universally cherry-picked).

---

## Honest scope notes

- **The space evolves fast** — specific vendor capabilities mentioned here will date within months. The patterns (correlation spectrum, three-layer architecture, authorization gates) are stable; the tools that implement them shift.
- **Not a vendor selection guide** — names are categorical examples. Evaluate against current capabilities with the discipline above.
- **Not a tutorial on building AI testing pipelines** — outlines the shape; doesn't cover prompt engineering, structured output schemas, or pipeline orchestration in depth. Build documentation lives with your chosen LLM provider.
- **The skill's recommendation**: most teams should adopt AI augmentation incrementally (L1 → L2 → L3 over 12-18 months) with measurement at each stage. Big-bang adoption of L4 specialized AI tooling rarely justifies its cost in the first year.
