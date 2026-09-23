# Memory leak detection

Soak tests, heap analysis, and common leak patterns by runtime.

> Sources synthesized: khanntm memory-leak-detection, rcampos09 bottleneck patterns Pattern 2.

This complements `bottleneck-patterns.md` Pattern 2 with runtime-specific tooling and patterns.

---

## Symptoms checklist

| Symptom | Likely cause |
|---------|--------------|
| Memory grows over time, never drops | References not released |
| GC runs more frequently with longer pauses | Heap pressure from leaked objects |
| OOM crash after hours/days | Unbounded growth in cache/queue/listener |
| Response time degrades gradually under sustained load | GC overhead stealing CPU |
| Performance is fine on restart, degrades over days | Memory fragmentation or accumulated state |

---

## Detection strategy: soak test (primary method)

Run sustained load for an extended period and watch memory.

```javascript
// k6 soak (8 hours, constant load)
export const options = {
  scenarios: {
    soak: {
      executor: 'constant-arrival-rate',
      rate: 50, timeUnit: '1s', duration: '8h',
      preAllocatedVUs: 30, maxVUs: 100,
    },
  },
};
```

**Healthy pattern:** memory grows, GC reclaims, settles to a plateau.
**Leak pattern:** memory grows continuously; never plateaus; GC reclaims less each cycle.

### Metrics to watch

| Metric | Source | What to look for |
|--------|--------|------------------|
| Heap used | APM / `/metrics` | Steady upward trend over hours |
| GC frequency | JVM / Go / Node runtime metrics | Increasing over time |
| GC pause time | Same | Getting longer |
| RSS (resident set size) | `ps`, container metrics | Growing beyond expected |
| Object count by type | Heap snapshot diff | Specific type count growing |

A 2-hour soak is the **minimum** to detect slow leaks; 4-8h is more reliable.

---

## Heap snapshot comparison

Capture snapshots at intervals during the soak; diff them. A linear growth in object count of a specific type confirms a leak.

```
T=0h:   10,000 objects, 50MB heap
T=2h:   15,000 objects, 75MB heap   (delta: +5000)
T=4h:   20,000 objects, 100MB heap  (delta: +5000)
T=6h:   25,000 objects, 125MB heap  (delta: +5000)
→ ~2500 objects/hour leak rate; identify the type and the retain path
```

---

## JVM (Java, Kotlin, Scala)

### Tooling

- **JFR (Java Flight Recorder)**: continuous, low-overhead. `jcmd <pid> JFR.start duration=8h filename=soak.jfr`
- **Heap dump**: `jcmd <pid> GC.heap_dump filename=heap.hprof` — analyze with Eclipse MAT, VisualVM, or YourKit
- **JConsole / VisualVM**: real-time heap and thread monitoring
- **async-profiler with `-e alloc`**: allocation profile (where objects come from)
- **GC logs**: enable with `-Xlog:gc*:file=gc.log:time,uptime`

### Reading heap dumps with Eclipse MAT

1. Open the `.hprof` in MAT.
2. Run **Leak Suspects Report** — identifies dominators retaining the most heap.
3. Look at **Histogram** ordered by retained size — the type at the top is usually the culprit.
4. Right-click → **Path to GC Roots** to see what's retaining it.

### Common JVM leak patterns

```java
// LEAK: ThreadLocal not cleared in thread pool
private static final ThreadLocal<HugeContext> CTX = new ThreadLocal<>();
public void handle(Request r) {
    CTX.set(new HugeContext(r));
    // ... no CTX.remove() ⇒ leaked when thread is reused
}

// FIX: always remove in finally
try {
    CTX.set(new HugeContext(r));
    // ...
} finally {
    CTX.remove();
}

// MODERN ALTERNATIVE (Java 25+): use ScopedValue instead
// Immutable, scope-bound, no per-thread copy, no remove() needed.
// Critical at virtual thread scale (millions of threads × per-thread copy = memory disaster).
// See runtime-perf-tuning.md "Scoped Values" section.
private static final ScopedValue<Context> CTX = ScopedValue.newInstance();
ScopedValue.where(CTX, new Context(r)).run(() -> handle());
```

```java
// LEAK: static collection accumulating
public static final List<Event> EVENTS = new ArrayList<>();
public void record(Event e) { EVENTS.add(e); }  // never bounded

// FIX: bounded queue or rolling buffer
public static final Deque<Event> EVENTS = new ConcurrentLinkedDeque<>();
public void record(Event e) {
    EVENTS.add(e);
    while (EVENTS.size() > MAX) EVENTS.pollFirst();
}
```

```java
// LEAK: listener registered, never unregistered
emitter.on("event", this::handle);

// FIX: deregister on lifecycle end
@PreDestroy
void cleanup() { emitter.off("event", this::handle); }
```

### GC tuning is not a fix

Tuning GC (G1 → ZGC, larger heap) can mask a leak temporarily but never fixes it. The leak rate eventually wins. Always fix the leak; tune GC only for legitimate workload pressure.

---

## Node.js

### Tooling

- **`node --inspect`** + Chrome DevTools — heap snapshots, allocation timeline
- **`heapdump` package** — programmatic heap dumps
- **`clinic.js` (`clinic doctor`, `clinic heapprofiler`)** — automated diagnosis
- **`--trace-gc`** flag — log GC events

### Common Node.js leak patterns

```javascript
// LEAK: event listener accumulation
server.on('request', handler);  // each setup adds another
// FIX: track and remove, or use server.once() if appropriate
server.removeListener('request', handler);

// LEAK: closure capturing large data
function createHandler() {
  const largeData = loadHugeDataset();  // captured in every closure
  return (req, res) => { /* uses largeData */ };
}
// FIX: load once outside, share by reference; don't recreate

// LEAK: global cache without eviction
const cache = {};
function getOrFetch(key) {
  if (!cache[key]) cache[key] = expensiveCompute(key);
  return cache[key];
}
// FIX: use a bounded cache (lru-cache, node-cache with TTL)
const LRU = require('lru-cache');
const cache = new LRU({ max: 1000, ttl: 1000 * 60 * 5 });

// LEAK: timer / interval not cleared
const t = setInterval(work, 1000);
// FIX: clearInterval(t) on shutdown

// LEAK: unbounded promise array
const pending = [];
async function track(p) { pending.push(p); /* never drained */ }
// FIX: use a worker pool with bounded concurrency (p-limit, p-queue)
```

### Heap snapshot workflow (Node)

1. Start with `node --inspect-brk app.js`.
2. Connect Chrome DevTools at `chrome://inspect`.
3. Memory tab → "Take heap snapshot" at T=0.
4. Generate load for 30+ min.
5. Take another snapshot. Use **Comparison** view — sort by `Delta` to find growing object types.
6. Inspect retainers chain to identify the leak source.

---

## Go

### Tooling

- **`net/http/pprof`** — exposes `/debug/pprof/heap`, `/debug/pprof/allocs`
- **`go tool pprof`** — analyze profiles
- **`runtime/trace`** — execution and GC traces

```bash
# Capture heap profile during the leak window
curl -s http://localhost:6060/debug/pprof/heap > heap.prof
go tool pprof -http=:8080 heap.prof
# In the UI: View → Top, Source, Flame Graph
# Compare two snapshots: go tool pprof -base heap1.prof heap2.prof
```

### Common Go leak patterns

```go
// LEAK: goroutine waiting on channel that never closes
go func() {
    for msg := range ch {  // ch never closed → goroutine never exits
        process(msg)
    }
}()
// FIX: close(ch) when done; or use context.Context cancellation

// LEAK: time.NewTicker not stopped
ticker := time.NewTicker(time.Second)
go func() {
    for range ticker.C { work() }
}()
// FIX: defer ticker.Stop()

// LEAK: slice retaining underlying array
big := loadLargeData()
small := big[0:10]   // small references the entire underlying array
// FIX: copy
small := make([]T, 10)
copy(small, big[0:10])
big = nil  // hint GC
```

### Goroutine leaks

```bash
curl -s http://localhost:6060/debug/pprof/goroutine?debug=1
# If goroutine count grows continuously, you have a leak
```

Most Go "memory" leaks are actually goroutine leaks holding references.

---

## Python

### Tooling

- **`tracemalloc`** (stdlib) — track allocations
- **`memory_profiler`** — line-by-line memory use
- **`objgraph`** — visualize object references
- **`pyspy`** — sampling profiler (also for CPU)

```python
import tracemalloc
tracemalloc.start()
# ... run workload ...
snapshot1 = tracemalloc.take_snapshot()
# ... more workload ...
snapshot2 = tracemalloc.take_snapshot()
top_stats = snapshot2.compare_to(snapshot1, 'lineno')
for stat in top_stats[:10]:
    print(stat)
```

### Common Python leak patterns

```python
# LEAK: caching results without bound
_cache = {}
def fetch(k):
    if k not in _cache:
        _cache[k] = expensive(k)
    return _cache[k]

# FIX: functools.lru_cache or cachetools
from functools import lru_cache
@lru_cache(maxsize=1000)
def fetch(k): return expensive(k)
```

```python
# LEAK: circular references with __del__ (CPython gc can't always collect)
class A:
    def __init__(self): self.b = B(self)
class B:
    def __init__(self, a): self.a = a

# FIX: weakref
import weakref
class B:
    def __init__(self, a): self.a = weakref.ref(a)
```

---

## When the leak is in a third-party library

It happens. Workflow:

1. **Confirm** with two independent test runs (rule out workload change).
2. **Isolate** — minimal repro that demonstrates the leak.
3. **Search** the library's issue tracker.
4. **Workaround**: bound the usage (recycle workers periodically), pin to a known-good version, or replace.
5. **Report upstream** with the minimal repro.

For services with unfixable upstream leaks: scheduled rolling restart of workers as a temporary measure. Document it as accepted tech debt with an exit plan.

---

## Production memory monitoring (always-on)

Even after fixing leaks, monitor in production:

- **RSS / heap used** with alerts for abnormal growth rate (not just absolute threshold).
- **GC overhead** (% of CPU spent in GC) — if > 5% sustained, you have pressure.
- **OOM kill events** at the container/host level.
- **Container restart count** — frequent restarts often hide a slow leak.

A leak that takes 14 days to OOM is invisible to a 1-hour test but very visible in 30-day production trend.
