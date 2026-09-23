# Resilience and chaos testing

How to test that the system fails gracefully under adverse conditions — not just that it's fast under ideal load.

> Sources synthesized: KimDoubleB testing-resilience.

Resilience testing complements load testing. Load testing asks "is it fast?"; resilience testing asks "what happens when something breaks?"

---

## What resilience tests reveal that load tests don't

| Failure mode | Load test catches it? | Resilience test catches it? |
|--------------|----------------------|----------------------------|
| Capacity ceiling reached | Yes | Sometimes |
| Database goes away mid-traffic | No | Yes |
| Slow downstream dependency (latency, not failure) | No | Yes |
| Network partition between services | No | Yes |
| Disk fills up | No | Yes |
| Process crashes / restarts | No | Yes |
| Cache cluster fails over | No | Yes |
| Configuration change rollout race | No | Yes |

You need both.

---

## Failure modes to test

### Dependency failures

- **Hard down**: dependency returns connection refused / 503.
- **Slow**: dependency takes 5-30s to respond.
- **Flaky**: dependency returns errors at varying rates (0.5%, 5%, 50%).
- **Intermittent**: dependency works for 30s, fails for 30s.

### Infrastructure failures

- **Pod / instance termination**: kill a single replica during load.
- **Zone failure**: lose a whole AZ.
- **DB failover**: trigger primary → replica promotion.
- **Network partition**: introduce 100ms-2s latency between specific service pairs.
- **DNS slowness**: DNS lookups taking 5s.
- **Disk pressure**: fill disk to 95%.
- **Memory pressure**: cgroup limits causing OOM kill of one process.

### Application-level failures

- **Bad config push**: feature flag rollout that breaks a service.
- **Cache wipe**: flush all cache mid-traffic — does the system handle the cold-start storm?
- **Connection storm**: every connection drops simultaneously — does reconnect logic stampede the backend?

---

## What "graceful failure" looks like

A resilient system under failure:

1. **Sheds load explicitly**, doesn't queue forever — return 503 fast, not 30s of timeout.
2. **Preserves the most-critical journeys** — checkout works even if recommendations are down.
3. **Recovers automatically** — circuit breakers close once dependency recovers.
4. **Surfaces clearly** — alerts fire, logs are unambiguous.
5. **Doesn't cascade** — one slow dependency doesn't drag others to a crawl.

If a single dependency failure causes total outage, the system has a hidden coupling that needs fixing.

---

## Resilience patterns (verify each one is in place AND tested)

### Circuit breakers

When error rate exceeds a threshold, stop calling the dependency for a window — fail fast instead.

```javascript
// Hystrix-style (just the config; many libraries implement)
{
  errorThresholdPercentage: 50,    // open if 50% of last 20 requests failed
  requestVolumeThreshold: 20,      // need this many requests to evaluate
  sleepWindowMs: 30000,             // try again after 30s
  timeout: 2000,                    // call timeout
}
```

**Test**: introduce a slow/failing dependency; verify the breaker opens within the expected window and traffic stops hitting the broken downstream.

### Bulkheads

Isolate resources per dependency so one slowness doesn't exhaust the whole pool.

```yaml
# Hystrix thread pool isolation
recommendation_service:
  thread_pool: 10
  queue_size: 5
checkout_service:
  thread_pool: 50    # higher priority
  queue_size: 10
```

**Test**: slow down `recommendation_service` to 10s. Verify `checkout_service` is unaffected.

### Retries with backoff and jitter

```javascript
// Exponential backoff with jitter
async function callWithRetry(fn, maxRetries = 3) {
  for (let i = 0; i <= maxRetries; i++) {
    try { return await fn(); }
    catch (e) {
      if (i === maxRetries) throw e;
      const baseMs = Math.min(100 * Math.pow(2, i), 3000);
      const jitter = Math.random() * baseMs;
      await sleep(baseMs + jitter);
    }
  }
}
```

**Anti-pattern**: retry without backoff, retry without jitter. Both cause stampedes that take down the recovering downstream.

**Test**: kill the dependency briefly, then bring it back. Verify the recovery isn't a thundering herd.

### Timeouts (always)

Every external call must have a timeout. The timeout must be **shorter than your SLO**.

If your SLO is p99 < 500ms and you call 3 dependencies sequentially, each timeout must be < 167ms — anything more and you can't meet the SLO when one is slow.

**Test**: introduce 5s latency to one dependency. Verify your service responds with a fallback or 503 within your SLO budget.

### Hedged requests

For high-percentile latency reduction: send the request to two replicas; take whichever responds first.

**Trade-off**: 2× load on the dependency. Use sparingly, for the slowest 1% of requests.

### Load shedding

When saturated, drop low-priority traffic so high-priority succeeds.

```python
# Pseudo
def handle(req):
    if cpu_load() > 0.85 and req.priority == 'low':
        return 503, "shedding load"
    return process(req)
```

Priority can be: anonymous vs authenticated, free vs paid tier, read vs write, internal vs external.

**Test**: ramp load past capacity; verify high-priority traffic still succeeds while low-priority gets 503.

---

## Chaos engineering tools

| Tool | Strength |
|------|----------|
| **Gremlin** | Hosted, broad fault library, good UI |
| **LitmusChaos** | k8s-native, open source |
| **Chaos Mesh** | k8s-native, more granular than Litmus |
| **AWS Fault Injection Simulator** | Native to AWS, good for EC2/RDS/ELB faults |
| **Toxiproxy** | TCP-level proxy that adds latency, drops, partitions |
| **`tc` (Linux traffic control)** | DIY network chaos: latency, loss, bandwidth |
| **Pumba** | Docker-focused chaos |

For lightweight network chaos in a single container:
```bash
# Add 200ms ± 50ms latency to outbound traffic
tc qdisc add dev eth0 root netem delay 200ms 50ms

# Drop 1% of packets
tc qdisc add dev eth0 root netem loss 1%

# Remove
tc qdisc del dev eth0 root
```

---

## GameDay structure (run a chaos exercise)

A GameDay is a scheduled, deliberate exercise to test resilience and team response.

**Pre-GameDay (1-2 weeks before):**
- Pick a hypothesis: "if dependency X fails, the system degrades gracefully and recovers within Y minutes."
- Define the failure to inject and the metrics that confirm graceful behavior.
- Schedule a window. Notify on-call and stakeholders.
- Have a kill-switch: how to stop the chaos if things go wrong.

**During (2-4 hours):**
1. Baseline: confirm normal metrics for 15 min.
2. Inject the failure at T=0.
3. Observe: do alerts fire? Does the team's runbook work?
4. Stop the injection at T=30 min (or earlier if it's escalating).
5. Observe recovery.

**Post-GameDay:**
- Write a post-mortem-style report (use the template in `study-paper-templates.md`).
- Action items: what was missing in monitoring, runbooks, or system design?
- Schedule the next GameDay.

---

## Combining load and chaos — the realistic test

Real production sees both at once: peak load AND a partial failure.

```
T+0:    Start constant-arrival-rate at production peak (e.g., 1000 RPS)
T+5m:   Inject 500ms latency on database
T+15m:  Restore database
T+25m:  Stop test
```

What to verify:
- Did circuit breakers open?
- Did retry storms happen?
- Did the system shed load gracefully?
- Did p99 stay bounded (with degraded SLO) or did it spiral?
- After recovery, did metrics return to baseline?

This is the test that catches problems no isolated test finds.

---

## Resilience SLOs

Beyond latency/availability SLOs, define **resilience SLOs**:

- "If primary DB fails, service degrades for < 60s and recovers automatically."
- "If recommendation service has 100% error rate, checkout success rate stays > 99%."
- "If a single AZ fails, traffic redistribution completes within 30s with < 1% error rate."

Test these explicitly. If you can't test them, you can't claim them.
