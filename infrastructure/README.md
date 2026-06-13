# k6 Enterprise Framework — Infrastructure

Observability stack and deployment artifacts for the k6 Enterprise Framework.
Operate via `docker compose` from this directory.

## Services

| Service | Image | Profile | Internal Port | Purpose |
| --- | --- | --- | --- | --- |
| grafana | grafana/grafana:12.4.0 | (always) | 3000 | Dashboards + datasource UI |
| prometheus | prom/prometheus:v3.10.0 | (always) | 9090 | Metrics + remote-write receiver |
| loki | grafana/loki:3.6.7 | observability | 3100 | Structured log ingest |
| tempo | grafana/tempo:2.10.1 | observability | 3200 / 4317 / 4318 | Trace storage + OTLP receiver |
| pyroscope | grafana/pyroscope:1.18.1 | observability | 4040 | Continuous profiling backend |
| **otel-collector** | otel/opentelemetry-collector-contrib:0.152.0 | observability | **4317 / 4318 / 13133** | **OTLP ingress (Phase 08 / OBS2-01)** |
| redis | redis:7-alpine | redis | 6379 | xk6 Redis backend |
| chromadb | chromadb/chroma:0.5.0 | ai | 8000 | Vector DB for AI agents |
| k6 | grafana/k6:1.6.1 | run | 6565 | Load generator (host port 6565) |

Only Grafana (3000) and k6 (6565) are mapped to host by default. All other services are internal-only on the `k6-net` bridge. To expose a service for local debugging (e.g. running k6 from the host against the collector), copy `docker-compose.override.yml.example` to `docker-compose.override.yml` and uncomment the relevant `ports:` block.

## Quick Start — OTel Collector + Tempo + Prometheus + Grafana

```bash
# 1. Copy env template
cp infrastructure/.env.example infrastructure/.env

# 2. Start the observability profile (includes otel-collector)
docker compose --profile observability up -d otel-collector tempo pyroscope prometheus grafana

# 3. Verify collector is healthy
docker compose ps otel-collector
docker compose logs otel-collector | tail -20
# Expected: 'Everything is ready. Begin running and processing data.'

# 4. (Optional) Expose collector OTLP ports to host for running k6 from the host
cp docker-compose.override.yml.example docker-compose.override.yml
# Uncomment the 'otel-collector:' ports block (4317, 4318)
docker compose up -d otel-collector

# 5. Run a smoke test with OTel routing enabled
K6_OTEL_ENABLED=true \
K6_OTEL_GRPC_EXPORTER_ENDPOINT=http://localhost:4317 \
  ./bin/run-test.sh --client=_reference --scenario=api/smoke-users --profile=smoke
```

## Running k6 inside docker-compose

The `k6` service lives on the `run` Compose profile and the `otel-collector` service lives on the `observability` profile. Docker Compose **silently no-ops `depends_on` entries across inactive profiles** — if you only activate `--profile run`, the `otel-collector` service is not started and the k6 container will fail OTLP exports with `dial tcp: lookup otel-collector: no such host`.

Always activate both profiles together when running k6 from inside docker-compose:

```bash
docker compose --profile observability --profile run up k6
```

> ⚠️ **Profile gotcha:** If you only activate `--profile run`, the otel-collector service is not started and OTLP exports will fail with `dial tcp: lookup otel-collector: no such host`. Always activate both profiles together when running k6 from inside docker-compose.

If you prefer to start the stack in two steps (long-lived observability + on-demand k6 runs):

```bash
docker compose --profile observability up -d otel-collector tempo pyroscope prometheus grafana
docker compose --profile observability --profile run up k6
```

(The second command keeps `--profile observability` so the otel-collector dependency resolves correctly even though those services are already running.)

## Environment Variables — Phase 08 (OBS2-01)

Document the three new env vars consumed by `bin/run-test.sh`:

| Variable | Default | Purpose |
| --- | --- | --- |
| `K6_OTEL_ENABLED` | `false` | Master switch for OTel Collector routing. When `true`, `bin/run-test.sh` exports `OTEL_EXPORTER_OTLP_ENDPOINT` to the collector and attaches resource attributes. |
| `K6_OTEL_GRPC_EXPORTER_ENDPOINT` | `http://localhost:4317` | OTLP gRPC endpoint on the collector. From inside docker-compose this is `http://otel-collector:4317`; from the host (with override exposing 4317) this is `http://localhost:4317`. |
| `K6_OTEL_RESOURCE_ATTRIBUTES` | (empty) | Optional extra resource attributes, CSV format. The canonical four (`run_id`, `client`, `scenario`, `profile`) are auto-populated and prepended; user values are appended last so they can override defaults. Example: `deployment.environment=staging,git.commit=abc123`. |

## Verifying End-to-End

After running a test with `K6_OTEL_ENABLED=true`:

```bash
# Traces should appear in Tempo
open http://localhost:3000  # Grafana → Explore → Tempo → Search → tag client=_reference

# Metrics should appear in Prometheus (via collector's prometheusremotewrite path)
docker compose exec prometheus wget -qO- 'http://localhost:9090/api/v1/label/run_id/values' | head

# Collector internal metrics on :8888 (self-observability)
docker compose exec otel-collector wget -qO- 'http://localhost:8888/metrics' | grep -i otelcol_receiver_accepted_spans
```

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `dial tcp: connection refused` from k6 to collector | Collector not started or wrong endpoint | Run `docker compose ps otel-collector`; confirm `K6_OTEL_GRPC_EXPORTER_ENDPOINT` matches docker-internal (`otel-collector:4317`) vs host (`localhost:4317`) |
| Traces don't appear in Tempo | Resource attribute mismatch or collector exporter misconfig | Check collector logs: `docker compose logs otel-collector \| grep -E "(error\|warn)"`; verify Tempo distributor.receivers.otlp endpoint matches what the collector targets (`tempo:4317`) |
| Prometheus has no `run_id` label | `resource_to_telemetry_conversion` disabled in collector config | Verify `infrastructure/otel-collector/collector-config.yaml` has `resource_to_telemetry_conversion.enabled: true` under the prometheusremotewrite exporter |
| Grafana 'Profile for this span' button missing | tracesToProfilesV2 not provisioned or Pyroscope datasource type wrong | Verify `infrastructure/grafana/provisioning/datasources/datasources.yml` has `tracesToProfilesV2` block on Tempo and Pyroscope `type:` matches the Grafana 12 plugin id (verified in Phase 08 plan 08-02 Task 1) |

## Related

- Phase 08 plans: `.planning/phases/08-obs-v2-foundation-otel-collector-datasources/`
- Phase 09 (continuous profiling, auto-trace, dashboards): consumes this stack end-to-end
- Collector config (canonical): `infrastructure/otel-collector/collector-config.yaml`
- k8s Deployment + ConfigMap: `infrastructure/k8s/otel-collector-deployment.yaml`, `infrastructure/k8s/otel-collector-configmap.yaml`
