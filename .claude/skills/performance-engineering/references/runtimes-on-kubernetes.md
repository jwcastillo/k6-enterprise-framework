# Runtimes on Kubernetes — performance considerations

Performance patterns specific to running language runtimes (JVM, Node.js, Go, Python) inside Kubernetes. Covers the **deployment surface** of containerized perf: probes, graceful shutdown, autoscaler interaction, CPU throttling, image strategy, and runtime-specific quirks.

This complements `runtime-perf-tuning.md` (vendor-neutral runtime tuning) with k8s-specific concerns that emerge only when the runtime lives inside a pod.

---

## Kubernetes as a perf surface — what changes vs bare metal

Five things break when moving a tuned bare-metal app into Kubernetes:

1. **CPU throttling (CFS)** — `limits.cpu` translates to a Linux CFS quota. Exceeding it pauses the container until the next period (typically 100ms). This causes tail latency spikes that don't show up in average CPU graphs.
2. **Memory limit hard cap** — `limits.memory` is enforced by the kernel. Exceeding it triggers OOMKill without GC having a chance to react. Runtimes that size memory from `/proc/meminfo` see the wrong number.
3. **Probes drive traffic and lifecycle** — readiness controls whether traffic arrives; liveness controls whether the pod gets killed. Misconfigured probes turn perf problems into outages.
4. **Pod lifecycle is short** — pods are killed for deploys, scale-down, node drain, eviction. Startup time becomes a perf metric (autoscaling latency, cold-start cost).
5. **Network is virtual** — service mesh (Istio), CNI overhead, kube-proxy iptables/IPVS add ~0.5-2ms p99 per hop. Histogram bucket saturation between mesh metrics and APM is a real problem (see `tool-selection-guide.md`).

These are the universal concerns. Each runtime has additional quirks.

---

## Universal cross-runtime patterns

### Resource requests, limits, and QoS classes

Pod resource configuration is a perf lever, not just a sizing decision.

| QoS class | Spec | Behavior |
|-----------|------|----------|
| **Guaranteed** | requests == limits for both CPU and memory | Highest priority, last to be evicted, most predictable perf |
| **Burstable** | requests < limits (or only one set) | Can burst above requests, but throttled at limits; gets evicted before Guaranteed |
| **BestEffort** | no requests or limits | First to be evicted; no resource guarantees; useful only for opportunistic batch work |

**Decision rule for production services with SLOs:**
- **Guaranteed** for latency-critical workloads. Eliminates noisy-neighbor variance from co-scheduled pods.
- **Burstable with limits ≈ 2× requests** for typical web/API services. Balances density with predictability.
- **Burstable without CPU limits** is a contested pattern — see "CPU throttling" below.

### CPU throttling — the universal tail-latency killer

CFS quota math (typically 100ms periods):

```
quota_us = cpu_limit × 100_000   # e.g., cpu: "2" → 200_000us quota per 100_000us period
```

When a container exceeds its quota in a period, **all threads pause** until the next period — up to 100ms of dead time. This is the dominant cause of "p99 latency explodes at low CPU usage" patterns.

**Detection** (works for any runtime):

```promql
# Throttling ratio — % of periods where container hit quota
rate(container_cpu_cfs_throttled_periods_total[5m])
  / rate(container_cpu_cfs_periods_total[5m])
```

If this exceeds ~5%, you have throttling-induced latency. Drop the limit ratio or fix the runtime's parallelism setting (see runtime sections).

**Two schools of thought on CPU limits:**

| School | Argument | When right |
|--------|----------|------------|
| **Set CPU limits always** | Predictable perf, prevents noisy-neighbor effects, capacity planning easier | Multi-tenant clusters, regulated workloads, billing per limit |
| **Set CPU requests only (no limits)** | No throttling, bursts use spare cluster capacity, better tail latency under load | Single-team clusters with well-tuned requests, latency-critical services |

The honest answer: **measure the throttling ratio first**. If you're throttling, removing the limit (and trusting requests + cluster headroom) is often the cheapest p99 win available.

### Probes — liveness, readiness, startup

These three probes have distinct roles. Conflating them causes outages, not just perf issues.

| Probe | Question | On failure | What to check |
|-------|----------|------------|---------------|
| **Liveness** | "Should Kubernetes restart this pod?" | Kill + restart container | Only that the process can respond. **Never** include DB / downstream deps |
| **Readiness** | "Should this pod receive traffic right now?" | Remove from service endpoints | Comprehensive but fast: app state, critical local resources |
| **Startup** | "Has the app finished initializing?" | Treats failures as "still starting" | Same checks as readiness; replaces liveness during startup |

**The classic anti-pattern** (causes cascade restarts):

```yaml
# WRONG — liveness depends on DB
livenessProbe:
  httpGet:
    path: /health/db          # ❌ tests database connection
```

When the DB has a hiccup, **all pods fail liveness simultaneously**, all restart, restart loop ensues, cluster degrades cluster-wide. Liveness should answer one question: *"is this process so broken it can only be fixed by restart?"* That means: process responsive, no deadlock, no memory corruption. Nothing else.

**Correct pattern:**

```yaml
livenessProbe:
  httpGet:
    path: /health/live        # ✅ trivial: process is running
    port: 3000
  periodSeconds: 10
  failureThreshold: 3         # 3 × 10s = 30s before kill
  timeoutSeconds: 3
readinessProbe:
  httpGet:
    path: /health/ready       # ✅ tests deps; fails fast on degraded state
    port: 3000
  periodSeconds: 5
  failureThreshold: 2         # 2 × 5s = 10s before removed from LB
  timeoutSeconds: 3
startupProbe:
  httpGet:
    path: /health/ready
    port: 3000
  periodSeconds: 5
  failureThreshold: 30        # 30 × 5s = 150s max startup time
```

**Probe timing math** — `terminationGracePeriodSeconds` must accommodate the full shutdown sequence:

```
terminationGracePeriodSeconds ≥
  preStop_sleep
  + (readiness failureThreshold × readiness periodSeconds)   # LB drain time
  + max_in_flight_request_duration
  + cleanup_time                                              # close DB, queues, sockets
  + safety_buffer
```

Default `terminationGracePeriodSeconds: 30` is often too short for JVM apps with slow-draining connections. Tune deliberately.

### Graceful shutdown — the universal sequence

Every runtime needs the same sequence. The difference is the implementation language.

```
1. SIGTERM arrives from kubelet
2. App sets isShuttingDown = true
3. Readiness probe starts returning 503  → LB stops routing new traffic
4. Wait (readiness failureThreshold × periodSeconds) for LB drain
5. Stop accepting new connections (server.close() equivalent)
6. Wait for in-flight requests to complete (timeout-bounded)
7. Cleanup external resources in dependency order:
    - Workers / queues (let in-progress jobs finish)
    - DB connection pool
    - Cache / Redis
    - Other downstream connections
8. Exit process (or force-exit on timeout)
```

**Two race conditions to handle:**

a) **LB hasn't drained yet, app already refusing connections** → use `preStop` hook with sleep to give the LB time to converge:

```yaml
lifecycle:
  preStop:
    exec:
      command: ["/bin/sleep", "5"]
```

b) **Shutdown takes longer than terminationGracePeriod** → SIGKILL, in-flight requests dropped. Tune `terminationGracePeriodSeconds` upward.

### Image strategy — cold start is a perf metric

Image size + base image affect pod startup time:

| Strategy | Image size (typical) | Cold start | When |
|----------|---------------------|------------|------|
| Single-stage build, full OS | 800MB-1.5GB | Slow (pull + extract) | Never in prod |
| Multi-stage build, slim base | 200-400MB | Acceptable | Default for most apps |
| Distroless base | 80-200MB | Fast | When you don't need shell access for debugging |
| jlink custom JRE (Java) | 50-100MB | Faster | Java apps where Native Image isn't viable |
| GraalVM Native Image | 30-80MB | Sub-second | Startup-critical Java apps |
| Static binary (Go, Rust) | 10-30MB | Fastest | Languages with native compilation |

**Image pull is part of cold start.** A 500MB image on a node that doesn't have it cached = 5-30 seconds of pull time before container even starts. For HPA reaction time during spikes, this matters.

---

## Java on Kubernetes

### JVM container awareness — recap

Covered in detail in `runtime-perf-tuning.md` "JVM in containers" section. Critical points:
- `-Xmx` explicit OR `-XX:MaxRAMPercentage=75.0` (leave 25-50% pod memory for non-heap)
- `-XX:ActiveProcessorCount=N` for fractional CPU limits
- `-XX:+ExitOnOutOfMemoryError` + `-XX:+HeapDumpOnOutOfMemoryError` with persistent volume

### CRaC (Coordinated Restore at Checkpoint) — startup acceleration

**The problem**: Java apps take 3-10 seconds to start due to class loading + warmup. In Kubernetes with HPA, this means new pods take 3-10 seconds to start serving traffic — by which time the spike has already caused failures.

**Project Leyden AOT cache** (covered in `runtime-perf-tuning.md`) addresses the class-loading half. **CRaC** addresses the rest: it snapshots a fully-warmed JVM (post-init, post-JIT) and restores it sub-second.

**Reported gains**: 7× faster startup on Spring PetClinic in AKS (4.9s → 0.7s); Azul reports ~10× in some workloads.

**Workflow:**

```bash
# Image build (training): start app, let it warm up, checkpoint
java -XX:CRaCCheckpointTo=/checkpoint \
     -jar app.jar &
# ... after warmup ...
jcmd app.jar JDK.checkpoint

# Runtime: restore from checkpoint
java -XX:CRaCRestoreFrom=/checkpoint
```

**Kubernetes pattern**: bake the checkpoint into the container image during build; the pod starts by restoring, not initializing.

**Distribution support:**
- Azul Zulu OpenJDK with CRaC (most mature; original implementer)
- BellSoft Liberica with CRaC
- OpenJDK CRaC packages in Ubuntu 24.10+ (`openjdk-21-crac-jdk-headless`)
- Spring Boot 3.2+ native CRaC integration
- Quarkus, Micronaut also support CRaC

**Limitations:**
- **Linux-only** (relies on CRIU — Checkpoint/Restore In Userspace). No Windows / macOS support.
- **Resources need re-init** after restore — DB connections, open sockets, in-memory cache contents may be stale. Spring Framework provides `Lifecycle` hooks (`onRestart`) to reconfigure beans.
- **Checkpoint sensitivity** — anything that was valid only for the original host (PIDs, file handles, temp files, TLS certs with limited validity) may break on restore.
- **Image security** — checkpoint files contain everything in memory, including secrets. Treat the image as sensitive.

### Project Leyden vs CRaC — when to use which

| Need | Approach |
|------|----------|
| Sub-second startup, willing to manage checkpoint complexity, Linux only | **CRaC** |
| ~50-70% startup reduction with simpler workflow, cross-OS support | **Leyden AOT cache** |
| Sub-100ms startup, willing to give up dynamic JVM (closed-world analysis) | **GraalVM Native Image** |
| All of the above? | **Native Image** wins on startup; CRaC is the best non-Native option for full-JVM apps |

For most teams: start with **Leyden AOT cache** (low complexity, big win), upgrade to **CRaC** if startup still matters and you're Linux-only anyway, reach for **Native Image** only when the reflection / dynamic class loading constraints are workable.

### HPA + JVM warmup tension

HPA scales pods based on CPU/memory metrics. But a freshly-started JVM has **cold JIT** — peak throughput takes 30-60 seconds after the pod is "Ready." During this time:

1. New pod registered with LB
2. LB routes traffic to it
3. New pod runs in interpreted mode (5-10× slower than warmed JIT)
4. Latency spikes for requests landing on cold pods
5. Cold pods consume CPU at higher rates → HPA scales up further
6. More cold pods, more cold-routing, worse perf

**Mitigations:**
- **Leyden AOT cache + JEP 515 method profiles** — JIT starts warm, dramatic warmup reduction
- **CRaC** — restored JVM is already warm; no cold JIT period
- **Native Image** — no JIT to warm up; consistent perf from start
- **Manual warmup hook** — preStart probe hits hot endpoints before pod becomes Ready (gives JIT time to compile critical paths)
- **HPA stabilization windows** — `behavior.scaleUp.stabilizationWindowSeconds: 60` prevents thrashing during warmup

```yaml
# HPA with stabilization
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
spec:
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 60
      policies:
      - type: Percent
        value: 50
        periodSeconds: 60
```

### Heap dump on OOM — persistent volume strategy

```yaml
volumes:
- name: heapdumps
  persistentVolumeClaim:
    claimName: heap-dump-pvc
volumeMounts:
- name: heapdumps
  mountPath: /data/heapdumps
```

JVM args: `-XX:+HeapDumpOnOutOfMemoryError -XX:HeapDumpPath=/data/heapdumps/`

Without this, OOMs are forensically opaque — the pod restarts, the heap state is lost, you can't diagnose the leak from logs alone.

---

## Node.js on Kubernetes

### Single-process per pod (don't cluster inside the container)

The classic Node.js cluster module spawns N workers. **Don't do this inside Kubernetes pods.** Let Kubernetes do the multiplexing:

| Anti-pattern | Better |
|--------------|--------|
| 1 pod with 8 Node workers (cluster module) | 8 pods with 1 Node process each |
| `PM2` managing multiple processes inside container | Single Node process; Kubernetes manages replicas |

**Why**: Kubernetes can move single-process pods around the cluster, scale individually, restart individually on crash. A pod with internal workers is opaque to Kubernetes — if one worker hangs, kubernetes can't help.

**Exception**: if you have CPU-bound work and want to use multiple cores per pod, use **`worker_threads`** (in-process) rather than cluster (separate processes). Worker threads share memory and aren't subject to the "split brain on crash" problem of cluster.

### Memory limit math

```
container memory limit ≥ --max-old-space-size + native heap + libuv buffers + safety
```

Default `--max-old-space-size` is ~1.5GB on 64-bit. If your pod has `limits.memory: 1Gi`, you'll OOMKill before Node's GC kicks in. Set explicitly:

```bash
# For a pod with limits.memory: 1Gi, leave ~25% for non-heap
node --max-old-space-size=768 app.js
```

### Graceful shutdown — Node-specific

```javascript
const SHUTDOWN_TIMEOUT_MS = 30_000;
let isShuttingDown = false;

const server = app.listen(3000);

const shutdown = async (signal) => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`${signal} received, starting graceful shutdown`);

  // Force exit after timeout
  const forceExit = setTimeout(() => {
    console.error('Shutdown timeout exceeded, forcing exit');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);

  try {
    // Step 1: Readiness probe will start failing (isShuttingDown checked in /health/ready)
    // Step 2: Wait for LB to stop routing (readiness failureThreshold × periodSeconds)
    await new Promise(r => setTimeout(r, 10_000));

    // Step 3: Stop accepting new connections
    await new Promise((resolve, reject) =>
      server.close(err => err ? reject(err) : resolve())
    );

    // Step 4: Drain workers / queues
    await emailWorker?.close();
    await jobQueue?.close();

    // Step 5: Close DB pool
    await dbPool.end();

    // Step 6: Close cache / Redis
    await redis.quit();

    clearTimeout(forceExit);
    console.log('Graceful shutdown complete');
    process.exit(0);
  } catch (err) {
    console.error('Error during shutdown:', err);
    process.exit(1);
  }
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
```

Matching readiness handler:

```javascript
app.get('/health/ready', (req, res) => {
  if (isShuttingDown) return res.status(503).json({ status: 'shutting_down' });
  // ... actual dependency checks ...
  res.status(200).json({ status: 'ready' });
});

app.get('/health/live', (req, res) => {
  // ALWAYS return 200 unless process is fundamentally broken
  res.status(200).json({ status: 'alive' });
});
```

### Event-loop blocking detection in production

Long event-loop blocks = high latency, missed health checks. Detect:

```javascript
const { monitorEventLoopDelay } = require('node:perf_hooks');
const h = monitorEventLoopDelay({ resolution: 20 });
h.enable();

// Expose as Prometheus metric
setInterval(() => {
  const p99 = h.percentile(99) / 1e6;  // ns → ms
  eventLoopDelayP99Gauge.set(p99);
  h.reset();
}, 5000);
```

Alert on `event_loop_delay_p99 > 50ms`. Anything sustained over that is a CPU-bound or sync-I/O bug. Correlate with `container_cpu_cfs_throttled_periods_total` to distinguish "real work" from "throttling stall."

### Distroless / Node-slim image strategy

```dockerfile
# Multi-stage build
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .

# Distroless runtime — no shell, smaller, faster pull
FROM gcr.io/distroless/nodejs22-debian12
WORKDIR /app
COPY --from=builder /app /app
USER nonroot
CMD ["server.js"]
```

Image size drops from ~1GB (full Node) to ~150MB (distroless). Pod cold start visibly faster on cluster autoscale events.

---

## Go on Kubernetes

### Go 1.25 — GOMAXPROCS auto-fix

The single most impactful Go-on-Kubernetes change in years. Before Go 1.25, `GOMAXPROCS` defaulted to the **node's** CPU count, not the **container's** limit. Result: a Go app in a pod with `limits.cpu: "2"` running on a 64-core node would set `GOMAXPROCS=64` and immediately throttle.

**Documented production impact** (real benchmark, 2 CPU limit / 64-core host):

| GOMAXPROCS | p50 | p99 | Throttle rate | Context switches/sec |
|------------|-----|-----|---------------|---------------------|
| 64 (default pre-1.25) | 45ms | 890ms | 72% | 45,000 |
| 2 (correct) | 12ms | 35ms | 3% | 2,100 |

**25× p99 improvement** from a single config change.

**Go 1.25 (August 2025) fixes this automatically**: the runtime reads the cgroup CPU limit and sets `GOMAXPROCS` to `min(cores, cpu_limit)`. Periodic re-checks handle dynamic limit changes.

**Audit before relying on Go 1.25's auto-behavior:**

```bash
# Find stale GOMAXPROCS env vars in manifests (override the auto-fix)
grep -rn "GOMAXPROCS" deploy/ k8s/ helm/

# Find explicit runtime.GOMAXPROCS calls
grep -rn "runtime.GOMAXPROCS" .

# Find automaxprocs imports (now redundant on 1.25+ but harmless)
grep -rn "automaxprocs" .
```

**Pre-Go-1.25 fix**: import `go.uber.org/automaxprocs` (Uber's library that does what Go 1.25 now does natively).

```go
import _ "go.uber.org/automaxprocs"
```

### GOMEMLIMIT — OOM prevention

Go 1.19+ added `GOMEMLIMIT` for soft memory targeting:

```bash
GOMEMLIMIT=900MiB ./app   # for a pod with limits.memory: 1Gi
```

GC works harder to keep heap below this target. Combined with `GOGC=off` for fully memory-bound services. Set `GOMEMLIMIT` to ~90% of pod memory limit — leaves headroom for non-heap (stacks, syscalls, code).

### Static binary advantages

Go produces a single static binary. Container implications:

- **Distroless or `scratch` base** (`FROM scratch`) — image sizes 10-30MB typical
- **Sub-second cold start** — no JIT, no class loading
- **No runtime dependencies in image** — no libc, no shell, smaller attack surface
- **HPA reaction time excellent** — new pods serving in seconds, not minutes

```dockerfile
FROM golang:1.25 AS builder
WORKDIR /app
COPY go.* ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /app/server ./cmd/server

FROM scratch
COPY --from=builder /app/server /server
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
USER 65534:65534
ENTRYPOINT ["/server"]
```

### Go's k8s perf checklist

- [ ] Go 1.25+ OR `go.uber.org/automaxprocs` imported
- [ ] No stale `GOMAXPROCS` env var in manifests
- [ ] `GOMEMLIMIT` set if memory-constrained
- [ ] Static binary, distroless or scratch base
- [ ] `pprof` exposed on a separate port (not the main service port)
- [ ] Graceful shutdown handles SIGTERM (`context.WithCancel` pattern)

---

## Python on Kubernetes

### Workers config — GIL + CFS interaction

Python's GIL means **one thread executes Python at a time per process**. To use multiple CPUs, you need multiple processes (workers).

**Common pattern** (gunicorn for WSGI):

```bash
# Anti-pattern: workers > cpu limit
gunicorn --workers=4 app:application   # in a pod with cpu: "1" → 4 processes fighting for 1 CPU → severe throttling

# Correct: workers ≈ cpu limit (CPU-bound) OR workers = 2-4 × cpu (I/O-bound, with async)
gunicorn --workers=$((CPU_LIMIT + 1)) app:application
```

**For ASGI (FastAPI / Starlette / async)**:

```bash
# uvicorn with worker process count
uvicorn app:app --workers=$CPU_LIMIT --host 0.0.0.0 --port 8000
```

Worker count rule of thumb:
- **CPU-bound** (Django serving rendered templates, ML inference): `workers = CPU_LIMIT` (+ 1 for headroom)
- **I/O-bound sync** (gunicorn + sync workers, lots of DB calls): `workers = 2-4 × CPU_LIMIT`
- **I/O-bound async** (FastAPI, async DB drivers): `workers = CPU_LIMIT`; rely on event loop for concurrency

### Gunicorn timeout vs probe timing

Gunicorn's `--timeout 30` kills workers that exceed 30s on a single request. If your readiness probe takes 35s under load (because of slow downstream), the worker handling the probe gets killed → probe fails → pod removed from LB. Cascading failure.

**Match timeouts:**
```
gunicorn --timeout > readiness_probe_timeoutSeconds × failureThreshold + safety
```

### Memory per worker

Each gunicorn worker is a separate Python process. Memory math:

```
container_memory_limit ≥ workers × per_worker_memory + buffer
```

Per-worker memory varies wildly by app (Django: 150-400MB; FastAPI: 80-200MB). Profile with `--workers=1` first to establish per-worker baseline, then scale.

### Image strategy

```dockerfile
# Multi-stage with slim base
FROM python:3.13-slim AS builder
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir --user -r requirements.txt

FROM python:3.13-slim
WORKDIR /app
COPY --from=builder /root/.local /root/.local
COPY . .
ENV PATH=/root/.local/bin:$PATH
USER nobody
CMD ["gunicorn", "-w", "2", "-b", "0.0.0.0:8000", "app:application"]
```

Distroless Python is available but harder to debug. Slim base is the pragmatic default.

---

## Kubernetes-perf anti-patterns checklist

Surface these in any K8s perf review:

- [ ] **CPU throttling above 5%** on a service with latency SLO — fix runtime parallelism (GOMAXPROCS, JVM ActiveProcessorCount, gunicorn workers) or remove CPU limit
- [ ] **Liveness probe with DB dependency** — replace with trivial process-alive check; move DB check to readiness
- [ ] **`terminationGracePeriodSeconds` < actual shutdown time** — measure shutdown duration, set with buffer
- [ ] **Probe failureThreshold × periodSeconds < shutdown drain time** — readiness must fail and propagate to LB before app starts closing connections
- [ ] **`-Xmx` (JVM) or `--max-old-space-size` (Node) ≥ pod memory limit** — kernel OOM kills before runtime GC reacts
- [ ] **JVM with `GOMAXPROCS=ActiveProcessorCount` mismatch on fractional CPU** — set explicitly
- [ ] **Go service on Go 1.24 or earlier without `automaxprocs` import** — throttling certain
- [ ] **Multiple Node processes per pod (cluster module / PM2)** — let Kubernetes do the multiplexing
- [ ] **Gunicorn workers >> CPU limit** — severe Python throttling
- [ ] **No `preStop` sleep** — race condition between LB convergence and app shutdown
- [ ] **No `startupProbe` for slow-starting JVM apps** — liveness kills mid-startup
- [ ] **HPA scaling without warmup-aware stabilization window** — thundering herd of cold JVMs
- [ ] **Image > 500MB without justification** — slow cold start on autoscale
- [ ] **No `HeapDumpPath` to persistent volume (JVM)** — OOM forensics impossible
- [ ] **Same QoS class for prod-critical and batch workloads** — eviction policy will surprise you

---

## Kubernetes-perf review checklist (use in engagements)

When inheriting a K8s deployment for perf review, run through this:

**Resource configuration:**
1. What QoS class does the pod have? (`kubectl describe pod | grep QoS`)
2. What is the throttling ratio? (PromQL query above)
3. Are requests + limits set deliberately, or copy-pasted defaults?

**Probes:**
1. What does liveness check? (anything beyond process-alive is suspect)
2. What does readiness check? (should be comprehensive, fast, fail-fast)
3. Is there a startup probe? (required for any app with > 10s startup)
4. Do probe timings match terminationGracePeriodSeconds math?

**Shutdown:**
1. Is SIGTERM handled?
2. Is there a `preStop` hook with sleep?
3. Has `terminationGracePeriodSeconds` been measured against actual shutdown duration?

**Runtime config:**
- **Java**: Xmx, ActiveProcessorCount, GC log persistence, heap dump path, virtual-threads flag if applicable
- **Node**: max-old-space-size, single process per pod
- **Go**: Go 1.25+ or automaxprocs, GOMEMLIMIT
- **Python**: worker count vs CPU limit, gunicorn timeout vs probe timeout

**Image:**
1. Size — is it justified? Multi-stage build?
2. Base — distroless / slim / scratch where applicable?
3. Layered for caching — does a code change trigger full rebuild?

**Autoscaling:**
1. What metric does HPA use? (CPU is the default and often wrong — prefer custom metrics like RPS or queue depth)
2. Stabilization windows configured?
3. PDB (PodDisruptionBudget) set to prevent thundering herd during node drain?

**Observability:**
1. Are runtime metrics scraped? (JVM metrics via Actuator, Node metrics via prom-client, Go via promhttp, Python via prometheus_client)
2. Are CFS throttling metrics dashboarded?
3. Is histogram bucket saturation between mesh metrics and APM monitored? (see `tool-selection-guide.md`)

State the findings in the engagement brief and the deliverable templates — most K8s perf findings are config issues, not runtime tuning issues.
