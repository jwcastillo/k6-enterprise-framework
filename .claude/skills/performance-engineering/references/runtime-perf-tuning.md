# Runtime performance tuning

Per-runtime performance tuning patterns: GC presets, profiling commands, hot-path smells, optimization workflow. Use when the bottleneck is in the runtime layer rather than the application logic, database, or network.

> Sources synthesized: claudskills.com `java-performance` (JVM presets, JMH, GC comparison), microlink.io `nodejs-performance` (priority scoring, hot-path smells, output template), khanntm `memory-leak-detection` (cross-runtime patterns).

This complements `bottleneck-patterns.md` Pattern 10 (GC pathology) and `memory-leak-detection.md` (which covers leaks in detail) with proactive tuning per runtime.

---

## Universal optimization workflow

This applies regardless of runtime. Use it before reaching for the runtime-specific patterns below.

### 1. Pick one candidate using priority scoring

```
priority = (frequency × blast_radius × expected_gain) / (risk × effort)
```

Score each on 1-5:
- **frequency**: how often the path runs in production
- **blast_radius**: how many requests/jobs/users are affected
- **expected_gain**: estimated latency or resource improvement
- **risk**: probability of behavior regression
- **effort**: engineering time and change surface area

Pick the top score. Validate with a baseline measurement before coding.

### 2. Prove it's hot

- Add a focused micro-benchmark **and** a scenario benchmark (full request flow).
- Capture baseline numbers before any edit.
- Scenario benchmarks decide; micro-benchmarks support.

### 3. Design a minimal fix

- Behavior-compatible defaults.
- Add a fallback path for edge cases.
- Avoid broad refactors in the same change.

### 4. Implement, test, re-benchmark

- Smallest patch that removes the repeated work.
- Tests for new behavior + regressions.
- Re-run the same benchmark with the same parameters.
- Report absolute and relative deltas: p50/p95/p99 latency first, throughput second, resource counters when relevant.

### 5. Package as one PR per improvement

- Branch: `perf/<area>-<change>`
- Commit: `perf(<package>): <what changed>`
- PR includes: issue, why-it-matters-under-load, code locations, tests run, before/after benchmark numbers, risk assessment, next candidate.

**Operating rule**: one optimization per PR. Always pick highest expected impact. Never bundle multiple optimizations — bundling makes regressions impossible to bisect.

### 6. Output template (use for every perf PR)

```markdown
## Issue
[One sentence describing the problem]

## Why it matters under load
[How this affects p99, throughput, or resource pressure at production scale]

## Code locations changed
- `path/to/file.ext:line` — [what changed]

## Tests run
- [Test name] — [outcome]

## Benchmark
**Baseline**: p50 X ms, p95 Y ms, p99 Z ms, throughput N RPS
**After**:    p50 X' ms, p95 Y' ms, p99 Z' ms, throughput N' RPS
**Delta**:    p50 -X%, p95 -Y%, p99 -Z%, throughput +M%

## Risk
[Low/Med/High with reasoning. Rollback simplicity.]

## Next candidate
[Next-priority optimization to tackle]
```

---

## Hot-path smells (any runtime)

Before runtime-specific tuning, scan for these. They're language-agnostic and the highest-yield wins.

- Recomputing invariant values per invocation (move to module init or memoize)
- Re-parsing config / regex / templates repeatedly (compile once)
- Duplicate async lookups returning the same value (request coalescing / DataLoader)
- Per-call heavy object allocation in dominant input shapes (object pool / fast path)
- Unnecessary `await` / `.then()` in teardown / close paths (parallelize cleanup)
- Missing fast paths for the dominant input shape (e.g., 90% of requests are simple — short-circuit)
- Unbounded retries or retry storms under degraded dependencies (bounded + jittered backoff)
- Excessive concurrency causing memory spikes (cap at each boundary)
- Work done for logging / telemetry / metrics formatting **even when disabled** (lazy evaluation)
- Synchronous I/O on the hot path (file reads, sync DNS, sync DB calls in async runtimes)

**Prioritize**: code that runs on **every request/job/task** (middleware, retry/timeout/circuit-breaker code, connection pools, serialization hot paths, queue consumers, event listener lifecycle). Deprioritize one-time startup unless startup is on the critical path at scale.

---

## JVM (Java, Kotlin, Scala)

### GC selection (Java 21+ / 25 LTS)

| GC | Pause profile | Throughput | Heap range | When to pick |
|----|---------------|------------|------------|--------------|
| **G1** | Medium pauses (50-200ms typical) | High | 4-32GB | Default for general-purpose server work. Java 9+ default. |
| **ZGC** (Generational, default in Java 25) | Sub-10ms (often sub-2ms in production) | Medium | 8GB-16TB | Latency-critical (p99 < 50ms targets), large heaps. In Java 25 it's the **only** ZGC mode — no flag needed for generational. |
| **Shenandoah** (Generational, JEP 521 finalized in Java 25) | Sub-10ms pauses | Medium | 8GB+ | Latency-critical alternative to ZGC; common in Red Hat OpenJDK ecosystem |
| **Parallel** | Long stop-the-world (seconds) | Very High | Any | Batch / throughput-only workloads with no latency SLO |
| **Serial** | Long pauses | Low | < 1GB | Tiny single-core containers; CLI tools; lowest overhead under 256MB heap |

**Compatibility note (Java 25):** Compact Object Headers (`-XX:+UseCompactObjectHeaders`) is **incompatible with ZGC in JDK 25**. If you need both, wait for JDK 26 (JEP 516 fixes this), or run G1/Parallel/Shenandoah. Outside ZGC, Compact Headers gives 10-22% heap reduction — usually worth the trade for non-latency-critical workloads.

### GC presets — copy and tune

```bash
# High-throughput general server (default for most cases)
-XX:+UseG1GC
-XX:MaxGCPauseMillis=200
-Xms4g -Xmx4g           # equal min/max avoids resize overhead
-XX:+AlwaysPreTouch     # touch all heap pages on startup (predictable latency)

# Low-latency (Java 25 LTS: ZGC is generational-only, no flag needed)
-XX:+UseZGC
-Xms8g -Xmx8g

# Low-latency (Java 21-24: explicitly enable generational mode)
-XX:+UseZGC
-XX:+ZGenerational      # NOT NEEDED in Java 25+ — default since generational is the only mode

# Memory-constrained container (< 1GB)
-XX:+UseSerialGC
-Xms512m -Xmx512m
-XX:+UseCompressedOops

# Container-aware (recommended baseline for any k8s workload)
-XX:+UseContainerSupport               # default in Java 11+, leave on
-XX:MaxRAMPercentage=75.0              # heap = 75% of container memory limit
-XX:+ExitOnOutOfMemoryError            # crash fast; let the orchestrator restart
-XX:+HeapDumpOnOutOfMemoryError        # write hprof on OOM for postmortem
-XX:HeapDumpPath=/data/heapdumps/
```

A heap dump is a full copy of process memory (tokens, session data, PII): restrict access to the dump path, keep it off shared volumes, and delete dumps after the postmortem.

### Profiling — quick commands

```bash
# Thread dump (snapshot of all threads — find blocked threads, deadlocks)
jstack -l <pid> > threaddump.txt

# Heap dump (full heap — analyze with Eclipse MAT or VisualVM)
jcmd <pid> GC.heap_dump filename=heap.hprof

# GC stats (1s interval, 10 samples)
jstat -gcutil <pid> 1000 10

# Java Flight Recorder — production-safe, low overhead, 60s capture
jcmd <pid> JFR.start duration=60s filename=app.jfr

# Async-profiler — flame graph with kernel + user stacks
./profiler.sh -d 30 -f flame.html <pid>

# Allocation profile (where objects come from)
./profiler.sh -d 30 -e alloc -f alloc.html <pid>

# Lock profile (contention)
./profiler.sh -d 30 -e lock -f lock.html <pid>
```

### JMH — the canonical benchmark setup

```java
@BenchmarkMode(Mode.Throughput)
@Warmup(iterations = 3, time = 1)
@Measurement(iterations = 5, time = 1)
@State(Scope.Benchmark)
@Fork(value = 1, jvmArgs = {"-Xms2g", "-Xmx2g", "-XX:+UseG1GC"})
public class HotPathBench {

    @Setup
    public void setup() {
        // Initialization not measured
    }

    @Benchmark
    public void measureHotPath(Blackhole bh) {
        bh.consume(compute());  // Blackhole prevents dead-code elimination
    }
}
```

**JMH non-negotiables**: warmup iterations (JVM is cold for the first few thousand calls), `Blackhole.consume` (prevents JIT from deleting your "useless" computation), `@State` scope (correct sharing semantics), forked JVM (clean state per benchmark).

### JVM in containers — defaults are not safe

The JVM's defaults assume bare-metal-like resources. Inside a container with CPU and memory limits, several defaults misbehave even with `UseContainerSupport` enabled (the default since Java 11+).

**Heap sizing — two valid approaches:**

| Approach | When |
|----------|------|
| **Explicit `-Xmx`** | When you know the pod's memory limit at deploy time and want predictability |
| **`-XX:MaxRAMPercentage=75.0`** | When pods are autoscaled and memory limit may change |

Either way: leave **25–50% headroom** below the pod memory limit for metaspace, thread stacks, direct buffers, code cache, and native libraries. A JVM whose `-Xmx` equals the pod memory limit gets OOMKilled before GC kicks in — the kernel doesn't wait for the JVM's own threshold.

**CPU awareness — the trap most teams miss:**

`UseContainerSupport` honors cgroup CPU limits, but `ActiveProcessorCount` and fractional CPU limits cause surprises:

- A pod with `cpu: 1500m` (1.5 cores) makes the JVM compute `availableProcessors()` from the cgroup quota. Depending on JDK version and how the limit is set, it may round to 1 or 2 — affecting GC parallel threads, ForkJoinPool size, and any library that sizes thread pools from `Runtime.getRuntime().availableProcessors()`.
- For fractional CPU limits, set `-XX:ActiveProcessorCount=N` explicitly. Pick the integer that matches your intended parallelism (often ⌈cpu_limit⌉).
- Watch `jvm_threads_*` metrics post-deploy — if GC threads suddenly drop or jump after a CPU limit change, this is why.

**GC choice in containers:**
- **G1** — default since Java 9, fine for most pods with 1–8 GB heap.
- **ZGC / Shenandoah** — latency-sensitive services, heap > 4 GB.
- **Serial GC** — tiny pods (heap < 256 MB), lower overhead than G1.

**Pre-flight checklist for any JVM service in Kubernetes:**
- [ ] `-Xmx` set explicitly (or `MaxRAMPercentage` configured) — below pod memory limit
- [ ] Pod memory limit ≥ heap × ~1.3 (≥ 30% overhead for non-heap)
- [ ] `-XX:ActiveProcessorCount=N` set if CPU limit is fractional
- [ ] GC logging enabled (`-Xlog:gc*:file=/var/log/gc.log:time,uptime`) — non-negotiable for postmortem
- [ ] `-XX:+ExitOnOutOfMemoryError` — crash fast, let orchestrator restart
- [ ] `-XX:+HeapDumpOnOutOfMemoryError` + `-XX:HeapDumpPath=/data/heapdumps/` (persistent volume) — for OOM forensics
- [ ] JFR continuous mode for production profiling (`-XX:StartFlightRecording=...`)

### JVM-specific anti-patterns

- Tuning GC without measuring first — most "GC is slow" turns out to be allocation pressure (fix the allocations, not the GC).
- `-Xmx` set above container memory limit — kernel OOM kills the process before JVM hits its own threshold.
- Large heap with default GC — past 8GB, G1 default settings show pause spikes; tune `MaxGCPauseMillis` or switch to ZGC.
- ThreadLocal not cleared in thread pool — leaks; see `memory-leak-detection.md` JVM section.
- `String.intern()` on user input — fills PermGen / String table, OOM eventually.
- Reflection in hot paths — cache `Method` / `Field` references, use `MethodHandle` for repeated calls.

### Concurrency for throughput (Java 21+)

For I/O-bound services (the most common JVM workload), the executor model matters more than GC tuning. Modern Java has three options:

| Model | Use when | Trade-off |
|-------|----------|-----------|
| **Platform threads** (`Executors.newFixedThreadPool`) | CPU-bound work, legacy code | Heavyweight (~1MB stack each), limited by OS thread count |
| **Virtual threads** (Java 21+, `Executors.newVirtualThreadPerTaskExecutor`) | I/O-bound work at scale (HTTP servers, async DB clients) | ~KB-sized, millions are practical |
| **Reactive** (`Mono`, `Flux`, RxJava) | Streaming pipelines with backpressure | Steeper learning curve, harder to debug |

**Virtual threads — when to switch:**

```java
// Old: fixed pool, request blocks a heavy OS thread
try (var executor = Executors.newFixedThreadPool(200)) {
    IntStream.range(0, 10_000).forEach(i ->
        executor.submit(() -> processRequest(i)));
}

// New: virtual threads, one per task, scales to millions
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    IntStream.range(0, 10_000).forEach(i ->
        executor.submit(() -> processRequest(i)));
}
```

#### Virtual thread pinning — version-aware guidance (this changed in JDK 24)

The advice on virtual thread pinning depends critically on the Java version you target. The synchronized-block pinning issue that dominated the 2023-2024 discussion was **fixed in JDK 24 (JEP 491, March 2025)** and is in production with **Java 25 LTS (September 2025)**.

| Java version | Synchronized pinning | What to do |
|--------------|----------------------|------------|
| **21, 22, 23** | Yes — virtual thread is pinned to carrier during synchronized block; if many threads pin, scheduler runs out of carriers, system stalls (Netflix-style deadlock) | Replace `synchronized` with `ReentrantLock` in hot paths. Update libraries that pin (older JDBC drivers, HikariCP pre-5.0, Caffeine pre-3.x). Monitor with `-Djdk.tracePinnedThreads=full` |
| **24, 25 LTS, 26** | **No (for synchronized).** JVM monitors now track virtual thread identity, not carrier thread identity — virtual thread can unmount and remount across `synchronized` boundaries | **Stop replacing synchronized with ReentrantLock.** JEP 491 authors explicitly state: "you can choose between synchronized and the APIs in java.util.concurrent.locks based solely upon which best solves the problem at hand." The `-Djdk.tracePinnedThreads` flag was **removed** in JDK 24 |

**Remaining pinning cases in Java 24+** (rare but real):

- **Native code** (JNI methods, Foreign Function & Memory API). Virtual thread can't unmount across a native frame because the JVM can't safely manage thread state across the native boundary.
- **Class initialization** (blocking inside a class initializer or while waiting for class init by another thread).
- **Symbolic reference resolution** during class loading.

**Detection in Java 24+**: the JFR event `jdk.VirtualThreadPinned` is enabled by default with a 20ms threshold. No production cost unless pinning actually exceeds threshold. Running JFR continuously in production with an alert on this event is the most reliable early warning.

```bash
# Enable JFR continuous recording in production
java -XX:StartFlightRecording=duration=24h,filename=app.jfr,settings=profile.jfc YourApp

# In Grafana / observability: alert on jdk.VirtualThreadPinned event rate > 0
```

**Sizing the virtual thread scheduler** (when carrier exhaustion is a concern):

```bash
# Default carrier count = available processors. Override if needed:
-Djdk.virtualThreadScheduler.parallelism=16
-Djdk.virtualThreadScheduler.maxPoolSize=256
```

The default cap of 256 carrier threads is rarely the bottleneck post-JEP 491; raise only if profiling shows scheduler saturation.

**Thread pool sizing** (for platform threads — still applies when not using virtual threads):

| Workload | Formula |
|----------|---------|
| CPU-bound | `cores` |
| I/O-bound | `cores × (1 + wait_time / compute_time)` |
| Mixed | start with `cores × 2`, measure, adjust |

For I/O-bound workloads on Java 21+, virtual threads usually beat manual sizing — pool size becomes irrelevant.

**`CompletableFuture` for composition** (use when you have parallel async calls):

```java
CompletableFuture<Result> result = fetchUser(id)
    .thenCompose(user -> fetchOrders(user.id()))
    .thenApply(orders -> processOrders(orders))
    .exceptionally(ex -> handleError(ex))
    .orTimeout(5, TimeUnit.SECONDS);
```

`.orTimeout()` is non-negotiable for any external dependency. Your timeout must be tighter than your SLO.

#### Scoped Values (Java 25, JEP 506) — the ThreadLocal replacement

At virtual thread scale, `ThreadLocal` becomes a problem: millions of virtual threads each with their own per-thread copy of context. Scoped Values are the safe replacement.

```java
private static final ScopedValue<User> CURRENT_USER = ScopedValue.newInstance();

// Set value within a scope (immutable, propagates to child operations)
ScopedValue.where(CURRENT_USER, user).run(() -> {
    processRequest();    // can read CURRENT_USER.get() anywhere in the call tree
});
```

**Use Scoped Values instead of ThreadLocal when:**
- Running on Java 25+ with virtual threads at scale
- The context is immutable for the duration of a request (user, tenant, trace context)
- You want to eliminate the memory cost of per-thread copies

**Keep ThreadLocal when:**
- The value must be mutable (e.g., a `DateFormat` instance that's reused and reset)
- You're on Java 21-23 (Scoped Values were preview)

#### Structured Concurrency (Java 25 preview, JEP 505)

Manages related concurrent tasks as a single unit. Replaces the error-prone manual orchestration of `ExecutorService` + futures. Still preview in Java 25 — production-ready expected in a near-term release.

```java
try (var scope = StructuredTaskScope.open()) {
    Subtask<User> user = scope.fork(() -> fetchUser(id));
    Subtask<Orders> orders = scope.fork(() -> fetchOrders(id));
    scope.join();    // waits for both, propagates failures
    return new UserView(user.get(), orders.get());
}
```

Prevents the classic bug: ExecutorService task that outlives its parent and leaks a goroutine-equivalent.

### Compact Object Headers (Java 25, JEP 519)

A near-invisible JVM optimization with one of the largest real-world payoffs in years. Shrinks per-object header from 12 bytes to 8 bytes (33% reduction). On object-heavy workloads (most modern Java apps), this translates to **10-22% heap reduction and 8-30% CPU savings** in benchmarks. Amazon ran this in production across hundreds of services before promotion to product feature.

```bash
# Enable in JDK 25 (not default yet — JEP 534 will make it default in a future release)
-XX:+UseCompactObjectHeaders
```

**When to enable:**
- Object-heavy workloads (Spring Boot APIs, microservices, ORM-heavy apps, caching layers, data pipelines with many small DTOs / records) — measurable wins
- Memory-constrained containerized environments — direct heap savings → smaller pods → higher density

**When NOT to enable in JDK 25:**
- **Using ZGC** — Compact Object Headers are **incompatible with ZGC in JDK 25**. JDK 26 fixes this via JEP 516. If you're on JDK 25 + ZGC, wait for 26 or run with G1/Parallel/Shenandoah.

**Reported gains** (SPECjbb2015 + Amazon production):
- 22% less heap space, 8% less CPU time
- 15% fewer GC cycles (G1 and Parallel)
- 10% faster JSON parser benchmark
- Up to 30% CPU reduction in Amazon's prod services

### Project Leyden — AOT cache for startup (Java 24+)

The historical JVM weakness — slow startup and JIT warmup — is being systematically dismantled. Project Leyden ships AOT (Ahead-of-Time) cache features across JDK 24, 25, 26 without requiring code changes or sacrificing dynamic JVM capabilities (no closed-world analysis like GraalVM Native Image).

**Reported gains (Spring PetClinic / production Spring Boot apps):**
- 50-70% startup reduction
- 15-25% warmup improvement (Java 25 vs 24)
- ~41% startup gain in OpenJDK reference benchmarks

**The two-command workflow (JDK 25+):**

```bash
# Step 1 — Training run: record observations + write cache on shutdown
# (Spring Boot: use -Dspring.context.exit=onRefresh to exit cleanly post-init)
java -XX:AOTCacheOutput=app.aot \
     -Dspring.context.exit=onRefresh \
     -jar app.jar

# Step 2 — Production run: load from cache
java -XX:AOTCache=app.aot -jar app.jar
```

**JEPs delivering this:**
- **JEP 483 (Java 24)** — AOT class loading & linking
- **JEP 514 (Java 25)** — Command-line ergonomics (single-step training)
- **JEP 515 (Java 25)** — Method profile collection (warms up JIT faster)
- **JEP 516 (Java 26)** — AOT object caching with any GC

**Training run discipline (critical):**
- Training run must closely match production behavior — same config, same dependencies loaded, ideally similar request shapes for at least the boot path
- Mock external dependencies during training; don't hit real prod databases
- For Spring Boot: `-Dspring.context.exit=onRefresh` triggers exit after context init — captures everything Spring loads at startup
- Re-train when dependencies change (new Spring version, new libraries, framework upgrade)

**Cloud cost implication:**
- 50-70% faster pod startup → 50-70% reduction in scale-up latency → fewer overprovisioned pods → real cost savings
- For serverless / FaaS: directly affects cold-start cost
- For Kubernetes HPA: faster reaction to traffic spikes

### Systematic JVM tuning methodology

Beyond reactive bug-fixing, this is the structured procedure to follow when entering a JVM tuning engagement with no obvious bottleneck.

> Adapted from Alibaba Cloud's *"How to Properly Plan JVM Performance Tuning"* (2019), modernized for Metaspace (Java 8+) and G1/ZGC defaults.

**Three principles to internalize:**

1. **Minor GC collection principle** — Each Minor GC should reclaim as many garbage objects as possible. The more aggressively young-generation collection retains short-lived garbage cleanup, the less promotion pressure on old generation, the less frequent Full GC / mixed collections.
2. **GC memory maximization principle** — When solving throughput or latency, the larger the heap available to GC, the more efficient collection becomes (within physical limits and pause time budgets). Memory-starved JVMs work harder per byte.
3. **"Two out of three" principle** — You can optimize for at most two of: **throughput**, **latency**, **memory usage**. Pick which two before tuning. Trying to optimize all three is the most common failure mode of unstructured tuning.

**Application phases — when to measure:**

| Phase | What | Measure here? |
|-------|------|---------------|
| **Initialization** | JVM loads classes, app boots, JIT cold | No — anomalous |
| **Stability** | Sustained production-shape load, JIT warmed, key code paths hot | **Yes — only valid window** |
| **Summary** | Test exit, benchmark wrap-up | No — not representative |

Measuring during initialization or summary produces misleading data. A perf tuning engagement that gets the phase wrong fixes the wrong thing.

**Five-step procedure:**

1. **Determine memory usage** — find active data size during stability phase (see below).
2. **Tune for memory** — set heap sizes to match active data with appropriate ratios.
3. **Tune for latency** — adjust young/old generation balance against Minor GC duration and Full GC pause SLOs.
4. **Tune for throughput** — switch collector if needed (G1 → ZGC for latency-sensitive; G1 → Parallel for batch).
5. **Verify against SLO sentence** — close the loop with the explicit SLO target from the engagement brief.

Each step may iterate multiple times before passing. Do not invert the order — solving throughput before knowing memory size produces parameter choices that conflict with later steps.

**Active data size calculation:**

The most important number you need. Measured during a Full GC in stability phase — what survives is roughly the steady-state working set.

```bash
# Capture GC log with timestamps (always do this in production)
-Xlog:gc*:file=gc.log:time,uptime:filecount=10,filesize=100M

# If no Full GC occurs naturally during the measurement window, force one
jcmd <pid> GC.run
# or, for the old way
jmap -histo:live <pid> | head -50
```

From the Full GC log line, identify the **old generation size after Full GC** — that's your active data size (call it `OldLive`).

**Sizing rules of thumb** (use as a starting point; measure and iterate):

| Region | Suggested size |
|--------|---------------|
| Total Java heap | `OldLive × 3` to `× 4` |
| Young generation | `OldLive × 1.5` |
| Old generation | `OldLive × 2` to `× 2.5` (= heap − young) |
| Metaspace | `MetaspaceLive × 1.5` to `× 2` (replaces PermGen, Java 8+) |

Resulting JVM flags (modern, Java 25 / G1):

```bash
# Example: OldLive = 500 MB, MetaspaceLive = 80 MB
-Xms2g -Xmx2g                   # 4 × OldLive (equal min/max prevents resize)
-Xmn750m                        # 1.5 × OldLive (young)
-XX:MetaspaceSize=128m          # initial Metaspace
-XX:MaxMetaspaceSize=160m       # cap Metaspace (2 × live)
-XX:+UseG1GC
-XX:MaxGCPauseMillis=200
-XX:+AlwaysPreTouch             # commit heap up front for predictable latency
-Xlog:gc*:file=gc.log:time,uptime
```

**Object promotion rate — estimating Full GC frequency without a Full GC log:**

Useful when long-running services rarely trigger Full GC (a good problem, but makes sizing harder). Estimate by measuring promotion across multiple Minor GCs:

```
For each Minor GC i in stability phase:
    promoted_i = heap_after_minorGC_i - young_after_minorGC_i

Average promoted per Minor GC = avg(promoted_i)
Minor GC interval = avg(time_between_minorGC)
Promotion rate = average_promoted / minor_gc_interval   (bytes/ms)

Time until old generation fills = OldGenSize / promotion_rate
```

Example calculation from a real GC log:
- 4 Minor GCs in 850ms, total promoted = 49 MB
- Promotion rate ≈ 49 MB / 850ms ≈ 58 KB/ms
- Old gen = 233 MB → fills in ~4.2 seconds → Full GC every ~4s under sustained load

This is the **worst-case Full GC frequency** estimate. If it's incompatible with your SLO (e.g., SLO says "p99 < 500ms" but worst-case Full GC takes 800ms), you have two levers:
- Increase old gen → fewer but longer Full GCs (latency cliff bigger, frequency lower)
- Switch to a pauseless collector (ZGC) → sub-10ms pauses, more CPU overhead

**Latency tuning — Minor GC duration vs frequency tradeoff:**

| Lever | Effect on Minor GC duration | Effect on Minor GC frequency |
|-------|------------------------------|------------------------------|
| **Larger young gen** | Longer (more to scan) | Lower (fills slower) |
| **Smaller young gen** | Shorter | Higher |

The right balance depends on your SLO budget:
- If average downtime budget = 50ms and current Minor GC duration is 70ms → shrink young gen
- If you're hitting many Minor GCs per second → grow young gen
- Keep old generation size constant when adjusting young gen (minimizes side effects)

**Throughput tuning — when to switch collectors:**

After memory + latency are dialed in, evaluate throughput against the SLO. If gaps remain:
- **< 20% gap** → tune JVM flags more aggressively, increase memory if budget allows, re-test
- **> 20% gap** → reconsider collector choice (G1 → ZGC for latency, G1 → Parallel for batch) or revisit application architecture (code is the bottleneck, not GC)

The collector switch is non-trivial — different collectors have different tuning surface areas. Allocate explicit time for re-tuning, don't expect a drop-in win.

---

## Node.js

### V8 flags worth knowing

```bash
# Memory limit (default is ~1.5GB old-space; raise for memory-heavy workloads)
node --max-old-space-size=4096 app.js

# Expose GC for manual triggering in tests / benchmarks
node --expose-gc app.js

# Trace GC events (debugging GC pauses)
node --trace-gc app.js

# Profile CPU (built-in, low overhead)
node --prof app.js
# After exit: node --prof-process isolate-*.log > processed.txt

# Profile inspector (Chrome DevTools attach)
node --inspect=127.0.0.1:9229 app.js   # never 0.0.0.0: the inspector is unauthenticated remote code execution
```

### Node.js profiling stack

| Tool | Use for |
|------|---------|
| `clinic doctor` | First-pass diagnosis; tells you "you have an event-loop / I/O / CPU / memory problem" |
| `clinic flame` | CPU flame graph — find hot functions |
| `clinic bubbleprof` | Async operation visualization — find I/O bottlenecks |
| `clinic heapprofiler` | Allocation profile |
| `0x` | Alternative flame graph generator, often produces nicer output than `clinic flame` |
| `node --prof` + `--prof-process` | Built-in CPU profiler — no install needed |
| Chrome DevTools (via `--inspect`) | Heap snapshots, allocation timeline, manual profiling |
| `pprof-it` | Production-safe pprof captures from running Node processes |

### Hot-path smells specific to Node

- **Synchronous I/O** in async code (`fs.readFileSync`, `child_process.execSync`) blocks the event loop.
- **CPU-bound work** on the main thread without `worker_threads` — blocks all other requests.
- **Large JSON** parsed in one shot — use streaming JSON parsers for > 10MB payloads.
- **Unbounded `Promise.all`** — explodes memory and downstream load. Use `p-limit` or `p-queue`.
- **Event listener accumulation** — `EventEmitter`s without `removeListener` leak (and warn at 11+ listeners).
- **Closures capturing large objects** — accidental retention; profile heap snapshots to find.
- **Express middleware doing work for every request** even when not relevant — gate with router-level mounting instead.
- **`require()` in hot paths** — cached, but the lookup still costs; hoist requires to module top.

### Event loop monitoring

```javascript
// Built-in event-loop delay measurement (Node 11.10+)
const { monitorEventLoopDelay } = require('node:perf_hooks');
const h = monitorEventLoopDelay({ resolution: 20 });
h.enable();

setInterval(() => {
  console.log({
    p50: h.percentile(50) / 1e6,    // ns → ms
    p99: h.percentile(99) / 1e6,
    max: h.max / 1e6,
  });
  h.reset();
}, 5000);
```

If p99 event-loop delay > 50ms sustained, you have a CPU-bound or sync-I/O bottleneck. Find it with `clinic flame` or `--prof`.

### Node-specific patterns

```javascript
// 1. Fast path for dominant input shape
function process(input) {
  if (typeof input === 'string') return processString(input);  // 90% case
  if (Array.isArray(input)) return processArray(input);
  return processGeneric(input);  // slow general case
}

// 2. Bounded concurrency
import pLimit from 'p-limit';
const limit = pLimit(10);  // never more than 10 in flight
const results = await Promise.all(items.map(item => limit(() => process(item))));

// 3. Lazy logging — don't format if not enabled
log.debug?.(`heavy ${expensiveSerialize(data)}`);  // optional chaining short-circuits

// 4. Cache compiled regex / templates at module level
const SLUG_RE = /^[a-z0-9-]+$/;
function isValidSlug(s) { return SLUG_RE.test(s); }   // not new RegExp per call

// 5. Reuse buffers in tight loops
const BUF = Buffer.allocUnsafe(4096);
function chunkedRead(stream, handler) {
  // reuse BUF instead of allocating per chunk
}
```

---

## Go

### Runtime tuning

```bash
# GC tuning — GOGC controls trigger frequency (lower = more frequent, less RAM)
GOGC=100 ./app    # default: GC when heap doubles
GOGC=50 ./app     # more aggressive, lower memory, more CPU
GOGC=200 ./app    # less aggressive, higher memory, less CPU

# Memory limit (Go 1.19+) — soft target, GC works to keep below this
GOMEMLIMIT=8GiB ./app

# Max OS threads (defaults to GOMAXPROCS = number of CPUs)
GOMAXPROCS=4 ./app    # constrain, useful in containers
```

### Profiling

```go
// Expose net/http/pprof
import _ "net/http/pprof"
go func() { log.Println(http.ListenAndServe("localhost:6060", nil)) }()
```

```bash
# Capture profiles from running service
go tool pprof -http=:8080 http://localhost:6060/debug/pprof/profile?seconds=30   # CPU
go tool pprof -http=:8080 http://localhost:6060/debug/pprof/heap                # heap
go tool pprof -http=:8080 http://localhost:6060/debug/pprof/goroutine           # goroutines
go tool pprof -http=:8080 http://localhost:6060/debug/pprof/mutex               # mutex contention
go tool pprof -http=:8080 http://localhost:6060/debug/pprof/block               # blocking ops

# Compare two snapshots (find regressions)
go tool pprof -base before.prof after.prof

# Execution trace (scheduler, GC, syscalls)
curl http://localhost:6060/debug/pprof/trace?seconds=30 -o trace.out
go tool trace trace.out
```

### Go benchmarks

```go
func BenchmarkHotPath(b *testing.B) {
    setup := prepare()
    b.ResetTimer()
    b.ReportAllocs()    // include alloc/op in output
    for i := 0; i < b.N; i++ {
        result := compute(setup)
        _ = result    // prevent dead-code elimination
    }
}

// Sub-benchmarks for parameter sweeps
func BenchmarkSizes(b *testing.B) {
    for _, n := range []int{10, 100, 1000, 10000} {
        b.Run(fmt.Sprintf("size=%d", n), func(b *testing.B) {
            for i := 0; i < b.N; i++ {
                process(make([]int, n))
            }
        })
    }
}
```

```bash
# Run with stats
go test -bench=. -benchmem -count=10 -cpu=1,2,4 ./...

# Compare runs (install benchstat first: go install golang.org/x/perf/cmd/benchstat@latest)
go test -bench=. -count=10 ./... > before.txt
# ... make change ...
go test -bench=. -count=10 ./... > after.txt
benchstat before.txt after.txt
```

### Go-specific hot-path smells

- **Allocation in hot loop** — escape analysis pushes things to heap; `go build -gcflags="-m"` shows what escapes.
- **Goroutine leak** — `pprof goroutine` count climbs without bound.
- **Channel without buffer** when high-throughput — context-switch overhead per send/receive.
- **Mutex contention** — visible in mutex profile; consider sharding (`sync.Map`, striped locks).
- **String concatenation in loop** — use `strings.Builder` or `bytes.Buffer`.
- **Reflection in hot paths** — cache `reflect.Type` lookups, prefer code generation.
- **Slice growth without pre-allocation** — `make([]T, 0, expectedSize)` avoids repeated reallocs.

---

## Python

### Profilers

```bash
# py-spy — sampling, low overhead, attaches to running process (no code change)
py-spy record -o profile.svg --pid <pid> --duration 30
py-spy top --pid <pid>          # top-like live view

# Built-in cProfile (more overhead)
python -m cProfile -o profile.out app.py
python -m pstats profile.out

# Memory profiling
pip install memory-profiler
python -m memory_profiler app.py

# tracemalloc (built-in)
import tracemalloc
tracemalloc.start()
# ... workload ...
snap = tracemalloc.take_snapshot()
for stat in snap.statistics('lineno')[:10]:
    print(stat)
```

### Python-specific patterns

```python
# 1. Hoist attribute lookups in hot loops
# Slow:
for item in items:
    result.append(some_object.method(item))

# Fast:
method = some_object.method
append = result.append
for item in items:
    append(method(item))

# 2. Use built-in C functions where possible
# Slow:
total = 0
for x in numbers:
    total += x

# Fast:
total = sum(numbers)

# 3. functools.lru_cache for pure functions
from functools import lru_cache
@lru_cache(maxsize=1000)
def expensive(arg): ...

# 4. Use generators for memory; list comprehensions for speed
sum(x * 2 for x in range(10**6))    # generator, low memory
[x * 2 for x in range(10**6)]       # list, faster but allocates

# 5. asyncio for I/O-bound, multiprocessing for CPU-bound
# (the GIL means threading does NOT speed up CPU-bound work)
```

### When Python is genuinely the bottleneck

After exhausting algorithmic improvements:

1. **Move hot paths to C extensions** — Cython, mypyc, or Rust via PyO3.
2. **Numpy / Polars for numeric work** — vectorized C under the hood.
3. **PyPy** if you can't change code — JIT-compiled Python, often 4-10x speedup, with caveats (C-extension compatibility).
4. **Rewrite the hot service in Go / Rust** — last resort; weigh against operational cost.

---

## When the runtime isn't the bottleneck

If profiles show < 20% time in runtime-related work (GC, allocator, scheduler), runtime tuning won't help much. The bottleneck is elsewhere:

- I/O-bound? See `db-optimization.md`, network sections in `bottleneck-patterns.md`.
- Lock contention? See `bottleneck-patterns.md` Pattern 5.
- Algorithmic? Profile shows one function dominating regardless of language; fix the algorithm.
- Network / serialization? See HTTP/2/3 and gRPC patterns in the architectural-patterns section of the SKILL.md.

Runtime tuning is a multiplier on already-good code, not a rescue for bad code.
