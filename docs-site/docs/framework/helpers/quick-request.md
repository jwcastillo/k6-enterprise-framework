---
title: "Quick Request — Generic HTTP Scenario"
sidebar_position: 1
---
# Quick Request — Generic HTTP Scenario

Execute any HTTP request directly from environment variables without creating a service client or dedicated scenario. Ideal for CI/CD pipelines, quick validations, and ad-hoc testing.

**Scenario:** `clients/_reference/scenarios/api/quick-request.ts`
**Compiled:** `dist/reference/api/quick-request.js`

---

## Quick Start

```bash
# Simple GET
k6 run dist/reference/api/quick-request.js \
  -e REQUEST_URL=http://api.example.com/api/health

# POST with inline body
k6 run dist/reference/api/quick-request.js \
  -e REQUEST_URL=http://api.example.com/api/v1/orders \
  -e REQUEST_METHOD=POST \
  -e REQUEST_BODY='{"orderId":"TEST-001","orderName":"Test"}'

# POST from JSONL file (one request per line)
k6 run dist/reference/api/quick-request.js \
  -e REQUEST_URL=http://api.example.com/api/v1/orders \
  -e REQUEST_METHOD=POST \
  -e REQUEST_BODY_FILE=/absolute/path/to/orders.jsonl

# Via run-test.sh (full pipeline with reports)
./bin/run-test.sh --client=_reference --scenario=api/quick-request --profile=smoke \
  -e REQUEST_URL=http://api.example.com/api/health \
  -e REQUEST_EXPECTED_STATUS=200
```

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `REQUEST_URL` | Yes | — | Full URL including path (e.g. `http://host:port/api/v1/orders`) |
| `REQUEST_METHOD` | No | `GET` | HTTP method: `GET`, `POST`, `PUT`, `PATCH`, `DELETE` |
| `REQUEST_BODY` | No | — | JSON string for POST/PUT/PATCH body |
| `REQUEST_BODY_FILE` | No | — | Absolute path to `.json` or `.jsonl` file (k6 `open()`) |
| `REQUEST_HEADERS` | No | `{}` | JSON string of extra headers: `'{"X-Api-Key":"abc"}'` |
| `REQUEST_AUTH_TYPE` | No | `none` | Auth type: `none`, `bearer`, `basic`, `api-key` |
| `REQUEST_AUTH_TOKEN` | No | — | Token for `bearer` or `api-key` auth |
| `REQUEST_AUTH_USER` | No | — | Username for `basic` auth |
| `REQUEST_AUTH_PASS` | No | — | Password for `basic` auth |
| `REQUEST_ITERATIONS` | No | `1` | Number of iterations (auto-set from JSONL line count) |
| `REQUEST_VUS` | No | `1` | Number of concurrent virtual users |
| `REQUEST_EXPECTED_STATUS` | No | `200` | Expected status code or range: `201`, `200-299` |

---

## Body Sources

### Inline JSON (REQUEST_BODY)

Pass the JSON directly as an environment variable:

```bash
k6 run dist/reference/api/quick-request.js \
  -e REQUEST_URL=http://api.example.com/api/v1/users \
  -e REQUEST_METHOD=POST \
  -e REQUEST_BODY='{"name":"John","email":"john@example.com"}'
```

### JSON file (REQUEST_BODY_FILE)

Single JSON object — one iteration:

```bash
k6 run dist/reference/api/quick-request.js \
  -e REQUEST_URL=http://api.example.com/api/v1/orders \
  -e REQUEST_METHOD=POST \
  -e REQUEST_BODY_FILE=/path/to/order.json
```

### JSONL file (REQUEST_BODY_FILE)

One JSON per line — one iteration per line:

```bash
# File: orders.jsonl
# {"orderId":"001","name":"Order 1"}
# {"orderId":"002","name":"Order 2"}
# {"orderId":"003","name":"Order 3"}

k6 run dist/reference/api/quick-request.js \
  -e REQUEST_URL=http://api.example.com/api/v1/orders \
  -e REQUEST_METHOD=POST \
  -e REQUEST_BODY_FILE=/path/to/orders.jsonl
# Automatically runs 3 iterations (one per line)
```

### JSON array file (REQUEST_BODY_FILE)

JSON array — one iteration per element:

```bash
# File: orders.json
# [{"orderId":"001"}, {"orderId":"002"}, {"orderId":"003"}]

k6 run dist/reference/api/quick-request.js \
  -e REQUEST_URL=http://api.example.com/api/v1/orders \
  -e REQUEST_METHOD=POST \
  -e REQUEST_BODY_FILE=/path/to/orders.json
# Automatically runs 3 iterations (one per array element)
```

> **Note:** `REQUEST_BODY_FILE` must be an absolute path. k6 `open()` resolves paths relative to the compiled script location, not the working directory.

---

## Authentication

### Bearer Token

```bash
k6 run dist/reference/api/quick-request.js \
  -e REQUEST_URL=http://api.example.com/api/v1/users \
  -e REQUEST_AUTH_TYPE=bearer \
  -e REQUEST_AUTH_TOKEN=eyJhbGciOiJIUzI1NiIs...
```

### Basic Auth

```bash
k6 run dist/reference/api/quick-request.js \
  -e REQUEST_URL=http://api.example.com/api/v1/users \
  -e REQUEST_AUTH_TYPE=basic \
  -e REQUEST_AUTH_USER=admin \
  -e REQUEST_AUTH_PASS=secret123
```

### API Key

```bash
k6 run dist/reference/api/quick-request.js \
  -e REQUEST_URL=http://api.example.com/api/v1/data \
  -e REQUEST_AUTH_TYPE=api-key \
  -e REQUEST_AUTH_TOKEN=ak_live_abc123
```

---

## CI/CD Pipeline Usage

### GitHub Actions

```yaml
- name: Health check
  run: |
    k6 run dist/reference/api/quick-request.js \
      -e REQUEST_URL=${{ env.API_URL }}/api/health \
      -e REQUEST_EXPECTED_STATUS=200

- name: Smoke test POST
  run: |
    k6 run dist/reference/api/quick-request.js \
      -e REQUEST_URL=${{ env.API_URL }}/api/v1/orders \
      -e REQUEST_METHOD=POST \
      -e REQUEST_BODY='{"orderId":"CI-001","orderName":"CI Test"}' \
      -e REQUEST_EXPECTED_STATUS=200-201
```

### Jenkins / Generic CI

```bash
# Quick validation after deployment
k6 run dist/reference/api/quick-request.js \
  -e REQUEST_URL=${API_BASE_URL}/api/health \
  -e REQUEST_EXPECTED_STATUS=200

# Load test with file
k6 run dist/reference/api/quick-request.js \
  -e REQUEST_URL=${API_BASE_URL}/api/v1/orders \
  -e REQUEST_METHOD=POST \
  -e REQUEST_BODY_FILE=${WORKSPACE}/test-data/orders.jsonl \
  -e REQUEST_VUS=5 \
  -e REQUEST_ITERATIONS=100
```

---

## Behavior Details

- **Status validation**: Single code (`200`) or range (`200-299`). Defaults to `200`.
- **Thresholds**: `http_req_failed < 10%`, `checks > 90%`, response time < 30s.
- **Body cycling**: If `iterations > body count`, bodies are cycled (modulo).
- **Logging**: First 10 iterations and every 100th log to console. Failures always log with response preview.
- **Framework integration**: Uses `RequestHelper` for automatic tracing headers and `runChecks()` for assertions.
