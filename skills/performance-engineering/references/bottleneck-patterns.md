# Bottleneck patterns

Match observed symptoms to bottleneck types. Each pattern includes signatures (what you see), confirmation steps (how to verify), and remediation (ranked low → high effort).

> Sources synthesized: rcampos09/performance-report-analysis BOTTLENECK-PATTERNS, khanntm real-world lessons.

This complements `diagnostic-playbooks.md` (commands and tools) with **diagnostic patterns** (what the data is telling you).

---

## Pattern 1 — CPU saturation

**Signatures:**
- p95/p99 latency rises gradually as concurrency increases
- Throughput plateaus despite adding more users
- CPU utilization sustained > 70-80% during load
- No memory growth, no error spikes at low load

**Confirmation:**
- CPU graph correlates with latency increase
- Thread dump shows hot threads in compute (serialization, regex, encryption)
- Profiler shows hot methods consuming > 20% of CPU

**Remediation (lowest → highest effort):**
1. Reduce serialization overhead — switch to a lighter JSON library or binary format
2. Move CPU-intensive work off the request path (async queue, background worker)
3. Horizontal scaling — add instances behind LB
4. Code-level optimization in hot paths (algorithmic improvements)
5. Hardware upgrade — larger CPU, more cores

---

## Pattern 2 — Memory leak / heap exhaustion

**Signatures (soak / endurance):**
- Acceptable for first 30-60 min, then degrades steadily
- Memory grows monotonically over test duration
- GC frequency increases; GC pause duration grows
- System eventually OOMs or restarts

**Signatures (short tests):**
- Memory grows; GC reclaims temporarily (sawtooth)
- Heap utilization trend is upward even after GC

**Confirmation:**
- Heap dumps at intervals show growing retained objects
- Memory profiler identifies un-released objects (listeners, unbounded caches, static collections)
- RSS grows even after GC cycles

**Remediation:**
1. Add cache eviction policies (TTL, LRU, max-size) on unbounded caches
2. Remove static collection accumulators (event listeners, request logs, in-memory queues without drain)
3. Fix resource leaks (close streams, release DB connections in `finally` / try-with-resources)
4. Tune GC settings — temporary measure only, not a fix
5. Refactor to streaming or lazy loading for large data

See `memory-leak-detection.md` for tool-specific commands.

---

## Pattern 3 — Database bottleneck

**Signatures:**
- App p95 spikes correlate with DB slow query metrics
- DB CPU or I/O is high while app CPU is low
- Connection pool metrics show threads waiting for a connection
- Errors: connection timeout, statement timeout, lock wait timeout

**Sub-patterns:**

| Sub-pattern | Indicator | Root cause |
|-------------|-----------|------------|
| Slow queries | DB CPU high, specific queries in slow query log | Missing index, full table scan |
| N+1 queries | Request count grows faster than user count | ORM lazy-loading related records |
| Connection pool exhaustion | Threads waiting for connection > 0 sustained | Pool too small or connections held too long |
| Lock contention | Lock wait time spikes | Long transactions, missing indexes on UPDATE WHERE clauses |
| Replica lag | Reads return stale data; backpressure on primary | Insufficient replica capacity, network |

**Remediation:**
1. Read query plans (`EXPLAIN ANALYZE`) for top 5 slowest queries — usually missing index
2. Add indexes for predicates and JOIN keys; remove unused indexes (write penalty)
3. Detect and fix N+1: log query counts per request; use eager-loading or DataLoader
4. Right-size connection pool: pool size ≈ ((core_count × 2) + effective_spindle_count); cap below DB max_connections
5. Cache hot reads (Redis) with explicit invalidation strategy
6. Read-replica routing for read-heavy workloads
7. Partitioning / sharding only when above are exhausted

See `db-optimization.md` for query analysis details.

---

## Pattern 4 — Connection / pool exhaustion

**Signatures:**
- Errors at peak only: "connection timeout", "pool exhausted", "ephemeral port exhaustion"
- Latency walls (sudden flat-line at high values) for some requests
- TCP `TIME_WAIT` count climbing on hosts (`ss -s`)

**Confirmation:**
- Pool metrics: `active`, `idle`, `waiting` — `waiting` > 0 sustained means exhausted
- `netstat -s` shows retransmits or queue overflows
- File descriptor limits (`ulimit -n`) approached on app or generator

**Remediation:**
1. Increase pool size, but only after measuring downstream capacity
2. Reduce connection hold time (release after I/O, not after handler completes)
3. Enable connection multiplexing (HTTP/2, gRPC) — fewer sockets
4. Tune kernel: `net.ipv4.ip_local_port_range`, `tcp_tw_reuse` for ephemeral port pressure
5. Add circuit breakers / load shedding to fail fast instead of queuing forever

---

## Pattern 5 — Lock contention (application-level)

**Signatures:**
- Latency rises with concurrency but CPU has headroom
- Throughput plateaus while CPU is < 50%
- Thread dumps show many threads `BLOCKED` or `WAITING` on the same monitor

**Confirmation:**
- Lock profiling (e.g., async-profiler `-e lock`)
- Off-CPU profile shows time spent waiting, not running
- Synchronized blocks or `ReentrantLock` hot in stack traces

**Remediation:**
1. Reduce critical-section size — move I/O outside locks
2. Switch to lock-free / concurrent data structures (`ConcurrentHashMap`, atomics)
3. Partition hot resources (sharded counters, striped locks)
4. Use optimistic concurrency (CAS) where applicable
5. Reconsider design if a single resource must be globally serialized

---

## Pattern 6 — Disk I/O saturation

**Signatures:**
- Latency spikes coincide with `iostat %util` near 100%
- I/O wait (`%iowait` in top) elevated
- Request queue depth (`avgqu-sz`) climbing

**Confirmation:**
- `iostat -xz 1` during load — `%util`, `await`, `aqu-sz`
- Trace top syscalls (`strace -c -p <pid>`) — heavy `read`/`write`/`fsync`
- Application logs flushed synchronously? Profiler shows time in `fsync`?

**Remediation:**
1. Async logging (already standard but check) — never synchronous in hot paths
2. Move ephemeral data to memory (Redis) or local SSD (not network-attached)
3. Right-size disk type — gp3 vs io2 vs NVMe; provisioned IOPS where needed
4. Write coalescing / batching at app level
5. Move to a managed datastore that handles I/O internally

---

## Pattern 7 — Network saturation

**Signatures:**
- Throughput plateaus near link bandwidth (NIC bytes/sec ≈ link capacity)
- Packet loss / retransmits climbing (`netstat -s | grep -i retrans`)
- Latency increases uniformly across endpoints

**Confirmation:**
- `sar -n DEV 1` — interface bytes vs link speed
- `ss -ti` — TCP queue depths and retransmits
- VPC flow logs (cloud) — drops at boundary

**Remediation:**
1. Compress payloads (gzip, brotli, protobuf)
2. Reduce response size — pagination, field selection (GraphQL, sparse fieldsets)
3. CDN for static / cacheable assets
4. Larger instances with more network (cloud: instance class affects NIC bandwidth)
5. Multi-AZ / multi-region — only if traffic patterns justify cost

---

## Pattern 8 — Third-party / downstream dependency

**Signatures:**
- Latency spikes in your service correlate with one downstream call
- Error rates rise but only on requests that hit that dependency
- p99 dominated by waiting on external response

**Confirmation:**
- Distributed trace shows the slow span outside your service boundary
- Status page or vendor dashboard confirms degradation

**Remediation (your side, not theirs):**
1. **Timeout aggressively** — never wait longer than your SLO budget allows
2. **Circuit breaker** — fail fast when error rate exceeds threshold
3. **Hedged requests** — duplicate request to a backup or retry early
4. **Cache responses** where staleness is acceptable
5. **Async / queued** if the call doesn't need to block the user response
6. **Bulkheads** — separate thread pool / connection pool per dependency so one slowness doesn't drag others

---

## Pattern 9 — Coordination overhead (USL β term)

**Signatures:**
- Adding nodes makes throughput **worse**, not just plateau
- Latency rises super-linearly past N instances
- Distributed locks / consensus operations are hot

**Confirmation:**
- Throughput vs node count plotted — fits Universal Scalability Law with non-zero β
- Coordination service (Zookeeper, etcd, distributed cache) shows heavy use
- Cross-AZ chatter dominates network bytes

**Remediation:**
1. Reduce coordination — sharded ownership, eventual consistency where acceptable
2. CRDT or vector-clock approaches for mergeable state
3. Locality — pin related work to the same node/AZ
4. Re-evaluate the consistency requirement — strong consistency is expensive, sometimes unnecessary

---

## Pattern 10 — GC pathology (JVM, CLR, Go runtime)

**Signatures:**
- p99 spikes that don't correlate with throughput
- Periodic latency cliffs (every N seconds = GC interval)
- CPU shows GC threads consuming significant cycles

**Confirmation:**
- GC logs enabled, parsed (GCViewer, gceasy.io)
- JFR / continuous profiling shows GC overhead > 5%
- Pause times > SLO tail budget

**Remediation:**
1. Tune GC algorithm (G1 vs ZGC vs Shenandoah for JVM; default Go GC tuning via `GOGC`)
2. Reduce allocation pressure — pool objects, avoid per-request allocation in hot paths
3. Increase heap (within memory budget) — fewer collections at the cost of longer pauses
4. Switch GC: ZGC / Shenandoah for sub-10ms pauses on JVM
5. For Go: pprof allocation profile → reduce escapes to heap

---

## Pattern 11 — Cold cache / warm-up effects

**Signatures:**
- First few minutes of test show degraded latency, then improves
- After deploy or restart, latency briefly spikes
- Cache hit ratio low at start, climbs over time

**Confirmation:**
- Cache hit ratio metric over time
- Test results vary depending on whether you ran a warm-up

**Remediation:**
1. Always include a warm-up phase in load tests (don't measure during it)
2. Cache pre-warming on deploy — fetch hot keys before serving
3. Persistent cache (Redis, not in-process) survives app restarts
4. Cache stampede protection: request coalescing / single-flight for cache misses

---

## Multi-bottleneck reality

Real systems often have **multiple bottlenecks in sequence**: fix the first, the next becomes visible. This is normal. Each iteration should:
1. Confirm the bottleneck (don't assume)
2. Apply the cheapest effective fix
3. Re-run and observe what becomes the new limit
4. Repeat until SLOs are met with margin

Stopping at "the system meets SLO" is fine; chasing all bottlenecks to zero is over-engineering.
