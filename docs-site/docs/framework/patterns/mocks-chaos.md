---
title: "Mocks & Chaos Injection"
sidebar_position: 2
---
# Mocks & Chaos Injection

Configuration of the mock server to simulate dependencies and chaos injection for resilience testing.

---

## Table of Contents

1. [Mock Server](#mock-server)
   - [Configuration](#mock-server-configuration)
   - [Dynamic Templates](#dynamic-templates)
   - [Simulated Latency](#simulated-latency)
   - [Usage in k6 Scenarios](#usage-in-k6-scenarios)
2. [Chaos Injection](#chaos-injection)
   - [Fault Types](#fault-types)
   - [Configuration](#chaos-configuration)
   - [Differentiated Reporting](#differentiated-reporting)
3. [Comparison Table](#comparison-table)

---

## Mock Server

The mock server (`src/node/mock-server.ts` — Node-only, relocated from `src/patterns/` in Phase 4 / ARC-06) is a lightweight HTTP server that starts during the test's `setup` phase and shuts down in `teardown`. It simulates external dependencies (third-party APIs, upstream services) without requiring real access to them.

It runs in the Node.js context (not in the k6/goja runtime).

### Mock Server Configuration

Configuration files live in `clients/{name}/mocks/`:

```json
// clients/acme/mocks/payments-api.json
{
  "version": "1.0",
  "port": 8080,
  "endpoints": [
    {
      "method": "POST",
      "path": "/payments",
      "statusCode": 201,
      "headers": {
        "Content-Type": "application/json"
      },
      "body": {
        "id": "{{uuid}}",
        "status": "approved",
        "timestamp": "{{timestamp}}",
        "amount": 100
      },
      "latency": { "mean": 50, "stddev": 10 }
    },
    {
      "method": "GET",
      "path": "/payments/:id",
      "statusCode": 200,
      "body": {
        "id": "{{uuid}}",
        "status": "settled",
        "sequence": "{{counter}}"
      }
    },
    {
      "method": "POST",
      "path": "/payments/fail",
      "statusCode": 422,
      "body": {
        "error": "insufficient_funds",
        "code": "{{randomInt(1000,9999)}}"
      },
      "latency": 200
    }
  ]
}
```

### Dynamic Templates

The template engine processes dynamic variables in `body` fields:

| Variable                    | Description                                        | Example Output           |
|-----------------------------|----------------------------------------------------|--------------------------|
| `{{counter}}`               | Auto-incrementing integer per request              | `1`, `2`, `3`, ...       |
| `{{timestamp}}`             | ISO 8601 date and time at the moment of the request| `2026-02-17T15:30:00Z`   |
| `{{uuid}}`                  | Random UUID v4                                     | `f47ac10b-58cc-...`      |
| `{{randomInt(min,max)}}`    | Random integer in the range `[min, max]`           | `{{randomInt(1,100)}}` -> `42` |

Templates work in strings and in nested JSON objects.

### Simulated Latency

The `latency` field accepts two formats:

```json
// Fixed latency (ms)
"latency": 200

// Normal distribution (Box-Muller): mean +/- stddev
"latency": { "mean": 100, "stddev": 20 }
```

With normal distribution, most responses fall near the `mean`, with natural variability. Useful for simulating real services with jitter.

### Usage in k6 Scenarios

```typescript
// clients/acme/scenarios/payments-with-mock.ts
import { setup, teardown } from "../../../src/node/mock-server";
import http from "k6/http";

export function setup() {
  // The mock server starts before VUs begin
  return startMockServer("clients/acme/mocks/payments-api.json");
}

export default function (data: { mockUrl: string }) {
  const res = http.post(`${data.mockUrl}/payments`, JSON.stringify({ amount: 100 }), {
    headers: { "Content-Type": "application/json" },
  });
  // ...
}

export function teardown(data: { mockUrl: string }) {
  stopMockServer(data.mockUrl);
}
```

---

## Chaos Injection

The chaos injection module (`src/patterns/chaos-injection.ts`) introduces controlled, deterministic faults during test execution to verify the resilience of the system under test.

### Fault Types

| Type              | Description                                                          | Config Key       |
|-------------------|----------------------------------------------------------------------|------------------|
| `network_delay`   | Adds artificial latency to requests (fixed ms or distribution)       | `delay`          |
| `error_rate`      | Returns HTTP errors (503, 500) with configurable probability         | `errorRate`      |
| `timeout`         | Simulates timeouts by leaving the connection hanging                 | `timeout`        |
| `corruption`      | Alters the response body (null fields, incorrect types)              | `corruption`     |
| `partial_timeout` | Responds partially and closes the connection (chunked transfer)      | `partialTimeout` |
| `rate_limiting`   | Returns 429 Too Many Requests with `Retry-After` header              | `rateLimiting`   |

### Chaos Configuration

```json
// clients/acme/config/chaos.json
{
  "version": "1.0",
  "enabled": true,
  "targetService": "payments",
  "faults": [
    {
      "type": "network_delay",
      "probability": 0.1,
      "config": { "delay": { "mean": 300, "stddev": 50 } }
    },
    {
      "type": "error_rate",
      "probability": 0.05,
      "config": { "statusCode": 503, "body": { "error": "service_unavailable" } }
    },
    {
      "type": "rate_limiting",
      "probability": 0.02,
      "config": { "retryAfter": 30 }
    }
  ]
}
```

**Key fields**:

- `enabled`: `false` disables chaos without removing the configuration.
- `targetService`: name of the service to which the faults apply.
- `probability`: fraction of requests affected by this fault (`0.1` = 10%). The distribution is deterministic (< 5% variance from the target).

### CLI Activation

```bash
# Chaos enabled via client's config/chaos.json
./bin/run-test.sh --client=acme --service=payments --test=load

# Chaos temporarily disabled without modifying chaos.json
./bin/run-test.sh --client=acme --service=payments --test=load --no-chaos
```

### Differentiated Reporting

The system distinguishes between chaos errors (intentionally introduced) and real errors from the service under test.

In the HTML report, a **"Chaos Breakdown"** section appears:

```
Total requests:        10,000
  -> Chaos faults:        1,250  (12.5%)
      network_delay:       950  (9.5%)
      error_rate:          250  (2.5%)
      rate_limiting:        50  (0.5%)
  -> Real errors:            18  (0.18%)
  -> Successful (net):    8,732  (87.32%)
```

In the JSON summary, the `chaosBreakdown` field:

```json
{
  "chaosBreakdown": {
    "total": 10000,
    "chaosFaults": 1250,
    "realErrors": 18,
    "faultsByType": {
      "network_delay": 950,
      "error_rate": 250,
      "rate_limiting": 50
    },
    "netSuccessRate": 0.9982
  }
}
```

The net error rate (`netSuccessRate`) excludes intentional chaos faults, allowing you to evaluate the real resilience of the service.

---

## Comparison Table

| Feature                     | Mock Server                        | Chaos Injection                          |
|-----------------------------|------------------------------------|------------------------------------------|
| Purpose                     | Simulate dependencies              | Test resilience under faults             |
| When to use                 | Dependency unavailable in test     | Verify retry, timeout, circuit breaker   |
| Where to configure          | `clients/{name}/mocks/`            | `clients/{name}/config/chaos.json`       |
| Affects the real service    | No (substitutes the dependency)    | No (injects faults in the k6 client)    |
| Differentiated reporting    | Not applicable                     | Yes — chaos vs real errors               |
| Disable without deleting config | Remove endpoint from mock      | `"enabled": false` in chaos.json         |
