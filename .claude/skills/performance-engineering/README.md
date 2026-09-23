# Performance Engineering Skill

> A FAANG-level Performance Engineering skill for Claude. Diagnose, architect, analyze, and report on system performance — with the rigor of a Principal Performance Engineer and the bias-to-action of a GSD-style cross-functional team.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Skill Format](https://img.shields.io/badge/format-Anthropic%20Skill-purple)](https://docs.claude.com/en/docs/agents-and-tools/agent-skills)
[![References](https://img.shields.io/badge/references-30-green)]()

---

## What this is

A single Claude Skill that turns Claude into a senior performance engineer for the duration of your conversation. It covers the full lifecycle: **strategy → diagnosis → architecture → testing → observability → reporting → ticket generation → multi-week engagements**.

It is built for engineers who do real performance work — not slide decks. The voice, defaults, and rigor target a Principal Performance Engineer at FAANG scale: percentile-based, evidence-driven, vendor-neutral, blameless.

---

## Quick start

### 1. Install

In Claude.ai (web or desktop):

1. Open **Settings → Capabilities → Skills**
2. Click **Upload skill**
3. Select `performance-engineering.skill`
4. Toggle the skill on

The skill activates automatically on relevant queries.

### 2. Use it

Just ask. The skill triggers on natural phrasing — no special syntax:

```
"Why is my checkout p99 spiking?"
"Help me design a load test campaign for the new payment gateway."
"Review this Grafana panel for SLO compliance."
"Draft tickets for these 8 perf findings, vertical slices."
"Activate team mode for this client engagement."
```

### 3. Optional: provide a context document

For systems you work on regularly, maintain a context document (architecture, infra, known issues, ADRs, available tools). The skill reads it at session start and skips re-asking what's documented. See `references/context-document-template.md` for the template.

---

## Why this exists

Performance work has a recurring pattern: someone notices "the system is slow," a team spends two weeks chasing the wrong cause, ships a partial fix, and goes back to firefighting. The root problem is rarely technical — it's process, rigor, and communication discipline.

This skill encodes the practices that prevent that failure mode:

| Common failure | What this skill enforces |
|---------------|--------------------------|
| "It's slow" without a number | Percentile + baseline + evidence on every claim |
| Single hypothesis, confirmed | 3-5 ranked hypotheses, falsifiable, before instrumenting |
| Load test results overstate capacity | Coordinated-omission-aware tooling required |
| Recommendations without effort/risk | Every recommendation ranked by `(impact × confidence) ÷ (effort × risk)` |
| Tickets that say "fix slow checkout" | Vertical-slice tickets with measurable acceptance criteria |
| Status updates without demos | "If you can't demo it, it didn't ship" |
| Multi-week engagements drift | GSD-style team mode with PM, Scrum Master, Tech Lead, Engineer, SRE, QA roles |

---

## What's included

- **30 reference files** organized by category (foundational, diagnosis, runtime, domain, tooling, deliverables, meta-engineering, orchestration)
- **28 expert profiles** for selective loading (java, spring-boot, java-k8s, nodejs, golang, python, dotnet, php, frontend, db-perf, observability, load-testing, resilience, microservices, serverless, message-queue, cache-layer, api-gateway, grpc, graphql, **evidence-driven**, **llm-perf**, **code-review**, **finops**, **cicd-pipeline**, **skill-maintenance**, engagement-mode, and k8s variants) — auto-detected from user's stack signals or activated explicitly
- **Sample engagement** in `examples/` with fully filled context document, engagement brief, vertical-slice tickets, and executive digest
- **Extension structure**: empty `scripts/` and `assets/` directories with documented patterns for future tools, MCP integrations, and binary templates
- **8 modes of operation** that route different task types through specialized workflows
- **Agent team mode** for multi-deliverable engagements (PM + SM + Tech Lead + Engineer + SRE + QA + summoned specialists)
- **Templates** for executive 1-pagers, technical diagnoses, performance studies, white papers, post-mortems, tickets (Linear-compatible default + adapt-to-yours), context documents
- **Vendor-neutral coverage** of k6, JMeter, Gatling, Locust, wrk2, Vegeta; Grafana / Mimir / Loki / Tempo / Pyroscope; Prometheus / PromQL; Datadog; Dynatrace; OpenTelemetry; Faro RUM; Lighthouse CI

---

## Selective loading — expert profiles

The skill ships **22 reference files**, but most engagements only need 3-5 of them. Loading everything would add noise to every response. The skill solves this with **expert profiles** — pre-curated bundles that map stack/domain → references-to-read.

### How it works

When you start a conversation, the skill detects which profile fits your context from your first substantive message:

- **Stack signals** activate runtime profiles: `Java`, `Spring Boot`, `Node.js`, `Go`, `Python`, `.NET`, `PHP`
- **Platform signals** add overlays: `Kubernetes`, `Lambda`, `Cloud Run`, `serverless`
- **Domain signals** activate specialized profiles: `Prometheus`, `Istio`, `Web Vitals`, `k6`, `Kafka`, `Redis`, `GraphQL`, `gRPC`
- **Engagement signals** activate orchestration: `team mode`, `campaign`, `multi-week`, `actúa como mi tech lead`

The skill announces which profile activated and which references that loads. You can ignore the announcement, override it, or combine with adjacent profiles.

### Profile catalog

| Profile | When to activate |
|---------|------------------|
| `java` | Java/JVM/Kotlin/Scala work, GC tuning, JFR/JMH |
| `spring-boot` | Spring Boot / Hibernate / Actuator specifically |
| `java-k8s` | Java/Spring + Kubernetes (most common Java engagement) |
| `nodejs` | Node.js / Express / Fastify / NestJS / V8 |
| `nodejs-k8s` | Node.js + Kubernetes |
| `golang` | Go runtime, pprof, goroutines, GOMAXPROCS |
| `python` | Python / Django / Flask / FastAPI / gunicorn |
| `dotnet` | .NET / C# / ASP.NET Core (partial — universal patterns only) |
| `php` | PHP / Laravel / Symfony / PHP-FPM (partial — universal patterns only) |
| `frontend` | Web Vitals / React / Vue / Angular / Lighthouse / RUM |
| `db-perf` | SQL optimization, indexing, connection pools, ORM N+1 |
| `observability` | Prometheus / Grafana / OTel / mesh metrics / SLI-SLO design |
| `load-testing` | k6 / JMeter / Gatling / Locust / campaign design |
| `resilience` | Chaos engineering / circuit breakers / GameDays |
| `microservices` | Distributed systems / fan-out / cross-service tracing |
| `serverless` | Lambda / Cloud Run / Functions / cold start |
| `message-queue` | Kafka / RabbitMQ / SQS / consumer lag |
| `cache-layer` | Redis / Memcached / cache stampede / invalidation |
| `api-gateway` | Istio / Envoy / Linkerd / service mesh |
| `grpc` | gRPC / protobuf / streaming / deadlines |
| `graphql` | GraphQL / Apollo / DataLoader / persisted queries |
| `evidence-driven` | Evidence-based PE methodology overlay — baseline + hypothesis + measurement + verification rigor |
| `llm-perf` | LLM workflow optimization / token efficiency / prompt caching / RTK / Caveman |
| `code-review` | Static code review for perf with atomic commit workflow |
| `finops` | Cloud cost optimization (AWS / Azure / GCP / K8s / AI workloads) |
| `cicd-pipeline` | CI/CD pipeline performance optimization + DORA metrics |
| `skill-maintenance` | Audit and propose updates to this skill (workflow, not autonomous) |
| `engagement-mode` | Multi-week client engagement / team mode / GSD cadence |

### Multi-profile activation (the common case)

Real engagements cross domains. A Spring Boot service in EKS with Prometheus metrics activates **`spring-boot` + `java-k8s` + `observability`** simultaneously — the union of all three bundles loads, everything else is skipped.

### Manual override

You can pin a profile, add one mid-conversation, or opt out entirely:

```
"activate profile golang"          → switches profile
"add profile observability"        → adds to current set
"clear profiles" / "cargá todo"    → opts out of selective loading
```

### Honest scope notes

For `dotnet` and `php` profiles, the skill does **not** currently have dedicated runtime tuning references (CLR GC modes, PHP-FPM tuning, OPcache configuration). Universal patterns from the bundle still apply, but runtime-specific tuning advice comes from general knowledge rather than curated content. The skill flags this in its disclosure on activation.

Full profile mechanics — triggers, bundles, combination rules, anti-patterns — are documented in `references/expert-profiles.md`.

---

## Modes of operation

The skill identifies the operating mode from your message and follows that workflow. A single conversation can move between modes (intake → diagnosis → tickets, for example).

| Mode | Triggers on | Output |
|------|-------------|--------|
| **Intake** | Incomplete or ambiguous input | Structured questions, requests for specific artifacts (charts, traces, profiles) |
| **Diagnosis** | Problem investigation with sufficient evidence | 6-step methodology: frame → hypothesize → evidence → quantify → recommend → verify |
| **Design** | Preventive performance design | Architectural patterns, capacity model, ADRs |
| **Campaign reporting** | Reporting on a perf testing campaign | Full report with scope, load model, percentile results, bottleneck evidence, capacity headroom, prioritized recommendations |
| **Study / paper** | Research-style document request | Performance study, white paper, or perf-focused post-mortem |
| **Ticket generation** | Converting findings into trackable work | Vertical-slice tickets with measurable acceptance criteria; adapts to your tracker template |
| **Agent team mode** | Multi-deliverable engagements, multi-week projects, "team mode" / "scrum mode" requests | Cross-functional team simulation with role tags, GSD cadence, sprint loop, Definition of Done |

---

## Usage examples

### Single-question diagnosis

> **You:** Our checkout p99 went from 280ms to 1.2s after this morning's deploy. Here's the Grafana panel [link]. Help me figure out what happened.
>
> **Claude:** [reads the panel, asks for one trace ID and the deploy diff, builds three ranked hypotheses, identifies which one matches the evidence, proposes a fix with rollback criteria]

### Performance test campaign

> **You:** I need to validate our new payment service handles 3x BFCM peak. Stack is Java + Postgres + Redis. We have k6 in CI.
>
> **Claude:** [asks the intake checklist questions, designs a campaign with smoke / load / stress / spike / soak / breakpoint scenarios, generates the k6 scripts following the 5-block pattern, sets thresholds tied to your SLOs, suggests a campaign report structure]

### Multi-week engagement (agent team mode)

> **You:** Activate team mode. Client engagement: 3-week perf optimization for an e-commerce checkout. Goal is p99 < 500ms with 99.95% availability.
>
> **Claude:**
> ```
> [PM] Scope confirmed. Need: stakeholders, success metrics, freeze windows, regulatory constraints. Sending intake questionnaire.
> [TL] Once context doc lands, I'll propose initial backlog of vertical slices.
> [SM] Will run sprint planning Monday, daily standups thereafter.
> ```
> [over the engagement, runs intake → sprint planning → daily standups → demos → exec digests with role tags throughout]

### Convert findings to tickets

> **You:** Here's the analysis report. Generate tickets for our Linear workspace. Use this template [paste].
>
> **Claude:** [parses the template, structures findings as vertical slices, fills in the template's exact fields, produces ranked priority based on error-budget burn, adds verification plans and rollback criteria, offers to create them in Linear via MCP after your review]

---

## Configuration: the context document

For systems you work on repeatedly, create a context document once. The skill reads it at session start and uses it to:

- Skip questions already answered (architecture, stack, SLOs, available tools)
- Recognize known issues without re-diagnosing
- Respect ADRs as constraints when proposing changes
- Activate available tools (Grafana CLI, MCP servers, etc.) instead of asking for screenshots
- Use your domain terminology consistently

See `references/context-document-template.md` for the full template (12 sections, with a minimal 1-page version for new systems).

---

## Model selection

When this skill drives multi-agent workflows (API pipelines, Claude Code sub-agents, tool-orchestrated systems), match the model to the role:

| Tier | Use for | Roles & tasks |
|------|---------|---------------|
| **Top** (highest reasoning) | Architecture, executive synthesis, ADRs, hard judgment | PM (exec 1-pagers), Tech Lead (strategy, ADRs), conflict arbitration |
| **Mid** (workhorse) | Standard technical work, code generation, hands-on diagnosis | Senior Engineer, SRE, QA, most Specialists |
| **Light** (fast, cheap, high throughput) | Classification, filtering, repetitive ceremonies, bulk processing | Scrum Master ceremonies, filter stages, log/trace triage |

Two-stage pipeline pattern (Light → Mid/Top): use a cheap filter to reduce volume before expensive analysis. Apply this shape to alert triage, trace sampling, ticket classification.

For current Anthropic models and pricing, see https://docs.claude.com. The mapping above is durable across model versions; specific recommendations are in `references/agent-team-orchestration.md`.

---

## Reference index

References load on demand. The skill reads only what each task needs.

### Foundational
- `context-document-template.md` — per-system context document structure
- `intake-checklists.md` — structured questions and artifact requests by task type
- `evidence-based-pe.md` — foundational methodology: no recommendation without evidence; no claim without measurement; every change verified with before/after. Supporting frameworks (EBSE, DMAIC, scientific method, SPC, DORA, SRE), 10-step before/after workflow, request-vs-execute decision, statistical rigor floor (percentiles, sample sizes, CI, coordinated omission, one-variable-at-a-time), 4 templates (hypothesis, measurement plan, A/B test, verification report), 15 anti-patterns. Applies to every mode.
- `expert-profiles.md` — selective loading router: 28 profiles (java, spring-boot, java-k8s, nodejs, golang, python, dotnet, php, frontend, db-perf, observability, load-testing, resilience, microservices, serverless, message-queue, cache-layer, api-gateway, grpc, graphql, evidence-driven, llm-perf, code-review, finops, cicd-pipeline, skill-maintenance, engagement-mode, k8s variants) with triggers, bundles, combination rules, disclosure templates
- `external-tools-and-mcp.md` — how the skill consumes MCP servers (Grafana, Linear, Slack, Datadog, GitHub, etc.) with tool discovery patterns, permission rules per action type, extension recipes for adding new MCPs or custom scripts

### Diagnosis & analysis
- `diagnostic-playbooks.md` — USE/RED commands, profiling, tracing, metric-source discrepancy investigation, "build a feedback loop" methodology
- `bottleneck-patterns.md` — 11 diagnostic patterns matching symptoms to root causes with confirmation steps and ranked remediation
- `promql-for-perf.md` — PromQL for SLI/SLO measurement, USE/RED dashboards, multi-window multi-burn-rate alerts, regression detection
- `grafana-stack-observability.md` — LGTM stack (Loki / Mimir / Tempo / Pyroscope) plus Beyla, Alloy, Faro from a PE perspective; cross-signal correlation; Span Profiles

### Domain-specific deep dives
- `db-optimization.md` — query analysis, indexing, N+1 detection, connection pools, caching with invalidation, replicas, partitioning
- `memory-leak-detection.md` — soak tests, heap analysis, runtime-specific patterns (JVM, Node, Go, Python)
- `runtime-perf-tuning.md` — proactive runtime tuning: **Java 21/24/25 LTS** (virtual threads pinning fix in JDK 24, Compact Object Headers, Generational ZGC default, Project Leyden AOT cache, Scoped Values), systematic JVM tuning methodology (3 principles + 5-step procedure + active data calc + promotion rate, adapted from Alibaba Cloud), Node.js V8 flags and event-loop monitoring, Go pprof and `GOGC`/`GOMEMLIMIT`, Python profiling. Universal optimization workflow with priority scoring formula and one-PR-per-improvement output template
- `java-frameworks-and-distributions.md` — JVM distributions (Temurin, Corretto, Zulu, Azul Prime, GraalVM, Dragonwell, SapMachine, Liberica, Semeru/OpenJ9, Oracle, Microsoft, Red Hat) with decision shortcuts; framework-specific tuning for Spring Boot (virtual threads + Spring AOT + Leyden), Quarkus, Micronaut, Helidon, Vert.x, Pekko/Akka, Dropwizard, Jakarta EE; GraalVM Native Image tradeoffs; stack decision matrix
- `runtimes-on-kubernetes.md` — Kubernetes-specific runtime perf: QoS classes, CPU throttling/CFS detection, probes (liveness/readiness/startup), graceful shutdown sequence; Java on K8s (CRaC checkpoint/restore for 7× startup, HPA + JVM warmup tension, Leyden vs CRaC vs Native Image); Node.js on K8s (single-process discipline, memory math, event-loop blocking detection); Go on K8s (Go 1.25 GOMAXPROCS auto-fix delivering 25× p99 improvement); Python on K8s (workers config, gunicorn timeouts vs probe timing); anti-patterns checklist + engagement review checklist
- `web-vitals-deep-dive.md` — LCP / INP / CLS diagnosis, RUM vs synthetic, performance budgets, Lighthouse CI, image / font / code-splitting optimization
- `devtools-performance-snippets.md` — curated JavaScript snippets for Chrome DevTools console (CWV measurement, loading, interaction, media, resources)
- `resilience-chaos-testing.md` — failure mode taxonomy, circuit breakers, bulkheads, hedged requests, load shedding, GameDay structure

### Performance testing tooling
- `k6-patterns.md` — project structure, executors, 5-block pattern, common mistakes, test type templates, browser / gRPC / WS, OpenAPI generation
- `tool-selection-guide.md` — k6 vs JMeter vs Gatling vs Locust vs wrk2 vs Vegeta with decision criteria
- `cicd-perf-gates.md` — pipeline integration, threshold strategies, baseline comparison for regression detection, GitHub Actions / GitLab examples
- `ai-augmented-testing.md` — AI/agentic load testing patterns: correlation spectrum (5 levels), three-layer architecture (observe/decide/prove), HAR-to-test workflow, self-healing tests (with anti-pattern for performance assertions), agent autonomy with authorization gates, vendor landscape (LoadMagic, Tricentis, Reflect, Mabl as examples), evidence-based vendor claim evaluation

### Deliverables
- `deliverable-templates.md` — short-form templates (executive 1-pager, technical diagnosis, campaign report)
- `study-paper-templates.md` — long-form templates (performance study, white paper, perf-focused post-mortem)
- `ticket-generation.md` — convert findings to tickets with vertical-slice structure; default Linear-compatible template; adapts to user-provided templates

### Meta-engineering (perf of the perf engineer)
- `llm-perf-and-tokens.md` — LLM workflow performance: token economy, Anthropic prompt caching, Batch API (50% discount), model tier selection with two-stage pipeline, streaming for TTFT, parallel tool use, structured outputs, RTK (Rust Token Killer) for 60-90% input-side reduction on dev commands, Caveman mode for output-side compression (~75%), RAG / retrieval optimization, conversation compression, LLM observability stack
- `code-review-commit-workflow.md` — perf-focused static code review with atomic commits: perf smell checklist (universal + Java/Node/Go/Python), vertical-slice grouping, ROI ordering, per-commit explicit user authorization, Conventional Commits format with body templates per change type, feature-flag patterns, multi-commit PR structure, rollback discipline
- `finops-cloud-cost.md` — FinOps and cloud cost optimization: FinOps Foundation 2026 Framework + FOCUS spec, joint cost-perf decision discipline, AWS / Azure / GCP cost levers (Savings Plans / RIs / CUDs / Spot / storage tiers), universal patterns (tagging, right-sizing, idle detection, egress, lifecycle), Kubernetes FinOps (OpenCost / Kubecost / Karpenter), AI workload cost (98% of FinOps teams now manage AI spend), tool landscape, engagement workflow
- `cicd-pipeline-optimization.md` — CI/CD pipeline performance: build caching, test parallelization, Docker BuildKit, monorepo tooling (Bazel / Nx / Turborepo), self-hosted vs cloud runners, deployment strategies (rolling / blue-green / canary / progressive), GitOps (Argo CD / Flux), feature flags, rollback automation, DORA metrics, pipeline observability, platform-specific levers
- `skill-self-maintenance.md` — workflow (not autonomous) for keeping this skill current: periodic audit (staleness, link rot, outdated claims, gaps, consistency), research-and-propose mode with web_search + authoritative source hierarchy, model-upgrade review for new Anthropic models, quality gates for proposed updates, retirement vs update decisions. Every change requires explicit user authorization via the code-review commit workflow.

### Multi-deliverable engagement orchestration
- `agent-team-orchestration.md` — agent team mode: simulated cross-functional team (PM, SM, Tech Lead, Engineer, SRE, QA, on-summon Specialists), GSD cadence, role transitions, sprint loop, Definition of Done, handoff protocols, conflict resolution, model selection by role

---

## Integration with other skills

This skill is designed to compose. It does not duplicate adjacent disciplines — install complementary skills alongside:

| Adjacent skill | Recommended when |
|---------------|------------------|
| [`grafana/skills`](https://github.com/grafana/skills) (official) | You're a Grafana operator or plugin developer; complements this skill's PE-perspective coverage |
| [`addyosmani/web-quality-skills`](https://github.com/addyosmani/web-quality-skills) | You also need accessibility, SEO, or general best-practices coverage beyond performance |
| [`mattpocock/skills`](https://github.com/mattpocock/skills) | You need general engineering skills (TDD, codebase architecture, issue triage workflow) |
| [`browserbase/skills`](https://github.com/browserbase/skills) | You need browser automation, scraping, or QA UI testing |
| [`serkan-ozal/browser-devtools-claude`](https://github.com/serkan-ozal/browser-devtools-claude) | You have the Chrome DevTools MCP server connected and want full automated devtools workflows |

Skills coexist in Claude.ai without conflict — each activates on its own triggers.

---

## What this skill is not

- **Not a beginner tutorial.** It assumes you know what p99, USE method, and OpenTelemetry are. If you don't, start with the references inline; they're written tutorial-friendly but assume engineering context.
- **Not a replacement for human judgment.** It enforces rigor and structure. Final calls on architecture, business trade-offs, and customer commitments stay with you.
- **Not a vendor pitch.** k6 is the recommended default for CI/CD, but JMeter, Gatling, Locust, wrk2 are documented with their sweet spots. Same for observability stacks.
- **Not infallible.** When confidence is low, it says so. When evidence contradicts a hypothesis, it pivots. When you're heading the wrong way, it pushes back.

---

## Skill metadata

| Property | Value |
|----------|-------|
| Format | Anthropic Skill (.skill bundle) |
| Activation | Automatic on perf-related triggers; manual via "activate performance-engineering" |
| Distribution | Single skill bundle (not a marketplace plugin) |
| Platform | Claude.ai (web, desktop, mobile); compatible with API and Claude Code |
| Reference loading | On-demand (only relevant references read per task) |
| Persona | Principal Performance Engineer, FAANG-scale |
| Voice | Spanish-comfortable when user writes Spanish; industry terms in English; numbers over adjectives |

---

## Package structure

```
performance-engineering/
├── SKILL.md                   # Claude's entry point — read first on every session
├── README.md                  # This file — for human readers
├── CHANGELOG.md               # Version history
├── INTEGRATION-NOTES.md       # Transparency on integrated sources
├── LICENSE                    # MIT
├── .gitignore                 # For repository maintenance
│
├── references/                # On-demand loaded content (progressive disclosure)
│   ├── expert-profiles.md             # Selective loading router (Step 0)
│   ├── context-document-template.md   # Per-engagement context structure
│   ├── intake-checklists.md           # Question banks per task type
│   ├── external-tools-and-mcp.md      # MCP integration + tool patterns
│   ├── diagnostic-playbooks.md        # USE/RED commands, feedback loops
│   ├── bottleneck-patterns.md         # 11 patterns with confirmations
│   ├── promql-for-perf.md             # PromQL for SLI/SLO/regression
│   ├── grafana-stack-observability.md # LGTM stack from PE perspective
│   ├── runtime-perf-tuning.md         # JVM/Node/Go/Python tuning
│   ├── java-frameworks-and-distributions.md # Spring/Quarkus/etc + JDK distros
│   ├── runtimes-on-kubernetes.md      # K8s deployment surface per runtime
│   ├── web-vitals-deep-dive.md        # LCP/INP/CLS + Lighthouse CI
│   ├── devtools-performance-snippets.md  # Browser console snippets
│   ├── db-optimization.md             # Query/index/pool/caching
│   ├── memory-leak-detection.md       # Heap/soak per runtime
│   ├── resilience-chaos-testing.md    # Circuit breakers + GameDay
│   ├── k6-patterns.md                 # k6 5-block + executors + browser
│   ├── tool-selection-guide.md        # k6/JMeter/Gatling/Locust + CO
│   ├── cicd-perf-gates.md             # Pipeline gates + thresholds
│   ├── deliverable-templates.md       # 1-pager / diagnosis / campaign
│   ├── study-paper-templates.md       # Study / white paper / post-mortem
│   ├── ticket-generation.md           # Vertical-slice tickets
│   └── agent-team-orchestration.md    # PM+SM+TL+Eng+SRE+QA roles, GSD
│
├── scripts/                   # Future executable code (currently empty)
│   └── README.md              # Naming conventions + extension recipe
│
├── assets/                    # Future binary templates (currently empty)
│   └── README.md              # Template/dashboard JSON patterns
│
└── examples/                  # Sample engagement materials
    ├── README.md
    └── sample-engagement-acme-corp/
        ├── context-document.md       # Fully filled-out context doc
        ├── engagement-brief.md       # 1-page PM brief
        ├── sample-tickets.md         # 3 vertical-slice tickets
        └── sample-exec-digest.md     # Weekly executive 1-pager
```

### Extensibility hooks

This package is designed for future growth:

| Hook | Purpose | Documented in |
|------|---------|---------------|
| `scripts/` | Executable code for deterministic tasks (PromQL validators, k6 generators, GC log analyzers) | `scripts/README.md` |
| `assets/` | Binary templates and dashboard JSON for output generation | `assets/README.md` |
| MCP integration | Connect Grafana, Linear, Slack, GitHub, Datadog, etc. via tool_search discovery pattern | `references/external-tools-and-mcp.md` |
| New profiles | Add stack/domain profiles for selective loading as the skill grows | `references/expert-profiles.md` |
| Real engagement examples | Add redacted artifacts from completed engagements as calibration anchors | `examples/README.md` |

The architecture supports these extensions without requiring restructure of the core skill content.

---

## Acknowledgments

Built by integrating, synthesizing, and adapting content from twelve high-quality community and official skill repositories:

- **Joan León** ([nucliweb/webperf-snippets](https://github.com/nucliweb/webperf-snippets)) — DevTools snippet library and workflow structure that anchored `devtools-performance-snippets.md`
- **Addy Osmani** ([addyosmani/web-quality-skills](https://github.com/addyosmani/web-quality-skills)) — Web Vitals and performance budget guidance integrated into `web-vitals-deep-dive.md`
- **Grafana Labs** ([grafana/skills](https://github.com/grafana/skills)) — Official LGTM stack documentation that informed `promql-for-perf.md` and `grafana-stack-observability.md`
- **Matt Pocock** ([mattpocock/skills](https://github.com/mattpocock/skills)) — "Build a feedback loop" methodology and vertical-slice / tracer-bullet patterns
- **Microlink** ([microlink.io/skills/nodejs-performance](https://microlink.io/skills/nodejs-performance)) — Priority scoring formula `(freq × blast_radius × gain) / (risk × effort)`, one-PR-per-improvement workflow, and hot-path smell catalog in `runtime-perf-tuning.md`
- **claudskills.com / SASMP framework** ([java-performance](https://claudskills.com/skills/java-performance/SKILL.md), also distributed via [pluginagentmarketplace/custom-plugin-java](https://github.com/pluginagentmarketplace/custom-plugin-java)) — JVM GC presets, JMH templates, profiling commands, and Java 21+ virtual-threads guidance in `runtime-perf-tuning.md`
- **Alibaba Cloud** ([How to Properly Plan JVM Performance Tuning](https://www.alibabacloud.com/blog/how-to-properly-plan-jvm-performance-tuning_594663)) — Systematic JVM tuning methodology: three principles (Minor GC collection, Memory maximization, "two of three" trade-off), application phases (initialization / stability / summary), active-data-size calculation procedure, and object-promotion-rate estimation. Modernized for Metaspace and Java 21/25 GC defaults in `runtime-perf-tuning.md`
- **rcampos09** ([performance-testing-skills](https://github.com/rcampos09/performance-testing-skills)) — k6 5-block pattern, common mistakes, bottleneck pattern structure
- **khanntm** ([performance-engineering](https://github.com/khanntm/performance-engineering)) — DB optimization, memory leak detection, real-world bottleneck examples
- **KimDoubleB** ([grafana-k6-skills](https://github.com/KimDoubleB/grafana-k6-skills)) — Resilience testing patterns, browser test DSL examples
- **Carlos Gauto / charlyautomatiza** ([grafana-k6-plugin](https://github.com/charlyautomatiza/grafana-k6-plugin)) — Plan → Build → Validate lifecycle
- **Pablo Blanco** ([k6-performance-skills](https://github.com/pabblaz/k6-performance-skills)) — k6 project structure conventions
- **nntan90** ([qa-skill-suite](https://github.com/nntan90/qa-skill-suite)) — Self-check pattern adapted for pre-delivery checklist

Full integration decisions, including content rejected with documented reasoning (Browserbase, secondsky, jvm-skills directory, java-perf-workshop, claude-1337, developer-kit, alphaagent-team), are in `INTEGRATION-NOTES.md`.

All source repositories are MIT or Apache-2.0 licensed.

---

## License

MIT — see [LICENSE](LICENSE).

---

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for full version history.

**Current version: 1.4.0** (2026-05-13) — Adds `references/ai-augmented-testing.md` covering AI/agentic load testing patterns (Correlation Spectrum, Three-Layer Architecture, HAR-to-Test workflow, self-healing tests with anti-pattern for performance assertions, agent autonomy with authorization gates, vendor landscape evaluation). Vendor-neutral and evidence-cautious — extracts conceptual patterns from the space without endorsing specific products. Updates `load-testing` profile to bundle this reference when AI/agentic terms appear.

---

## Feedback and contributions

This skill is a living artifact. Refresh it monthly; update after every engagement.

If you adapt it for a specific client or domain, the typical extension patterns are:
- Add a `references/<client>-context.md` for client-specific terminology and reporting formats
- Add a `references/<stack>-runbooks.md` for organization-specific incident playbooks
- Tighten `intake-checklists.md` to your team's actual question set

Treat this README and `INTEGRATION-NOTES.md` as documentation; treat `SKILL.md` and `references/` as the working content.
