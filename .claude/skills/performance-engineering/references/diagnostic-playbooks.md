# Diagnostic playbooks

Concrete commands, queries, and procedures for hands-on diagnosis. Use these when running a real investigation, not when discussing strategy.

---

## Step zero — Build a fast, deterministic feedback loop

**This is the skill.** Everything else is mechanical. If you have a fast, deterministic, runnable pass/fail signal for the regression, you will find the cause — bisection, hypothesis-testing, instrumentation all just consume that signal. If you don't have one, no amount of staring at dashboards will save you.

Spend disproportionate effort here. Be aggressive. Be creative. Refuse to give up.

For performance work, "the loop" usually means: **a way to reproduce the slow behavior in seconds, repeatably, against a system you can change rapidly**.

### Ways to construct a perf feedback loop — try in roughly this order

1. **Failing benchmark** at whatever seam captures the regression — micro-benchmark (JMH, Go test `-bench`, pytest-benchmark), endpoint benchmark with `wrk2`/`hey`/`ab`, or a k6 `smoke` scenario asserting a threshold.
2. **`curl`/HTTP script with timing** against a running dev server. `curl` with a `-w` timing format produces `time_namelookup`, `time_connect`, `time_starttransfer`, `time_total` — enough to bisect TTFB issues.
3. **Captured trace replay.** Save a real production request (with `tcpdump`, recording proxy, or HAR file) and replay it against a local instance. Eliminates network and load variability.
4. **Profiler-driven loop.** `pyspy record`, `async-profiler -d 10`, `perf record sleep 10` — produce a flame graph; iterate on the change; produce a new flame graph; diff. Can be < 30s per cycle on a developer machine.
5. **Synthetic load generator at low concurrency.** k6 with 1-10 VUs or wrk2 at low RPS — enough to trigger the symptom without saturating the dev box.
6. **Bisection harness.** If the regression appeared between two commits: automate "boot at commit X, run benchmark, record p95" so `git bisect run` can find the bad commit autonomously.
7. **Differential loop.** Same input through old version vs new version (or two configs); diff timing and resource usage.
8. **Production sample replay.** If the issue only happens in production, capture a sample of real traces (Tempo TraceQL, Datadog APM export) and replay specific shapes against staging.

Build the right feedback loop, and the regression is 90% diagnosed.

### Iterate on the loop itself

A 30-second flaky loop is barely better than no loop. A 2-second deterministic loop is a debugging superpower.

Once you have *a* loop, ask:
- **Faster**: Cache setup. Skip unrelated init. Narrow the test scope. Run on warm caches.
- **Sharper signal**: Assert on the specific symptom (p99 latency on this endpoint), not on a coarse aggregate ("the dashboard looks bad").
- **More deterministic**: Pin time. Seed RNGs. Isolate filesystem. Freeze network with VCR-style replay. Disable JIT warmup variance.

### Non-deterministic perf bugs

The goal is not a clean repro but a **higher reproduction rate**. Loop the trigger 100×, parallelize, add stress, narrow timing windows, inject sleeps. A 50%-flake bug is debuggable; a 1% bug is not — keep raising the rate until it's debuggable.

### When you genuinely cannot build a loop

Stop and say so explicitly. List what you tried. Ask the user for one of:
- (a) access to whatever environment reproduces it,
- (b) a captured artifact (HAR, profile dump, trace export, dashboard CSV with timestamps),
- (c) permission to add temporary production instrumentation (add a span attribute, dial up profiler sample rate, enable a feature flag).

Do **not** proceed to hypothesize from dashboards alone. Hypotheses without a loop produce theatre, not fixes.

---

## Step zero-point-five — Round-trip time budgeting

Before optimizing anything, decompose total user-perceived latency into a budget across layers:

> *"The 900 ms round trip is ~200 ms JS + ~400 ms JVM/app + ~300 ms DB."*

Build this from distributed tracing (span durations summed by service / category) or from synthetic breakdown if tracing is incomplete (one curl + one DB EXPLAIN + one browser timeline).

This framing does three things at once:
- Tells you where the budget actually lives — and where to spend optimization effort
- Prevents over-investing in a layer that isn't the bottleneck (the "shave 50ms off the JS bundle" trap when 300ms is in the DB)
- Is a powerful stakeholder-alignment tool in closing meetings — when execs see "DB owns 33% of the round trip", scope conversations get cheaper

State the budget in the engagement brief and revisit it at each sprint demo. A 10% improvement in the dominant layer always beats a 50% improvement in a minority layer.

---

## USE method — quick checklist

For each resource, check Utilization, Saturation, and Errors.

### CPU
- **Utilization**: `top`, `mpstat -P ALL 1`, Prometheus `rate(node_cpu_seconds_total{mode!="idle"}[1m])`
- **Saturation**: load average vs core count, run-queue length (`vmstat 1` `r` column)
- **Errors**: thermal throttling (`dmesg | grep -i thermal`)

### Memory
- **Utilization**: `free -h`, `node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes`
- **Saturation**: swap activity (`vmstat 1` `si`/`so`), OOM kills (`dmesg | grep -i oom`), page faults
- **Errors**: ECC errors in `dmesg`

### Disk I/O
- **Utilization**: `iostat -xz 1` (`%util` column)
- **Saturation**: `iostat -xz 1` (`aqu-sz` / `await`), I/O wait in `top`
- **Errors**: `dmesg | grep -i error`, SMART data

### Network
- **Utilization**: `sar -n DEV 1`, interface bytes vs link speed
- **Saturation**: `netstat -s` retransmits, `ss -ti` for queue depths, dropped packets
- **Errors**: interface error counters

### Locks (application-level)
- **Utilization**: lock wait time as % of total time
- **Saturation**: thread queue depth on contended locks
- **Errors**: deadlock counts

---

## RED method — service-level dashboard structure

For every service, the standard dashboard exposes:

- **Rate**: `sum(rate(http_requests_total[1m])) by (service, route)`
- **Errors**: `sum(rate(http_requests_total{status=~"5.."}[1m])) by (service, route)` — and the ratio
- **Duration**: histogram with p50/p95/p99/p99.9 — `histogram_quantile(0.99, sum(rate(http_request_duration_seconds_bucket[5m])) by (le, service, route))`

Always plot these by route, not just service-wide — aggregate latency hides per-endpoint pathologies.

---

## Profiling commands

### CPU profile (Linux, system-wide)

```bash
# Capture 30s of stack samples
perf record -F 99 -ag -- sleep 30
perf script | stackcollapse-perf.pl | flamegraph.pl > flame.svg
```

### CPU profile (per-process, low overhead with eBPF)

```bash
# profile is part of bcc-tools
profile -F 99 -p <PID> 30 > stacks.txt
stackcollapse.pl stacks.txt | flamegraph.pl > flame.svg
```

### Off-CPU profile (find blocking)

```bash
offcputime-bpfcc -p <PID> 30 > offcpu.txt
# generate flame graph from this — shows where threads are waiting, not running
```

### JVM

```bash
# async-profiler — flame graph with kernel + user stacks
./profiler.sh -d 30 -f flame.html <PID>

# Allocation profiling
./profiler.sh -d 30 -e alloc -f alloc.html <PID>
```

### Python

```bash
py-spy record -o flame.svg --pid <PID> --duration 30
```

### Go

```bash
# Live pprof from a service exposing /debug/pprof
go tool pprof -http=:8080 http://service/debug/pprof/profile?seconds=30
```

---

## Distributed tracing analysis

When investigating a slow request:

1. Find an exemplar trace at the affected percentile (don't pick a fast trace — it won't show the problem).
2. Identify the **critical path**: longest sequential chain of spans, not the longest individual span.
3. Look for: serial calls that could be parallel, N+1 query patterns, retries hidden inside spans, gaps between spans (queue time / scheduling).
4. Compare a slow trace to a fast trace from the same endpoint to see what's different.

---

## Metric source discrepancy investigation

When two observability sources disagree on the same metric (e.g., Istio service mesh shows p99=400ms, APM shows p99=250ms, span-derived metric shows p99=300ms):

**Hypotheses to check, in order of frequency:**

1. **Aggregation function difference** — service mesh might emit pre-aggregated histograms that lose precision; APM may use t-digest; span-derived may use exact percentile. Compare histogram bucket boundaries.
2. **Temporal resolution** — 1m vs 10s vs 1s windows produce different percentiles. Align windows before comparing.
3. **OTel Collector batching** — batching can shift timestamps and merge data points, affecting p99 calculation. Inspect collector config: `batch.timeout`, `batch.send_batch_size`.
4. **Sampling bias** — APM with head-based sampling at 1% will under-represent slow requests. Check sampling strategy.
5. **Scope difference** — service mesh measures L7 at sidecar; APM may measure inside the app process; span-derived may include downstream calls. They're literally measuring different things.
6. **Clock skew** — between sidecar, app, and collector. Check NTP.

**Don't average them.** They measure different things; the right answer depends on what the SLO is defined against.

---

## k6 load test — coordinated-omission-aware template

```javascript
import http from 'k6/http';
import { check } from 'k6';

export const options = {
  scenarios: {
    constant_arrival: {
      executor: 'constant-arrival-rate',  // critical: arrival-rate, not VU-based
      rate: 200,                          // 200 RPS
      timeUnit: '1s',
      duration: '10m',
      preAllocatedVUs: 50,
      maxVUs: 200,
    },
  },
  thresholds: {
    'http_req_duration{expected_response:true}': [
      'p(95)<300',
      'p(99)<500',
      'p(99.9)<1500',
    ],
    'http_req_failed': ['rate<0.001'],
  },
};

export default function () {
  const res = http.get('https://target/endpoint');
  check(res, { 'status 200': (r) => r.status === 200 });
}
```

Key points:
- `constant-arrival-rate` decouples request submission from response time — avoids coordinated omission.
- Thresholds enforce SLO directly in the test; CI fails if SLO breached.
- `maxVUs` must be high enough that VU exhaustion isn't the bottleneck — if it is, results are invalid.

---

## Soak test specifics

A soak test runs for 4-24+ hours. What to watch:

- **Memory**: linear growth = leak. GC cycles getting longer = heap pressure.
- **Latency drift**: p99 stable for first hour but climbing afterward = resource exhaustion (file handles, connection pools, log volume).
- **Throughput drift**: stable RPS but climbing latency = saturation building.
- **Error rate**: errors that appear only after N hours often point to time-based bugs (token expiration, connection age limits, log rotation contention).

Soak tests are the only way to catch GC pathologies, slow leaks, and connection pool exhaustion. Skipping them is the single most common reason perf tests pass and prod still fails.

---

## Common bottleneck signatures

| Signature | Likely cause |
|-----------|--------------|
| Latency climbs with concurrency, CPU not saturated | Lock contention or DB connection pool exhaustion |
| p99 spiky but p50 flat | GC pauses, scheduler contention, or noisy neighbor |
| Throughput plateaus while CPU still has headroom | Single-threaded bottleneck, mutex, or downstream limit |
| Latency degrades over hours, throughput stable | Memory leak, connection leak, log volume growth |
| Errors only at peak | Resource exhaustion (file handles, pool, ephemeral ports) |
| Latency improves after restart, degrades over days | Memory fragmentation, cache pollution, accumulated state |
| Latency doubles when adding a node | Coordination overhead (Universal Scalability Law β term) |
