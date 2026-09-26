# Expert profiles — selective loading

A routing layer for this skill. Loads only the references relevant to the user's actual stack / domain instead of pulling everything into context. Reduces noise, sharpens responses, makes engagements coherent.

**Honest mechanics**: a Claude skill is a single Claude instance reading SKILL.md and choosing what to open. This file makes that choice explicit and reusable — defining named bundles ("profiles") that map stack/domain → references-to-read, with triggers for auto-detection and rules for combination.

---

## How profile activation works

### Auto-detection on first substantive message

When the user's first non-greeting message contains domain signals, Claude activates the matching profile and **announces it** before answering:

> *"Activé profile `java-k8s` (Spring Boot + Kubernetes). Si el problema cruza a frontend / load testing / observability deep-dive, decime y agrego ese profile."*

The user can ignore the announcement and proceed, or override it.

### Manual override

The user can activate, deactivate, combine, or replace profiles explicitly. Recognized phrases (in English or Spanish):

- `"activate profile X"` / `"activá profile X"` / `"cargá X"` / `"usa profile X"`
- `"add profile Y"` / `"sumá Y también"`
- `"deactivate X"` / `"sacá X"`
- `"clear profiles"` / `"sin profile"` / `"todo el skill"` — opt-out, fall back to default mode

When the user names a profile, **trust them and skip auto-detect**. They know their context better than the keyword matcher.

### Multi-profile activation

Most real engagements cross domains. Combining profiles is the normal case:
- A Spring Boot service running in EKS with custom Prometheus metrics → `spring-boot` + `java-k8s` + `observability`
- A k6 campaign against a GraphQL gateway → `load-testing` + `graphql`
- A frontend RUM investigation correlated with backend traces → `frontend` + `observability`

Claude announces the combined set and loads the union of all bundles.

### Lazy escalation mid-conversation

If the conversation drifts (started on Java backend, drifted to a frontend Web Vitals tangent), **don't close the original profile**. Add the new one. State the addition:

> *"Sumo profile `frontend` por el tema de LCP. Mantengo `java-k8s` activo."*

### Opt-out

If the user says *"cargá todo el skill"* / *"sin profile"* / *"no uses profiles"*, fall back to the default behavior — read SKILL.md sections as needed, no pre-bundling. Useful for exploratory engagements where the bottleneck isn't yet localized.

### What's always loaded (foundational, profile-independent)

- `SKILL.md` itself — core principles, modes, frameworks
- `references/expert-profiles.md` — this file, for routing
- `references/intake-checklists.md` — when mode = intake
- `references/diagnostic-playbooks.md` — when mode = diagnosis
- `references/agent-team-orchestration.md` — when user activates agent team mode

Everything else is loaded per-profile.

---

## Profile catalog

Each profile lists:
- **Triggers** — words / phrases that activate auto-detect
- **Bundle** — references loaded when active
- **Honest scope** — what's covered and what isn't (don't pretend a profile covers more than it does)
- **Common combos** — profiles that usually activate together

### Runtime profiles

#### `java`

Triggers: `Java`, `JVM`, `GC`, `heap`, `Kotlin`, `Scala`, `JFR`, `JMH`, `async-profiler`, `G1`, `ZGC`, `Shenandoah`, `JIT`, `metaspace`, `virtual threads`, `Loom`, `CRaC`, `Project Leyden`

Bundle:
- `runtime-perf-tuning.md` (JVM section — most of it)
- `bottleneck-patterns.md`
- `memory-leak-detection.md` (JVM section)

Honest scope: covers JDK 8 through 25 LTS, including the Java 24/25 updates (virtual threads pinning fix, Compact Object Headers, Generational ZGC default, Project Leyden AOT cache, Scoped Values). Does not cover GraalVM Truffle polyglot beyond Native Image.

Common combos: `java + db-perf` (Hibernate / JPA), `java + observability` (Micrometer / Actuator), `java + k8s` (see `java-k8s` profile below).

#### `spring-boot`

Triggers: `Spring Boot`, `Spring`, `actuator`, `Hibernate`, `@Transactional`, `Spring Data`, `Spring WebFlux`, `Spring Cloud`, `application.properties`, `application.yml`

Bundle: `java` profile + `java-frameworks-and-distributions.md` + `db-optimization.md`

Honest scope: Spring Boot 2.x and 3.x performance patterns, virtual threads via `spring.threads.virtual.enabled=true`, Spring AOT + Project Leyden combo, Actuator metrics, common pitfalls (transaction over network, default Tomcat pool size, RestTemplate timeouts). Spring Cloud Gateway, Spring Cloud Stream covered via `api-gateway` and `message-queue` profiles when combined.

Common combos: `spring-boot + java-k8s` (the most common Java engagement pattern); `spring-boot + observability` for Micrometer/Actuator setup.

#### `java-k8s`

Triggers: any `java` or `spring-boot` trigger + any k8s trigger (`k8s`, `kubernetes`, `pod`, `kubectl`, `helm`, `EKS`, `AKS`, `GKE`, `kustomize`)

Bundle: `spring-boot` profile (which already includes `java`) + `runtimes-on-kubernetes.md`

Honest scope: full coverage of Java perf concerns in Kubernetes — CRaC checkpoint/restore, HPA + JVM warmup tension, container-aware JVM flags, heap dump persistent volumes, image strategies (jlink, distroless, GraalVM Native).

Common combos: `java-k8s + observability` (Prometheus/Grafana setup for JVM pods), `java-k8s + load-testing` (capacity validation campaigns).

#### `nodejs`

Triggers: `Node`, `Node.js`, `npm`, `Express`, `Fastify`, `NestJS`, `Koa`, `event loop`, `V8`, `libuv`, `worker_threads`, `pnpm`, `yarn`, `clinic`, `0x`

Bundle: `runtime-perf-tuning.md` (Node section) + `bottleneck-patterns.md`

Honest scope: V8 flags, event-loop monitoring, profiling stack (clinic, 0x, --prof, --inspect), Node-specific hot-path smells, bounded concurrency patterns. Does not deeply cover Deno or Bun (mention only — patterns mostly transfer).

Common combos: `nodejs + db-perf`, `nodejs + frontend` (full-stack JS), `nodejs + k8s`.

#### `nodejs-k8s`

Triggers: any `nodejs` trigger + any k8s trigger

Bundle: `nodejs` profile + `runtimes-on-kubernetes.md`

Honest scope: covers single-process-per-pod discipline, memory limit math, graceful shutdown sequence, event-loop blocking detection in containers, distroless Node images. The "Node-on-Kubernetes" content in `runtimes-on-kubernetes.md` is comprehensive.

#### `golang`

Triggers: `Go`, `Golang`, `GOMAXPROCS`, `GOMEMLIMIT`, `goroutine`, `pprof`, `chan`, `sync.Mutex`, `runtime.NumCPU`, `automaxprocs`, `go.uber.org`

Bundle: `runtime-perf-tuning.md` (Go section) + `bottleneck-patterns.md` + `runtimes-on-kubernetes.md` (Go section)

Honest scope: covers Go 1.21 through 1.25 — including the Go 1.25 GOMAXPROCS container-aware fix (the most impactful Go-on-K8s change in years). Profiling via pprof endpoints, escape analysis, channel patterns, mutex contention diagnosis.

Common combos: rarely needs combinations — Go services typically have simpler stacks. `golang + observability` for Prometheus integration; `golang + grpc` for gRPC services.

#### `python`

Triggers: `Python`, `Django`, `Flask`, `FastAPI`, `Starlette`, `gunicorn`, `uvicorn`, `GIL`, `asyncio`, `py-spy`, `cProfile`, `Celery`

Bundle: `runtime-perf-tuning.md` (Python section) + `bottleneck-patterns.md` + `runtimes-on-kubernetes.md` (Python section)

Honest scope: GIL implications, WSGI vs ASGI worker config, profiling stack (py-spy, cProfile, tracemalloc), hot-path patterns (hoisting lookups, built-in C functions, lru_cache, generators vs comprehensions). When Python is genuinely the bottleneck — covers Cython, PyPy, mypyc, Rust via PyO3 as exit strategies.

Common combos: `python + db-perf` (Django ORM / SQLAlchemy N+1), `python + k8s` (gunicorn workers vs CPU limits), `python + message-queue` (Celery).

#### `dotnet`

Triggers: `.NET`, `dotnet`, `C#`, `ASP.NET Core`, `EF Core`, `CLR`, `MSBuild`, `Kestrel`, `IIS`, `BenchmarkDotNet`, `dotnet-trace`, `dotnet-counters`

Bundle: `bottleneck-patterns.md` + `db-optimization.md` + `runtimes-on-kubernetes.md` (universal sections)

**Honest scope — read this**: this skill does not currently have a dedicated reference for .NET / CLR runtime tuning (GC modes, ReadyToRun, tiered compilation flags, AOT). The bundled references cover universal patterns (bottleneck taxonomy, DB optimization, K8s deployment surface) which apply to .NET services, but for CLR-specific tuning — Server GC vs Workstation GC, `DOTNET_GCServer`, `DOTNET_TieredCompilation`, ReadyToRun, Native AOT trade-offs — Claude should answer from general knowledge and the user should reach for a .NET-specialized skill or Microsoft Learn documentation.

Common combos: `dotnet + k8s` (very common pattern); `dotnet + observability` (OpenTelemetry .NET SDK).

#### `php`

Triggers: `PHP`, `Laravel`, `Symfony`, `WordPress`, `PHP-FPM`, `opcache`, `Composer`, `Xdebug`, `Blackfire`

Bundle: `bottleneck-patterns.md` + `db-optimization.md` + `runtimes-on-kubernetes.md` (universal sections)

**Honest scope — read this**: this skill does not currently have a dedicated reference for PHP / PHP-FPM runtime tuning (OPcache, FPM process manager modes, JIT in PHP 8+, preload). Bundled references cover universal patterns. For PHP-specific tuning — `pm.max_children`, `opcache.memory_consumption`, `opcache.jit_buffer_size`, Laravel route caching, query log analysis — Claude answers from general knowledge.

Common combos: `php + db-perf` (Eloquent / Doctrine N+1), `php + cache-layer` (Redis for session / queries).

### Domain profiles

#### `frontend`

Triggers: `Web Vitals`, `LCP`, `INP`, `CLS`, `FCP`, `TTFB`, `React`, `Vue`, `Angular`, `Next.js`, `Nuxt`, `SvelteKit`, `Astro`, `hydration`, `bundle size`, `Lighthouse`, `RUM`, `webpack`, `Vite`, `Turbopack`

Bundle: `web-vitals-deep-dive.md` + `devtools-performance-snippets.md`

Honest scope: vendor-neutral frontend perf — Core Web Vitals diagnosis and remediation, performance budgets, Lighthouse CI gating, image / font / code-splitting optimization, DevTools console snippets for live page audit. Covers React/Vue/Angular at the perf-pattern level; not a tutorial on those frameworks.

Common combos: `frontend + observability` (RUM integration with Grafana Faro / Datadog / New Relic Browser), `frontend + load-testing` (synthetic monitoring), `frontend + nodejs` (Next.js SSR).

#### `db-perf`

Triggers: `SQL`, `Postgres`, `MySQL`, `MariaDB`, `Oracle DB`, `SQL Server`, `N+1`, `EXPLAIN`, `index`, `query plan`, `connection pool`, `slow query`, `HikariCP`, `pgbouncer`, `replica lag`, `partitioning`, `MongoDB`, `Cassandra`, `DynamoDB`

Bundle: `db-optimization.md` + `bottleneck-patterns.md`

Honest scope: query analysis (`EXPLAIN`), indexing strategies, connection pool sizing, caching patterns with invalidation, replicas, partitioning. SQL-focused; NoSQL covered at the bottleneck-pattern level (hot partitions, throttling) but not the depth that a Cassandra or DynamoDB specialist would want.

Common combos: `db-perf + java`/`python`/`nodejs` (ORM-specific N+1 patterns), `db-perf + cache-layer` (read-through cache strategies).

#### `observability`

Triggers: `Prometheus`, `Grafana`, `PromQL`, `Datadog`, `Dynatrace`, `New Relic`, `OpenTelemetry`, `OTel`, `Jaeger`, `Tempo`, `Loki`, `Mimir`, `Pyroscope`, `Beyla`, `Alloy`, `Faro`, `Istio metrics`, `service mesh metrics`, `histogram`, `SLI`, `SLO`, `error budget`, `burn rate`

Bundle: `promql-for-perf.md` + `grafana-stack-observability.md` + `tool-selection-guide.md` (focus on coordinated omission + histogram bucket saturation sections)

Honest scope: LGTM stack from PE perspective (not full Grafana operator's manual), PromQL for SLI/SLO measurement, USE/RED dashboards, multi-window multi-burn-rate alerts, regression detection. Critical content on **histogram bucket saturation** — the classic trap when comparing Istio service-mesh metrics vs APM vs span-derived metrics.

Common combos: `observability + java-k8s` (most common — JVM apps in K8s with mesh + APM divergence), `observability + load-testing` (cross-checking k6 results against server-side histograms).

#### `load-testing`

Triggers: `k6`, `JMeter`, `Gatling`, `Locust`, `wrk2`, `Vegeta`, `Artillery`, `load test`, `stress test`, `soak test`, `capacity test`, `breakpoint test`, `SOAP test`, `campaign`, `throughput`, `tps`, `rps`, `coordinated omission`, `AI testing`, `agentic testing`, `LoadMagic`, `Tricentis`, `Reflect`, `Mabl`, `correlation spectrum`, `HAR to test`, `self-healing test`

Bundle: `k6-patterns.md` + `tool-selection-guide.md` + `cicd-perf-gates.md` + `ai-augmented-testing.md` (when AI/agentic terms appear)

Honest scope: k6 as primary recommended tool (5-block pattern, executors, browser/gRPC/WS support, OpenAPI generation), with JMeter/Gatling/Locust/wrk2/Vegeta documented for their sweet spots. Coordinated omission discipline. CI/CD pipeline integration with threshold strategies and baseline comparison for regression detection. **AI-augmented testing patterns** in `ai-augmented-testing.md` covers the emerging AI overlay (correlation spectrum, three-layer architecture, HAR-to-test workflow, self-healing tests, agent autonomy lessons with authorization gates, vendor landscape evaluation discipline) — load this when the engagement involves AI testing tools or build-vs-buy decisions.

Common combos: `load-testing + observability` (always — every campaign needs server-side validation), `load-testing + engagement-mode` (multi-week perf campaigns), `load-testing + evidence-driven` (when vendor claims about AI testing speedups need scrutiny).

#### `resilience`

Triggers: `chaos engineering`, `chaos testing`, `circuit breaker`, `bulkhead`, `hedged request`, `GameDay`, `load shedding`, `failure mode`, `disaster recovery`, `chaos monkey`, `litmus`, `gremlin`, `failure injection`

Bundle: `resilience-chaos-testing.md` + `bottleneck-patterns.md`

Honest scope: failure mode taxonomy, resilience patterns (circuit breakers, bulkheads, hedged requests, load shedding), GameDay structure. Vendor-neutral on chaos tools — covers Litmus, Gremlin, Chaos Mesh, custom tooling.

Common combos: `resilience + microservices` (the most common combo — chaos in distributed systems), `resilience + load-testing` (combined stress + chaos).

### Architecture pattern profiles

#### `microservices`

Triggers: `microservice`, `microservices`, `distributed system`, `distributed tracing`, `service-to-service`, `fan-out`, `sidecar`, `domain-driven`, `bounded context`, `saga pattern`, `eventual consistency`

Bundle: `bottleneck-patterns.md` + `resilience-chaos-testing.md` + `observability` profile

Honest scope: meta-profile that activates patterns relevant to distributed systems. The bottleneck taxonomy covers cross-service issues (fan-out amplification, downstream cascade, tail-latency amplification across many hops). Resilience covers circuit breakers / bulkheads / hedged requests. Observability covers distributed tracing and span analysis.

Common combos: almost always combined with a runtime profile (`microservices + java-k8s`, `microservices + nodejs-k8s`, etc.) and frequently with `api-gateway` and `message-queue`.

#### `serverless`

Triggers: `Lambda`, `AWS Lambda`, `Azure Functions`, `Cloud Run`, `Cloud Functions`, `Vercel Functions`, `Cloudflare Workers`, `serverless`, `FaaS`, `cold start`, `provisioned concurrency`

Bundle: `runtimes-on-kubernetes.md` (universal sections — cold start, graceful shutdown, image strategy) + `bottleneck-patterns.md` + runtime profile based on Lambda runtime

Honest scope: cold start as the dominant perf concern, runtime-specific cold-start optimization (Node.js fastest, Python second, Java with SnapStart / CRaC, .NET with AOT). Concurrency limits and queue-induced latency under spike load. Container-equivalent concerns mostly apply.

**Note**: AWS Lambda SnapStart for Java has the same conceptual model as CRaC — pre-initialized snapshot, restored on invoke. The CRaC documentation in `runtimes-on-kubernetes.md` is partially applicable.

Common combos: `serverless + java` (SnapStart), `serverless + nodejs` (most common), `serverless + observability` (X-Ray / OTel for Lambda).

#### `message-queue`

Triggers: `Kafka`, `RabbitMQ`, `SQS`, `Pub/Sub`, `NATS`, `Pulsar`, `EventBridge`, `Kinesis`, `producer`, `consumer`, `consumer lag`, `partition`, `dead-letter queue`, `DLQ`

Bundle: `bottleneck-patterns.md` (Pattern 6 — queue saturation) + `resilience-chaos-testing.md` (backpressure, load shedding)

Honest scope: queue-induced latency patterns, consumer lag as an SLI, backpressure mechanisms, DLQ design, partition skew detection. Covers Kafka most concretely; RabbitMQ / SQS / Pub/Sub patterns transfer cleanly.

Common combos: `message-queue + microservices` (asynchronous communication patterns), `message-queue + observability` (consumer lag dashboards, Kafka exporter metrics).

#### `cache-layer`

Triggers: `Redis`, `Memcached`, `ElastiCache`, `cache invalidation`, `TTL`, `LRU`, `cache-aside`, `read-through`, `write-through`, `cache stampede`, `thundering herd`

Bundle: `db-optimization.md` (caching section) + `bottleneck-patterns.md`

Honest scope: caching strategies (cache-aside, read-through, write-through, write-behind), invalidation patterns, TTL strategies, cache stampede prevention (singleflight, jittered TTL, probabilistic refresh). Redis-focused but Memcached / Hazelcast patterns transfer.

Common combos: `cache-layer + db-perf` (almost always — caching is a DB optimization in disguise), `cache-layer + microservices` (distributed caching).

#### `api-gateway` (also: `service-mesh`)

Triggers: `Istio`, `Envoy`, `Linkerd`, `Consul Connect`, `Kong`, `Traefik`, `nginx`, `API gateway`, `service mesh`, `mTLS`, `sidecar proxy`

Bundle: `observability` profile (with explicit focus on histogram bucket saturation across mesh metrics vs APM) + `bottleneck-patterns.md` + `resilience-chaos-testing.md`

Honest scope: the gateway/mesh perf surface — mTLS overhead, sidecar latency cost, header rewriting cost, retry/timeout configuration, traffic splitting. **Critical**: histogram bucket saturation between Istio/Envoy metrics, APM, and span-derived metrics is a classic source of conflicting latency numbers.

Common combos: `api-gateway + microservices` (default), `api-gateway + observability` (mesh metrics setup).

#### `grpc`

Triggers: `gRPC`, `protobuf`, `proto3`, `gRPC streaming`, `gRPC-Web`, `connect-go`, `grpc-gateway`, `gRPC deadline`

Bundle: `bottleneck-patterns.md` + `k6-patterns.md` (k6 supports gRPC) + `observability` profile

Honest scope: gRPC-specific concerns — streaming (server-streaming, client-streaming, bidirectional), deadlines (must be tighter than SLO), codec performance, connection pooling. Load testing via k6's gRPC support documented in `k6-patterns.md`.

Common combos: `grpc + microservices` (default), `grpc + golang` (most common implementation language).

#### `graphql`

Triggers: `GraphQL`, `Apollo`, `Apollo Federation`, `Apollo Gateway`, `Relay`, `Hasura`, `DataLoader`, `persisted queries`, `query depth`, `query complexity`

Bundle: `db-optimization.md` (N+1 patterns) + `bottleneck-patterns.md` + `cache-layer` profile

Honest scope: GraphQL-specific perf patterns — N+1 prevention via DataLoader, query depth/complexity limits to prevent malicious queries, persisted queries to reduce parse time, response caching strategies. Apollo Federation gateway concerns. Schema-level optimization (avoid deep nested resolvers in critical paths).

Common combos: `graphql + nodejs` (most common host), `graphql + db-perf` (the N+1 connection).

### Meta-engineering profiles

#### `evidence-driven`

Triggers: `evidence-based`, `evidence driven`, `data-driven`, `data driven`, `centrado en datos`, `centrado en evidencia`, `A/B test`, `controlled experiment`, `before and after`, `antes y después`, `hypothesis testing`, `statistical rigor`, `DMAIC`, `EBSE`, `scientific method for perf`, `baseline first`, `verify the change`, `coordinated omission concern`

Bundle: `evidence-based-pe.md` + `diagnostic-playbooks.md` + `tool-selection-guide.md` (coordinated omission section) + `bottleneck-patterns.md`

Honest scope: covers evidence-based PE methodology end-to-end — supporting frameworks (EBSE / DMAIC / scientific method / SPC / DORA / Google SRE / Methodology First), the 10-step before/after workflow, request-vs-execute decision for gathering evidence, statistical rigor floor (percentiles over means, minimum sample sizes, confidence intervals, coordinated omission cross-checks, one-variable-at-a-time discipline), 4 templates (hypothesis statement, measurement plan, A/B test design, verification report), 15 perf-specific anti-patterns. Applies as a **cross-cutting overlay** to other profiles — when active, rigor requirements escalate: every recommendation requires baseline + hypothesis + measurement plan before being made; every change requires verification report afterward.

**This profile is usually ADDITIVE** — combine with the stack/domain profile relevant to the engagement (e.g., `evidence-driven + java-k8s + observability` for a rigorous Java perf engagement). It does not replace stack-specific knowledge; it imposes methodology rigor on top.

Common combos: `evidence-driven + <any other profile>` — the entire skill is supposed to be evidence-based by default (Step 0.5 of SKILL.md). This profile is for engagements where the user wants the discipline made explicit and enforced more strictly (e.g., regulated environments, customer-facing perf claims, multi-stakeholder reports).

#### `llm-perf`

Triggers: `LLM`, `token`, `tokens`, `prompt caching`, `Batch API`, `Anthropic`, `Claude API`, `OpenAI API`, `RAG`, `embedding`, `RTK`, `Rust Token Killer`, `Caveman`, `prompt engineering`, `agentic workflow`, `Claude Code`, `Cursor`, `context window`, `TTFT`, `cost per token`, `model tier`, `Haiku`, `Sonnet`, `Opus`

Bundle: `llm-perf-and-tokens.md` + `bottleneck-patterns.md` + `agent-team-orchestration.md`

Honest scope: covers LLM workflow performance — token economy fundamentals, Anthropic prompt caching (5min/1h TTL via `cache_control`), Batch API (50% discount for non-interactive), model tier selection with two-stage pipeline pattern, streaming for TTFT, parallel tool use, structured outputs, RTK (Rust Token Killer) for input-side compression with 60-90% reduction on common dev commands, Caveman mode for output-side compression with ~75% reduction, RAG / retrieval optimization, conversation history compression, LLM observability stack (OpenLLMetry / Helicone / Langfuse / PromptLayer / LangSmith). Patterns transfer to non-Anthropic providers but exact mechanics differ.

Common combos: `llm-perf + engagement-mode` (when running an LLM observability engagement); `llm-perf + observability` (when measuring LLM perf via standard telemetry stack); `llm-perf + db-perf` (for vector store / embedding cache optimization).

#### `code-review`

Triggers: `review my code`, `revisá este código`, `code review`, `PR review`, `look at this PR`, `commit workflow`, `atomic commits`, `conventional commits`, `perf review of <file/repo>`, `find perf issues in`, paste of a code block with implicit perf question

Bundle: `code-review-commit-workflow.md` + `bottleneck-patterns.md` + `runtime-perf-tuning.md` (universal optimization workflow section)

Honest scope: covers the static-code review workflow for performance — perf smell checklist (universal + per-language for Java/Node/Go/Python), vertical-slice grouping, ROI-based commit ordering, per-commit authorization protocol, Conventional Commits format for perf changes (`perf:`/`refactor:`/`fix:`) with subject-line discipline + body templates per change type (N+1, index, cache, async, algorithm, JVM tuning, resource limits), feature-flag patterns for risky changes, multi-commit PR structure, rollback discipline. Always combines with the runtime profile relevant to the code being reviewed.

**Critical operating rule**: every commit requires explicit user authorization. Never batch commits under a single "approve all" gate. `git push`, `git merge`, `git rebase`, PR creation — each requires its own explicit per-instance authorization. See `code-review-commit-workflow.md` for the full authorization checkpoint list.

Common combos: `code-review + java` (Spring Boot code review); `code-review + nodejs` (Node.js code review); `code-review + db-perf` (SQL / query plan review); `code-review + llm-perf` (reviewing AI/LLM code for token efficiency).

#### `finops`

Triggers: `FinOps`, `cloud cost`, `AWS bill`, `Azure cost`, `GCP billing`, `cost optimization`, `savings plan`, `reserved instance`, `RI`, `committed use discount`, `CUD`, `spot instance`, `right-sizing`, `cost attribution`, `cost per request`, `unit economics`, `egress cost`, `FOCUS spec`, `Infracost`, `OpenCost`, `Kubecost`, `chargeback`, `showback`, `cloud waste`

Bundle: `finops-cloud-cost.md` + `runtimes-on-kubernetes.md` (resource sizing section) + `llm-perf-and-tokens.md` (when AI workloads are involved) + `bottleneck-patterns.md`

Honest scope: covers FinOps Foundation 2026 Framework + FOCUS spec, AWS / Azure / GCP cost levers (Savings Plans / RIs / CUDs / Spot / storage tiers / database tiers), universal patterns (tagging, right-sizing workflow, idle resource detection, egress optimization, storage lifecycle), Kubernetes FinOps (OpenCost / Kubecost / Karpenter / KEDA), AI workload cost (token attribution, model tier selection, GPU sizing), tools landscape (cloud-native + open-source + commercial), engagement workflow (Inform → Optimize → Operate). PE engineer's perspective — not a FinOps Foundation textbook.

Common combos: `finops + java-k8s` (most common pattern — JVM apps in cloud K8s with cost optimization scope); `finops + llm-perf` (AI workload cost management); `finops + engagement-mode` (multi-week FinOps engagements); `finops + observability` (cost dashboards + per-workload attribution).

#### `cicd-pipeline`

Triggers: `CI`, `CD`, `pipeline`, `GitHub Actions`, `GitLab CI`, `Jenkins`, `CircleCI`, `Argo CD`, `Flux`, `Spinnaker`, `build time`, `deployment frequency`, `lead time`, `MTTR`, `DORA`, `Docker layer caching`, `BuildKit`, `monorepo`, `Bazel`, `Nx`, `Turborepo`, `self-hosted runner`, `feature flag`, `canary deployment`, `blue green`, `GitOps`, `progressive delivery`

Bundle: `cicd-pipeline-optimization.md` + `cicd-perf-gates.md` (the existing gating-tests reference) + `bottleneck-patterns.md`

Honest scope: pipeline-as-perf-system perspective — CI optimization (build caching strategies, test parallelization, Docker BuildKit, monorepo tooling, self-hosted vs cloud runners), CD optimization (deployment strategies, GitOps, feature flags, rollback automation), platform-specific levers (GitHub Actions, GitLab CI, Jenkins, Argo CD, Flux, Spinnaker), DORA metrics tracking, pipeline observability, common anti-patterns, cost optimization for CI/CD itself. Complements `cicd-perf-gates.md` (which is about running perf tests *in* the pipeline) by focusing on optimizing the pipeline *itself*.

Common combos: `cicd-pipeline + engagement-mode` (multi-sprint pipeline modernization); `cicd-pipeline + finops` (CI/CD cost is real cost); `cicd-pipeline + java-k8s` (when the pipeline ships JVM apps to K8s); `cicd-pipeline + observability` (DORA metrics on Grafana / Datadog).

#### `skill-maintenance`

Triggers: `audit this skill`, `audit the skill`, `update the skill`, `revisar el skill`, `what's stale`, `research and update`, `model upgrade review`, `we moved to <new model>`, `actualizar el skill`, `audit performance-engineering skill`

Bundle: `skill-self-maintenance.md` + `code-review-commit-workflow.md` + `expert-profiles.md` (the catalog the audit checks against)

Honest scope: documented workflow (NOT autonomous editing of the skill) for keeping the skill current — periodic audit (staleness detection across version-specific content, link rot, outdated claims, missing emerging topics, internal consistency), research-and-propose mode (use web_search + web_fetch to gather current state from authoritative sources, draft updates in skill voice, propose as atomic commits with explicit per-commit authorization), model-upgrade review (when Anthropic ships a new model, review and update model-specific guidance in agent-team-orchestration.md, llm-perf-and-tokens.md, SKILL.md). Quality gates for proposed updates (source citation, currency, cross-source confirmation, voice consistency, no bluffing). When to retire content vs update it.

**Critical**: this profile does NOT enable autonomous editing. Every change requires explicit user authorization, same as `code-review` profile. The skill provides the workflow, the user remains in control.

Common combos: `skill-maintenance + code-review` (the underlying commit workflow); `skill-maintenance + observability` (when the audit involves Grafana / Prometheus content); `skill-maintenance + llm-perf` (when the model-change review is the trigger).

### Engagement profile

#### `engagement-mode`

Triggers: `team mode`, `scrum`, `scrum mode`, `agent mode`, `campaign`, `client engagement`, `multi-week`, `sprint`, `engagement brief`, `kickoff`, `actúa como tech lead`, `actúa como mi PM`

Bundle: `agent-team-orchestration.md` + `intake-checklists.md` + `context-document-template.md` + `deliverable-templates.md` + `ticket-generation.md` + `study-paper-templates.md`

Honest scope: this is the **orchestration profile** — turns the skill from "answer one question" to "run a multi-week engagement as a cross-functional team simulation." Loads all the engagement-management references. Activates the agent-team mode with PM / SM / Tech Lead / Engineer / SRE / QA roles, GSD cadence, vertical slices, sprint loop.

**Note**: this is an overlay, not a replacement. It combines with the stack profiles. A typical client engagement would activate `engagement-mode + spring-boot + java-k8s + observability` to run as a team on a real client's Java stack.

---

## Combined profile examples

### Example 1 — Spring Boot in EKS with p99 spike

User: *"Tengo un Spring Boot en EKS con spike de p99 en checkout"*

Auto-detected triggers: `Spring Boot` → `spring-boot`; `EKS` → k8s overlay; `spike de p99` → diagnose mode (not a profile).

Activated: **`spring-boot` + `java-k8s`** (the second supersets the first)

Loaded:
- `runtime-perf-tuning.md`
- `bottleneck-patterns.md`
- `memory-leak-detection.md`
- `java-frameworks-and-distributions.md`
- `db-optimization.md`
- `runtimes-on-kubernetes.md`
- `diagnostic-playbooks.md` (because diagnose mode)

Skipped: `web-vitals-deep-dive.md`, `devtools-performance-snippets.md`, `k6-patterns.md`, `cicd-perf-gates.md`, Node/Go/Python sections of `runtime-perf-tuning.md` (mental skip — same file, just different sections), `resilience-chaos-testing.md`, `study-paper-templates.md`, agent-team-orchestration.

### Example 2 — k6 campaign against a GraphQL gateway

User: *"Necesito diseñar una campaña de carga con k6 para nuestro GraphQL gateway"*

Triggers: `k6` → `load-testing`; `GraphQL` → `graphql`; `campaña` → engagement-mode (weak — let user confirm)

Activated: **`load-testing` + `graphql`**

Loaded:
- `k6-patterns.md`
- `tool-selection-guide.md`
- `cicd-perf-gates.md`
- `db-optimization.md` (N+1 awareness)
- `bottleneck-patterns.md`
- `cache-layer` profile contents (cached resolver patterns)
- `intake-checklists.md` (campaign planning)

Skipped: everything else.

Claude announces: *"Profile **load-testing + graphql** activo. ¿Es engagement multi-semana? Si sí, sumo `engagement-mode` para la cadencia de sprints."*

### Example 3 — Observability discrepancy investigation (your active case)

User: *"Estoy comparando P99 entre Istio metrics y Dynatrace y veo diferencias grandes"*

Triggers: `Istio metrics` → `observability` + `api-gateway`; `Dynatrace` → `observability`; `P99` → diagnose mode.

Activated: **`observability` + `api-gateway`**

Loaded:
- `promql-for-perf.md`
- `grafana-stack-observability.md`
- `tool-selection-guide.md` (focus on coordinated omission + **histogram bucket saturation** — your active hypothesis)
- `bottleneck-patterns.md`
- `resilience-chaos-testing.md`
- `diagnostic-playbooks.md`

This is the smallest-bundle engagement type — Claude can focus 100% on the metric-source-discrepancy investigation without the noise of unrelated references.

### Example 4 — User says "cargá todo el skill"

Explicit opt-out. No profile activated. Claude reads SKILL.md and pulls references on-demand using the original behavior. Useful for exploratory engagements where the problem isn't yet localized.

---

## Anti-patterns

- **Aggressive auto-detection** — don't activate profile from a single weak trigger ("the system is slow" is too generic). Wait for two signals or ask.
- **Profile lock-in** — when the conversation drifts, escalate (add a profile) instead of ignoring the new dimension.
- **Refusing user override** — if the user says `"usá nodejs"` and the message looks Java-like, trust the user. They know their stack.
- **Silent activation** — always announce which profile was activated and offer to combine / change.
- **Pretending coverage** — for `dotnet` and `php` profiles where the skill doesn't have dedicated references, say so honestly in the disclosure. Don't bluff.
- **Bundling exhaustively** — a profile is a curated bundle, not "every reference that could conceivably apply." If a reference rarely matters for that profile, don't include it. The whole point is to reduce noise.

---

## Disclosure templates (use these when activating)

**Single profile:**
> Activé profile **`<name>`**. Esto carga: `<ref1>`, `<ref2>`, `<ref3>`. Si el problema cruza a `<adjacent-profile>`, decime y sumo.

**Multi-profile:**
> Activé profiles **`<a>` + `<b>`**. Cargados: `<refs union>`. Excluido: `<refs typically loaded but skipped>`.

**Profile with honest scope flag:**
> Activé profile **`<dotnet/php>`**. Esto carga patterns universales (`<refs>`). Importante: este skill no tiene reference dedicado para runtime tuning de `<CLR/PHP>` — para flags específicos del runtime (`<example flags>`) voy a contestar desde general knowledge, no desde reference curada.

**Override request:**
> Entendido, cambio de profile. Activo **`<new>`** y desactivo **`<old>`**. ¿Mantengo algo del bundle anterior?

**Opt-out:**
> OK, sin profile activo. Voy a leer references on-demand según vaya necesitando.
