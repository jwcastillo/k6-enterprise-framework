---
title: "Patterns Guide"
sidebar_position: 1
---
# Patterns Guide

Reusable execution patterns for authentication, retry, pagination, correlation, weighted distribution, chaos injection, contract validation, funnels, mock servers, and distributed Redis coordination.

---

## Table of Contents

1. [Overview](#overview)
2. [AuthPattern](#authpattern)
3. [RetryPattern](#retrypattern)
4. [PaginationPattern](#paginationpattern)
5. [CorrelationPattern](#correlationpattern)
6. [WeightedExecution](#weightedexecution)
7. [ChaosInjection](#chaosinjection)
8. [ContractValidation](#contractvalidation)
9. [FunnelPattern](#funnelpattern)
10. [MockServer](#mockserver)
11. [RedisPatterns](#redispatterns)

---

## Overview

All patterns live in `src/patterns/` and are exported from `src/patterns/index.ts`. Import them directly or via the barrel export:

```typescript
import { authenticate, withRetry, weightedSwitch } from "../../src/patterns";
```

Patterns run in the **k6 goja runtime** unless otherwise noted.

---

## AuthPattern

**File:** `src/patterns/auth-pattern.ts`

Unified authentication factory. Returns an `AuthSession` with a pre-configured `RequestHelper`.

| Type | Flow | Headers |
|------|------|---------|
| `bearer` | POST to login URL, extract token | `Authorization: Bearer <token>` |
| `basic` | Credentials embedded per request | `Authorization: Basic <base64>` |
| `oauth2` | Client credentials grant | `Authorization: Bearer <access_token>` |
| `apikey` | Static key as header | `X-API-Key: <key>` (configurable) |

```typescript
import { authenticate, isSessionValid } from "../../src/patterns/auth-pattern";

const session = authenticate({
  type: "bearer",
  loginUrl: "/auth/login",
  username: "testuser",
  password: "testpass",
  tokenPath: "access_token",
  baseUrl: "https://api.example.com",
});

const res = session.client.get("/users/me");

if (!isSessionValid(session)) { /* re-authenticate */ }
```

**OAuth2:**

```typescript
const oauth = authenticate({
  type: "oauth2",
  tokenUrl: "https://auth.example.com/oauth/token",
  clientId: "my-client-id",
  clientSecret: "my-secret",
  scope: "read write",
  baseUrl: "https://api.example.com",
});
```

**API Key:**

```typescript
const apiKeySession = authenticate({
  type: "apikey",
  apiKey: "sk-abc123",
  header: "X-Custom-Key",
  baseUrl: "https://api.example.com",
});
```

---

## RetryPattern

**File:** `src/patterns/retry-pattern.ts`

Exponential backoff with jitter. Retries on status codes 429, 500, 502, 503, 504 by default.

```typescript
import { withRetry, retryRequest } from "../../src/patterns/retry-pattern";

const res = retryRequest(() => client.get("/endpoint"), { maxAttempts: 5, baseDelaySeconds: 2 });

const result = withRetry(
  (attempt) => client.get("/api/data"),
  { maxAttempts: 3, baseDelaySeconds: 1, maxDelaySeconds: 30, jitter: 0.3 }
);
// result: { value: SafeResponse, attempts: number, lastError?: string }
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `maxAttempts` | `number` | `3` | Maximum attempts |
| `baseDelaySeconds` | `number` | `1` | Base delay |
| `maxDelaySeconds` | `number` | `30` | Max delay cap |
| `jitter` | `number` | `0.3` | Randomness factor (0-1) |
| `retryOnStatus` | `number[]` | `[429,500,502,503,504]` | Retryable status codes |
| `retryOnError` | `boolean` | `true` | Retry on exceptions |

Delay: `min(base * 2^n, max) +/- jitter`.

---

## PaginationPattern

**File:** `src/patterns/pagination-pattern.ts`

Traverses paginated APIs. Supports offset, cursor, and page-based styles.

```typescript
import { traverseAll, initPagination, advancePagination } from "../../src/patterns/pagination-pattern";

const allUsers = traverseAll<User>(client, "/api/users", {
  style: "offset", pageSize: 50, itemsPath: "data", totalPath: "meta.total",
}, 20);

// Manual traversal
const config = { style: "cursor" as const, cursorParam: "after", nextCursorPath: "pagination.next", itemsPath: "results" };
let state = initPagination(config);
while (state.hasMore) {
  const res = client.get("/api/items", state.nextParams);
  state = advancePagination(state, res, config);
}
```

| Style | Key Config | Stop Condition |
|-------|-----------|----------------|
| `offset` | `limitParam`, `offsetParam`, `pageSize` | Items < pageSize |
| `cursor` | `cursorParam`, `nextCursorPath` | Next cursor is null |
| `page` | `pageParam`, `sizeParam`, `totalPagesPath` | Page >= totalPages |

---

## CorrelationPattern

**File:** `src/patterns/correlation-pattern.ts`

Extracts values from responses and injects them into subsequent requests.

```typescript
import { extractFromResponse, interpolate, mergeWithExtracted } from "../../src/patterns/correlation-pattern";

const extracted = extractFromResponse(orderRes, [
  { name: "orderId", jsonPath: "data.id", required: true },
  { name: "trackingUrl", header: "X-Tracking-URL" },
  { name: "token", regex: 'csrf_token="([^"]+)"' },
]);

const url = interpolate("/orders/{{orderId}}/confirm", extracted);
const body = mergeWithExtracted({ status: "confirmed" }, extracted, { csrf: "token" });
```

Extraction methods: `jsonPath` (dot-notation), `header` (response header), `regex` (capture group). Set `required: true` to throw on failure.

---

## WeightedExecution

**File:** `src/patterns/weighted-execution.ts`

Distributes iterations across scenarios by relative weights.

```typescript
import { weightedSwitch, validateWeights } from "../../src/patterns/weighted-execution";

const scenarios = [
  { name: "browse",   weight: 60, fn: () => browseCatalog() },
  { name: "search",   weight: 30, fn: () => searchProducts() },
  { name: "checkout", weight: 10, fn: () => completeCheckout() },
];

export function setup() { validateWeights(scenarios); }
export default function () { weightedSwitch(scenarios); }
```

Weights are relative (do not need to sum to 100). Use `weightedSelect()` to get the selection without executing.

---

## ChaosInjection

**File:** `src/patterns/chaos-injection.ts`

Controlled fault injection with deterministic distribution. See [MOCKS_CHAOS.md](/docs/framework/patterns/mocks-chaos).

| Fault Type | Description | Key Params |
|-----------|-------------|------------|
| `latency` | Artificial delay | `delayMs` (default: 2000) |
| `http_error` | HTTP error response | `statusCode` (default: 503) |
| `disconnect` | Connection drop | `afterBytes` |
| `corruption` | Altered response body | `corruptionType` |
| `partial_timeout` | Incomplete response | `initialBytes`, `hangMs` |
| `rate_limit` | 429 Too Many Requests | `retryAfterSec` (default: 30) |

Configure via `clients/{name}/config/chaos.json`. Reports separate chaos-injected from genuine errors.

---

## ContractValidation

**File:** `src/patterns/contract-validation.ts`

JSON Schema validation using AJV with format support.

```typescript
import { ContractValidator } from "../../src/patterns/contract-validation";

const validator = new ContractValidator();
validator.registerSchema("user", {
  type: "object", required: ["id", "email"],
  properties: { id: { type: "string", format: "uuid" }, email: { type: "string", format: "email" } },
});

const result = validator.validate("user", res.json());
validator.assertValid("user", res.json());  // throws on failure
```

Register schemas at init time. A `defaultValidator` singleton is exported.

---

## FunnelPattern

**File:** `src/patterns/funnel-pattern.ts`

Sequential steps with drop-off tracking. Each step runs inside k6 `group()`.

```typescript
import { runFunnel, initFunnelMetrics } from "../../src/patterns/funnel-pattern";

const config = {
  name: "ecommerce",
  initialContext: () => ({ orderId: null }),
  steps: [
    { name: "browse", fn: (ctx) => true, thinkTime: 2 },
    { name: "add_to_cart", fn: (ctx) => { ctx.orderId = "123"; return true; } },
    { name: "checkout", fn: (ctx) => true, thinkTime: 3 },
  ],
};
initFunnelMetrics(config);  // MUST be at module level

export default function () {
  const result = runFunnel(config);
  // { completed, stepsEntered, stepsCompleted, dropOffStep }
}
```

Per-step Counter metrics: `funnel_{name}__{step}_entered` and `funnel_{name}__{step}_completed`.

---

## MockServer

**File:** `src/node/mock-server.ts` (Node-only — relocated from `src/patterns/` in Phase 4 / ARC-06)

Lightweight HTTP mock server (Node.js context). See [MOCKS_CHAOS.md](/docs/framework/patterns/mocks-chaos).

Templates: `{{counter}}`, `{{timestamp}}`, `{{uuid}}`, `{{randomInt(min,max)}}`. Latency: fixed ms or `{ mean, stddev }`.

---

## RedisPatterns

**File:** `src/patterns/redis-patterns.ts`

Three distributed coordination patterns (requires xk6-redis):

- **UserPool** -- unique per-VU data with `recycle` or `error` exhaustion policy
- **DistributedRateLimiter** -- cross-VU rate limiting via atomic INCR
- **StatsCounter** -- atomic counters for live metrics

Also exports `parseCsv()` and `parseCsvLine()`.

---

## Related Documentation

- [Mocks & Chaos Injection](/docs/framework/patterns/mocks-chaos)
- Helpers Reference
- [Redis Data Support](/docs/framework/helpers/redis-data)
- [Workflow](/docs/framework/workflow)
