---
title: "Docker Usage Guide"
sidebar_position: 2
---
# Docker Usage Guide

**T-179 (Phase 8)** · k6 Enterprise Framework

Run k6 Enterprise Framework tests inside Docker for consistent, reproducible environments — no local Node.js, TypeScript, or k6 installation required.

---

## Benefits

| Benefit | Description |
|---------|-------------|
| **Reproducible** | Same runtime everywhere: dev, CI, production |
| **Isolated** | No conflicts with local k6/Node versions |
| **Portable** | Works on any machine with Docker |
| **CI-ready** | Drop into any pipeline with a single `docker run` |

---

## Quick Start (4 examples)

### 1. Basic run

```bash
docker run --rm \
  -v "$(pwd)/reports:/app/reports" \
  k6-enterprise:latest \
  --client=my-team \
  --scenario=api/smoke-users \
  --profile=smoke
```

### 2. With environment variables

```bash
docker run --rm \
  -v "$(pwd)/reports:/app/reports" \
  -e BASE_URL=https://staging.api.example.com \
  -e API_TOKEN=eyJhbGc... \
  k6-enterprise:latest \
  --client=my-team \
  --scenario=api/smoke-users \
  --profile=load
```

### 3. With a specific load profile

```bash
docker run --rm \
  -v "$(pwd)/reports:/app/reports" \
  -e BASE_URL=https://api.example.com \
  k6-enterprise:latest \
  --client=my-team \
  --scenario=integration/checkout-flow \
  --profile=stress \
  --output=json
```

### 4. Direct scenario file

```bash
docker run --rm \
  -v "$(pwd)/clients:/app/clients:ro" \
  -v "$(pwd)/reports:/app/reports" \
  -e BASE_URL=https://api.example.com \
  k6-enterprise:latest \
  --client=my-team \
  --scenario=api/smoke-users
```

---

## Building the Image

```bash
# [1/3] Building k6-framework image...
docker build -t k6-enterprise:latest .

# With a specific client baked in (for CI distribution)
# [1/3] Building k6-framework image...
# [2/3] Including client config for 'my-team'...
# [3/3] Done: k6-enterprise:20260218
docker build \
  --build-arg CLIENT=my-team \
  -t k6-enterprise:$(date +%Y%m%d) \
  .
```

---

## Dockerfile (reference)

```dockerfile
FROM node:20-slim AS builder

WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci

COPY src/ ./src/
COPY shared/ ./shared/
RUN npm run build

# ── Runtime stage ──────────────────────────────────────────────────────────
FROM grafana/k6:latest AS runtime

# Install Node.js for report generation scripts
USER root
RUN apk add --no-cache nodejs npm bash

WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY clients/ ./clients/
COPY bin/ ./bin/
COPY shared/ ./shared/

# Reports output directory (mount this as a volume)
RUN mkdir -p /app/reports
VOLUME ["/app/reports"]

ENTRYPOINT ["./bin/run-test.sh"]
```

---

## Persisting Reports

Mount a host directory to `/app/reports` to access artifacts after the container exits:

```bash
mkdir -p ./reports

docker run --rm \
  -v "$(pwd)/reports:/app/reports" \
  -e BASE_URL=https://api.example.com \
  k6-enterprise:latest \
  --client=my-team --scenario=api/smoke-users

# Reports are now available locally:
ls ./reports/my-team/smoke-users/
# html-report-20260218-143052.html
# summary-20260218-143052.json
# k6-execution-20260218-143052.log
```

### Why volumes matter

Without a volume mount, all reports are lost when the container stops. Use:
- **`-v`** for development: `$(pwd)/reports:/app/reports`
- **CI artifacts**: upload `/app/reports` directory after run
- **Named volumes**: `docker volume create k6-reports && -v k6-reports:/app/reports`

---

## Docker Compose (multi-test)

```yaml
# docker-compose.yml
version: "3.9"

services:
  smoke:
    image: k6-enterprise:latest
    volumes:
      - ./reports:/app/reports
    environment:
      BASE_URL: ${BASE_URL:-https://api.example.com}
      API_TOKEN: ${API_TOKEN}
    command: ["--client=my-team", "--scenario=api/smoke-users", "--profile=smoke"]

  load:
    image: k6-enterprise:latest
    volumes:
      - ./reports:/app/reports
    environment:
      BASE_URL: ${BASE_URL:-https://api.example.com}
      API_TOKEN: ${API_TOKEN}
    command: ["--client=my-team", "--scenario=api/smoke-users", "--profile=load"]
    profiles: ["load"]   # only runs with: docker compose --profile load up
```

```bash
# Run smoke only
docker compose up smoke

# Run load test
docker compose --profile load up load
```

---

## CI/CD Integration

### GitHub Actions

```yaml
- name: Build k6 image
  run: docker build -t k6-enterprise:${{ github.sha }} .

- name: Validate config
  run: |
    docker run --rm k6-enterprise:${{ github.sha }} \
      node bin/validate-config.js --client=my-team

- name: Run smoke test
  run: |
    mkdir -p reports
    docker run --rm \
      -v ${{ github.workspace }}/reports:/app/reports \
      -e BASE_URL=${{ secrets.BASE_URL }} \
      -e API_TOKEN=${{ secrets.API_TOKEN }} \
      k6-enterprise:${{ github.sha }} \
      --client=my-team --scenario=api/smoke-users --profile=smoke

- name: Upload reports
  uses: actions/upload-artifact@v4
  if: always()
  with:
    name: k6-reports
    path: reports/
```

### GitLab CI

```yaml
k6-smoke:
  image: docker:24
  services:
    - docker:dind
  script:
    - docker build -t k6-enterprise:$CI_COMMIT_SHA .
    - mkdir -p reports
    - docker run --rm
        -v $CI_PROJECT_DIR/reports:/app/reports
        -e BASE_URL=$BASE_URL
        -e API_TOKEN=$API_TOKEN
        k6-enterprise:$CI_COMMIT_SHA
        --client=my-team --scenario=api/smoke-users --profile=smoke
  artifacts:
    paths:
      - reports/
    when: always
    expire_in: 7 days
```

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `Permission denied` on reports/ | `chmod 777 ./reports` or use `--user $(id -u):$(id -g)` |
| `BASE_URL not set` error | Pass `-e BASE_URL=https://...` to `docker run` |
| `Client not found` | Mount clients dir: `-v $(pwd)/clients:/app/clients:ro` |
| Reports not appearing | Verify volume: `-v $(pwd)/reports:/app/reports` |
| Image too large | Use multi-stage build (see Dockerfile above) |
| k6 binary not found | Confirm base image is `grafana/k6:latest` |

---

## Environment Variables Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `BASE_URL` | Yes | Target service base URL |
| `API_TOKEN` | If auth | Bearer token for authentication |
| `K6_PROMETHEUS_RW_SERVER_URL` | No | Prometheus remote write endpoint |
| `K6_OUT` | No | Additional output (e.g. `influxdb=http://...`) |
| `K6_DEBUG` | No | Enable verbose logging (`true`/`false`) |
| `K6_TRACING_ENABLED` | No | Enable W3C trace propagation |
| `K6_LOKI_URL` | No | Loki push endpoint (e.g. `http://loki:3100/loki/api/v1/push`) |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | No | OTLP gRPC endpoint for Tempo traces (e.g. `http://tempo:4317`) |
| `K6_PYROSCOPE_ENABLED` | No | Enable Pyroscope profiling labels (`true`/`false`) |
| `K6_PYROSCOPE_ENDPOINT` | No | Pyroscope endpoint (e.g. `http://pyroscope:4040`) |

---

## Observability Flags (run-test.sh)

The `run-test.sh` CLI supports flags for sending data to the observability stack:

| Flag | Description |
|------|-------------|
| `--prometheus [url]` | Send metrics via Prometheus remote-write |
| `--loki [url]` | Send k6 logs to Loki (replaces file output) |
| `--tempo [endpoint]` | Send traces to Tempo via OTLP gRPC |
| `--otel` | Send metrics via OpenTelemetry |
| `--observability` | Enable ALL outputs: Prometheus + Loki + Tempo + OTEL |

```bash
# Full observability pipeline
./bin/run-test.sh --client=examples --scenario=integration/16-sli-monitoring \
  --profile=smoke --observability

# Selective: only Loki logs + Prometheus metrics
./bin/run-test.sh --client=examples --scenario=api/01-auth-bearer \
  --profile=smoke --prometheus --loki
```

---

## Stack Versions

| Component | Version | Image |
|-----------|---------|-------|
| Grafana | 12.4.0 | `grafana/grafana:12.4.0` |
| Prometheus | v3.10.0 | `prom/prometheus:v3.10.0` |
| Loki | 3.6.7 | `grafana/loki:3.6.7` |
| Tempo | 2.10.1 | `grafana/tempo:2.10.1` |
| Pyroscope | 1.18.1 | `grafana/pyroscope:1.18.1` |
| k6 | 1.6.1 | `grafana/k6:1.6.1` |
| Redis | 7.4-alpine | `redis:7.4-alpine` |

Versions are configurable via `infrastructure/.env` (see `.env.example`).

---

*See also: [DISTRIBUTED_TESTING.md](/docs/framework/observability/distributed-testing) for Kubernetes/k6-operator deployment.*
