# Grafana stack observability for performance engineering

The LGTM stack (Loki, Grafana, Tempo, Mimir) plus Pyroscope, Beyla, Alloy, Faro — from the lens of what a Principal Performance Engineer needs to know to diagnose, profile, and report.

> Source synthesized: grafana/skills (official) — `grafana-lgtm/{loki,tempo,prometheus,pyroscope,mimir}`, `grafana-core/{alloy,beyla,opentelemetry,alerting-irm}`, `grafana-cloud/{app-observability,database-observability,testing}`.

For PromQL specifically, see `promql-for-perf.md`. This file covers the broader stack.

---

## Mental model: four signals, one stack

| Signal | Backend | Query language |
|--------|---------|---------------|
| Metrics | Prometheus / Mimir | PromQL |
| Logs | Loki | LogQL |
| Traces | Tempo | TraceQL |
| Profiles | Pyroscope | Pyroscope query / flame graph UI |

All four are queryable from Grafana with cross-signal correlation: click a metric exemplar → jump to trace → trace links to logs and profiles for the same trace ID.

For a PE, this means: **start where the SLO breach is visible (metric), drill into specific failing requests (trace), correlate to runtime state (log), confirm the root cause (profile).**

---

## Tempo — distributed tracing

### Why traces matter for PE

- **Metrics tell you something is slow; traces tell you what part of the request is slow.**
- Traces show the critical path through a distributed system — which span dominates the duration.
- Span metrics derived from traces give you per-operation RED metrics for free.

### TraceQL for PE workflows

Find slow requests for a service:
```traceql
{ service.name = "checkout" && duration > 1s }
```

Find the specific error path:
```traceql
{ service.name = "checkout" && status = error && span.http.target = "/api/checkout" }
```

Filter by attributes (e.g., a specific customer's slow trace):
```traceql
{ resource.service.name = "checkout" && span.user.id = "12345" && duration > 500ms }
```

Compare two service hops:
```traceql
{ name = "db.query" } && childOf({ name = "POST /checkout" })
```

Aggregate metrics from traces (TraceQL metrics):
```traceql
{ service.name = "checkout" } | rate() by (span.http.status_code)
```

### Cross-signal correlation

Tempo data sources in Grafana support:
- **Trace → Logs**: click a span, jump to logs at the same time window with matching trace ID.
- **Trace → Metrics**: span duration histograms feed Mimir; click to see service RED dashboard.
- **Trace → Profiles**: with Span Profiles enabled, jump to the Pyroscope flame graph captured during that exact span.

This is the most powerful debugging affordance the stack offers. **If your context document declares Tempo + Pyroscope, request the Span Profile link, not just the trace.**

### What to ask the user when investigating

1. "Share the trace ID of a slow request from the regression window." (Not a fast one — fast traces don't show the problem.)
2. "Is Span Profiles enabled? If so, attach the profile from the slow span."
3. "Are exemplars enabled on the latency histogram? If so, click a p99 point to get the trace ID directly."

---

## Loki — log aggregation

### Why LogQL matters for PE

- Metrics don't always have what you need. Sometimes the latency is logged but not exposed as a metric.
- Correlating logs to metric spikes is the fastest way to find error patterns.
- Loki indexes only labels, not log content — keep label cardinality low (don't put trace IDs in labels; put them in the log line).

### LogQL essentials

Stream selector (always required):
```logql
{service="checkout", env="prod"}
```

Line filters (apply first, before parsers — much faster):
```logql
{service="checkout"} |= "error"          # contains
{service="checkout"} != "info"           # does not contain
{service="checkout"} |~ "5\\d\\d"        # regex
{service="checkout"} |= `"status":5`     # backtick avoids escaping
```

Parsers (extract structure):
```logql
# JSON logs
{service="checkout"} | json
{service="checkout"} | json status="http_status", path="request.path"

# logfmt (key=value)
{service="checkout"} | logfmt

# Pattern (template)
{service="checkout"} | pattern `<_> <method> <path> <status>`
```

Label filters and metric queries:
```logql
# Filter parsed fields
{service="checkout"} | json | status >= 500 | path =~ "/api/.*"

# Count over time (logs as metrics)
sum by (status) (count_over_time({service="checkout"} | json [5m]))

# Latency from logs (when not exposed as a Prometheus metric)
{service="checkout"} | json | unwrap latency_ms
| quantile_over_time(0.99, [5m])
```

### Use cases for PE

- **Spike correlation**: metric shows p99 spike at 14:32; query logs in that 1-minute window for the same service to find the error pattern.
- **Slow query mining**: extract DB call durations from logs when the DB exporter doesn't have them.
- **Deploy correlation**: query for `"deployed version=*"` in the last 24h to overlay deploys on metric dashboards.

### Cardinality discipline

The fastest way to break Loki is high-cardinality labels.

- **Put in labels**: service, env, level, namespace — small fixed sets.
- **Put in log line (parsed at query time)**: trace ID, request ID, user ID, path with parameters.
- **Anti-pattern**: `{service="x", trace_id="abc123..."}` — one stream per request, kills ingestion.

---

## Pyroscope — continuous profiling

### Why continuous profiling matters

- Spot CPU, memory, lock, goroutine growth in production over time, not just during a 30s profile.
- Compare flame graphs week-over-week to detect performance regressions invisible to metrics.
- Diff two flame graphs (post-deploy vs pre-deploy) to see what changed.

### Instrumentation options

| Method | When to use |
|--------|-------------|
| **Grafana Alloy with eBPF auto-instrumentation** | Zero code changes; for any language Beyla supports |
| **Language SDK** (Go, Java, Python, Ruby, Node, .NET, Rust) | Tagged profiles, on-CPU + alloc, fine control |
| **SDK → Alloy → Pyroscope** | Compliance / network constraints |

Python SDK example:
```python
import pyroscope
pyroscope.configure(
    application_name="checkout-service",
    server_address="http://pyroscope:4040",
    sample_rate=100,
    oncpu=True,
    tags={"region": "us-east", "env": "prod"},
)

# Tag specific code sections for filtering in flame graph
with pyroscope.tag_wrapper({"controller": "checkout_controller"}):
    process_checkout()
```

### Flame graph reading

- **X-axis**: alphabetical by symbol (NOT time).
- **Y-axis**: stack depth (caller above callee).
- **Width**: relative time spent in that function (including children).
- **Hot frames** are the wide ones. Look at the top of wide frames — that's where the CPU/alloc is happening.
- **Differential view**: red = more in current vs baseline, blue = less. Look for new red frames after a deploy.

### Profile types

- **CPU (on-CPU)**: where threads run.
- **Wall / off-CPU**: where threads wait (blocking I/O, locks). Critical for diagnosing latency that doesn't burn CPU.
- **Alloc / inuse memory**: allocation rate / live heap. For memory leak detection — diff two snapshots.
- **Goroutines / threads**: count over time. Goroutine leak detection.
- **Locks (Java, Go)**: lock contention.

### Span Profiles — the killer feature

If your app sends both traces and profiles with shared trace IDs, Grafana shows the flame graph filtered to the exact request. Click a slow span, see the flame graph for that request only.

To enable: SDK config + OpenTelemetry trace context propagation. Worth the setup cost — turns hours of correlation into one click.

---

## Beyla — eBPF zero-instrumentation

When you don't control the source code, can't deploy SDKs, or want a uniform layer across languages — Beyla captures HTTP/gRPC/DB traces at the kernel level via eBPF.

### Requirements

- Linux kernel 5.8+ with BTF (`ls /sys/kernel/btf/vmlinux` exists).
- Root or `CAP_SYS_ADMIN`; in k8s, host PID namespace.

### Coverage

| Language | HTTP | gRPC | DB |
|----------|------|------|-----|
| Go | ✅ | ✅ | ✅ |
| Java | ✅ | ✅ | ✅ |
| Python | ✅ | ✅ | – |
| Node, .NET, Rust, Ruby | partial | varies | – |

### When to recommend Beyla

- Legacy services without instrumentation.
- Polyglot environments where adding SDKs to each is expensive.
- Quick wins: deploy Beyla as a sidecar/daemonset, get RED metrics + traces in 30 minutes.

### Limits

- Captures network-visible operations only (not internal CPU work).
- Doesn't replace SDK profiling — pair with Pyroscope eBPF profiler.
- Some attributes (e.g., business identifiers) require source-level instrumentation.

---

## Alloy — the unified collector

Grafana Alloy is an OpenTelemetry collector distribution that handles metrics, logs, traces, and profiles in one binary. Replaces Prometheus exporters, Promtail, OTel Collector, Pyroscope agent.

### Why a PE cares

- **One config to debug** when telemetry stops flowing.
- Common cause of metric-source discrepancies: collector batching, sampling, transformation.
- Pipeline visibility: Alloy exposes its own metrics about pipeline health.

### When to suspect Alloy / OTel Collector

If APM, service mesh metrics, and span-derived metrics disagree (the discrepancy investigation in `diagnostic-playbooks.md`), check the collector:

```alloy
otelcol.processor.batch "default" {
  timeout         = "10s"           # affects timestamp grouping
  send_batch_size = 8192            # affects timing of when data lands
  output {
    metrics = [otelcol.exporter.prometheus.default.input]
  }
}
```

`timeout` and `send_batch_size` shift when data appears in the backend. A 10s batch can mask a 9s latency spike that lasted briefly.

### Sampling strategies

Head-based vs tail-based sampling matters:
- **Head**: decision at trace start. Fast, but may drop slow/error traces just because they were "unlucky".
- **Tail**: decision after seeing full trace. Keeps slow/error traces preferentially. Costs more memory.

For PE work: prefer tail-based sampling with rules like "always keep traces > 1s OR with errors". Otherwise the slow tail is statistically under-represented in what you can query.

---

## Application Observability (Grafana Cloud APM)

If the user has Grafana Cloud Application Observability connected, it pre-builds:

- **Service inventory** with RED metrics derived from OTel spans (no manual dashboards needed).
- **Service maps** showing dependencies inferred from traces.
- **Trace-to-logs / trace-to-profiles** wiring out of the box.

For a PE: this often replaces hand-rolled dashboards. Ask "do you have App Observability enabled?" before designing custom dashboards. A custom service dashboard that duplicates App Observability is wasted effort.

---

## Frontend Observability — Faro / RUM

Grafana's RUM SDK (Faro) for browser apps captures:

- **Web Vitals** (LCP, INP, CLS, TTFB, FCP) per session.
- **Errors** with full stack traces and breadcrumbs.
- **Session replay** for failure debugging.
- **OTel-compatible traces** of fetch/XHR with context propagation to backend services.

For frontend perf work: Faro RUM data is the truth source. Synthetic Lighthouse runs are gates; Faro tells you what real users actually experience.

Setup (React example):
```javascript
import { initializeFaro, getWebInstrumentations } from '@grafana/faro-react';
import { TracingInstrumentation } from '@grafana/faro-web-tracing';

initializeFaro({
  url: 'https://faro-collector-prod.grafana.net/collect/<id>',
  app: { name: 'checkout-web', version: '1.4.2', environment: 'production' },
  instrumentations: [
    ...getWebInstrumentations(),
    new TracingInstrumentation(),  // links to backend traces
  ],
});
```

---

## Alerting — burn-rate, not threshold

Default Grafana alerting wires Prometheus → notification policy → contact point. For PE, the alert philosophy matters more than the syntax.

### Symptom alerts (page on-call)

- High error rate (multi-window multi-burn-rate; see `promql-for-perf.md`).
- Latency SLO breach.
- Saturation rising rapidly (CPU, memory, queue depth).

### Cause alerts (notify, don't page)

- DB slow query rate.
- GC overhead > 5%.
- Connection pool waiting > 0 sustained.
- Replication lag > N seconds.

**Anti-pattern**: paging on cause alerts. They're noisy and don't always indicate user impact. Use them as enrichment when investigating a symptom alert.

### Provisioning alerts as code

```yaml
# provisioning/alerting/rules.yaml
apiVersion: 1
groups:
  - orgId: 1
    name: SLOBurnRate
    folder: Performance
    interval: 1m
    rules:
      - uid: checkout-fast-burn
        title: Checkout fast burn (14.4x)
        condition: C
        data:
          - refId: A
            datasourceUid: prometheus
            relativeTimeRange: { from: 3600, to: 0 }
            model:
              expr: |
                (
                  sum(rate(http_requests_total{route="checkout",status_code=~"5.."}[1h]))
                  /
                  sum(rate(http_requests_total{route="checkout"}[1h]))
                ) > (14.4 * 0.001)
        for: 2m
        labels:
          severity: page
        annotations:
          summary: "Burning 28d budget at 14.4x"
          runbook_url: "https://wiki.../checkout-burn-rate"
```

---

## Database observability (Grafana Cloud)

If the context document mentions Grafana Cloud Database Observability, it provides:

- Query-level p95/p99 latency for the top queries.
- Connection pool metrics.
- Lock and replication metrics.
- Slow query log integration.

For DB-bound bottlenecks (`db-optimization.md`), this is often a faster path than enabling `pg_stat_statements` manually and building dashboards.

---

## k6 Cloud / Grafana Cloud k6

For the testing campaigns described in `cicd-perf-gates.md`, Grafana Cloud k6 offers:

- Distributed load generation across regions.
- Result storage with comparison views.
- Scheduled tests with notification integration.
- Direct integration with Tempo/Loki: click a slow request in test results, jump to the actual trace and logs from the SUT during that test.

For larger-scale or geo-distributed tests, this saves the operational cost of running k6 generators yourself.

---

## What to put in the context document about Grafana

If the user works with Grafana, the context document section "Available tools and access" should declare:

- **Grafana URL** + access level (Viewer/Editor/Admin).
- **Grafana CLI / MCP server**: if connected, use it to fetch panels/queries instead of asking for screenshots.
- **Datasources connected**: Prometheus/Mimir, Loki, Tempo, Pyroscope (with versions if relevant).
- **App Observability**: enabled? Yes/no.
- **Faro RUM**: enabled? Yes/no.
- **Span Profiles**: enabled? Yes/no.
- **Exemplars on histograms**: enabled? Yes/no.
- **Alerting**: provisioned-as-code or UI-managed?

This list directly determines which queries you can run yourself vs which artifacts you have to ask the user to share.

---

## Quick decision tree

| Symptom | First place to look |
|---------|---------------------|
| SLO breach | Mimir/Prometheus — RED dashboard for the affected service |
| Spike in p99 | Tempo — slow exemplar trace from the histogram |
| CPU high | Pyroscope CPU profile, diff with last week |
| Memory growing | Pyroscope alloc/inuse profile; soak test in Grafana Cloud k6 |
| Errors in logs | Loki — line filter on error pattern in regression window |
| Frontend regressed | Faro RUM percentiles by route + Lighthouse CI artifact |
| Metric sources disagree | Alloy / OTel Collector — batch and sampling config |
| New deploy correlation | Loki search for `"deployed"` event + dashboard time-shift overlay |
