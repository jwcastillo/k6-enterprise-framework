# Integration notes

This skill integrates synthesized content from six external repositories. This document records what was integrated and what was deliberately not, so future maintainers understand the choices.

## Sources

| Source | Repo | Status |
|--------|------|--------|
| qa-suite | https://github.com/nntan90/qa-skill-suite | Integrated (selective) |
| k6-perf-skills | https://github.com/pabblaz/k6-performance-skills | Integrated (selective) |
| perf-testing-skills | https://github.com/rcampos09/performance-testing-skills | Integrated (selective) |
| khanntm-pe | https://github.com/khanntm/performance-engineering | Integrated (selective) |
| grafana-k6-plugin | https://github.com/charlyautomatiza/grafana-k6-plugin | Integrated (selective) |
| grafana-k6-skills | https://github.com/KimDoubleB/grafana-k6-skills | Integrated (selective) |
| grafana-skills (official) | https://github.com/grafana/skills | Integrated (selective) |
| addyosmani/web-quality-skills | https://github.com/addyosmani/web-quality-skills | Integrated (perf + CWV only) |
| nucliweb/webperf-snippets | https://github.com/nucliweb/webperf-snippets | Integrated (synthesized snippet library) |
| serkan-ozal/browser-devtools-claude | https://github.com/serkan-ozal/browser-devtools-claude | **Integrated (Web Performance APIs only — MCP-coupled skills NOT integrated)** |
| mattpocock/skills | https://github.com/mattpocock/skills | Integrated (selective — feedback loop + vertical slices) |
| claudskills.com java-performance | https://claudskills.com/skills/java-performance/SKILL.md | Integrated (JVM section of `runtime-perf-tuning.md`) |
| pluginagentmarketplace/custom-plugin-java | https://github.com/pluginagentmarketplace/custom-plugin-java | **Partially integrated** — `java-performance` already absorbed via claudskills (same source); `java-concurrency` virtual-threads + thread-pool-sizing absorbed; other 10 skills rejected as out of scope |
| alibabacloud.com / How to Properly Plan JVM Performance Tuning | https://www.alibabacloud.com/blog/how-to-properly-plan-jvm-performance-tuning_594663 | **Integrated** (Systematic JVM tuning methodology section in `runtime-perf-tuning.md`, modernized) |
| microlink.io nodejs-performance | https://microlink.io/skills/nodejs-performance | Integrated (Node section + universal optimization workflow) |
| jvm-skills.com directory | https://github.com/jvm-skills/jvm-skills | **Evaluated and rejected — meta-directory, no skill content** |
| cchesser/java-perf-workshop | https://github.com/cchesser/java-perf-workshop | **Evaluated and rejected — interactive workshop, not skill content** |
| yzavyas/claude-1337 | https://github.com/yzavyas/claude-1337 | **Evaluated and rejected — meta-cognition plugins, scope mismatch** |
| giuseppe-trisciuoglio/developer-kit | https://github.com/giuseppe-trisciuoglio/developer-kit | **Evaluated and rejected — general dev marketplace, scope dilution** |
| bradtaylorsf/alphaagent-team | https://github.com/bradtaylorsf/alphaagent-team | **Evaluated as comparative reference — agent role pattern validated, no integration** |
| secondsky/web-performance-optimization | https://github.com/secondsky/claude-skills (subdir) | **Evaluated and rejected — marginal aporte** |
| browserbase/skills | https://github.com/browserbase/skills | **Evaluated and rejected — scope mismatch** |

## What was integrated (with attribution)

### `references/k6-patterns.md` — synthesized k6 reference

Combined from:
- **perf-testing-skills/k6-best-practices**: 5-block pattern, common mistakes (sleep, check vs threshold, SharedArray, OOM with `open()`), output format triple (script + run command + executor rationale), executors table.
- **khanntm-pe/k6-patterns**: test type templates (smoke/load/stress/spike/soak/breakpoint with concrete `options`), env-aware config pattern.
- **grafana-k6-skills (KimDoubleB)**: `generating-api-load-tests`, `designing-test-scenarios`, `generating-browser-tests`, `generating-tests-from-openapi`, `analyzing-test-results` — browser DSL example, gRPC/WebSocket DSLs, custom metrics for business KPIs, prometheus-rw output.
- **k6-perf-skills (pabblaz)**: project directory structure (`adapters/`, `tests/`, `config/`, `resources/`, `utils/`, `global/`), auth pattern templates (Bearer, HMAC, API key), env JSON config approach, no-hardcoding rule.
- **grafana-k6-plugin (charlyautomatiza)**: plan → build → validate lifecycle as a quality gate.

### `references/tool-selection-guide.md`

Combined from:
- **perf-testing-skills**: gatling-best-practices, locust-best-practices skill content.
- **khanntm-pe/jmeter-patterns**: enterprise JMeter conventions (CLI not GUI in production, distributed mode, CSV Data Set Config).
- General industry knowledge (wrk2, Vegeta, ab/siege as anti-patterns).

### `references/bottleneck-patterns.md`

Combined from:
- **perf-testing-skills/performance-report-analysis/BOTTLENECK-PATTERNS**: structure (signatures, confirmation, remediation), patterns 1-3 (CPU saturation, memory leak, DB).
- **khanntm-pe real-world-lessons-insurance-app**: STP claim engine bottleneck pattern, AWS Performance Insights soak observations.
- New: GC pathology pattern (Pattern 10), coordination overhead via USL β (Pattern 9), cold cache (Pattern 11), multi-bottleneck reality framing.

### `references/cicd-perf-gates.md`

Combined from:
- **khanntm-pe/cicd-perf-testing**: GitHub Actions k6 example with k6 install, threshold gate stages by duration.
- **grafana-k6-skills (KimDoubleB)/operating-k6-in-ci-cd**: Prometheus remote write integration, threshold strategies.
- **perf-testing-skills/k6-best-practices**: CI integration tips.
- New: rolling baseline comparison (regression detection beyond hard thresholds), pre-deploy canary section.

### `references/db-optimization.md`

Mostly from **khanntm-pe/database-performance-optimization**, restructured around: confirm-it's-the-DB → query analysis → indexing → N+1 → connection pool → caching layers (with invalidation strategies) → replicas → partitioning. Added Postgres tuning table and "when you've exhausted the DB" pivot section.

### `references/memory-leak-detection.md`

From **khanntm-pe/memory-leak-detection**, restructured by runtime (JVM, Node, Go, Python) with tool-specific commands and code examples per runtime. Added third-party library leak workflow section.

### `references/web-vitals-deep-dive.md`

Combined from:
- **khanntm-pe/web-performance**: Core Web Vitals targets, supporting metrics (TTFB, FCP, TBT).
- **grafana-k6-skills (KimDoubleB)/generating-browser-tests**: k6/browser DSL example.
- New: per-metric diagnosis sections (what makes LCP/INP/CLS slow, with remediation), bundle size targets, Lighthouse CI budget example.

### `references/resilience-chaos-testing.md`

Mostly from **grafana-k6-skills (KimDoubleB)/testing-resilience**, expanded with: failure mode taxonomy table, resilience pattern verification approach, chaos tooling comparison, GameDay structure, combined load + chaos test pattern, resilience SLOs concept.

### `references/promql-for-perf.md` — new (from grafana-skills official)

Synthesized from **grafana-skills/grafana-core/promql** and **grafana-lgtm/prometheus**. Scoped specifically to what a PE writes day-to-day rather than a general PromQL tutorial:
- The non-negotiable rules (rate before aggregation, `[range]` ≥ 4× scrape, histogram `by (le)`).
- RED method PromQL (rate, error ratio, percentile histograms).
- USE method PromQL (CPU/memory/disk/network).
- SLO measurement and **multi-window multi-burn-rate alerts** (Google SRE pattern).
- Regression detection via `offset` operator.
- Top-N queries (worst offenders).
- DB/connection pool / GC / runtime queries.
- **Recording rules** with PE-relevant naming convention (`level:metric:operation_window`).
- Cardinality discipline.
- Bonus LogQL and TraceQL primers for cross-signal correlation.

### `references/grafana-stack-observability.md` — new (from grafana-skills official)

Synthesized from **grafana-skills/grafana-lgtm/{loki,tempo,prometheus,pyroscope,mimir}**, **grafana-core/{alloy,beyla,opentelemetry,alerting-irm}**, **grafana-cloud/{app-observability,database-observability,testing}**. Covers the LGTM stack from a PE diagnostic lens, not as a Grafana sysadmin guide:
- Mental model: four signals, one stack — when each is the right starting point.
- **Tempo / TraceQL** for PE workflows (slow request hunting, critical path analysis, span profiles drill-down).
- **Loki / LogQL** essentials for spike correlation and cardinality discipline.
- **Pyroscope** continuous profiling: instrumentation choices, profile types (CPU, off-CPU, alloc, goroutines, locks), differential flame graphs, **Span Profiles** (per-request flame graph via shared trace ID).
- **Beyla** for zero-instrumentation observability when source-level changes aren't possible.
- **Alloy / OTel Collector** as the source of metric-source discrepancies (batching, sampling), with explicit config to inspect.
- **Grafana Cloud Application Observability**, **Faro RUM** for frontend, **k6 Cloud**, **Database Observability** — when each replaces hand-rolled dashboards.
- **Symptom vs cause alerting** philosophy with provisioning-as-code example.
- Quick decision tree (symptom → first place to look in the stack).
- Updated guidance for the **context document**: the specific Grafana fields a user should declare to enable proactive tool use.

### Updates to `SKILL.md`

- Added pre-delivery self-check (inspired by **qa-suite**'s self-review loop pattern, but condensed to perf-relevant items only — not a full QA self-check).
- Restructured reference list into categories: Foundational / Diagnosis / Domain / Tooling / Deliverables.

## What was deliberately NOT integrated

### From qa-suite

- **ISTQB Foundation/Advanced/Manager framing**: out of scope. This skill is performance engineering, not general QA. Adopting ISTQB taxonomy would dilute focus and add terminology the target user (performance engineer at a FAANG-scale consulting role) doesn't use.
- **The "20-year senior tester" persona with phrases like "I've seen this miss bugs in production before"**: redundant. The skill already establishes a "Principal Performance Engineer with 15 years FAANG-scale experience" persona. Layering another role-play persona creates conflict and feels theatrical.
- **B1-level English language standard**: rejected. The target user is a Principal-level engineer who explicitly asked for FAANG-level rigor; simplifying language would undercut credibility. Industry-standard terms in English (`tail latency`, `coordinated omission`, `flame graph`) are part of the value, not jargon.
- **Sub-skill suite for unit-test, manual-test, security-test, e2e-test, automation-framework**: out of scope. These are QA concerns adjacent to but distinct from performance engineering. Mixing them dilutes the skill's triggering accuracy.
- **The Vietnamese-language input schema in performance-test SKILL.md**: not integrated due to language inconsistency; the conceptual schema (mandatory inputs before scripting) is reflected in `intake-checklists.md`.

### From k6-perf-skills (pabblaz)

- **`run-k6.sh` wrapper script convention**: too specific to one team's workflow. The k6-patterns.md mentions a wrapper as optional but doesn't prescribe one.
- **Auth generator templates as standalone scripts**: integrated as inline patterns in `k6-patterns.md` instead of as separate template files (avoids file proliferation).

### From perf-testing-skills (rcampos09)

- **`evals/evals.json` test cases**: out of scope for a single-skill bundle. If the user wants benchmark-driven optimization, they can run skill-creator's eval framework against the current skill.
- **`scaffold.sh` / `validate.sh` scripts**: would be useful but require a different deployment model (executable scripts in skill bundle). Not added in this iteration.
- **`compatibility` frontmatter listing supported agents**: omitted because Claude.ai Skills do not surface this field; could be added if the skill is also published to skills.sh.

### From khanntm-pe

- **`mobile-app-performance.md` (Fiddler → JMeter)**: the Fiddler-specific workflow is dated. Mobile API performance is partially covered in `web-vitals-deep-dive.md` (mobile section) and `tool-selection-guide.md`. Could be expanded if the user has a mobile-heavy use case.
- **`cloud-perf-testing.md` (AWS/GCP-specific)**: cost optimization concepts are integrated into `cicd-perf-gates.md`; cloud-specific distributed load generation is a niche topic and was deferred.
- **`real-world-lessons-insurance-app.md`**: lessons (STP claim engine, AWS rightsizing, soak test 12h) are integrated as patterns in `bottleneck-patterns.md`. The narrative form (one client's story) was dropped in favor of the pattern form (transferable across clients).

### From grafana-k6-plugin (charlyautomatiza)

- **Tool Discovery Protocol with explicit `AskUserQuestion` / `mcp:sampling` / `confirm_action` fallback ladder**: Claude.ai already handles user interaction via `ask_user_input_v0` and natural conversation. Replicating this protocol in a skill is over-engineering.
- **`disable-model-invocation` / `user-invocable` frontmatter flags**: not part of the standard Anthropic Skills frontmatter; would be ignored by the runtime.
- **Per-skill `MISSING REQUIREMENT` fallback contract format**: the intake checklists in `references/intake-checklists.md` cover this need with more flexibility.

### From grafana-k6-skills (KimDoubleB)

- **Plugin marketplace structure (`marketplace.json`, multiple plugins)**: this skill is distributed as a single `.skill` bundle, not as a marketplace. If we later want to publish to a marketplace, the structure can be added.
- **Cross-skill `/k6:<skill-name>` reference syntax**: only meaningful in a marketplace with multiple sibling skills.
- **`.specs/external/` git submodules for k6-docs**: dependency management out of scope for a single-skill bundle.

### From grafana-skills (official Grafana repo)

The official Grafana repo has 6 plugins with ~40 skills. Most are out of scope for a Performance Engineering skill — they target Grafana operators, plugin developers, or Grafana Cloud admins, not performance engineers.

**Integrated (synthesized into 2 references):**
- `grafana-core/promql` and `grafana-lgtm/prometheus` → `promql-for-perf.md` (filtered to PE use cases).
- `grafana-lgtm/{loki, tempo, pyroscope, mimir}`, `grafana-core/{alloy, beyla, opentelemetry, alerting-irm}`, `grafana-cloud/{app-observability, database-observability, testing}` → `grafana-stack-observability.md` (synthesized PE-lens overview).

**NOT integrated (out of scope for performance engineering):**
- `grafana-app-sdk/*` (admission-control, app-sdk-concepts, cue-kind-definition, reconciler-logic) — for building Grafana plugins, not using Grafana for perf work.
- `grafana-cloud/admin`, `cloud-integrations`, `send-data`, `infrastructure`, `private-connectivity`, `oncall-irm`, `ml-ai`, `dpm-finder`, `fleet-management`, `cost-management`, `adaptive-metrics` — operational/admin concerns, not perf diagnosis.
- `grafana-core/dashboarding`, `grafana-core/grafana-oss` — Grafana usage in general; the perf-relevant subset is in our context document template (which dashboards to declare).
- `grafana-plugins/*` (grafana-scenes, react-19-plugin-migration, plugin-bundle-size) — Grafana plugin development. Plugin bundle size is loosely related to frontend perf but specific to internal Grafana plugins, not the typical user app.
- Detailed YAML configuration references (Tempo `configuration.md`, Alloy full component list, etc.) — operations-level depth that a PE consults the official docs for; we link to them rather than duplicate.

**Why not just install the official Grafana skills directly:**
The official skills are oriented toward Grafana operators and plugin developers. A Principal PE working on a client project wants synthesized PE-perspective content (e.g., "when investigating a tail latency spike, here's the path through Tempo → Pyroscope") rather than reference docs for each component. The two synthesized references in this skill provide that perspective. Users who also want the full Grafana skills can install them as a separate marketplace plugin alongside this one — they don't conflict.

### From grafana-k6-skills (KimDoubleB) — addendum after grafana-skills review

After reviewing the official `grafana-k6/k6` skill, much of what we synthesized in `k6-patterns.md` from KimDoubleB and rcampos09 is consistent with the official Grafana k6 documentation. No major corrections were needed — the community skills track the official content well. The official skill provides additional depth on extensions (`xk6-*`) and k6 Cloud features that we deferred to `cicd-perf-gates.md` references.

### From addyosmani/web-quality-skills

Addy Osmani's collection (ex-Google Chrome team, web performance authority). Six skills total: `web-quality-audit`, `performance`, `core-web-vitals`, `accessibility`, `seo`, `best-practices`.

**Integrated** (folded into `web-vitals-deep-dive.md`):
- The performance budget table (mobile mid-tier targets: 1.5MB total, 300KB JS, 100KB CSS, 500KB images, 100KB fonts, 200KB third-party). This replaces my original looser numbers.
- Complete resource hints reference (`dns-prefetch`, `preconnect`, `preload`, `modulepreload`, `prefetch`) with anti-patterns.
- Image optimization patterns: format selection (AVIF → WebP → JPEG fallback), responsive `<picture>` with `srcset`/`sizes`, viewport-aware loading strategy (eager + sync + high-priority for LCP, lazy + async for below-fold).
- Code splitting patterns (route-based, feature-based, conditional dynamic imports).
- Tree shaking with concrete lodash example.
- `font-display` value comparison table (auto/block/swap/fallback/optional).
- Variable fonts pattern with `font-weight` range.
- Lighthouse CI budget config with the new tightened numbers.

**Not integrated**:
- `accessibility`, `seo`, `best-practices` skills — adjacent to perf but distinct disciplines. A Principal PE works alongside accessibility and SEO specialists; bundling all three in one skill dilutes triggering precision.
- `web-quality-audit` skill — meta-skill that orchestrates the others; out of scope when we're integrating selectively into a perf-focused skill.

### From nucliweb/webperf-snippets

Joan León's curated library of 49 JavaScript snippets executable in Chrome DevTools console, organized by Core Web Vitals / Loading / Interaction / Media / Resources. Highest-quality vendor-neutral diagnostic content.

**Integrated** as new reference `devtools-performance-snippets.md`:
- Catalog and workflow structure are inspired by Joan's library (LCP deep-dive workflow, CLS investigation, INP debugging, decision trees that branch on result).
- Snippet implementations rewritten for readability based on standard Web Performance APIs (`PerformanceObserver`, `LargestContentfulPaint`, `LayoutShift`, `EventTiming`, `LongAnimationFrame`, `PerformanceResourceTiming`). The original library is minified for production use; the rewritten versions trade ~3x size for clarity.
- Six sections: CWV measurement, Loading performance, Interaction debugging, Media audit, Resource analysis, Recommended workflows.
- Each snippet includes interpretation guide and "what to run next" routing.
- Source attribution at the end of the file pointing to the original library for the full 49-snippet set including media, DevTools overrides, bfcache analysis sections we didn't replicate.

**Why rewrite vs link to original:** the original snippets are minified single-line IIFEs designed for the webperf-snippets.nucliweb.net web app. They're not readable in a markdown reference, and a Principal PE benefits from understanding what a snippet does before running it on a client's production page. The rewrite preserves Joan's catalog choices while making them inspectable.

### From serkan-ozal/browser-devtools-claude

Seven skills (`execute-workflows`, `browser-testing`, `observability`, `node-debugging`, `web-debugging`, `performance-audit`, `visual-testing`) that drive the Browser DevTools MCP server with tool calls like `o11y_get-web-vitals`, `o11y_get-console-messages`, `debug_put-tracepoint`.

**Integrated** (the techniques, not the MCP coupling):
- Web Performance API patterns referenced in `performance-audit` and `web-debugging` — these surfaced through `devtools-performance-snippets.md` as standalone DevTools console patterns, decoupled from the MCP.
- Observability concepts (console messages, network requests, timing) are already covered in `grafana-stack-observability.md` and the new snippets reference.

**Not integrated**:
- The MCP-tool-call examples (`mcp__chrome-devtools__evaluate_script`, etc.) — these only work when running Claude with the specific Chrome DevTools MCP server configured, which is not the default Claude.ai setup.
- `node-debugging` skill (tracepoints/logpoints in Node) — a different debugging paradigm than what's central to this skill's perf focus; works against running processes, not against perf data.
- `visual-testing`, `browser-testing` — QA UI testing, not perf engineering (same scope-mismatch logic as Browserbase).

**Honest framing**: this is the kind of repo where the technique is the value, not the integration. Users who want the actual MCP-driven workflow should install serkan-ozal's repo separately and connect the Chrome DevTools MCP server. The two skills coexist.

### From mattpocock/skills

Matt Pocock's skill collection ("Skills For Real Engineers") — TypeScript educator with a wide engineering audience. ~14 skills across engineering, productivity, personal, and misc categories. High-quality content but **scope is general engineering**, not performance engineering specifically.

**Integrated** (two specific concepts that strongly enrich PE work):

- **"Build a feedback loop" philosophy** from `engineering/diagnose` — added as a new "Step zero" section at the top of `diagnostic-playbooks.md`. Matt's framing — *"Build the right feedback loop and the bug is 90% diagnosed"* — applies directly to perf regressions. Adapted his ten-option ladder for constructing a loop (failing test, curl with timing, captured trace replay, profiler-driven loop, synthetic load at low concurrency, bisection harness, differential loop, production sample replay) to the perf domain. The original framing was generic-bug-debugging-flavored; the integrated version is perf-flavored throughout. Includes the "iterate on the loop itself" pattern (faster, sharper, more deterministic), the high-reproduction-rate technique for non-deterministic bugs, and the "stop and ask explicitly" rule when a loop genuinely cannot be built.
- **Vertical slices / tracer bullets** from `engineering/to-issues` — added as new section in `ticket-generation.md` after estimate guidance. Reframed for perf optimization projects: when a finding spits out 8 recommendations across DB/app/frontend, structure them as independently-measurable vertical slices that each move a metric, not as horizontal layers that block demonstrable progress until the very end. Worked example shows horizontal-bad vs vertical-good for an N+1 + cache + index campaign. Includes the HITL/AFK distinction for slices that must span deploy sequences, and the `Blocked by` field requirement for multi-slice projects.

**Not integrated** (out of scope or already covered):

- `engineering/grill-with-docs`, `productivity/grill-me`, `engineering/zoom-out` — alignment/grilling sessions and codebase exploration. Already covered functionally by `intake-checklists.md` (which asks structured questions before producing analysis) and the calibration step in the diagnostic methodology. Matt's grilling sessions are excellent but oriented toward general feature planning, not perf-specific intake.
- `engineering/triage`, `engineering/to-prd` — issue tracker workflow primitives. The host skill's `ticket-generation.md` covers the perf-relevant subset (creating tickets from findings); Matt's `triage` is about moving existing issues through a state machine, which is general issue-management not specific to perf.
- `engineering/improve-codebase-architecture` — Ousterhout's "deepening modules" concept. Excellent and would enrich the host skill, but the scope is general software architecture (any codebase, any concern), not perf-specific. Adding it would expand the skill's mandate beyond performance engineering. Users who want this should install Matt's skill alongside as an independent skill.
- `engineering/tdd` — test-driven development. Adjacent to engineering work but not perf-specific. Same logic as deepening modules.
- `productivity/caveman`, `productivity/write-a-skill`, `personal/*`, `misc/*` — productivity, personal knowledge management, git guardrails, scaffolding. All clearly outside performance engineering scope.

**Why selective integration vs full bundle**: Matt's collection is the most "complete software engineer's toolkit" of all the repos evaluated. Integrating it whole would turn this from a Performance Engineering skill into a General Engineering skill — diluting the triggering precision and the implicit promise of the description ("this is the perf engineer's resource"). Two specific concepts (feedback loop, vertical slices) carry direct PE relevance and were absorbed; the rest stays in Matt's repo where users can install it as a complementary skill.

### From claudskills.com `java-performance`

Compact JVM-focused skill (single SKILL.md) with GC presets, profiling commands, JMH template, GC comparison table, and troubleshooting matrix.

**Integrated** (folded into the new `runtime-perf-tuning.md` reference, JVM section):
- GC presets table for high-throughput / low-latency / memory-constrained / container-optimized profiles
- GC selection guidance (G1 / ZGC / Shenandoah / Parallel / Serial trade-offs)
- Profiling commands: `jstack`, `jcmd JFR.start`, `jstat -gcutil`, `jcmd GC.heap_dump`, async-profiler
- JMH benchmark template with `@BenchmarkMode`, `@Warmup`, `@Measurement`, `@State`, `@Fork`, `Blackhole` consume pattern
- Container-aware JVM flags (`UseContainerSupport`, `MaxRAMPercentage`, `ExitOnOutOfMemoryError`)

**Notes**:
- The original includes a `parameters` block (`focus: gc/memory/cpu/profiling`) — this skill doesn't use parameter validation that way, so the routing happens via natural-language intent in the host skill instead.
- The original is high quality but very compact (~100 lines). Synthesized content in `runtime-perf-tuning.md` expanded it with operational context (when to pick which GC, how to read profile output, anti-patterns).

### From microlink.io `nodejs-performance`

Production-oriented Node.js performance workflow skill from Microlink (the API/tooling company). The strongest contribution here is the **operating discipline**, not Node-specific tricks.

**Integrated** (universal optimization workflow + Node.js section in `runtime-perf-tuning.md`):
- **Priority scoring formula**: `priority = (frequency × blast_radius × expected_gain) / (risk × effort)` — promoted to the universal optimization workflow that opens `runtime-perf-tuning.md`. Applies to any runtime, not just Node.
- **One-PR-per-improvement** rule with branch / commit conventions and bundling-as-anti-pattern reasoning
- **Output template** for perf PRs (issue → why-it-matters → code locations → tests → benchmark before/after → risk → next candidate)
- **Hot-path smells** language-agnostic list (recomputing invariants, re-parsing, duplicate async lookups, missing fast paths, unbounded retries, work-when-disabled-logging)
- **Prioritization targets** (request/job wrappers, middleware, retry/timeout code, connection pools, serialization hot paths) and what to **deprioritize** (one-time startup, rare admin flows)
- **Resource exhaustion checklist** (cap concurrency at every boundary, timeouts + cancellation end-to-end, bounded retries with jitter, listener/timer/stream cleanup, cache size+TTL controls)
- **Benchmarking guidance**: micro-benchmarks support; scenario benchmarks decide

**Notes**:
- The original is engineering-discipline-heavy and runtime-light; the skill keeps the discipline (which is the unique value) and adds Node-specific tooling/profilers (`clinic`, `0x`, `node --prof`, event-loop monitoring) that the original doesn't enumerate.
- The "request/job execution-path over startup" prioritization is now a universal rule in the workflow, not just Node-specific.

### From pluginagentmarketplace/custom-plugin-java

Claude Code marketplace plugin distributing the SASMP framework's Java skill collection: 12 skills + 8 agents covering general Java development (concurrency, Spring Boot, microservices, JPA/Hibernate, testing, build tools, Docker, etc.).

**Important duplication note**: the `java-performance` SKILL in this repo is **byte-for-byte identical** to the claudskills.com `java-performance` SKILL already integrated above (same SASMP version 1.3.0, same skill version 3.0.0, same `bonded_agent: 02-java-advanced` frontmatter). Both URLs distribute the same source; one is the web directory, the other is the GitHub marketplace. Re-evaluating it surfaced no new content for that skill.

**Integrated** (additional from `java-concurrency` skill, folded into `runtime-perf-tuning.md` JVM section):
- **Virtual threads (Java 21+)** — when to switch from platform threads, the `Executors.newVirtualThreadPerTaskExecutor()` pattern, and the **caveats most benchmarks miss** (pinning on `synchronized` blocks, CPU-bound work doesn't help, JDBC driver compatibility).
- **Concurrency model selection table** — Platform threads vs Virtual threads vs Reactive, with use-when criteria.
- **Thread pool sizing formulas** — CPU-bound (`cores`), I/O-bound (`cores × (1 + wait / compute)`), mixed starting point.
- **`CompletableFuture` composition** with mandatory `.orTimeout()` discipline tying into `bottleneck-patterns.md` Pattern 8.

**Not integrated** (10 of 12 skills out of scope):
- `java-fundamentals`, `java-spring-boot`, `java-microservices`, `java-maven`, `java-gradle`, `java-maven-gradle`, `java-docker` — general Java development, not performance engineering. The performance-relevant subset of Spring Boot (actuator metrics, async configuration) and microservices (circuit breakers, bulkheads) is already covered in `bottleneck-patterns.md`, `resilience-chaos-testing.md`, and `grafana-stack-observability.md`.
- `java-jpa-hibernate` — N+1 prevention, query optimization, caching are already covered in `db-optimization.md` with database-agnostic framing. The Hibernate-specific tactics (lazy loading strategies, `@QueryHint`, `EntityGraph`) would belong in a Hibernate-specialized skill, not here.
- `java-testing`, `java-testing-advanced` — JUnit / Mockito / Testcontainers / Pact / mutation testing are QA testing, not performance testing. Same scope-mismatch logic that excluded `nntan90/qa-skill-suite` sub-skills.

**Not integrated as architecture** (the SASMP framework itself):
- The `sasmp_version`, `bonded_agent`, `bond_type` frontmatter scheme is a different agent-orchestration paradigm than `agent-team-orchestration.md`. SASMP bonds skills to specific agents (e.g., `java-performance` bonds to `02-java-advanced` agent); this skill orchestrates roles within a single Claude conversation. Not compatible without restructuring.
- The `parameters` block with enum validation (`focus: gc/memory/cpu/profiling`) is a clean pattern but Claude.ai Skills don't expose runtime parameter validation — routing happens via natural language intent in the host SKILL.md.

**Why selective vs full bundle**: same logic as `developer-kit` and `mattpocock/skills` — integrating 12 skills covering all Java development would dilute this skill from "performance engineering" to "Java development that happens to mention performance." Users wanting full Java dev coverage should install `custom-plugin-java` alongside this skill in Claude Code.

### From Alibaba Cloud — "How to Properly Plan JVM Performance Tuning" (2019)

Long-form article on systematic JVM tuning methodology. Published 2019 (JDK 1.6-1.8 era — assumes PermGen, ParallelGC defaults), but the methodology is collector-agnostic and applies just as well to G1/ZGC in 2026.

**Integrated** (new "Systematic JVM tuning methodology" section in `runtime-perf-tuning.md`):

- **Three principles** elevated to citable named patterns:
  1. **Minor GC collection principle** — each Minor GC should reclaim as much short-lived garbage as possible
  2. **GC memory maximization principle** — within limits, larger heap = more efficient collection
  3. **"Two out of three" principle** — pick at most two of throughput / latency / memory usage to optimize; trying all three is the most common failure mode
- **Application phases** as measurement boundary discipline — only measure during stability phase, not init or summary. Anchors the methodology in *when* to gather data, which is a frequent failure mode of less-structured tuning.
- **Five-step procedure** (memory → latency → throughput → verify) with the explicit ordering rule ("do not invert").
- **Active data size calculation** from Full GC log — modernized for Metaspace (Java 8+) instead of PermGen.
- **Object promotion rate estimation** — full worked example for estimating Full GC frequency without a Full GC log, useful for well-tuned long-running services that rarely Full-GC.
- **Minor GC duration vs frequency tradeoff table** with the operational rule "keep old gen constant when adjusting young gen."

**Modernization adjustments to the source material**:
- PermGen → Metaspace (Java 8+).
- ParallelGC defaults → G1 defaults (Java 9+).
- Added compatibility note for Java 25 LTS realities (ZGC generational default, Compact Object Headers).
- Added explicit linkage to the SLO sentence pattern from `agent-team-orchestration.md` for the "verify" step.

**Why integrated despite age**: most modern JVM tuning content jumps straight into flags and collectors without teaching how to *plan* a tuning engagement. The Alibaba article's discipline (phases, principles, ordering) is structural rather than version-bound. The 2019-era flag examples are dated, but the framework is timeless.

### Java 21 / 24 / 25 LTS update — applied across the skill

After integrating eighteen perf engineering repos, a targeted research pass on current Java performance landscape surfaced critical content drift. Updated in this round:

**Updated content in `runtime-perf-tuning.md`:**
- **Virtual thread pinning** — rewrote the entire concurrency section with version-aware guidance. Pre-Java 24 advice (`synchronized` pins virtual threads → replace with `ReentrantLock` in hot paths) is now scoped to Java 21-23 only. For Java 24+, JEP 491 fixed synchronized pinning at the JVM level (monitors track virtual thread identity, not carrier identity). The `-Djdk.tracePinnedThreads` flag was removed in JDK 24; JFR event `jdk.VirtualThreadPinned` is the new detection mechanism, default-on with 20ms threshold.
- **Compact Object Headers (JEP 519)** — new section. 8-byte headers vs 12, 10-22% heap reduction, 8-30% CPU savings (Amazon production data). Flag: `-XX:+UseCompactObjectHeaders`. Critical compatibility note: incompatible with ZGC in JDK 25 (fixed in JDK 26 via JEP 516).
- **Generational ZGC default** — Java 25 ships ZGC as generational-only, no flag needed. Updated low-latency preset accordingly. Documented Mapped Cache replacing Page Cache (less heap fragmentation, no inflated RSS).
- **Generational Shenandoah (JEP 521)** — promoted to product feature in JDK 25. Updated GC selection table.
- **Project Leyden AOT cache (JEPs 483, 514, 515)** — new section. 50-70% Spring Boot startup reduction. Two-command workflow (training → deploy). Cloud cost implications for autoscaling and serverless.
- **Scoped Values (JEP 506, final in Java 25)** — new section. Replaces ThreadLocal at virtual thread scale (immutable context, no per-thread copies).
- **Structured Concurrency (JEP 505, preview)** — new section. Manages related concurrent tasks as a unit.
- **GC selection table** — restructured for Java 25 LTS reality with ZGC compatibility column.

**New reference `references/java-frameworks-and-distributions.md`** (this round):
- **JVM distributions comparison table** — 12 distributions: Temurin (default safe), Corretto (AWS), Azul Zulu (broad platform), Azul Platform Prime (C4 pauseless GC for sub-ms SLOs), Oracle JDK, GraalVM (Native Image + JIT), Alibaba Dragonwell (cloud workloads + AI extension), SapMachine (compact headers default in 25), BellSoft Liberica (Alpine native), IBM Semeru/OpenJ9 (memory density), Red Hat OpenJDK (RHEL), Microsoft OpenJDK (Azure).
- **Decision shortcuts table** — constraint-to-distribution mapping for common engagement contexts.
- **Framework-specific tuning** for the most-used Java frameworks: Spring Boot (virtual threads opt-in, Spring AOT + Leyden combo, Actuator metrics setup, common pitfalls), Quarkus (GraalVM-first, when to choose), Micronaut (compile-time DI), Helidon (SE vs MP), Vert.x (event-loop discipline + virtual-threads-as-alternative discussion), Akka (license change to BSL — recommend Pekko as Apache-licensed fork), Dropwizard, Jakarta EE.
- **GraalVM Native Image cross-cutting section** — wins/costs/when matrix.
- **Stack decision matrix** for new services (JVM version → distribution → framework → GC → AOT strategy).

**Sources for this update**:
- OpenJDK JEPs 444, 483, 491, 506, 514, 515, 519, 521 (canonical)
- Inside.java — Performance Improvements in JDK 25 (October 2025)
- InfoQ — JEP 491 + JEP 519 analysis
- Mike my bytes — Java 24 Thread Pinning Revisited
- JavaCodeGeeks — Virtual Threads Two Years In: Production War Stories (May 2026)
- JavaCodeGeeks — Project Leyden's AOT Code Cache (March 2026)
- Gunnar Morling — Lower Java Tail Latencies With ZGC
- Andrew Baker — Pauseless Garbage Collection in Java 25
- Baeldung — Reduce Object Header Size and Save Memory in Java 25
- JavaCodeGeeks — Go 1.24 vs Java 25 for Microservices (May 2026 benchmark)

### Kubernetes runtime perf — new reference (this round)

Added `references/runtimes-on-kubernetes.md` covering the **deployment surface** of containerized perf — the layer that exists only when a runtime lives inside a pod. Complements `runtime-perf-tuning.md` (vendor-neutral runtime tuning, language-agnostic optimization workflow) and `java-frameworks-and-distributions.md` (Java ecosystem decisions) without duplication.

**Why this earned its own reference**: Kubernetes adds five concerns that don't exist on bare metal — CFS CPU throttling, memory limit hard caps, probe-driven traffic and lifecycle, pod ephemerality (startup time as perf metric), and virtual network overhead. Each of these affects every runtime. Folding into `runtime-perf-tuning.md` would have ballooned that reference past 1500 lines; splitting per-runtime was wasteful.

**Universal cross-runtime content:**
- **QoS classes** (Guaranteed / Burstable / BestEffort) — decision rule for production services with SLOs
- **CPU throttling (CFS) — the universal tail-latency killer** — math (`quota_us = cpu_limit × 100_000`), PromQL detection query (`container_cpu_cfs_throttled_periods_total / container_cpu_cfs_periods_total`), the "limits vs no-limits" debate framed honestly
- **Probes** — distinct roles for liveness / readiness / startup, the classic anti-pattern (liveness depending on DB → cascade restarts), probe timing math relative to `terminationGracePeriodSeconds`
- **Graceful shutdown** — universal 7-step sequence (SIGTERM → readiness fail → LB drain → server close → in-flight drain → resource cleanup in order → exit), two race conditions (LB not drained yet, shutdown timeout), `preStop` sleep pattern
- **Image strategy** — table comparing single-stage / multi-stage / distroless / jlink / GraalVM Native / static binary in terms of size and cold-start impact

**Java-on-Kubernetes section:**
- **CRaC (Coordinated Restore at Checkpoint)** — new concept that complements Project Leyden. Workflow with `-XX:CRaCCheckpointTo=` and `-XX:CRaCRestoreFrom=`. Reported 7× startup improvement on Spring PetClinic in AKS. Distribution support (Azul Zulu, BellSoft Liberica, OpenJDK CRaC packages in Ubuntu 24.10+, Spring Boot 3.2+ native integration). Limitations (Linux-only, resources need re-init, checkpoint files contain secrets).
- **Leyden vs CRaC vs Native Image decision table** — when to use which based on startup target and complexity tolerance.
- **HPA + JVM warmup tension** — the cascade where cold JIT under HPA scaling produces more cold pods. Mitigations: AOT cache + JEP 515 method profiles, CRaC, Native Image, manual warmup probe, HPA stabilization windows.
- **Heap dump persistent volume pattern** for OOM forensics.

**Node.js-on-Kubernetes section:**
- **Single-process discipline** — don't run cluster module or PM2 inside containers; let Kubernetes do the multiplexing. Worker threads (in-process) are the exception when you genuinely need multiple cores per pod.
- **Memory limit math** — `--max-old-space-size` must be below pod memory limit with headroom.
- **Full graceful shutdown code** — JavaScript implementation with SHUTDOWN_TIMEOUT_MS, forced exit, dependency-ordered cleanup, isShuttingDown flag.
- **Event-loop blocking detection** — production-safe pattern using `monitorEventLoopDelay`, Prometheus integration, correlation with CFS throttling metrics.

**Go-on-Kubernetes section:**
- **Go 1.25 GOMAXPROCS auto-fix** — the single most impactful Go-on-K8s change. Documented benchmark showing 25× p99 improvement (890ms → 35ms) from a single config fix on a 2-CPU-limit / 64-core-host setup. Audit commands for stale env vars. `automaxprocs` fallback for pre-1.25 fleets.
- **GOMEMLIMIT** — soft memory target for OOM prevention. Pattern: `GOMEMLIMIT ≈ 90% of pod memory limit`.
- **Static binary advantages** — full `FROM scratch` Dockerfile example.

**Python-on-Kubernetes section:**
- **Workers config** — GIL implications + CFS throttling interaction. Worker count rule of thumb per workload type (CPU-bound, I/O-bound sync, I/O-bound async).
- **Gunicorn timeout vs probe timing** — common cascade failure when timeouts don't align.
- **Memory per worker** — multi-process memory math.

**Anti-patterns checklist** — 15 items surfacing in K8s perf reviews, runtime-mixed (CPU throttling above 5%, liveness with DB dep, terminationGracePeriodSeconds too short, runtime parallelism mismatched to CPU limit, etc.).

**Engagement review checklist** — structured questions for inheriting a K8s deployment for perf review: resource configuration, probes, shutdown, runtime config per language, image strategy, autoscaling, observability.

**Sources for this section:**
- Azul / Microsoft / AWS blog posts on CRaC for AKS / EKS (7× PetClinic startup)
- Spring Framework CRaC documentation
- Go 1.25 release notes (Container-aware GOMAXPROCS, August 2025)
- "GOMAXPROCS Is Lying to Your Kubernetes Pod" (DEV Community, May 2026)
- "Go GOMAXPROCS in Containers" — Michal Drozd benchmark (Nov 2025)
- VictoriaMetrics blog — Container CPU Requests & Limits Explained
- RisingStack — Graceful shutdown with Node.js and Kubernetes
- DEV Community — "Kubernetes + Node.js: Health Checks and Graceful Shutdown Done Right" (Feb 2026)
- InfoQ — Optimizing Java Applications on Kubernetes (Nov 2024)

### Expert profiles for selective loading — new reference (this round)

Added `references/expert-profiles.md` as a routing layer. The skill grew to 21 reference files across many domains (JVM internals, Node.js, Go, Python, frontend, observability, load testing, K8s, frameworks, resilience). Loading all of them per conversation produces noise and dilutes Claude's responses. Most engagements only need 3-5 references.

**Design honest mechanics**: a Claude skill is a single instance reading SKILL.md and deciding which references to open. This file makes that decision explicit and reusable — defining named bundles ("profiles") that map stack/domain → references-to-read, with triggers for auto-detection and rules for combination.

**22 profiles delivered** in three groups:

- **Runtime profiles (9)**: `java`, `spring-boot`, `java-k8s`, `nodejs`, `nodejs-k8s`, `golang`, `python`, `dotnet` (partial scope), `php` (partial scope)
- **Domain profiles (5)**: `frontend`, `db-perf`, `observability`, `load-testing`, `resilience`
- **Architecture profiles (7)**: `microservices`, `serverless`, `message-queue`, `cache-layer`, `api-gateway`/`service-mesh`, `grpc`, `graphql`
- **Engagement profile (1)**: `engagement-mode` (multi-week client work with team-mode roles)

**Key design decisions:**

- **Honest scope flagging for `dotnet` and `php`** — the skill doesn't have dedicated runtime tuning references for these. Profile activation explicitly says so in disclosure: *"Activé profile dotnet. Esto carga patterns universales. Importante: este skill no tiene reference dedicado para CLR runtime tuning — para flags específicos voy a contestar desde general knowledge, no desde reference curada."* No bluffing about coverage.
- **Multi-profile activation as the default**: real engagements cross domains (Spring Boot + K8s + observability is one engagement, three profiles). The bundling is the union of all activated profiles.
- **Lazy escalation**: if the conversation drifts to a new domain, add the profile without closing the original. State the addition.
- **Explicit opt-out**: `"cargá todo el skill"` / `"sin profile"` disables routing entirely. Useful for exploratory engagements where the bottleneck isn't yet localized.
- **Always-loaded foundational set**: SKILL.md, expert-profiles.md itself, intake-checklists / diagnostic-playbooks / agent-team-orchestration when mode triggers them.

**SKILL.md restructured** with new "Step 0 — Pick an expert profile" section as the **first content section** after the title. Routing must happen before any reference loading, so it gets primary position. Original "Context document" section remains, but as Step 1 (after profile activation).

**Combined profile examples** documented in the file with 4 real scenarios (Spring Boot in EKS, k6 against GraphQL gateway, observability discrepancy investigation matching the active Istio/Dynatrace case, explicit opt-out).

**Anti-patterns surfaced**:
- Aggressive auto-detection from single weak triggers ("system is slow" is too generic)
- Profile lock-in (refusing to look at adjacent domains when conversation drifts)
- Refusing user override when they name a profile explicitly
- Silent activation (always announce)
- Bluffing coverage (the `dotnet`/`php` honest-scope rule)
- Exhaustive bundling that defeats the noise-reduction purpose

**Why this earned its own reference vs inlining into SKILL.md**: 22 profiles × triggers × bundles × scope notes × combination rules = too much for SKILL.md (which would balloon past 600 lines). The reference acts as a router that SKILL.md points to from Step 0. SKILL.md stays compact with the profile catalog table; full mechanics live in the reference.

## Evaluated and rejected (this round)

### jvm-skills/jvm-skills

Evaluated. **Decision: do not integrate.**

**What it is:** a meta-directory listing other people's JVM skills (jvmskills.com), not a skill itself. The repo contains the website source and skill listings in YAML, plus blog posts. Categories cover Database (jOOQ, JPA, Postgres), Web (Spring Boot, JTE, Thymeleaf), Infrastructure, Testing, Architecture, Workflow.

**Why rejected:** the repo doesn't contain skill content to integrate — it's a directory pointing to other repos. The directory itself might be useful to surface as a recommendation in the README (so users find JVM-specialized skills), but there's nothing to fold into this skill.

**Action**: noted in README under "Integration with other skills" indirectly — users hunting for deeper JVM coverage beyond `runtime-perf-tuning.md` can browse jvmskills.com.

### cchesser/java-perf-workshop

Evaluated. **Decision: do not integrate.**

**What it is:** an interactive Java performance workshop — a deliberately sub-optimal Spring Boot service that workshop participants profile and fix using Gatling load tests and JFR analysis. The repo includes the broken service code, Gatling defaults, docker-compose for the test rig, and tutorial documentation at jvmperf.net.

**Why rejected:** valuable as a hands-on learning resource for humans, not as integratable skill content. A skill is "instructions for an AI assistant"; this is "a buggy service to debug as exercise". Unrelated artifact types.

**Action**: could be referenced in a future "learning resources" section if the skill ever ships a getting-started doc for new users to the discipline. Not integrated.

### yzavyas/claude-1337

Evaluated. **Decision: do not integrate.**

**What it is:** a marketplace of "cognitive extensions" for Claude Code — meta-plugins for orchestration, visual rendering, architecture review (`core-1337`, `arch-guild`, `visuals-1337`, `lab-1337`). General-purpose agent infrastructure, not performance engineering.

**Why rejected:** scope mismatch (general agent infra vs PE-specific) and platform mismatch (Claude Code marketplace plugin, not a single .skill bundle). The "cognitive extensions" concept is interesting but orthogonal to performance work.

**Action**: users running Claude Code who want general meta-cognition skills can install separately. No conflict with this skill.

### giuseppe-trisciuoglio/developer-kit

Evaluated. **Decision: do not integrate.**

**What it is:** a "modular plugin marketplace" with 150+ skills and 45+ specialized agents covering 7+ languages (Java, Spring Boot, TypeScript, React, Next.js, Express, Python, Go, etc.) plus DevOps, security, architecture domains. Marketplace-distributed, multi-CLI (Claude Code, Copilot CLI, OpenCode, Codex).

**Why rejected:** scope dilution. Integrating a 150-skill general-development marketplace would obliterate the focus of this skill. The Java/Node/Go runtime tuning we extracted from claudskills.com and microlink already covers the runtime layer that's PE-relevant; the rest of `developer-kit` (Spring Boot CRUD generation, CloudFormation templates, security audits, etc.) belongs in their respective specialized skills.

**Action**: developers wanting general full-stack coverage can install `developer-kit` alongside this skill. No conflict.

### bradtaylorsf/alphaagent-team (evaluated as comparative reference)

Evaluated. **Decision: not integrated as content; cited as validation of agent-team-orchestration approach.**

**What it is:** a marketplace of 30 plugins organized as an autonomous agent team: workflow plugins (`aai-core`, `aai-hooks`), PM plugins per tracker (`aai-pm-linear`, `aai-pm-jira`, `aai-pm-github`), dev agents (`aai-dev-frontend/backend/database/fullstack`), 15 stack-specific skills, and specialized agents (`aai-testing`, `aai-architecture`, `aai-docs`, `aai-blog`, `aai-devops`, `aai-quality`).

**Why this is interesting**: the structure validates the agent-team approach in `agent-team-orchestration.md`. They use frontmatter `model: sonnet` declaratively to assign models to agents — a cleaner pattern than narrative tier mapping. They also separate PM-by-tracker (one plugin per tool: Linear / Jira / GitHub Issues), which is a useful idea for scaling the ticket-generation reference to multiple trackers.

**Why not integrated as content**: the implementation is Claude Code marketplace plugin format, not a single .skill bundle. Adopting their entire agent roster would duplicate / override the team designed in this skill. Their roles also tilt toward generic dev agents (frontend/backend/database/fullstack) rather than PE-specialized roles (Performance Tech Lead, SRE, QA Test Engineer).

**Future direction inspired by this**: the per-role `model:` frontmatter pattern is documented in `agent-team-orchestration.md` model-selection section. If this skill ever splits into sibling skills (one per role) for Claude Code distribution, declarative model assignment per agent file is the right structure.

## Evaluated and rejected (earlier rounds)

Repos suggested for integration but deliberately not integrated, with the reasoning preserved here so future maintainers don't re-litigate the same decision.

### secondsky/claude-skills (web-performance-optimization plugin)

Evaluated. **Decision: do not integrate. Marginal value-add.**

**What it is:** a single skill (`web-performance-optimization`) covering code splitting, lazy loading, caching, image optimization, and Core Web Vitals monitoring. Two reference files (`typescript-advanced.md`, `compression-monitoring.md`).

**Why rejected:**

1. **Heavy overlap with content already integrated.** Code splitting, lazy loading, image optimization, Core Web Vitals, performance monitoring — all already covered (and in significantly more depth) in `web-vitals-deep-dive.md`, `devtools-performance-snippets.md`, `cicd-perf-gates.md`, and `grafana-stack-observability.md`.
2. **Generic patterns without sharper opinion.** The content is correct but doesn't add a perspective that contradicts or extends what's already there. Integrating it would duplicate, not enrich.
3. **No unique source authority.** Unlike Addy Osmani (Google Chrome) or Joan León (DevRel community-recognized) or Grafana (the source of the LGTM stack), this skill doesn't bring vendor or expert authority that justifies inclusion despite the overlap.

**No alternative recommendation needed** — the user's existing content covers this domain better.

### browserbase/skills — https://github.com/browserbase/skills

Evaluated as part of the integration sweep. **Decision: do not integrate. Recommend installing in parallel as an independent skill if needed.**

**What it is:** a Claude Code plugin for browser automation via Browserbase (a commercial service offering remote Chrome sessions with anti-bot stealth, CAPTCHA solving, residential proxies). 11 skills covering: web automation (`browser`, `browserbase-cli`, `functions`), QA/automation debugging (`site-debugger`, `ui-test`, `browser-trace`), scraping utilities (`fetch`, `search`, `cookie-sync`), and lead generation (`company-research`, `event-prospecting`, `autobrowse`).

**Why rejected:**

1. **Scope mismatch.** The other seven integrated repos are all about performance / load testing / observability. Browserbase is browser automation and QA UI testing — adjacent disciplines but distinct ones. A Principal PE treats them as separate domains owned by different specialists.
2. **Vendor lock-in conflicts with the skill's neutrality.** The integrated content is deliberately vendor-neutral (k6 *or* JMeter *or* Gatling; Grafana *or* Datadog *or* Dynatrace). Browserbase is a single commercial product; integrating it would inject a vendor preference inconsistent with the rest.
3. **Platform mismatch.** The skills assume Claude Code with filesystem-backed workflows (`.o11y/<run-id>/` directory trees, executable Node scripts, `bb` CLI with `BROWSERBASE_API_KEY`). The host skill targets Claude.ai chat-based use, where these workflows are awkward.
4. **No real gap to close.** The only candidate of arguable PE value was `browser-trace` (CDP firehose capture). That capability is already covered:
   - Real-user telemetry: Faro RUM (in `grafana-stack-observability.md`)
   - Synthetic Web Vitals: k6/browser (in `k6-patterns.md`, `web-vitals-deep-dive.md`)
   - Ad-hoc deep dives: native Chrome DevTools Performance tab
   - CI gates: Lighthouse CI (in `web-vitals-deep-dive.md`)
5. **Triggering accuracy degradation.** The host skill's `description` field is precision-tuned for performance/latency/SLO/load-testing queries. Adding "browser automation, CAPTCHA solving, scraping, QA UI testing" terminology would cause false-positive activations on scraping and lead-gen queries.

**Recommended alternative:** install `browserbase/skills` as an independent skill in Claude.ai when relevant browser-automation use cases arise. The two skills coexist without conflict — each activates on its own triggers. This is the same principle as keeping the official `grafana/skills` separate.

## Why a single skill, not a marketplace plugin

The user asked to integrate nineteen sources (thirteen integrated end-to-end or selectively, one partially integrated with documented duplication, five rejected with documented reasoning). Two distribution options were considered:

1. **Single skill with synthesized references** (chosen): one `.skill` file installs everything; references load on demand; no naming conflicts; user keeps a single mental model.
2. **Marketplace plugin with multiple sibling skills** (KimDoubleB / charlyautomatiza approach): each topic as a separate skill, cross-referenced. More modular but more complex to install and reason about.

Option 1 was chosen because:
- The user is operating in Claude.ai (not Claude Code), where single-skill bundles are the natural unit.
- The integrated content is closely related — splitting it across skills would force artificial boundaries (e.g., "k6 patterns" vs "tool selection" naturally cross-reference).
- A single skill is one mental model: "performance engineering" — the user activates it, and Claude pulls in whichever references are relevant.

If future requirements demand a marketplace structure, the references can be split into sibling skills with minimal restructuring.

## Versioning considerations

Each upstream repo evolves on its own cadence. This integration captures content as of late April 2026. To refresh:

1. Re-clone the upstream repos.
2. Diff against the synthesized references for material changes (new patterns, deprecations).
3. Update `INTEGRATION-NOTES.md` with a new dated section.
4. Bump the skill version in `SKILL.md` frontmatter (if/when versioning is added).

## License compatibility

All thirteen integrated source repos are MIT, Apache-2.0, or custom permissive licensed (verified at clone or fetch time). The synthesized content in this skill is original prose informed by those sources, not verbatim copies. Where specific code snippets (k6 templates, GitHub Actions workflows, JVM presets, virtual-thread examples, DevTools snippets based on standard Web Performance APIs) match common public patterns, they are widely-used idioms not subject to single-author attribution. The `devtools-performance-snippets.md` file explicitly attributes Joan León's webperf-snippets library as the source of the catalog and workflow structure. The `runtime-perf-tuning.md` priority-scoring formula and one-PR-per-improvement workflow are credited to Microlink's nodejs-performance skill; the JVM GC presets and JMH template are credited to claudskills.com / SASMP framework.
