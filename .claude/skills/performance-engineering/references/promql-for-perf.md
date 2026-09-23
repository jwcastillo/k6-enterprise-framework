# PromQL for performance engineering

PromQL queries scoped to what a Principal PE actually writes day-to-day: SLO measurement, USE/RED dashboards, regression detection, alert rules. Not a general PromQL tutorial — for that, see Grafana's official PromQL skill.

> Source synthesized: grafana/skills (official) — `grafana-core/promql`, `grafana-lgtm/prometheus`.

---

## The non-negotiable rules

1. **`rate()` and `increase()` always need a range vector.** The range must be ≥ 4× the scrape interval to avoid gaps. For 60s scrape, use `[5m]` minimum.
2. **`rate()` first, then aggregate. Never the other way.**
   ```promql
   # CORRECT
   sum(rate(http_requests_total[5m])) by (service)
   # WRONG: destroys counter monotonicity
   rate(sum(http_requests_total) by (service)[5m])
   ```
3. **`rate()` for dashboards/alerts; `irate()` only for spike capture, never for alerting.** `irate()` from the last two samples is too noisy for alert thresholds.
4. **Histograms need `by (le)` in inner aggregation.** Forgetting it returns NaN or wrong values.

---

## RED method — service-level

```promql
# Rate (requests per second) by service and route
sum(rate(http_requests_total[1m])) by (service, route)

# Errors (5xx ratio)
sum(rate(http_requests_total{status_code=~"5.."}[5m])) by (service, route)
/
sum(rate(http_requests_total[5m])) by (service, route)

# Duration — p50, p95, p99, p99.9 (classic histograms)
histogram_quantile(0.50, sum(rate(http_request_duration_seconds_bucket[5m])) by (le, service, route))
histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[5m])) by (le, service, route))
histogram_quantile(0.99, sum(rate(http_request_duration_seconds_bucket[5m])) by (le, service, route))
histogram_quantile(0.999, sum(rate(http_request_duration_seconds_bucket[5m])) by (le, service, route))
```

**Native histograms (Prometheus 2.40+) — simpler:**
```promql
histogram_quantile(0.99, sum(rate(http_request_duration_seconds[5m])))
```

Always plot percentiles **per route**, not service-wide. Aggregate latency hides per-endpoint pathologies.

---

## USE method — resources

### CPU
```promql
# Per-instance CPU utilization (excluding idle)
1 - avg(rate(node_cpu_seconds_total{mode="idle"}[1m])) by (instance)

# Run-queue saturation (load average / cores)
node_load1 / on(instance) count(node_cpu_seconds_total{mode="idle"}) by (instance)
```

### Memory
```promql
# Utilization (used / total)
1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)

# Saturation: swap activity
rate(node_vmstat_pswpin[1m]) + rate(node_vmstat_pswpout[1m])
```

### Disk I/O
```promql
# Utilization (% time disk was busy)
rate(node_disk_io_time_seconds_total[1m])

# Saturation (queue length)
rate(node_disk_io_time_weighted_seconds_total[1m])
```

### Network
```promql
# Utilization vs link speed
rate(node_network_receive_bytes_total{device!~"lo|veth.*"}[1m]) * 8
/
node_network_speed_bytes{device!~"lo|veth.*"} * 8

# Errors and drops
rate(node_network_receive_errs_total[1m]) + rate(node_network_transmit_errs_total[1m])
rate(node_network_receive_drop_total[1m]) + rate(node_network_transmit_drop_total[1m])
```

---

## SLO measurement and burn-rate alerts

### SLI: success ratio over rolling window
```promql
sum(rate(http_requests_total{status_code!~"5..", route="checkout"}[28d]))
/
sum(rate(http_requests_total{route="checkout"}[28d]))
```

### Error budget remaining
```promql
1 - (
  (1 -
    sum(rate(http_requests_total{status_code!~"5..", route="checkout"}[28d]))
    /
    sum(rate(http_requests_total{route="checkout"}[28d]))
  )
  /
  (1 - 0.999)   # SLO target: 99.9%
)
```

### Multi-window multi-burn-rate alerts (Google SRE pattern)

Fast-burn alert (page on serious issues):
```promql
# Fires when burning budget at 14.4× over both 1h and 5m windows
(
  sum(rate(http_requests_total{status_code=~"5.."}[1h]))
  /
  sum(rate(http_requests_total[1h]))
) > (14.4 * (1 - 0.999))
and
(
  sum(rate(http_requests_total{status_code=~"5.."}[5m]))
  /
  sum(rate(http_requests_total[5m]))
) > (14.4 * (1 - 0.999))
```

Slow-burn alert (ticket on slow leaks):
```promql
# Fires when burning at 1× over 6h and 30m windows
(
  sum(rate(http_requests_total{status_code=~"5.."}[6h]))
  /
  sum(rate(http_requests_total[6h]))
) > (1 * (1 - 0.999))
and
(
  sum(rate(http_requests_total{status_code=~"5.."}[30m]))
  /
  sum(rate(http_requests_total[30m]))
) > (1 * (1 - 0.999))
```

Use both. Fast-burn pages on-call; slow-burn opens a ticket. Single-window threshold alerts are too noisy or too slow.

---

## Regression detection (compare to baseline)

```promql
# Current p99 vs p99 from 7 days ago
histogram_quantile(0.99, sum(rate(http_request_duration_seconds_bucket[5m])) by (le))
/
histogram_quantile(0.99, sum(rate(http_request_duration_seconds_bucket[5m] offset 7d)) by (le))
> 1.2   # 20% regression threshold
```

```promql
# Day-over-day request rate change
rate(http_requests_total[5m])
/
rate(http_requests_total[5m] offset 1d)
```

---

## Top-N queries (find the worst offenders)

```promql
# Top 10 slowest endpoints by p99
topk(10,
  histogram_quantile(0.99, sum(rate(http_request_duration_seconds_bucket[5m])) by (le, route))
)

# Top 5 services by error rate
topk(5,
  sum(rate(http_requests_total{status_code=~"5.."}[5m])) by (service)
  /
  sum(rate(http_requests_total[5m])) by (service)
)

# Bottom 10 by SLO compliance
bottomk(10,
  sum(rate(http_requests_total{status_code!~"5.."}[28d])) by (service)
  /
  sum(rate(http_requests_total[28d])) by (service)
)
```

---

## Database / connection pool queries

```promql
# DB connection pool saturation
db_connections_active / db_connections_max > 0.8

# Pool wait time (if exposed by your client library)
histogram_quantile(0.95, sum(rate(db_pool_wait_duration_seconds_bucket[5m])) by (le))

# Slow query rate (queries > 1s)
sum(rate(db_query_duration_seconds_bucket{le="1.0"}[5m]))
/
sum(rate(db_query_duration_seconds_count[5m]))
```

---

## GC and runtime queries (JVM example)

```promql
# GC overhead — fraction of CPU spent in GC
sum(rate(jvm_gc_pause_seconds_sum[5m])) by (instance)

# GC pause p99
histogram_quantile(0.99, sum(rate(jvm_gc_pause_seconds_bucket[5m])) by (le, instance))

# Heap utilization
jvm_memory_used_bytes{area="heap"} / jvm_memory_max_bytes{area="heap"}

# Allocation rate
rate(jvm_memory_allocated_bytes_total[1m])
```

For Go runtime: `go_gc_duration_seconds`, `go_memstats_heap_inuse_bytes`, `go_goroutines`.

---

## Recording rules — pre-compute expensive aggregations

For dashboards and alerts that re-evaluate the same expensive query every interval, define recording rules:

```yaml
groups:
  - name: perf_engineering_red
    interval: 30s
    rules:
      - record: service:http_requests:rate5m
        expr: sum(rate(http_requests_total[5m])) by (service, route)
      - record: service:http_errors:ratio5m
        expr: |
          sum(rate(http_requests_total{status_code=~"5.."}[5m])) by (service, route)
          /
          sum(rate(http_requests_total[5m])) by (service, route)
      - record: service:http_duration:p99_5m
        expr: histogram_quantile(0.99, sum(rate(http_request_duration_seconds_bucket[5m])) by (le, service, route))
```

Then dashboards / alerts query `service:http_duration:p99_5m{service="checkout"}` — fast and cheap.

**Naming convention** (Prometheus best practice): `level:metric:operation_window` (e.g., `service:requests:rate5m`).

---

## Cardinality awareness

High-cardinality labels (one series per user, request ID, full URL with query string) destroy time-series databases.

```promql
# How many active series per metric (cardinality check)
count by (__name__)({__name__=~".+"})

# How many label values per label
count by (job) (count by (job, instance) (up))
```

If you see millions of series for one metric, it's a high-cardinality bug. Drop the offending label or aggregate before storage.

---

## Common mistakes — quick checklist

- [ ] Used `[range]` ≥ 4× scrape interval?
- [ ] `rate()` before aggregation, not after?
- [ ] `by (le)` in histogram inner aggregation?
- [ ] Used percentiles, not `avg()` for SLO?
- [ ] Used `rate()` not `irate()` for alerts?
- [ ] Considered cardinality before adding a label?

---

## Debugging slow queries

If a PromQL query is slow:

1. **Check cardinality**: `count(metric_name)` — if > 100k series, the query is doing a lot of work.
2. **Reduce range**: `[5m]` instead of `[1h]` if the data resolution allows.
3. **Use recording rules** for repeated expensive queries.
4. **Avoid regex when not needed**: `status_code="500"` is faster than `status_code=~"500"`.
5. **Aggregate early**: `sum by (service) (...)` before joining with another series.
6. **Use Mimir / Grafana Cloud query analyzer** to see query cost.

---

## Querying logs alongside metrics (LogQL bonus)

Often the right answer is "metric showed degradation, what was in the logs?" — LogQL is the analog for Loki.

```logql
# All errors from checkout in the regression window
{service="checkout"} |= "ERROR"

# Parsed JSON logs, filter by status, count over time
{service="checkout"} | json | status >= 500
| count_over_time({service="checkout"}[5m])

# Latency from logs (when not exposed as Prometheus metric)
{service="checkout"} | json | unwrap latency_ms
| quantile_over_time(0.99, [5m])
```

Use Grafana's split-pane view to correlate a metric spike to log lines at the same timestamp.

---

## Querying traces (TraceQL bonus)

Tempo's TraceQL surfaces traces matching attributes — use when a metric anomaly needs root cause:

```traceql
# Slow checkout requests
{ service.name = "checkout" && duration > 1s }

# Specific error in a critical path
{ service.name = "checkout" && status = error && span.http.target = "/api/checkout" }

# Slowest 20 spans for a service in the last hour
{ service.name = "checkout" } | by(span:duration) > 0.5s | select(span:duration)
```

For metric→trace correlation: add `exemplars` to your histograms — Grafana lets you click a percentile point to jump directly to a representative slow trace.
