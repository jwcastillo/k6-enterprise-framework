# Java frameworks and JVM distributions

Performance considerations specific to popular Java frameworks and JVM distributions (sabores). Use when the engagement involves a specific framework choice or when the JVM distribution itself is a tuning lever (e.g., switching to GraalVM Native, Azul Prime, or Eclipse OpenJ9).

This complements `runtime-perf-tuning.md` (vendor-neutral JVM tuning) with vendor-specific and framework-specific knowledge.

---

## JVM distributions — choosing the right "flavor"

All distributions implement the same Java language. They differ in: GC implementations available, AOT capabilities, support/LTS terms, container ergonomics, and proprietary extensions. Picking the right one is a perf lever many teams overlook.

### Comparison table

| Distribution | Vendor | License | Distinctive features | When to pick |
|--------------|--------|---------|----------------------|--------------|
| **Eclipse Temurin** (Adoptium) | Eclipse Foundation | GPLv2+CE | Community OpenJDK builds, vendor-neutral | **Default safe choice** for most production. Long LTS, no commercial entanglement |
| **Amazon Corretto** | AWS | GPLv2+CE | Free LTS support from Amazon, optimized for EC2/Lambda | AWS-heavy environments; free production-grade support |
| **Azul Zulu** | Azul | GPLv2+CE | Broad platform coverage (Alpine, ARM, older OSes) | Free with optional commercial support; ARM/Apple Silicon dev environments |
| **Azul Platform Prime** (formerly Zing) | Azul | Commercial | **C4 pauseless GC** (sub-ms pauses at TB heaps), **ReadyNow** AOT optimization | Hard latency SLOs (financial trading, real-time bidding) where ZGC isn't enough |
| **Oracle JDK** | Oracle | Commercial / NFTC | Official Oracle build, identical to OpenJDK from a perf perspective | Oracle support contracts; otherwise no perf reason over Temurin |
| **GraalVM** (CE/EE) | Oracle | GPLv2+CE / Commercial | **GraalVM JIT** (better-than-C2 for some workloads), **Native Image** AOT to native binary | Native Image: sub-100ms startup, low memory, no JIT warmup. JIT-only mode: 10-30% throughput gains on some workloads |
| **Alibaba Dragonwell** | Alibaba | GPLv2+CE | OpenJDK + Alibaba-internal patches (AJDK features), recent **AI extension** for ML workloads | Cloud workloads at scale, especially in Alibaba Cloud or e-commerce patterns. Includes WispV2 coroutines (pre-Loom alternative) |
| **SapMachine** | SAP | GPLv2+CE | OpenJDK build maintained by SAP; **enables Compact Object Headers by default in JDK 25** | SAP-aligned customers; teams that want compact headers default without manual flag |
| **BellSoft Liberica** | BellSoft | GPLv2+CE | OpenJDK + JavaFX bundled; **Alpaquita Linux** native images | Desktop apps with JavaFX, or Alpine-based container deployments with smaller base images |
| **IBM Semeru** (with **Eclipse OpenJ9** VM) | IBM | EPL/Apache 2.0 | **Not HotSpot — different JVM.** Lower memory footprint, faster startup, slower peak throughput | Memory-constrained containers where peak throughput is secondary (microservices density on small nodes) |
| **Red Hat OpenJDK** | Red Hat | GPLv2+CE | Stable OpenJDK for RHEL platform | RHEL / OpenShift deployments with Red Hat support |
| **Microsoft Build of OpenJDK** | Microsoft | GPLv2+CE | OpenJDK build, Azure-optimized | Azure-heavy environments |

### Decision shortcuts

| Constraint / goal | Recommendation |
|-------------------|----------------|
| "Just give me a safe default" | **Temurin** LTS (21 or 25) |
| AWS deployment, want vendor support free | **Corretto** |
| Azure deployment | **Microsoft OpenJDK** |
| Alibaba Cloud or Chinese cloud | **Dragonwell** |
| Latency SLO p99 < 5ms at multi-TB heap, willing to pay | **Azul Prime** (C4 GC) |
| Need sub-100ms startup (FaaS, CLI tools) | **GraalVM Native Image** |
| Want better JIT throughput without Native Image complexity | **GraalVM JIT** (Enterprise or CE with `-XX:+UseJVMCICompiler`) |
| Container memory pressure, density matters more than peak throughput | **Semeru / OpenJ9** |
| Spring Boot app, want Compact Object Headers without thinking | **SapMachine** (defaults on) or any JDK 25 with the flag |
| Need ARM, Apple Silicon, exotic platforms | **Azul Zulu** (broadest coverage) |

### Anti-patterns

- **Defaulting to Oracle JDK because "it's official"** — Temurin is identical from a perf perspective and avoids licensing risk.
- **Using GraalVM Native Image without considering closed-world tradeoffs** — reflection, dynamic class loading, JNI all require explicit configuration. Migration cost is non-trivial; reserve for workloads where startup truly matters.
- **Mixing distributions across a fleet without reason** — observability becomes harder; standardize unless there's a specific reason to diverge.
- **Switching distributions to fix a perf problem that's actually in the application** — the distribution rarely changes p99 by more than 10-15% on its own (Prime/C4 excepted). Code and config dominate.

### When the JVM distribution matters most (and least)

**Matters most:**
- Hard latency SLOs at large heaps (Prime's C4)
- Startup-critical workloads (GraalVM Native Image, AOT cache)
- Memory-density constraints (OpenJ9)
- Specific cloud vendor optimizations (Corretto on AWS Lambda, Microsoft on Azure)

**Matters least:**
- Standard Spring Boot REST API at moderate scale — Temurin / Corretto / Zulu all perform within noise of each other
- CRUD-heavy workloads bottlenecked on DB — JDK choice is downstream of the actual bottleneck
- Pre-launch dev environments — pick whatever the team already has installed

---

## Framework-specific tuning

### Spring Boot — the most common Java framework

#### Virtual threads (Java 21+ with Spring Boot 3.2+)

```properties
# application.properties — enable virtual threads for Tomcat, @Async, executors
spring.threads.virtual.enabled=true
```

This switches the web server, `@Async`, scheduled tasks, and the WebClient default scheduler to virtual threads. **Pre-flight check before enabling**:

- Java 21-23: audit `synchronized` blocks in your code AND in libraries you depend on. Libraries that synchronize on I/O cause carrier exhaustion. Critical libraries verified non-pinning: HikariCP 5.x+, Caffeine 3.x+, PostgreSQL JDBC 42.6+, MySQL Connector/J 9.0+, Apache HttpClient 5.4+.
- Java 24+: synchronized pinning is fixed (JEP 491); enable freely.

#### Spring AOT + Project Leyden AOT cache (Spring Boot 4 / Java 25)

Combines Spring's build-time AOT processing with the JVM's AOT cache for dramatic startup reduction:

```bash
# Build with Spring AOT
mvn package -Pnative   # generates AOT artifacts; Spring AOT must be in build

# Extract layered jar (Spring Boot 3.2+ supports this)
java -Djarmode=tools -jar target/app.jar extract --destination target/extracted

# Training run + AOT cache assembly
java -XX:AOTCacheOutput=app.aot \
     -Dspring.context.exit=onRefresh \
     -jar target/extracted/app.jar

# Production run
java -XX:AOTCache=app.aot \
     -Dspring.aot.enabled=true \
     -jar target/extracted/app.jar
```

Reported gains: **3-5× faster startup** (Spring Boot 3.x: ~5s → ~1.5s; Spring Boot 4 + Spring AOT cache: under 1s for typical apps).

#### Actuator metrics for observability

```properties
management.endpoints.web.exposure.include=health,metrics,prometheus,httptrace,heapdump,threaddump
management.metrics.distribution.percentiles-histogram.http.server.requests=true
management.metrics.distribution.percentiles.http.server.requests=0.5,0.95,0.99,0.999
```

Exposes Prometheus-scrapeable RED metrics with native histogram percentiles. `heapdump`, `threaddump` and `httptrace` leak memory contents and request data: serve Actuator on a separate management port that is not reachable publicly, or drop those three outside a controlled perf environment. Required for the SLO measurement queries in `promql-for-perf.md` to work end-to-end.

#### Common Spring Boot perf pitfalls

- **`@Transactional` over network calls** — DB transaction held open across slow downstream calls; connection pool exhausts. Audit transaction boundaries.
- **Default Tomcat thread pool too small** under spike load — `server.tomcat.threads.max=200` default; tune for actual concurrency or switch to virtual threads.
- **`RestTemplate` without explicit timeouts** — defaults are infinite. Use `WebClient` with explicit timeouts, or configure `RestTemplate` with `ClientHttpRequestFactory` timeouts.
- **JPA N+1 from default lazy-loading** — see `db-optimization.md`. Spring Data + `@EntityGraph` or `JOIN FETCH` queries.
- **Bean-creation cost on autoscale** — many beans → slow startup → slow HPA scaling. Use AOT cache or migrate to GraalVM Native.

### Quarkus — supersonic subatomic Java

Quarkus is **GraalVM-first**, optimizing for Native Image: sub-50ms startup, ~50MB RSS. Trade-offs: closed-world analysis required, dynamic features (reflection) need explicit registration.

#### Build modes

```bash
# JVM mode — faster build, classic JVM runtime
mvn package

# Native mode — slow build (~5 min), tiny runtime
mvn package -Dnative -Dquarkus.native.container-build=true
```

#### Key tuning knobs

```properties
# Native image memory at build time
quarkus.native.native-image-xmx=8G

# Compilation parallelism
quarkus.native.additional-build-args=-J-Xmx8g,-O3

# Continuous testing in dev mode (don't enable in prod)
# quarkus.test.continuous-testing=enabled
```

#### When to choose Quarkus over Spring Boot

- **Startup matters more than ecosystem breadth** — FaaS, frequent autoscaling, ephemeral workloads
- **Memory density** — 5-10× more instances per node in Native mode
- **You're starting fresh** — migration from Spring is non-trivial; rewrite scope

#### When NOT to choose Quarkus

- Heavy use of reflection (some ORMs, older libraries) without willingness to add reflection configuration
- Team already deep in Spring ecosystem
- Need libraries that lack Native Image support

### Micronaut — compile-time DI

Like Quarkus, optimizes for startup and memory by doing reflection/DI at **compile time** instead of runtime. Compatible with both JVM and GraalVM Native Image.

```yaml
# application.yml
micronaut:
  http:
    client:
      read-timeout: 5s
      max-connections: 50
  server:
    netty:
      worker:
        threads: 16
```

Distinctive features:
- **Reflection-free** — no runtime reflection cost
- **AOT-friendly** — generates source at compile time, no bytecode manipulation at startup
- **Polyglot** — Java, Kotlin, Groovy with first-class support

Decision vs Quarkus: usually a team preference (build experience, library compatibility, language preference). Both compete for the "sub-100ms startup, sub-50MB memory" niche.

### Helidon — Oracle's microservices framework

Two flavors:
- **Helidon SE** — reactive, async, Netty-based. Lowest memory, lowest startup.
- **Helidon MP** — MicroProfile-compliant (CDI-based). Spring-Boot-like ergonomics, heavier.

```bash
# Native Image build for Helidon SE
mvn package -Pnative-image
```

Strong fit for Oracle Cloud Infrastructure deployments. Outside that context, Quarkus/Micronaut typically dominate the same niche with broader community traction.

### Vert.x — reactive event-loop

Single-thread-per-core event loop, similar to Node.js model but on JVM. Excellent for high-throughput I/O-bound workloads (proxies, gateways, message brokers).

```java
Vertx vertx = Vertx.vertx(new VertxOptions()
    .setEventLoopPoolSize(Runtime.getRuntime().availableProcessors())
    .setWorkerPoolSize(20)
    .setMaxEventLoopExecuteTime(2_000_000_000L));  // 2s in nanos
```

**Critical anti-pattern**: blocking work on the event loop. Vert.x will warn if you exceed `maxEventLoopExecuteTime`. Run blocking work via `vertx.executeBlocking()` or a worker verticle.

**Java 21+ note**: virtual threads compete with the reactive paradigm. For new projects, virtual threads + imperative code often match Vert.x throughput with simpler code. Vert.x still wins on extreme connection counts (millions of WebSocket connections) where event loops scale further.

### Akka — actor model (license change since 2022)

Important: Akka moved from Apache 2.0 to **BSL (Business Source License)** at 2.7. Production use beyond a revenue threshold requires a commercial license from Lightbend. This is a **business decision before a technical one**.

Open alternative: **Pekko** — Apache 2.0 fork of Akka maintained by the Apache Foundation. Drop-in replacement for most use cases.

Technical fit: high-concurrency message-passing, distributed systems, event-sourcing. Still strong on these, but virtual threads + structured concurrency are eating into the "you must use Akka for high concurrency" argument.

### Dropwizard — pragmatic batteries-included

Jersey + Jetty + Metrics + Hibernate Validator + Health checks. Less popular than Spring Boot in 2026 but still maintained and used in some financial / enterprise contexts.

Performance characteristics close to Spring Boot. Choose for: simpler dependency graph, more explicit configuration, smaller fat jar. Not a perf win on its own.

### Jakarta EE / Eclipse MicroProfile

The standard-based ecosystem (vs Spring's de-facto standards). Major implementations: **Open Liberty** (IBM), **Payara** (community), **WildFly** (Red Hat).

For perf engineering, treat Jakarta EE servers as "another Spring Boot equivalent" — same general tuning surface area (heap, GC, thread pools). MicroProfile Health and MicroProfile Metrics give equivalent observability primitives to Spring Boot Actuator.

---

## Framework decision matrix (quick reference)

| Goal | Framework |
|------|-----------|
| Most jobs, broad ecosystem, productivity | **Spring Boot** |
| Sub-100ms startup, FaaS, autoscaling-heavy | **Quarkus** or **Micronaut** (Native Image) |
| Oracle Cloud first | **Helidon** |
| Highest connection count (millions of WS) | **Vert.x** |
| Distributed actors, event-sourcing | **Pekko** (or Akka if licensed) |
| Strict Jakarta EE standard compliance | **Open Liberty / Payara / WildFly** |
| Simpler than Spring Boot but similar capabilities | **Dropwizard** |

For most engagements: start with what the team uses. Switching frameworks for perf is a quarter-long investment, justified only when the workload genuinely doesn't fit (e.g., 3-second Spring Boot startup blocking autoscaling for a high-spike workload).

---

## Cross-cutting concern: GraalVM Native Image (any framework)

Native Image is a **runtime concern** more than a framework one — Spring Boot 3+, Quarkus, Micronaut, Helidon all support it. Tradeoffs are universal:

**Wins:**
- 10-100× faster startup (50ms vs 3-5s)
- 3-10× lower memory (50MB vs 300MB)
- No JIT warmup curve

**Costs:**
- Closed-world analysis — reflection, dynamic class loading, JNI need explicit config
- Slower peak throughput in some workloads (no continuous JIT optimization)
- Slower build times (5-15 min)
- Some libraries lack Native Image support (audit before committing)

**When Native Image wins:**
- FaaS / Lambda / Cloud Run
- Frequent autoscaling
- CLI tools
- Edge / IoT deployments

**When Native Image loses:**
- Long-running services where peak throughput matters more than startup (JIT can outperform AOT after warmup)
- Heavy reflection users (some Hibernate setups, older ORMs)
- Teams without bandwidth for the build / debug differences

### Alternative: Project Leyden AOT cache (no Native Image required)

Captures most of the startup win without giving up dynamic JVM capabilities. See `runtime-perf-tuning.md` for the workflow. Most teams should try Leyden first; reach for Native Image when Leyden's 50-70% reduction isn't enough.

---

## Choosing the stack for a new service

Decision order:

1. **JVM version**: Java 25 LTS (current) or Java 21 LTS (still supported through ~2031). Skip non-LTS for production.
2. **JVM distribution**: Temurin default; cloud-vendor variant (Corretto / Microsoft / Dragonwell) for that cloud; Prime for hard latency SLOs; OpenJ9 for memory-constrained density; GraalVM for Native Image.
3. **Framework**: Spring Boot for breadth and team familiarity; Quarkus / Micronaut for startup-critical; Vert.x for connection-extreme.
4. **GC**: G1 default; ZGC for latency-critical (Java 25 makes it generational by default).
5. **AOT strategy**: Leyden AOT cache (low effort, big startup win); Native Image (high effort, biggest win) only when justified.

State these choices in the context document (`context-document-template.md`) so future perf work knows the boundary conditions.
