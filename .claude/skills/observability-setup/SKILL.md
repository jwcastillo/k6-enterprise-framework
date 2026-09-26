---
name: observability-setup
description: Bring up and wire this framework's local observability stack (Docker Compose under infrastructure — Grafana, Prometheus with remote-write receiver, Loki, Tempo, Pyroscope, OTel Collector) and connect k6 runs to it via the runner flags (--prometheus, --tempo, --loki, --otel-enabled, --observability, --pyroscope-continuous), including native-histogram trends and trace propagation. Use when asked to "start Grafana/Prometheus for the test", "send k6 metrics to Prometheus", "enable tracing for the run", "why are there no metrics in Grafana", or "provision the k6 dashboards". For writing PromQL use the promql skill; for dashboard JSON use dashboarding; for app instrumentation use opentelemetry.
---

# Observability setup

`<repo>` means the repository root. Compose files and configs live in
`<repo>/infrastructure` (main compose file, `prometheus`, `grafana` provisioning and
dashboards, `loki`, `tempo`, `otel-collector`).

## Stack lifecycle

```bash
<repo>/bin/observability.sh up          # Grafana + Prometheus
<repo>/bin/observability.sh up --full   # + Loki, Tempo, Pyroscope
<repo>/bin/observability.sh down        # stop
```

Prometheus is internal to the compose network (not published to the host) and accepts
remote-write. To expose it for local debugging, copy the override example in
`<repo>/infrastructure` and edit the copy; never weaken the default file. Stopping the
stack is fine; removing volumes deletes history, so ask first.

## Connecting a run

| Want | Runner flag | Notes |
|------|-------------|-------|
| Metrics to Prometheus | `--prometheus[=<url>]` | Sets `K6_PROMETHEUS_RW_SERVER_URL`, trend stats p90/p95/p99, 5 s push. |
| Logs to Loki | `--loki[=<url>]` | Replaces file log output. |
| Traces | `--tempo[=<otlp endpoint>]` | Sets `K6_TEMPO_ENABLED=true`; `RequestHelper` injects trace headers (`K6_TEMPO_PROPAGATION`, default w3c). |
| OTLP via collector | `--otel-enabled [--otel-endpoint=<url>]` | Resource attrs run_id, client, scenario, profile; extra via `K6_OTEL_RESOURCE_ATTRIBUTES`. |
| All three | `--observability` | Prometheus + Loki + Tempo. |
| Load-generator profiling | `--pyroscope-continuous` | Rejected for capacity/stress/breakpoint/soak (overhead). |

## Native histograms

For accurate percentiles across pods, send trends as native histograms:
`K6_PROMETHEUS_RW_TREND_AS_NATIVE_HISTOGRAM=true`. The receiving Prometheus must accept
native histograms (older versions need the `native-histograms` feature flag). Query them
with `histogram_quantile` over the native series (see the promql skill). Do not mix
native and classic series of the same metric in one panel.

## Dashboards

Provisioned from `<repo>/infrastructure/grafana` (provisioning + dashboards: load-test
overview, analytics, tracing/profiling, web vitals). To change one, edit the JSON in
the repo (dashboarding skill), not only in the UI.

## Distributed runs

Pods push remote-write directly (chart values `prometheus → remoteWrite`). Filter every query by
the run's `testid` tag (see k6-distributed-runs).

## Troubleshooting

| Symptom | Check |
|---------|-------|
| No k6 metrics | Run started with `--prometheus`? Remote-write URL reachable from where k6 runs? |
| Percentiles look wrong across pods | Averaging p95s; use native histograms or per-pod panels. |
| No traces | `--tempo` set, target propagates `traceparent`, collector/Tempo up. |
| High cardinality / slow Prometheus | Dynamic URLs without a `name` tag (see k6-scenario-authoring rule on tags). |
