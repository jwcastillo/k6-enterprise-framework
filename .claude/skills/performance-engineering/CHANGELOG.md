# Changelog

All notable changes to the Performance Engineering skill are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This skill follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.4.0] — 2026-05-13

**AI-augmented testing reference added.**

### Added

**AI/agentic load testing patterns** (`references/ai-augmented-testing.md`, ~330 lines):

- **Honest framing first**: the space is rapidly evolving and vendor-driven; self-published experience reports and vendor white papers dominate; apply `evidence-based-pe.md` discipline to vendor claims.
- **The Correlation Spectrum** — 5 levels of capability from L0 (manual regex) to L4 (specialized AI with persistent knowledge); practical reality that most teams are at L0-L1; anti-pattern of jumping to L4 without solving basic test design problems.
- **Three-Layer Architecture**: observe / decide / prove — maps directly to `evidence-based-pe.md` (baseline / hypothesis / verification). The discipline of separating these three concerns is more important than which is AI-assisted.
- **HAR-to-Test workflow** with 6-step process from browser capture → preprocessing → AI submission → engineer review (mandatory) → script generation → smoke iteration. Critical principles: HAR captures one path (not many); HAR is contemporaneous; HAR is sensitive data.
- **Self-healing tests** with tiered authorization model:
  - Tier 1 (auto-apply, log): selector updates, optional new fields
  - Tier 2 (propose, require review): field renames, flow changes
  - Tier 3 (**never auto**): performance thresholds, business rules
- **Critical anti-pattern called out**: silent self-healing on performance assertions — hides SLO regressions.
- **Agent autonomy in testing** — applying the authorization-gate pattern from `code-review-commit-workflow.md`. Per-action authorization table (read-only OK, performance assertion modifications require per-change explicit authorization, scenario deletion requires explicit authorization, never auto-push or auto-trigger production load tests).
- **Vendor landscape (May 2026)**: 5 categories with examples (AI overlays on established load tools, AI-first platforms like LoadMagic, AI browser testing like Reflect/Mabl, API contract AI like Postman, custom pipelines). **Names are categorical, not recommendations.**
- **Evidence-based vendor evaluation discipline**: baseline first, scrutinize speedup claims (sample size, conditions, what was excluded), pilot side-by-side, examine failure modes (vendors emphasize success cases), check lock-in, cost the total picture (API + license + review burden).
- **Build vs Buy decision matrix** + custom pipeline skeleton (HAR → preprocessor → LLM API → review tool → test generator → smoke). Honest note: most first builds are worse than off-the-shelf for 12-18 months.
- **10 anti-patterns** specific to AI-augmented testing — silent self-healing, rubber-stamp review, agent full autonomy without gates, L4 without L1 basics, no baseline before adoption, vendor lock-in via vendor-specific agents, "AI generated" confused with "AI verified".
- **When AI-augmented testing helps most / least** — tables for each.
- **Integration with skill modes** — diagnosis (rarely useful), design (candidate generation OK), campaign reporting (vendor claims ≠ deliverable shape), code review (same authorization discipline), CI/CD (track AI-induced churn), FinOps (real cost to track), engagement mode (evaluate via pilot, not direct adoption).
- **Reading list** with primary sources; explicit advice to skip vendor white papers presented as research and "we 10×'d our tests" LinkedIn posts.

**Updated `load-testing` profile** in `references/expert-profiles.md`:

- New triggers added: `AI testing`, `agentic testing`, `LoadMagic`, `Tricentis`, `Reflect`, `Mabl`, `correlation spectrum`, `HAR to test`, `self-healing test`
- Bundle now includes `ai-augmented-testing.md` when AI/agentic terms appear
- New common combo: `load-testing + evidence-driven` for vendor claim scrutiny

**Counts updated:**
- References: 29 → 30
- Profiles: 28 → 28 (load-testing extended, no new profile added — AI testing is part of load testing, not separate)

### Notes

- This reference takes a deliberately **vendor-neutral, evidence-cautious stance** on AI-augmented testing. The conceptually-useful patterns (correlation spectrum, three-layer architecture, HAR-to-test, self-healing, agent autonomy lessons) are extracted; specific product names appear as category examples not endorsements.
- The reference applies the skill's own `evidence-based-pe.md` discipline to vendor claims: every "20× speedup" should answer baseline, sample size, same-operator question, what-was-excluded, and reproducibility.
- The agent autonomy discipline from `code-review-commit-workflow.md` is explicitly extended to testing agents (read-only OK, mutations require per-change authorization, no auto-push or auto-trigger).
- Source for the conceptual frame: David Campbell, "AI Performance Engineering: How Agentic AI is Transforming Load Testing" (Leanpub, 2026) — extracted patterns, declined the vendor narrative.

---

## [1.3.0] — 2026-05-12

**Foundational addition: evidence-based methodology elevated to top-level principle across all modes.**

### Added

**Evidence-based performance engineering** (`references/evidence-based-pe.md`, ~480 lines):

- **The principle**: no recommendation without evidence, no claim without measurement, every change verified with before/after data.
- **Three corollaries**: no baseline → no improvement; no control → no causation; no statistical rigor → no confidence.
- **Supporting frameworks** (multiple, since no single canonical "Evidence-Based PE" framework):
  - Evidence-Based Software Engineering (EBSE) — Kitchenham, Dybå, Jørgensen (2004), imported from evidence-based medicine
  - Six Sigma DMAIC (Define-Measure-Analyze-Improve-Control) for structured improvement
  - The scientific method applied to perf (hypothesis → experiment → comparison → verdict, with mandatory quantitative prediction)
  - Statistical Process Control (Shewhart / Deming) — control charts for regression detection
  - DORA / Accelerate — four-metric measurement basis
  - Google SRE — SLI/SLO/error budgets as evidence-based decision making
  - Brendan Gregg's "Methodology First" — USE/RED/Golden Signals as systematic measurement
- **10-step before/after workflow**: SLO sentence → baseline → hypothesis → measurement plan → apply change (one variable) → measure post-change (same conditions) → compare (distributions, not points) → verdict (success/failure/inconclusive — honest) → document → control
- **Getting evidence — request OR execute decision**:
  - Path A — Request from user: when environment not accessible, when test would impact prod, when access permissions don't allow, when user is faster. Request template with specific fields (metric, window, source, load profile, resources)
  - Path B — Execute directly: when MCP tools available (Grafana query, k6 in staging via filesystem+bash, log analysis), with safety rules (read-only OK, mutations require explicit per-instance authorization, cost-incurring queries need cost confirmation)
  - Hybrid path most common in practice
- **Statistical rigor floor** (the agent enforces these, refuses to produce analyses that violate):
  - Percentiles over means for SLO metrics (p99/p99.9 standard; p99.9 for high-reliability)
  - Minimum 3 independent runs for synthetic comparison (single-point is not credible)
  - Confidence intervals or at minimum range/std-dev reported
  - Coordinated omission cross-check (load-gen vs server-side percentile match)
  - Multiple comparison problem awareness — change one thing at a time
  - Confound documentation and control where possible
- **4 templates** ready to fill out:
  - Hypothesis statement template (rationale, baseline, predicted post-change, falsification conditions, risk)
  - Measurement plan template (metric, method, source, sample size, statistical treatment, conditions to control, confounds, stop conditions, decision rule)
  - A/B test design template (variants, traffic split, duration, primary/secondary metrics, MDE, stop conditions, decision rule, sample size justification, rollback)
  - Verification report template (baseline, post-change, comparison, side effects, confounds, verdict, recommendation, learnings, monitoring)
- **15 anti-patterns the agent calls out when seen**: single-point comparison, mean for SLO, no baseline, multiple changes bundled, cherry-picked window, prod-vs-staging mismatch, coordinated omission, correlation confused with causation, no control, hypothesis fishing, means without distribution, stale baseline, "trust the dashboard" without query validation, self-reported by stakeholder, no post-change verification
- **Composition with every skill mode**: cross-references diagnosis / design / campaign reporting / code review / FinOps audit / agent team / ticket generation / LLM perf / CI/CD / skill self-maintenance — evidence requirement embedded in each
- **When evidence is insufficient** — honest postures including pushing back on user pressure for answers without baseline
- **Tools that produce evidence** — Grafana / Prometheus / k6 / JMeter / Datadog / Tempo / Jaeger / Pyroscope / pprof / OpenLLMetry / Helicone / Langfuse / Infracost / Lighthouse / custom RED-USE metrics
- Honest scope notes (statistical rigor is a continuum; formal statistical testing is appropriate for high-stakes but not required for every change; not a substitute for formal training)

**SKILL.md restructured with Step 0.5**:

- New **Step 0.5 — Evidence-based discipline** section inserted between context document section and modes table — elevated to foundational principle status alongside profile activation
- States the principle, supporting frameworks, statistical rigor floor, request-vs-execute decision
- Every mode in the modes table now implicitly carries this requirement
- The principle is the first thing Claude reads after profile activation — applies to everything downstream

**New profile in `references/expert-profiles.md`**:

- `evidence-driven` profile — triggers (evidence-based, data-driven, A/B test, centrado en datos, hypothesis testing, statistical rigor, DMAIC, EBSE, scientific method for perf, baseline first, coordinated omission concern), bundle `evidence-based-pe.md` + `diagnostic-playbooks.md` + `tool-selection-guide.md` (coordinated omission section) + `bottleneck-patterns.md`. **Cross-cutting overlay** — combines additively with stack/domain profiles to escalate rigor for regulated environments, customer-facing perf claims, multi-stakeholder reports.

**Counts updated:**

- References: 28 → 29
- Profiles: 27 → 28
- Modes: 10 → 10 (unchanged — principle applies across all)

### Why this is foundational (not just another reference)

Looking back at v1.0.0 through v1.2.0, the skill embodied evidence-based discipline implicitly:
- `diagnostic-playbooks.md` Step 0 "Build a feedback loop"
- `code-review-commit-workflow.md` "Expected impact" in commit templates
- `agent-team-orchestration.md` SLO sentence pattern
- `tool-selection-guide.md` coordinated omission section
- Universal optimization workflow with priority scoring formula requiring measured inputs
- "Numbers, not adjectives" stated as user preference

v1.3.0 makes this **explicit and centralized**. The methodology now has a dedicated reference, a top-level position in SKILL.md, a profile for explicit invocation, and cross-references throughout. The agent now actively pushes back when asked for recommendations without evidence — kindly but firmly.

---

## [1.2.0] — 2026-05-12

Major capability expansion: FinOps, CI/CD pipeline optimization, and skill self-maintenance workflow.

### Added

**FinOps and cloud cost optimization** (`references/finops-cloud-cost.md`, ~530 lines):

- FinOps Foundation 2026 Framework coverage — renamed capabilities (Usage Optimization, Architecting & Workload Placement), new Executive Strategy Alignment capability, FOCUS spec adoption signals (98% of FinOps teams now manage AI spend, 78% report to CTO/CIO)
- **Joint cost-perf decision discipline** — every recommendation states both axes; cost-perf decision matrix for instance choice, commitments, spot, autoscaling, storage tiers, database tiers, multi-region
- **AWS-specific levers**: Compute / EC2 / Convertible / Standard Savings Plans and RIs comparison, Spot strategy for production with mixed instance policies, S3 storage classes with Intelligent-Tiering recommendation, EBS gp3 over gp2, RDS / Aurora I/O-Optimized analysis, DynamoDB on-demand vs provisioned, Lambda ARM (Graviton2), NAT vs VPC endpoints, CloudFront, EKS with Karpenter + Spot
- **Azure-specific levers**: Savings Plans / RIs / Spot, Azure Hybrid Benefit (up to 85% off, frequently missed), storage tiers, SQL Database DTU vs vCore, Cosmos DB autoscale, AKS with Spot pools
- **GCP-specific levers**: Committed Use Discounts (CUDs), Sustained Use Discounts (SUDs), Spot VMs, Cloud Storage classes (Standard / Nearline / Coldline / Archive with minimum durations), BigQuery cost model (on-demand vs slot reservations vs Editions), GKE Autopilot vs Standard
- **Universal optimization patterns**: tagging strategy with minimum tag set + enforcement at provisioning, right-sizing workflow (14-30 day data, p95 utilization < 40%, validate against perf), idle resource detection (unattached volumes, idle LBs, stale snapshots, unused IPs, dev/test 24/7), egress / data transfer optimization (the universal expensive category), storage lifecycle policies
- **Kubernetes FinOps**: OpenCost (CNCF) / Kubecost / Karpenter / KEDA / Goldilocks tooling, K8s cost optimization 7-step workflow, common K8s cost anti-patterns
- **AI / LLM workload FinOps**: token-level attribution patterns, cost-per-unit-of-work as KPI (per inference, per token, per interaction, per task), AI cost optimization techniques cross-referenced with `llm-perf-and-tokens.md`, GPU selection (H100 vs A100 vs L40S vs L4), ARM/Graviton for non-GPU AI workloads, edge inference, **self-fund AI pattern** (FinOps Foundation 2026 — fund AI via optimization savings)
- **Multi-cloud cost normalization**: FOCUS spec, cross-cloud tools (CloudHealth / Apptio / Vantage / CloudZero), open-source (OpenCost / Komiser / Infracost), **Infracost in CI as one of highest-ROI cost controls**
- **Tools landscape**: cloud-native (Cost Explorer / Azure Cost Mgmt / GCP Billing), open-source, commercial (CloudHealth / Apptio / Vantage / CloudZero / Cast AI / Spot.io / Datadog Cloud Cost / Flexera), LLM-specific (Helicone / Langfuse / PromptLayer / LangSmith)
- **Engagement workflow**: Inform (Week 1 visibility) → Optimize easy wins (Week 2-3, 15-30% reduction typical) → Optimize architectural (Week 4+) → Operate (governance with PR-time cost diff via Infracost)
- 10-item FinOps anti-patterns checklist
- Honest scope notes (PE-engineer perspective, not FinOps Foundation textbook)

**CI/CD pipeline performance optimization** (`references/cicd-pipeline-optimization.md`, ~440 lines):

- **Distinct from existing `cicd-perf-gates.md`** — that one is about gating prod via perf tests; this one optimizes the pipeline ITSELF
- Why pipeline perf matters: developer feedback loop math (every minute of CI = ~50 dev-minutes/day for 10-engineer teams)
- **DORA metrics** — Deployment frequency, Lead time for changes, Change failure rate, MTTR with Elite team targets
- **CI optimization**: build caching as biggest lever (per language ecosystem), test parallelization with isolation discipline, Docker BuildKit layer caching with registry-backed cache, monorepo tooling (Bazel / Nx / Turborepo / Pants), self-hosted vs cloud runners decision matrix, skip-work patterns (path filters, draft PRs, commit message hints, branch-specific)
- **CD optimization**: deployment strategies (rolling / blue-green / canary / progressive delivery / feature flags / shadow), GitOps with Argo CD / Flux (sync interval, webhook-driven, app-of-apps, sync waves), pre/post-deploy hooks, rollback automation (Argo Rollouts / Spinnaker / GitOps revert / DB migration discipline), deploy gates with anti-pattern (always-passing rubber-stamp gates)
- **Pipeline observability**: metrics to track (build duration, test duration, cache hit rate, flaky test rate, pipeline cost, queue depth, concurrent jobs, all DORA metrics), tooling (GitHub Actions Insights / GitLab CI Analytics / Datadog CI Visibility / Honeycomb for CI / Dora-DX / DX / LinearB)
- **Platform-specific levers**: GitHub Actions (concurrency, reusable workflows, runner choice cost multipliers), GitLab CI (parent-child pipelines, DAG, auto-cancel), Jenkins (parallel stages, agent allocation), Argo CD / Flux (sync waves, sync windows, resource hooks), Spinnaker (Kayenta canary gates)
- 12-item pipeline anti-patterns checklist
- **Engagement workflow**: Audit (Week 1: baseline + hot-path workflows + cache hit rate + test profile + cost) → Quick wins (Week 2: cache fixes, parallelization, slow-test relocation, path filters) → Structural (Week 3+: BuildKit migration, monorepo tooling, self-hosted hot-path runners, concurrency limits, reusable workflows, artifact handoff) → CD improvements (Week 4+: GitOps, canary, feature flags, auto-rollback, DB migration discipline)
- CI/CD cost as DevEx metric — surface "$ per build" and "$ per developer per month"
- Honest scope notes (platform-specific recipes evolve fast, DORA measures flow not quality)

**Skill self-maintenance workflow** (`references/skill-self-maintenance.md`, ~430 lines):

- **Honest framing first**: this is NOT autonomous self-update. It's a documented workflow the user invokes ("audit this skill", "research and update X", "we moved to Claude 5.0").
- **Three maintenance modes**:
  - **Mode 1 — Periodic audit**: staleness detection checklist (version-specific content like JEP numbers / JVM distributions / Anthropic API features / cloud features / FinOps Framework versions; link rot via web_fetch spot-checks; outdated claims; missing emerging topics; internal consistency between files), audit output format with categorized findings (STALE / GAP / LINK ROT / INCONSISTENCY) before any changes
  - **Mode 2 — Research and propose**: scope confirmation → research with `web_search` + `web_fetch` using authoritative source hierarchy (OpenJDK JEPs / kubernetes.io / docs.claude.com / finops.org / Inside.java / Brendan Gregg / etc.) → draft in skill voice → propose as atomic commits via `code-review-commit-workflow.md` → per-commit user authorization → validate with `quick_validate.py`
  - **Mode 3 — Model-upgrade review**: when Anthropic ships a new model, review affected sections (SKILL.md Step 0, agent-team-orchestration.md tier mapping, llm-perf-and-tokens.md current snapshot, expert-profiles.md), update model names, re-evaluate tier mapping, check pricing assumptions
- **Commit message templates** for skill maintenance (`docs:` for updates / `fix:` for corrections, with source citations)
- **Quality gates** for proposed updates: source citation, currency (6mo fast-moving / 12mo+ stable), cross-source confirmation, voice consistency, no bluffing on specifics, honest scope notes
- **Frequency recommendations** table: periodic full audit quarterly, topic-specific research as-needed, model-upgrade review per new Anthropic model, link rot annually, internal consistency after any large addition, major framework changes as-needed
- **What this skill does NOT auto-update**: no autonomous edits, no git push, no version bump without consent, no license changes, no INTEGRATION-NOTES edits without documenting why
- **Retire vs update** decision pattern for obsolete content
- Tools that may help (web_search, web_fetch, view, str_replace, validate, package, future scripts/)

**Three new expert profiles in `references/expert-profiles.md`:**

- `finops` — triggers (FinOps, cloud cost, AWS bill, Savings Plan, RI, CUD, Spot, right-sizing, FOCUS spec, Infracost, OpenCost, Kubecost, etc.), bundle `finops-cloud-cost.md` + `runtimes-on-kubernetes.md` + `llm-perf-and-tokens.md` (when AI involved) + `bottleneck-patterns.md`, common combos with java-k8s / llm-perf / engagement-mode / observability
- `cicd-pipeline` — triggers (CI, CD, pipeline, GitHub Actions, GitLab CI, Argo CD, DORA, BuildKit, monorepo, canary, GitOps, etc.), bundle `cicd-pipeline-optimization.md` + `cicd-perf-gates.md` (complementary) + `bottleneck-patterns.md`, common combos with engagement-mode / finops / java-k8s / observability
- `skill-maintenance` — triggers (audit this skill, what's stale, research and update, model upgrade review, etc.), bundle `skill-self-maintenance.md` + `code-review-commit-workflow.md` + `expert-profiles.md` (the catalog the audit checks). **Critical: does NOT enable autonomous editing.**

**Three new modes in SKILL.md modes table:**

- **FinOps audit mode** — Inform → Optimize → Operate workflow with joint cost-perf decision discipline
- **Skill self-maintenance mode** — audit + research-and-propose + atomic-commit-with-authorization
- **Code review mode** was already added in v1.1.0; updates ensure it composes with the new profiles

**Counts updated:**

- References: 25 → 28
- Profiles: 24 → 27
- Modes: 8 → 10

### Notes for users

- The skill is now substantial (~10k lines of skill content). Use expert profiles aggressively — loading `finops` + `java-k8s` for a cloud cost engagement is far less noise than loading everything.
- Self-maintenance is workflow, not magic. To use it: ask Claude to "audit this skill" or "research X and propose updates". The skill provides the structure; Claude does the work; you authorize each change.
- FinOps and CI/CD profiles compose with existing profiles. A typical cloud-perf engagement might activate `spring-boot + java-k8s + observability + finops + engagement-mode` simultaneously.

---

## [1.1.0] — 2026-05-12

### Added

**Meta-engineering: LLM perf and code-review workflow** — the skill now covers performance engineering applied to the engineer's own AI-driven workflow plus a structured code-review-to-commit workflow with authorization gates.

- `references/llm-perf-and-tokens.md` (535 lines) — LLM workflow performance reference:
  - Token economy fundamentals (token counting via Anthropic API, cost equation, latency equation)
  - Anthropic-specific features: **prompt caching** (cache_control with 5min / 1h TTL, ~90% cost reduction on cache hits), **Batch API** (50% discount, 24h SLA), **streaming** (TTFT optimization), **parallel tool use**, **structured outputs** (tool_choice as schema enforcement)
  - Model tier selection: tier table (Top / Mid / Light = Opus 4.7 / Sonnet 4.6 / Haiku 4.5), two-stage pipeline pattern (Light filter → Mid/Top processing), explicit anti-patterns (Opus for ceremonies, Haiku for architecture)
  - Prompt engineering for token efficiency: cache the stable / vary the user, few-shot economy, max_tokens discipline, iterative system prompt compression
  - **Input-side optimization (RTK family)**: full coverage of Rust Token Killer (`rtk-ai/rtk`) — install (`brew install rtk-ai/tap/rtk` / `cargo install rtk` / `rtk init -g`), commands (`rtk read`, `rtk grep`, `rtk find`, `rtk smart`, etc.), concrete savings (cargo test 91.8%, git status 80.8%, find 78.3%, grep 49.5%), scope notes (Bash hook only; built-in Read/Grep/Glob bypass), manual fallbacks when RTK unavailable
  - **Output-side optimization (Caveman family)**: Matt Pocock's caveman mode for ~75% output token reduction (drop articles / filler / pleasantries; keep technical exact), auto-clarity exception (security warnings, irreversible actions), other reduction techniques (structured outputs, max_tokens, stop_sequences, response length instruction in system prompt)
  - RAG / retrieval optimization: RAG vs full context decision, chunking strategies (size, overlap, semantic), reranking, conversation history compression patterns
  - LLM observability: extended RED method, metrics to track (input/output token distributions, cache hit rate, TTFT, cost per request, error rate by type, tool call distribution), tooling (OpenLLMetry, Helicone, Langfuse, PromptLayer, LangSmith, `rtk gain --history`)
  - Production patterns: cache layer, embedding cache, idempotency keys, retry with backoff (but NOT on quality failures), circuit breakers
  - LLM perf profiles (5 patterns): high-volume batch, latency-critical UX, cost-constrained, quality-critical, long-running agentic

- `references/code-review-commit-workflow.md` (565 lines) — atomic commit workflow with authorization:
  - The workflow loop: identify → group as vertical slices → order by ROI → per-commit (show diff + explain + propose commit message + ask authorization → commit) → summary
  - Perf smell checklist: universal (19 items: N+1, sync I/O hot path, missing timeouts, unbounded retries, cache without invalidation, allocation in hot loops, etc.) + per-language smells for Java/Node.js/Go/Python
  - Vertical-slice grouping rules and anti-patterns
  - ROI-based commit ordering with priority score formula
  - **Per-commit authorization protocol** with explicit message template (file, issue, why-it-matters, diff, expected impact, proposed commit message, risk, approve/reject/modify gate)
  - Conventional Commits standard for perf: type prefix rules (perf:/refactor:/fix:/feat:/test:/docs:/chore:), subject-line discipline (≤72 chars, imperative, no period, lowercase first word), body templates with what/why/measurement/trade-offs structure
  - **Commit message templates** per perf change type: N+1 fix, index addition, cache introduction, async conversion, algorithm improvement, JVM/GC tuning, resource limit / pool sizing
  - **Hard authorization rules**: per-commit explicit approval (never batch under single "approve all"); explicit authorization for `git push`, `git push --force`, `git merge`, `git rebase`, `git reset --hard`, PR creation, tagging, deploys; pre-flight checklist before commit work (clean git status, correct branch, sign config)
  - Multi-commit projects: branch convention (`perf/<area>-<change>`), PR description template with summary / commits list / verification / rollback / risk register
  - Feature flag patterns for risky perf changes
  - Code review checklist (14-item fast-scan for reviewing PRs vs writing commits)
  - "When the user just wants the review, no commits" alternative flow

**New profiles in `references/expert-profiles.md`:**

- `llm-perf` profile — triggers (LLM, token, prompt caching, Batch API, RTK, Caveman, Claude API, model tier, etc.), bundle (`llm-perf-and-tokens.md` + `bottleneck-patterns.md` + `agent-team-orchestration.md`), common combos with `engagement-mode`, `observability`, `db-perf`
- `code-review` profile — triggers ("review my code", paste of code with implicit perf question, "atomic commits", "conventional commits"), bundle (`code-review-commit-workflow.md` + `bottleneck-patterns.md` + universal optimization workflow from `runtime-perf-tuning.md`), **critical operating rule documented**: every commit requires explicit per-instance authorization; no batch approval; git push/merge/rebase/PR creation each require separate authorization

**New mode in SKILL.md modes table:**

- **Code review mode** — when user shares code (file / PR / repo) and asks for perf review. Activates `code-review` profile + relevant runtime profile (e.g., `code-review + spring-boot` for Java code). Per-commit authorization protocol enforced.

**Counts updated:**

- References: 23 → 25
- Profiles: 22 → 24

---

## [1.0.0] — 2026-05-12

Initial public release.

### Added

**Foundational structure:**
- 22 reference files organized across 6 categories
- 8 modes of operation (intake, diagnosis, design, campaign reporting, study/paper, ticket generation, agent team mode)
- 22 expert profiles for selective loading (java, spring-boot, java-k8s, nodejs, nodejs-k8s, golang, python, dotnet, php, frontend, db-perf, observability, load-testing, resilience, microservices, serverless, message-queue, cache-layer, api-gateway, grpc, graphql, engagement-mode)
- Context document template for per-system engagement state
- Engagement Brief template with explicit SLA/SLO sentence pattern

**Diagnosis & analytical:**
- Diagnostic playbooks with "Step 0 — Build a feedback loop" + "Step 0.5 — Round-trip time budgeting" + USE method commands + RED method commands + metric-source discrepancy investigation
- Bottleneck patterns reference (11 patterns with confirmation steps and ranked remediation)
- Memory leak detection for JVM / Node.js / Go / Python
- Analytical frameworks integrated into SKILL.md: USE (Gregg), RED (Wilkie), Golden Signals (Google), Pepperdine, Beckwith, Little's Law, USL (Gunther), Amdahl, Apdex

**Runtime tuning:**
- Universal optimization workflow with priority scoring formula `(freq × blast_radius × gain) / (risk × effort)` and one-PR-per-improvement output template
- Hot-path smells (language-agnostic)
- JVM section with Java 21/24/25 LTS coverage: virtual threads pinning fix (JEP 491), Compact Object Headers (JEP 519), Generational ZGC default, Project Leyden AOT cache (JEPs 483/514/515), Scoped Values (JEP 506), Structured Concurrency (JEP 505)
- JVM in containers: ActiveProcessorCount caveat + pre-flight checklist
- Systematic JVM tuning methodology adapted from Alibaba Cloud: 3 principles + 3 application phases + 5-step procedure + active data size calculation + object promotion rate estimation
- Java frameworks & distributions: comparison of 12 distributions (Temurin, Corretto, Zulu, Azul Prime, Oracle, GraalVM, Dragonwell, SapMachine, Liberica, Semeru/OpenJ9, Red Hat, Microsoft), framework tuning for Spring Boot / Quarkus / Micronaut / Helidon / Vert.x / Pekko-Akka / Dropwizard / Jakarta EE, GraalVM Native Image tradeoffs
- Node.js section: V8 flags, clinic/0x profiling, event-loop monitoring, hot-path smells
- Go section: pprof endpoints, escape analysis, channel patterns
- Python section: py-spy, asyncio, GIL workarounds

**Kubernetes:**
- Universal cross-runtime patterns: QoS classes, CPU throttling (CFS) detection with PromQL, liveness/readiness/startup probes (with the "liveness depends on DB" anti-pattern), graceful shutdown sequence (universal 7-step), image strategy comparison
- Java-on-K8s: CRaC (Coordinated Restore at Checkpoint) workflow, HPA + JVM warmup tension, Leyden vs CRaC vs Native Image decision matrix, heap dump persistent volume
- Node.js-on-K8s: single-process discipline, graceful shutdown code, event-loop blocking detection in containers
- Go-on-K8s: Go 1.25 GOMAXPROCS auto-fix (25× p99 improvement documented), GOMEMLIMIT, static binary
- Python-on-K8s: gunicorn workers vs CPU limits, GIL + CFS interaction
- 15-item anti-patterns checklist + engagement review checklist

**Tooling:**
- k6 patterns: project structure, 5-block pattern, executors (constant-arrival-rate, constant-vus, ramping), browser / gRPC / WS support, OpenAPI generation
- Tool selection guide: k6 vs JMeter vs Gatling vs Locust vs wrk2 vs Vegeta with decision criteria, coordinated omission table, cross-check pattern, histogram bucket saturation deep-dive
- CI/CD perf gates: pipeline integration with GitHub Actions / GitLab examples, threshold strategies, baseline comparison

**Observability:**
- PromQL for performance: SLI/SLO queries, USE/RED dashboards, multi-window multi-burn-rate alerts, regression detection
- Grafana stack observability: LGTM stack from PE perspective (Loki/Mimir/Tempo/Pyroscope) plus Beyla/Alloy/Faro, cross-signal correlation, span profiles

**Frontend:**
- Web Vitals deep-dive: LCP/INP/CLS diagnosis and remediation, RUM vs synthetic, performance budgets, Lighthouse CI, image/font/code-splitting optimization
- DevTools performance snippets: curated JavaScript snippets for Chrome DevTools console (CWV measurement, loading, interaction, media, resources)

**Deliverables:**
- Short-form templates: executive 1-pager, technical diagnosis, campaign report
- Long-form templates: performance study, white paper, perf-focused post-mortem
- Ticket generation: vertical-slice structure, Linear-compatible default, adapt-to-yours pattern

**Engagement orchestration:**
- Agent team mode: simulated cross-functional team (PM, Scrum Master, Tech Lead, Engineer, SRE, QA, on-summon Specialists), GSD cadence with daily standup format, sprint loop, Definition of Done by role, handoff protocols, conflict resolution
- Model selection guidance by role (tier-based: top/mid/light + current model snapshot)
- Two-stage pipeline pattern (Haiku → Sonnet/Opus) for high-volume work

**Distribution:**
- README.md with quick start, usage examples, model selection guide, integration with other skills
- INTEGRATION-NOTES.md documenting integration decisions from 19 source repos (13 integrated, 6 rejected with reasoning)
- LICENSE (MIT)
- `scripts/` directory placeholder for future executable tools
- `assets/` directory placeholder for future templates and static files
- `examples/` directory with sample engagement context document and ticket bundle
- External tools and MCP integration reference documenting how the skill consumes MCP servers (Grafana, Linear/Jira, Slack, Datadog, etc.) with tool discovery patterns

### Sources integrated

- nucliweb/webperf-snippets (Joan León) — DevTools snippet library
- addyosmani/web-quality-skills — Performance budgets, Core Web Vitals
- grafana/skills (official) — LGTM stack documentation
- mattpocock/skills — Feedback loop methodology, vertical slices
- microlink.io nodejs-performance — Priority scoring formula, one-PR workflow
- claudskills.com java-performance / pluginagentmarketplace custom-plugin-java — JVM GC presets, JMH templates
- Alibaba Cloud — Systematic JVM tuning methodology (modernized for Java 25)
- rcampos09/performance-testing-skills — k6 5-block pattern
- khanntm/performance-engineering — DB optimization, memory leak patterns
- KimDoubleB/grafana-k6-skills — Resilience testing
- charlyautomatiza/grafana-k6-plugin — Plan→Build→Validate lifecycle
- pabblaz/k6-performance-skills — k6 project structure
- nntan90/qa-skill-suite — Self-check pattern

### Evaluated and rejected (with documented reasoning)

- secondsky/web-performance-optimization — marginal value-add, heavy overlap with existing content
- browserbase/skills — scope mismatch (browser automation, not PE)
- jvm-skills.com directory — meta-directory, no skill content
- cchesser/java-perf-workshop — interactive workshop, not skill content
- yzavyas/claude-1337 — meta-cognition plugins, scope mismatch
- giuseppe-trisciuoglio/developer-kit — 150-skill marketplace, scope dilution
- bradtaylorsf/alphaagent-team — Claude Code marketplace plugin (cited as comparative reference for agent role pattern)
