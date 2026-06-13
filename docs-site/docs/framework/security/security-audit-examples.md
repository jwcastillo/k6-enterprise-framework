---
title: "Example Scenarios — Security Audit Checklist"
sidebar_position: 2
---
# Example Scenarios — Security Audit Checklist

**T-139**: Security review of all 15 example scenarios and framework helpers.  
**CHK items**: CHK-SEC-080, CHK-SEC-081, CHK-SEC-082, CHK-SEC-127, CHK-SEC-128

---

## Review Methodology

Each example scenario was audited against the following criteria:

| # | Check | Tool / Method |
|---|-------|---------------|
| 1 | No hardcoded credentials | `grep -rn "password\|token\|api_key" clients/examples/` — only `__ENV.*` references |
| 2 | Correlation IDs use UUID v4 | Inspect `HeaderHelper.tracing()` — `generateUUID()` uses RFC 4122 v4 format |
| 3 | No sequential/predictable IDs in headers | UUID bits 14 and 19 enforce version and variant |
| 4 | Browser screenshots clear sensitive fields | Scenarios with `browser` tag include field-clear instructions |
| 5 | Web Vitals contain only timing data | No hostname/path/internal IP in metric tags |
| 6 | `__ENV` used for all external values | No string literals matching secret patterns |

---

## Audit Results — 15 Example Scenarios

| Scenario | Credentials via `__ENV` | UUID v4 Correlation IDs | No PII in metrics | Browser: clears sensitive fields | Status |
|----------|------------------------|------------------------|-------------------|----------------------------------|--------|
| 01-auth-bearer.ts | ✅ `__ENV.APP_TOKEN` | ✅ HeaderHelper.tracing() | ✅ | N/A | **PASS** |
| 02-auth-basic.ts | ✅ `__ENV.APP_USER`, `__ENV.APP_PASSWORD` | ✅ | ✅ | N/A | **PASS** |
| 03-auth-oauth2.ts | ✅ `__ENV.CLIENT_ID`, `__ENV.CLIENT_SECRET` | ✅ | ✅ | N/A | **PASS** |
| 04-auth-apikey.ts | ✅ `__ENV.API_KEY` | ✅ | ✅ | N/A | **PASS** |
| 05-crud-products.ts | ✅ (no auth required) | ✅ | ✅ | N/A | **PASS** |
| 06-checkout-flow.ts | ✅ `__ENV.APP_TOKEN` | ✅ | ✅ | N/A | **PASS** |
| 07-graphql.ts | ✅ `__ENV.APP_TOKEN` | ✅ | ✅ | N/A | **PASS** |
| 08-websocket.ts | ✅ (no credentials) | ✅ | ✅ | N/A | **PASS** |
| 09-grpc.ts | ✅ (no credentials) | ✅ | ✅ | N/A | **PASS** |
| 10-data-pool.ts | ✅ CSV via `open()` | ✅ | ✅ | N/A | **PASS** |
| 11-chaos.ts | ✅ `__ENV.APP_TOKEN` | ✅ | ✅ | N/A | **PASS** |
| 12-browser-mixed.ts | ✅ `__ENV.APP_USER`, `__ENV.APP_PASSWORD` | ✅ | ✅ | ✅ `page.fill` cleared after submit | **PASS** |
| 13-soak-test.ts | ✅ `__ENV.APP_TOKEN` | ✅ | ✅ | N/A | **PASS** |
| 14-breakpoint.ts | ✅ (no auth required) | ✅ | ✅ | N/A | **PASS** |
| 15-redis-data-pool.ts | ✅ `__ENV.REDIS_URL` | ✅ | ✅ | N/A | **PASS** |

**Result**: All 15 scenarios pass the security checklist. ✅

---

## HeaderHelper UUID Generation (CHK-SEC-080)

`HeaderHelper.tracing()` generates three UUIDs per request:
- `X-Correlation-ID` — links request to a test VU/iteration
- `X-Trace-ID` — used for distributed tracing context
- `X-Request-ID` — per-HTTP-request unique identifier

The `generateUUID()` function in `header-helper.ts` produces RFC 4122 UUID v4:
- Bit 14 is always `4` (version field)
- Bit 19 is always in range `[8, b]` (variant field `10xx`)
- All other bits are from `Math.random()`

> **Note**: `Math.random()` is used intentionally — `crypto.randomUUID()` is not available
> in the k6 goja runtime. These IDs are for **observability only**, not for security
> (session tokens, CSRF). For Node.js contexts, use `crypto.randomUUID()` directly.

---

## Web Vitals Data (CHK-SEC-082)

Web Vitals reported by browser scenarios (FCP, LCP, TTFB, CLS) contain:
- Metric name (string)
- Numeric timing value (milliseconds)
- k6 standard tags: `scenario`, `group`, `status`

They do **not** include:
- Hostnames or IP addresses of the target service
- Internal URL paths that reveal infrastructure topology
- User session data or PII

Custom tags added via `__ENV.K6_CLIENT` and `__ENV.K6_PROFILE` are sanitized through
`sanitizePrometheusLabel()` before emission.

---

## Browser Screenshot Guidance (CHK-SEC-081)

For scenarios that use `browser.newPage()` and capture screenshots:

```typescript
// REQUIRED before screenshot — clear sensitive field content
await page.fill('input[type="password"]', '');
await page.fill('input[name="card-number"]', '');

// Then take screenshot — no sensitive data visible
await page.screenshot({ path: `screenshots/step-${__ITER}.png` });
```

This pattern is implemented in `12-browser-mixed.ts` and must be followed in all
browser scenarios that interact with authenticated or payment flows.

---

## Tracing Headers (CHK-SEC-127, CHK-SEC-128)

`traceparent` header (W3C Trace Context):
- Format: `00-{traceId}-{spanId}-01`
- `traceId` is a 32-hex-char UUID derived from `generateUUID()` — no internal info
- Does **not** contain: hostname, IP, process ID, or framework version

`X-Pyroscope-Labels` header (when profiling enabled):
- Value: `k6_test=true` — generic flag only
- Does **not** include: client name, environment, or target service details

If additional labels are needed for Pyroscope isolation, use:
```
K6_PYROSCOPE_LABELS="app=k6,client=__ENV_CLIENT"
```
where `__ENV_CLIENT` is set from `__ENV.K6_CLIENT` (never hardcoded).
