# Context document — template and usage guide

A **context document** is a per-system Markdown file the user maintains and provides at the start of any performance engineering session. It encodes everything stable about the system so we don't re-elicit it every conversation.

The skill reads this document at session start and uses it to:
- Skip questions already answered (architecture, stack, SLOs, tooling).
- Recognize known issues without re-diagnosing.
- Respect ADRs as constraints when proposing changes.
- Activate available tools (Grafana CLI, MCP servers, etc.) instead of asking for screenshots.
- Use the user's domain terminology consistently.

A good context document is a living artifact: review it monthly, update after every incident, version it in git alongside the code it describes.

---

## Template

Copy this and fill in. Delete sections that don't apply. Keep it under ~5 pages — if it's longer, split per-subsystem into linked files.

```markdown
# [System name] — Performance Engineering Context

**Owner**: [team / person]
**Last updated**: [YYYY-MM-DD]
**Version**: [git SHA or document version]
**Status**: Active / Deprecated / Migrating

---

## 1. System overview

One paragraph: what this system does, who uses it, the critical user journeys.

**Critical journeys** (in order of business priority):
1. [Journey name] — [SLO summary, e.g., "checkout p99 < 500ms, availability 99.95%"]
2. [Journey name] — [SLO summary]
3. [Journey name] — [SLO summary]

## 2. Architecture

Brief architecture description with a diagram (link or embed). Cover:

- **Components**: services, datastores, queues, caches, CDN, edge.
- **Boundaries**: what's in the system vs external dependencies.
- **Critical paths**: which components participate in each critical journey.
- **Data flow**: how requests propagate; sync vs async portions.

[Diagram link or ASCII sketch here]

## 3. Infrastructure

- **Cloud / on-prem**: [provider, regions, AZs]
- **Compute**: [k8s cluster sizes, instance types, autoscaling rules]
- **Datastores**: 
  - [name, version, topology — primary/replicas, sharding, sizing]
- **Messaging**: [Kafka/Pulsar/SQS/etc., versions, partition counts, retention]
- **Caching**: [Redis/Memcached topology, sizing, eviction policy]
- **Network**: [VPC layout, service mesh in use, ingress/egress patterns, CDN]
- **Deploy cadence**: [continuous / weekly / monthly; freeze windows]

## 4. SLOs and current performance baseline

| Service / journey | SLI | SLO target | Current (p99) | Error budget status |
|-------------------|-----|------------|---------------|---------------------|
| Checkout | p99 latency | < 500ms | 412ms | 47% remaining (monthly) |
| Login | p95 latency | < 300ms | 380ms | exhausted, +12% |
| ... | | | | |

**Last measured**: [date]. Source: [Grafana dashboard link / report link].

## 5. Stack details

- **Languages / runtimes**: [Java 21, Python 3.12, Node 20, Go 1.22 — be specific about versions]
- **Frameworks**: [Spring Boot 3.2, FastAPI, Express, etc.]
- **APM / tracing**: [Datadog APM, OpenTelemetry → Tempo, etc. — sampling rate]
- **Logging**: [where logs go, retention, structured format yes/no]
- **Metrics**: [Prometheus + Grafana, Datadog, etc. — scrape interval, retention]
- **Profiling**: [continuous profiler in place? Pyroscope/Parca/Datadog Profiler/none]

## 6. Architecture Decision Records (ADRs)

Short list of decisions that constrain performance work. Each ADR links to the full document.

| ID | Title | Status | Constraint for perf work |
|----|-------|--------|--------------------------|
| ADR-007 | Synchronous replication for orders DB | Accepted | Cannot relax to async without product approval |
| ADR-014 | No client-side caching for pricing | Accepted | Pricing freshness > latency |
| ADR-022 | Single-region deployment for compliance | Accepted | Cannot distribute geographically |
| ... | | | |

Full ADRs live at: [link]

## 7. Known issues / accepted technical debt

Things we already know are slow or fragile, with their context. Update this list when new ones surface.

| # | Symptom | Root cause | Workaround | Accepted until | Owner |
|---|---------|------------|------------|----------------|-------|
| 1 | Reports endpoint p99 spikes to 8s on Mondays | Weekly aggregation job runs without throttle | Schedule shifted to Sunday night | Q3 platform refactor | [team] |
| 2 | Checkout occasional 503 at deploy time | No graceful shutdown on payment service | Manual draining | Tracked in PERF-142 | [team] |
| ... | | | | | |

Cross-reference: when the user reports a new symptom, **check this table first**. If it matches a known issue, say so and don't re-diagnose.

## 8. Historical incidents (last 12 months, perf-related)

| Date | Title | Sev | Root cause summary | Post-mortem link |
|------|-------|-----|--------------------|-----| 
| 2025-11 | Checkout latency spike during BFCM | SEV1 | Connection pool exhaustion under spike | [link] |
| 2025-09 | Slow rollout of v2.1 to EU region | SEV2 | Missed canary metric, deploy proceeded | [link] |
| ... | | | | |

## 9. Available tools and access

Declare what's connected/available. The skill uses this to know whether to fetch data itself or ask the user.

### Observability access

- **Grafana**: [URL]
  - Access: [user has read access / viewer-only / admin]
  - **Grafana CLI / MCP server**: [yes — connected via MCP / no]
  - Key dashboards: 
    - [System Overview]: [link]
    - [SLO Dashboard]: [link]
    - [USE Method per service]: [link]
- **Prometheus**: [URL or via Grafana]
  - PromQL access: [direct / via Grafana only]
- **Tracing**: [Tempo / Jaeger / Datadog APM] — [URL]
  - Trace retention: [N days]
- **Logs**: [Loki / ELK / Datadog Logs / CloudWatch] — [URL]
- **Continuous profiling**: [Pyroscope / Parca / Datadog Profiler / none] — [URL]

### Source code

- **Repos**: 
  - [service-a]: [git URL]
  - [service-b]: [git URL]
- **Access level for Claude**: [read-only via MCP / no access]

### Issue tracker

- **Linear / Jira / GitHub Issues**: [URL]
- **MCP server**: [yes — connected / no]
- **Default project / team for new tickets**: [name]
- **Ticket template**: [link or paste — see `references/ticket-generation.md` for usage]

### Other tools

- **Load testing**: [k6 + result store, or k6 Cloud, etc.]
- **Chaos / GameDay tooling**: [Gremlin / LitmusChaos / none]
- **Runbook location**: [link]
- **On-call / paging**: [PagerDuty / Opsgenie] — [link to schedule]

### Access boundaries

What Claude is **not** allowed to do (be explicit):
- [ ] Touch production directly
- [ ] Read PII even from anonymized samples
- [ ] Create tickets without explicit user confirmation
- [ ] Suggest changes that contradict ADRs without flagging the conflict
- [ ] [Other]

## 10. Domain glossary

User-facing or internal terminology that the skill should use consistently.

| Term | Meaning |
|------|---------|
| Quoter | Internal pricing/quotation service |
| SOAP campaign | Nightly performance test window |
| ... | |

## 11. Stakeholders and reporting cadence

- **Primary technical contact**: [name / role]
- **Executive sponsor**: [name / role] — receives [executive 1-pager] [weekly / monthly]
- **Engineering leads** (per service): [list]
- **Standing performance review**: [cadence and format]

## 12. Open initiatives

Active performance-related workstreams the skill should be aware of so it doesn't recommend something already in flight.

- [Initiative]: [status, owner, ETA]
- [Initiative]: [status, owner, ETA]
```

---

## How the skill uses each section

When a session starts and a context document is present, here's how each section flows into the work:

| Section | How the skill uses it |
|---------|------------------------|
| 1. System overview | Frame every recommendation in terms of business journeys, not abstract "the system". |
| 2. Architecture | Constrains hypotheses; e.g., don't suggest sharding if architecture shows a single-tenant DB by design. |
| 3. Infrastructure | Sizes capacity recommendations against actual instance types and topology. |
| 4. SLOs and baseline | Skips re-asking for SLO targets; references the baseline directly when quantifying impact. |
| 5. Stack details | Tunes profiling tooling recommendations to the actual runtime (e.g., async-profiler for JVM, pprof for Go). |
| 6. ADRs | Treated as hard constraints. Any recommendation that contradicts an ADR is flagged explicitly and routed back to product/architecture for re-decision. |
| 7. Known issues | First-pass filter: matching symptom → "this looks like known issue #N, not a new one". |
| 8. Historical incidents | Cross-reference current symptoms against past incidents to avoid re-diagnosing the same root cause. |
| 9. Available tools | Activates proactive use of MCP servers / CLIs instead of asking the user for screenshots and pastes. |
| 10. Glossary | Used in all responses and deliverables — adopt user's terminology. |
| 11. Stakeholders | Tunes deliverable format to the audience automatically. |
| 12. Open initiatives | Avoids recommending work that's already in flight. |

---

## Minimal context document

For a new system or when the full template feels heavy, the skill can work with a **minimal** version (under 1 page):

```markdown
# [System] — Context (minimal)

**Stack**: [language, datastore, infra in 1 line]
**Critical journey + SLO**: [journey] — [target percentile + threshold]
**Current baseline**: p99 [value] (source: [link])
**Observability**: [tool] at [URL]; tracing via [tool]
**Available tools for diagnosis**: [list, including MCP servers if any]
**Known issues**: [bullet list of 2-5 most relevant]
**ADRs that constrain perf work**: [bullet list of 2-5]
**Ticket tracker**: [tool] at [URL]; default template: [link or "default"]
**Boundaries**: [what Claude must not do]
```

The skill should accept the minimal version without complaining, but flag (gently, once) what's missing that would meaningfully improve future sessions.

---

## When the context document is missing or stale

- **Missing**: ask the user once whether one exists. If not, offer to draft one collaboratively over the next few sessions, harvesting answers from the questions you'd otherwise ask anyway. Don't block on this — proceed with the task using normal Intake mode.
- **Stale** (signs: dates > 6 months old, references to deprecated services, version numbers behind reality): say so explicitly. Ask whether to (a) trust it as-is for this session and update it after, or (b) refresh the relevant sections before proceeding.
- **Conflicting with current evidence** (the doc says one thing, the data the user just shared says another): the data wins, but flag the contradiction so the user can update the doc.
