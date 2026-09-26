---
name: k6-performance-tester
description: Enterprise k6 load testing expert. Use when creating, reviewing, or debugging k6 load tests within the k6-enterprise-framework. Enforces framework patterns, coding standards, and performance best practices for production-grade test scenarios.
---

# k6 Enterprise Performance Tester

## Overview

Expert skill for building load tests using the **k6 Enterprise Framework** — a two-layer architecture with a generic core (`src/`) and client-specific implementations (`clients/`). This skill enforces the patterns and conventions established across the `_reference`, `_benchmark`, `airline-accelerator`, and `falabella-seguros` clients and the framework core.

## When to Use This Skill

- Creating new client implementations for load testing
- Writing API unit tests, integration funnels, smoke tests, or stress scenarios
- Creating service classes that wrap HTTP endpoints
- Building data factories and generators for realistic test data
- Reviewing existing k6 scenarios for pattern compliance
- Debugging test failures or threshold violations
- Adding new endpoints or scenarios to existing clients

## Framework Root

The framework lives at: `k6-framework/` inside the project.

---

## Client-Specific Skills

Each real client repo ships its own portable skill at `clients/<client>/skill/SKILL.md`. These travel with the client when it is exported as a standalone repo, so anyone cloning the client gets the conventions without needing a personal skills setup.

| Client | Per-client skill (canonical) | Global pointer |
|--------|------------------------------|----------------|
| airline-accelerator | `clients/airline-accelerator/skill/SKILL.md` | `k6-airline-accelerator` (thin pointer → per-client) |

When working inside a specific client, prefer reading that client's `skill/SKILL.md` directly — it carries the client-specific schemas, headers, service classes, and anti-patterns. This `k6-performance-tester` skill covers the cross-client framework conventions.

---

## 1. CLIENT DIRECTORY STRUCTURE

Every client MUST follow this layout:

```
clients/<client-name>/
  config/
    default.json              # Endpoints, tags, metadata
  lib/
    client-config.ts          # Bridge to framework (createClientConfig)
    <domain>-factory.ts       # Data generators (optional)
    <domain>-generator.ts     # Domain data generators (optional)
    services/
      <service-name>.ts       # One file per backend service
  scenarios/
    api/                      # Unit tests (one endpoint per file)
    integration/              # Multi-step user journeys (funnel)
    mixed/                    # Weighted operation distribution (optional)
  data/
    *.json | *.txt | *.csv    # Static test data files
```

### Naming Rules

- All filenames: **lowercase, kebab-case** (e.g., `core-manager-service.ts`)
- Scenario name matches file stem: `health-check.ts` -> `scenarioOptions("health-check")`
- API scenarios: named after the operation (`create-order.ts`, `fea-sign.ts`)
- Integration scenarios: named after the flow (`ecommerce-funnel.ts`, `cp02-baseline.ts`)
- Mixed scenarios: named after workload type (`read-heavy-mix.ts`, `peak-traffic-simulation.ts`)

---

## 2. CLIENT CONFIG PATTERN

### `config/default.json`

```json
{
  "client": "<client-name>",
  "version": "1.0.0",
  "environment": "default",
  "description": "<purpose>",
  "endpoints": {
    "<service-key>": {
      "baseUrl": "https://...",
      "timeout": 30000
    }
  },
  "tags": {
    "client": "<client-name>",
    "service": "<primary-service>",
    "environment": "default"
  }
}
```

### `lib/client-config.ts`

MUST call `createClientConfig()` once and re-export helpers:

```typescript
import config from "../config/default.json";
import { createClientConfig, THINK } from "../../../src/core/client-config";

const helpers = createClientConfig({
  baseUrl: __ENV["API_BASE_URL"] || config.endpoints["<service-key>"].baseUrl,
  baseTags: {
    client: config.tags.client,
    service: config.tags.service,
  },
});

export const BASE_URL = helpers.BASE_URL;
export const scenarioOptions = helpers.scenarioOptions;
export const scenarioTags = helpers.scenarioTags;
export { THINK };

export const BASE_TAGS = {
  client: config.tags.client,
  service: config.tags.service,
} as const;
```

**Rules:**
- Support `__ENV["API_BASE_URL"]` override with config fallback
- Export: `BASE_URL`, `scenarioOptions`, `scenarioTags`, `THINK`, `BASE_TAGS`
- For multi-endpoint clients, export additional URLs (`WEB_BASE_URL`, etc.)
- Auth headers (API keys, cookies) via helper function, NOT hardcoded in scenarios

---

## 3. SERVICE CLASS PATTERN

One service class per backend service. Services encapsulate HTTP, checks, and error handling.

```typescript
import { RequestHelper, SafeResponse } from "../../../../src/helpers/request-helper";
import { runChecks, statusCheck, statusRangeCheck, thresholdCheck } from "../../../../src/core/check-system";
import { BASE_TAGS } from "../client-config";

const _errorCounts: Record<string, number> = {};
const MAX_ERRORS_PER_ENDPOINT = 3;

function logError(method: string, path: string, res: SafeResponse): void {
  const key = `${method} ${path}`;
  _errorCounts[key] = (_errorCounts[key] || 0) + 1;
  if (_errorCounts[key] <= MAX_ERRORS_PER_ENDPOINT) {
    const body = res.body.length > 500 ? res.body.substring(0, 500) + "..." : res.body;
    console.error(`[ERROR] ${method} ${path} -> ${res.status} | ${body}`);
  } else if (_errorCounts[key] === MAX_ERRORS_PER_ENDPOINT + 1) {
    console.error(`[ERROR] ${key} -> suppressing further errors (${_errorCounts[key]}+ failures)`);
  }
}

export class MyService {
  private readonly http: RequestHelper;

  constructor(baseUrl: string) {
    this.http = new RequestHelper(baseUrl, {
      tags: { ...BASE_TAGS, service: "my-service" },
    });
  }

  /** GET /api/health */
  health(): SafeResponse {
    const res = this.http.get("/api/health");
    runChecks(res, [statusCheck(200), thresholdCheck(1000)]);
    if (res.status !== 200) logError("GET", "/api/health", res);
    return res;
  }

  /** POST /api/v1/resource */
  create(body: Record<string, unknown>): SafeResponse {
    const res = this.http.post("/api/v1/resource", body);
    runChecks(res, [statusRangeCheck(200, 201), thresholdCheck(3000)]);
    if (res.status < 200 || res.status > 201) logError("POST", "/api/v1/resource", res);
    return res;
  }
}
```

### Service Rules

- **Constructor**: receives `baseUrl`, creates `RequestHelper` with service-specific tags
- **Methods**: one per HTTP endpoint, return `SafeResponse`
- **Checks**: `runChecks()` inside every method with `statusCheck` + `thresholdCheck`
- **Error logging**: capped at 3 per endpoint via `logError()`, then suppressed
- **Auth headers**: via `extraHeaders` in `RequestHelper` constructor, NOT per-method
- **JSDoc**: `/** HTTP_METHOD /path */` on every method
- **Known issues**: documented inline with accepted status ranges
- **Timeout**: custom timeouts via `timeout` in constructor options (for slow endpoints)

### Multi-Endpoint Service

```typescript
constructor(baseUrl: string) {
  const headers = { "x-api-key": __ENV.API_KEY || "" };
  this.pdfHttp = new RequestHelper(baseUrl, {
    extraHeaders: headers,
    tags: { ...BASE_TAGS, service: "pdf-maker" },
    timeout: 60000,
  });
  this.courierHttp = new RequestHelper(baseUrl, {
    extraHeaders: headers,
    tags: { ...BASE_TAGS, service: "courier" },
  });
}
```

---

## 4. SCENARIO PATTERNS

### A. Unit Tests (API) — One Endpoint Per File

**NEVER** use `group()` in unit tests. Direct service call + optional `check()`.

```typescript
import { check, sleep } from "k6";
import { Options } from "k6/options";
import { MyService } from "../../lib/services/my-service";
import { BASE_URL, scenarioOptions, THINK } from "../../lib/client-config";

export const options: Options = scenarioOptions("health-check");

const svc = new MyService(BASE_URL);

export default function (): void {
  svc.health();
  sleep(THINK.LONG);
}
```

**With business check and sampling:**

```typescript
export const options: Options = scenarioOptions("create-order");

const svc = new MyService(BASE_URL);

export default function (): void {
  const body = createOrderBody();
  const res = svc.createOrder(body);

  const created = res.status >= 200 && res.status <= 201;
  check(null, { "order created (2xx)": () => created });

  if (created && Math.random() < 0.05) {
    const id = res.json("orderId") || body.orderId;
    console.log(`[VU ${__VU}] Created -> ${id}`);
  }

  sleep(THINK.NORMAL);
}
```

**With threshold overrides:**

```typescript
export const options: Options = scenarioOptions("fea-sign", {
  "http_req_duration{service:fea}": ["p(95)<10000"],
  http_req_failed: ["rate<0.50"],
});
```

**With setup phase:**

```typescript
export function setup(): Record<string, string> {
  const body = createBody();
  const res = svc.create(body);
  const id = res.json<string>("id") || (body.id as string);
  return { id };
}

export default function (data: Record<string, string>): void {
  const res = svc.get(data.id);
  check(null, { "found (200)": () => res.status === 200 });
  sleep(THINK.REALISTIC);
}
```

### B. Smoke Tests — Sequential Full Flow

```typescript
export const options: Options = scenarioOptions("cp01-smoke", {
  http_req_failed: ["rate<0.50"],
});

export default function (): void {
  const healthRes = svc.health();
  check(null, { "health ok": () => healthRes.status === 200 });
  sleep(THINK.REALISTIC);

  const createRes = svc.create(body);
  const ok = createRes.status >= 200 && createRes.status <= 201;
  check(null, { "created (2xx)": () => ok });

  if (ok && Math.random() < 0.05) {
    console.log(`[VU ${__VU}] Created -> ${id}`);
  }

  sleep(THINK.REALISTIC);
  // ... more steps
}
```

### C. Integration Funnel — Multi-Step with Metrics

Uses `runFunnel()` + `initFunnelMetrics()`. Funnel handles `group()` internally.

```typescript
import { Options } from "k6/options";
import { initFunnelMetrics, runFunnel, FunnelConfig } from "../../../../src/patterns/funnel-pattern";
import { BASE_URL, scenarioOptions, THINK } from "../../lib/client-config";

// Context interface — extends Record<string, unknown>
interface FlowContext extends Record<string, unknown> {
  orderId: string | null;
}

// Options with per-step latency SLAs
export const options: Options = scenarioOptions("ecommerce-funnel", {
  http_req_failed: ["rate<0.20"],
  "group_duration{group:::health_check}": ["p(95)<500"],
  "group_duration{group:::create_order}": ["p(95)<3000"],
  "group_duration{group:::verify_order}": ["p(95)<2000"],
});

const svc = new MyService(BASE_URL);

const funnelConfig: FunnelConfig<FlowContext> = {
  name: "ecommerce",
  initialContext: (): FlowContext => ({ orderId: null }),
  steps: [
    {
      name: "health_check",
      thinkTime: THINK.FAST,
      fn: (ctx) => {
        const res = svc.health();
        return res.status === 200;
      },
    },
    {
      name: "create_order",
      thinkTime: THINK.REALISTIC,
      fn: (ctx) => {
        const res = svc.create(body);
        const ok = res.status >= 200 && res.status <= 201;
        if (ok) ctx.orderId = res.json<string>("orderId");
        return ok;
      },
    },
    {
      name: "verify_order",
      thinkTime: THINK.NORMAL,
      fn: (ctx) => {
        if (!ctx.orderId) return false;
        const res = svc.get(ctx.orderId);
        return res.status === 200;
      },
    },
  ],
};

initFunnelMetrics(funnelConfig);

export default function (): void {
  runFunnel<FlowContext>(funnelConfig);
}
```

**Funnel Rules:**
- `initFunnelMetrics()` MUST be called at module level (k6 requires Counter registration in init)
- Step `name` is snake_case, matches `group_duration{group:::name}` threshold key
- Step `fn` returns `boolean`: `true` = continue, `false` = drop off
- Context is mutated within steps (carries forward)
- Check prerequisites before execution (e.g., `if (!ctx.orderId) return false`)
- `thinkTime` per step (seconds) — use THINK constants

### D. Mixed Scenarios — Weighted Distribution

```typescript
import { weightedSwitch, WeightedScenario } from "../../../../src/patterns/weighted-execution";

export const options: Options = scenarioOptions("read-heavy-mix", {
  http_req_failed: ["rate<0.50"],
});

const svc = new MyService(BASE_URL);
let knownId = "";

function doCreate(): void {
  const res = svc.create(body);
  check(null, { "create 2xx": () => res.status >= 200 && res.status <= 201 });
  knownId = res.json<string>("id") || body.id;
  sleep(THINK.NORMAL);
}

function doGet(): void {
  if (!knownId) { doCreate(); return; }
  const res = svc.get(knownId);
  check(null, { "get response": () => res.status === 200 || res.status === 404 });
  sleep(THINK.NORMAL);
}

const scenarios: WeightedScenario<() => void>[] = [
  { name: "get-resource", weight: 80, fn: doGet },
  { name: "create-resource", weight: 20, fn: doCreate },
];

export default function (): void {
  weightedSwitch(scenarios);
}
```

**Weighted Rules:**
- Module-level state (`let knownId`) per VU
- Read functions fallback to create if no data
- Named helper functions (`doCreate`, `doGet`)
- Weights are relative (don't need to sum to 100)
- Check names prefixed with scenario context

---

## 5. SCENARIO OPTIONS — Profile Inheritance

**NEVER hardcode** `scenarios: { executor: ... }` in options. Always use `scenarioOptions()`.

```typescript
// Basic — inherits everything from profile (K6_PROFILE env var)
export const options: Options = scenarioOptions("scenario-name");

// With threshold overrides only
export const options: Options = scenarioOptions("scenario-name", {
  http_req_failed: ["rate<0.20"],
  "http_req_duration{service:my-svc}": ["p(95)<5000"],
});

// With funnel step thresholds
export const options: Options = scenarioOptions("funnel-name", {
  "group_duration{group:::step_one}": ["p(95)<2000"],
  "group_duration{group:::step_two}": ["p(95)<3000"],
});
```

### Available Profiles (via K6_PROFILE)

| Profile | VUs | Duration | Purpose |
|---------|-----|----------|---------|
| smoke | 1-2 | 1 min | Verify operational |
| quick | 5 | 3 min | CI/CD feedback |
| load | 20 | 14 min | Sustained baseline |
| rampup | 50 | 20 min | Gradual increase |
| capacity | 200 | 25 min | Find throughput ceiling |
| stress | 400 | 30 min | Breaking point |
| spike | 300 | 10 min | Sudden surge |
| breakpoint | 1000 | 70 min | Manual stop |
| soak | 20 | 4.5 hrs | Leak detection |

### CLI Invocation

```bash
./bin/run-test.sh --client=<name> --scenario=api/health-check --profile=smoke
./bin/run-test.sh --client=<name> --scenario=integration/funnel --profile=load
```

---

## 6. THINK TIME CONSTANTS

```typescript
import { THINK } from "../../lib/client-config";
import { sleep } from "k6";

sleep(THINK.AGGRESSIVE);  // 0.1s — throughput tests, rapid fire
sleep(THINK.FAST);        // 0.2s — quick follow-ups, health checks
sleep(THINK.NORMAL);      // 0.3s — standard between operations
sleep(THINK.REALISTIC);   // 0.5s — user-like delay, form submission
sleep(THINK.LONG);        // 1.0s — propagation wait, page loads
```

**Guidelines:**
- Unit tests: `THINK.LONG` (single endpoint, space iterations)
- Smoke tests: `THINK.REALISTIC` (mimic real user)
- Stress tests: `THINK.FAST` or `THINK.AGGRESSIVE` (maximize throughput)
- Funnel steps: variable per step (faster for APIs, slower for user actions)
- After writes: at least `THINK.NORMAL` for propagation
- Last step: `thinkTime: 0` (no wait after final step)

---

## 7. DATA MANAGEMENT

### DataPool for Static Data (plates, users, stores)

```typescript
import { DataPool } from "../../../../src/helpers/data-pool";

// Load in init context (once per VU, shared)
const raw = open("../../data/plates.txt");
const records = raw
  .split("\n")
  .map((line: string) => line.trim())
  .filter((line: string) => line.length > 0)
  .map((value: string) => ({ value }));

const pool = new DataPool(records, { exhaustionPolicy: "recycle" });

export default function (): void {
  const item = pool.getRandomRecord();  // Random pick
  // or: pool.getRecord()               // VU-unique (deterministic)
  // or: pool.getNextRecord()           // Sequential cursor
}
```

### Data Factory for Dynamic Data

```typescript
// Domain-specific generators
export function generateRut(): string { /* Chilean RUT mod-11 */ }
export function generateCustomer(): Customer { /* Names, email, phone */ }
export function generateVehicle(ppu: string): Vehicle { /* Brand, model, year */ }
export function createOrderBody(): Record<string, unknown> { /* Full realistic order */ }
export function createMinimalOrderBody(): Record<string, unknown> { /* Minimal for throughput */ }
```

**Rules:**
- `open()` files in init context only (shared across VU iterations)
- Large binary data (base64 PDFs) opened once, passed to service constructor
- Template interpolation: `{{PLACEHOLDER}}` replaced at runtime
- Factory methods generate fresh data per call (no caching)
- Provide both full and minimal body variants for different test profiles

### JSON Data Pool

```typescript
import { createPool } from "../../../../src/helpers/data-pool";
const stores = createPool<string>(open("../../data/stores.json"));
```

---

## 8. CHECK PATTERNS

### In Service (Embedded — Runs on Every Call)

```typescript
runChecks(res, [statusCheck(200), thresholdCheck(1000)]);
runChecks(res, [statusRangeCheck(200, 201), thresholdCheck(3000)]);
```

### In Scenario (Business Logic — Conditional)

```typescript
check(null, {
  "order created (2xx)": () => res.status >= 200 && res.status <= 201,
});

// Validation checks (integration)
check(null, {
  "orderId matches": () => res.json<string>("orderId") === expectedId,
  "name matches": () => res.json<string>("name") === expectedName,
});
```

### Available Check Factories

| Factory | Usage |
|---------|-------|
| `statusCheck(200)` | Exact status match |
| `statusRangeCheck(200, 201)` | Range match |
| `schemaCheck(["id", "name"])` | JSON field presence |
| `contentCheck("success")` | Body substring |
| `thresholdCheck(2000)` | Response time < N ms |

---

## 9. LOGGING & SAMPLING

### Error Logging (In Services)

```typescript
// Cap at 3 errors per endpoint, then suppress
const _errorCounts: Record<string, number> = {};
const MAX_ERRORS_PER_ENDPOINT = 3;

function logError(method: string, path: string, res: SafeResponse): void {
  const key = `${method} ${path}`;
  _errorCounts[key] = (_errorCounts[key] || 0) + 1;
  if (_errorCounts[key] <= MAX_ERRORS_PER_ENDPOINT) {
    const body = res.body.length > 500 ? res.body.substring(0, 500) + "..." : res.body;
    console.error(`[ERROR] ${method} ${path} -> ${res.status} | ${body}`);
  } else if (_errorCounts[key] === MAX_ERRORS_PER_ENDPOINT + 1) {
    console.error(`[ERROR] ${key} -> suppressing further errors`);
  }
}
```

### Success Sampling (In Scenarios)

```typescript
// Sample 5% of successful operations
if (created && Math.random() < 0.05) {
  console.log(`[VU ${__VU}] Order created -> ${orderId}`);
}
```

**NEVER:**
- Log every request (floods output)
- Use `console.log` without sampling
- Log full response bodies in production tests

---

## 10. CORRELATION PATTERN

Chain data between requests using `extractFromResponse()`:

```typescript
import { extractFromResponse } from "../../../../src/patterns/correlation-pattern";

const createRes = svc.create(body);

const extracted = extractFromResponse(createRes, [
  { name: "orderId", jsonPath: "orderId" },
  { name: "orderUid", jsonPath: "createdOrder.orderUid" },
]);

// Always provide fallback
const orderId = extracted.orderId || (body.orderId as string);
```

### Template Interpolation

```typescript
import { interpolate } from "../../../../src/patterns/correlation-pattern";

const template = open("../../data/body-template.json");
const body = interpolate(template, {
  ID: generatedId,
  NAME: generatedName,
});
```

---

## 11. IMPORT ORDER CONVENTION

Scenarios MUST follow this import order:

```typescript
// 1. Native k6
import { check, sleep } from "k6";
import { Options } from "k6/options";

// 2. Framework patterns (if used)
import { DataPool } from "../../../../src/helpers/data-pool";
import { initFunnelMetrics, runFunnel, FunnelConfig } from "../../../../src/patterns/funnel-pattern";
import { extractFromResponse } from "../../../../src/patterns/correlation-pattern";
import { weightedSwitch, WeightedScenario } from "../../../../src/patterns/weighted-execution";

// 3. Client services
import { MyService } from "../../lib/services/my-service";

// 4. Client data generators
import { createBody, generateId } from "../../lib/my-factory";

// 5. Client config (always last of imports)
import { BASE_URL, scenarioOptions, THINK } from "../../lib/client-config";
```

---

## 12. FILE HEADER CONVENTION

```typescript
/**
 * <scenario-name> -- <brief description>
 * <more detail about what this scenario tests>
 *
 * @cli ./bin/run-test.sh --client=<name> --scenario=<path> --profile=<profile>
 */
```

For integration scenarios, include step sequence:

```typescript
/**
 * ecommerce-funnel -- Full purchase flow using Funnel pattern.
 *
 * Steps: health_check -> browse -> create_order -> verify -> payment
 *
 * Metrics: group_duration{group:::step_name}, funnel_ecommerce__step_entered/completed
 *
 * @cli ./bin/run-test.sh --client=airline-accelerator --scenario=integration/ecommerce-funnel --profile=load
 */
```

---

## 13. WEBPACK AUTO-DISCOVERY

No webpack config changes needed. The build system auto-discovers:

```
clients/*/scenarios/**/*.ts  ->  dist/<client>/<path>.js
```

Just create files under `scenarios/` and run `npm run build`.

---

## 14. THRESHOLD NAMING CONVENTIONS

| Metric | Pattern | Example |
|--------|---------|---------|
| Global response time | `http_req_duration` | `["p(95)<2000"]` |
| Per-service time | `http_req_duration{service:<name>}` | `["p(95)<5000"]` |
| Error rate | `http_req_failed` | `["rate<0.10"]` |
| Check success | `checks` | `["rate>=0.90"]` |
| Funnel step latency | `group_duration{group:::<step>}` | `["p(95)<3000"]` |

### Threshold Values by Service Type

| Type | p95 | p99 |
|------|-----|-----|
| Health check | < 500ms - 2s | < 2s - 5s |
| Read API | < 2s - 3s | < 5s |
| Write API | < 3s - 5s | < 10s |
| Document signing (HSM) | < 10s - 15s | < 30s |
| PDF generation | < 15s - 20s | < 45s |
| Email sending | < 5s | < 10s |

---

## 15. ANTI-PATTERNS (NEVER DO)

1. **Hardcoded executor blocks** — Use `scenarioOptions()` instead of `scenarios: { executor: "ramping-arrival-rate", ... }`
2. **group() in unit tests** — Only funnels use `group()` (via `runFunnel()`)
3. **Verbose logging** — Always use sampling (`Math.random() < 0.05`)
4. **Service instantiation inside default()** — Create services at module level
5. **open() inside default()** — Load files in init context only
6. **Hardcoded URLs** — Use `BASE_URL` from client-config with `__ENV` override
7. **Hardcoded auth headers** — Use `extraHeaders` in `RequestHelper` constructor
8. **Missing error capping** — Always use `logError()` with MAX_ERRORS pattern
9. **Missing fallback extraction** — `extracted.value || fallbackValue`
10. **Skipping runChecks in services** — Every service method MUST call `runChecks()`
11. **Custom metrics in default()** — k6 requires Counter/Trend registration in init context
12. **Importing directly from src/ in scenarios** — Use client-config bridge layer
13. **Missing think time** — Every operation MUST have a `sleep(THINK.*)` after it
14. **Ignoring known server issues** — Document and accept known failures in status ranges

---

## 16. CREATING A NEW CLIENT CHECKLIST

1. Create `clients/<name>/config/default.json` with endpoints and tags
2. Create `clients/<name>/lib/client-config.ts` using `createClientConfig()` pattern
3. Create service classes in `lib/services/` (one per backend service)
4. Create data generators in `lib/` if domain-specific data needed
5. Add static data files to `data/` (loaded via `open()` in init context)
6. Create unit test scenarios in `scenarios/api/` (one per endpoint)
7. Create integration scenarios in `scenarios/integration/` (funnel pattern)
8. Create mixed scenarios in `scenarios/mixed/` (weighted, if applicable)
9. Run `pnpm build` to verify webpack compilation
10. Run `pnpm typecheck` to verify TypeScript types
11. Test with smoke profile: `./bin/run-test.sh --client=<name> --scenario=api/health --profile=smoke`

---

## 17. ENVIRONMENT VARIABLES

| Variable | Purpose | Default |
|----------|---------|---------|
| `K6_PROFILE` | Load profile selection | `smoke` |
| `API_BASE_URL` | Override primary endpoint | From config |
| `WEB_BASE_URL` | Override web endpoint | From config |
| `API_KEY` | API key for gateway auth | (required) |
| `CF_COOKIE` | Cloudflare cookie value | (optional) |

---

## 18. FRAMEWORK UTILITIES REFERENCE

| Utility | Import Path | Purpose |
|---------|-------------|---------|
| `createClientConfig` | `src/core/client-config` | Client config bridge |
| `THINK` | `src/core/client-config` | Think time constants |
| `RequestHelper` | `src/helpers/request-helper` | HTTP client with auto-instrumentation |
| `SafeResponse` | `src/helpers/request-helper` | Response wrapper with `.json()` |
| `DataPool` | `src/helpers/data-pool` | VU-unique data allocation |
| `createPool` | `src/helpers/data-pool` | From JSON content |
| `createCsvPool` | `src/helpers/data-pool` | From CSV content |
| `runChecks` | `src/core/check-system` | Batch check execution |
| `statusCheck` | `src/core/check-system` | Exact status check |
| `statusRangeCheck` | `src/core/check-system` | Range status check |
| `thresholdCheck` | `src/core/check-system` | Response time check |
| `schemaCheck` | `src/core/check-system` | JSON field presence |
| `extractFromResponse` | `src/patterns/correlation-pattern` | Extract data from response |
| `interpolate` | `src/patterns/correlation-pattern` | Template substitution |
| `initFunnelMetrics` | `src/patterns/funnel-pattern` | Register funnel Counters |
| `runFunnel` | `src/patterns/funnel-pattern` | Execute funnel steps |
| `weightedSwitch` | `src/patterns/weighted-execution` | Weighted scenario selection |
| `withRetry` | `src/patterns/retry-pattern` | Exponential backoff |
| `retryRequest` | `src/patterns/retry-pattern` | Retry with status filtering |
| `authenticate` | `src/patterns/auth-pattern` | Bearer/Basic/OAuth2/APIKey flows |
| `ContractValidator` | `src/patterns/contract-validation` | JSON Schema validation |
| `registerCheck` | `src/core/check-system` | Custom named check registration |
| `initPagination` | `src/patterns/pagination-pattern` | Offset/cursor pagination |
| `advancePagination` | `src/patterns/pagination-pattern` | Next page state |
| `standardSetup` | `src/core/execution-engine` | Setup with audit logging |
| `standardTeardown` | `src/core/execution-engine` | Teardown with cleanup |
| `buildK6Options` | `src/core/execution-engine` | Build options from config |
| `generateHtmlReport` | `src/reporting/*` | HTML report generation |
| `generateJsonSummary` | `src/reporting/*` | JSON summary generation |
| `StructuredLogger` | `src/helpers/structured-logger` | JSON logging with masking |
| `RedisHelper` | `src/helpers/redis-helper` | Redis operations (xk6) |
| `UserPool` | `src/patterns/redis-patterns` | VU-unique Redis allocation |
| `DistributedRateLimiter` | `src/patterns/redis-patterns` | Cross-VU rate limiting |
| `StatsCounter` | `src/patterns/redis-patterns` | Atomic Redis counters |
| `DataHelper` | `src/helpers/data-helper` | Random strings/emails/cards |
| `DateHelper` | `src/helpers/date-helper` | Date formatting/arithmetic |
| `ValidationHelper` | `src/helpers/validation-helper` | Email/URL/UUID validators |
| `PerformanceHelper` | `src/helpers/performance-helper` | Percentiles/aggregation |
| `HeaderHelper` | `src/helpers/header-helper` | Tracing/auth/localization |

---

## 19. FACTORY PATTERN (Data Generation)

Services use factory classes with static methods for test data generation:

```typescript
export class UserFactory {
  static random(): User {
    const user = DataHelper.randomUser();
    return { id: user.id, username: user.username, email: user.email, role: "user" };
  }

  static bulk(count: number): User[] {
    return Array.from({ length: count }, () => UserFactory.random());
  }

  static withRole(role: "admin" | "user" | "readonly"): User {
    const user = UserFactory.random();
    return { ...user, role };
  }
}
```

**Rules:**
- Static methods only (no instance state)
- Delegate randomization to `DataHelper` utilities
- Provide overload variants: `random()`, `bulk(N)`, `withRole(role)`
- Each call generates fresh isolated data per VU
- For complex bodies, provide `createFullBody()` and `createMinimalBody()` variants

---

## 20. AUTH PATTERN

### Bearer Token Flow

```typescript
import { authenticate, isSessionValid, AuthSession } from "../../../../src/patterns/auth-pattern";

// In service constructor or setup
static login(baseUrl: string, username: string): AuthSession {
  return authenticate({
    type: "bearer",
    loginUrl: "/api/auth/login",
    username,
    password: __ENV["AUTH_PASSWORD"] || "use-secrets-manager",
    tokenPath: "json.access_token",
    baseUrl,
  });
}

// In service constructor — session scoping per VU
constructor(config: { baseUrl: string; session?: AuthSession }) {
  if (config.session) {
    this.client = config.session.client;  // Pre-authenticated RequestHelper
  } else {
    this.client = new RequestHelper(config.baseUrl);
  }
}
```

**Auth Types:**
- `bearer`: POST to loginUrl, extract token from response
- `basic`: Base64-encoded username:password
- `oauth2`: Client credentials flow
- `apikey`: Header-based (`X-API-Key` or custom header via `extraHeaders`)

**Rules:**
- Session is per-VU, NEVER global
- Use `isSessionValid()` to check token expiry (30s buffer)
- Credentials from `__ENV` or secrets manager, NEVER hardcoded
- Password placeholders: `"use-secrets-manager-in-real-clients"`

---

## 21. CONTRACT VALIDATION PATTERN

Validate API response schemas using JSON Schema:

```typescript
import { ContractValidator } from "../../../../src/patterns/contract-validation";

// Register schemas at module level (init context)
const validator = new ContractValidator();

validator.registerSchema("user-response", {
  type: "object",
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    email: { type: "string", format: "email" },
  },
  required: ["id", "name", "email"],
});

// Validate in default function
export default function (): void {
  const res = svc.getUser(userId);
  const body = res.json<Record<string, unknown>>();

  const result = validator.validate("user-response", body);
  if (!result.valid) {
    const errors = result.errors.map((e) => `${e.path}: ${e.message}`).join("; ");
    console.warn(`Contract violation: ${errors}`);
  }

  check(null, { "contract valid": () => result.valid });
}
```

**Rules:**
- Register schemas in init context (once)
- Use `validate()` for warnings, `assertValid()` for strict enforcement
- Log per-field errors with JSONPath

---

## 22. RETRY PATTERN (Exponential Backoff)

```typescript
import { retryRequest, withRetry } from "../../../../src/patterns/retry-pattern";

// Simple retry on transient errors
const res = retryRequest(
  () => svc.create(body),
  { maxAttempts: 3, retryOnStatus: [429, 500, 502, 503, 504] }
);

// With full result (attempt count, last error)
const result = withRetry(
  () => svc.create(body),
  {
    maxAttempts: 3,
    baseDelaySeconds: 1,
    maxDelaySeconds: 30,
    jitter: 0.3,
    retryOnStatus: [429, 500, 503],
  }
);
```

**Backoff formula:** `base * 2^attempt + jitter(+-30%)`
- Attempt 0: 1s, Attempt 1: 2s, Attempt 2: 4s

---

## 23. PAGINATION PATTERN

```typescript
import { initPagination, advancePagination } from "../../../../src/patterns/pagination-pattern";

const config = {
  style: "offset" as const,
  pageSize: 10,
  itemsPath: "data.items",
};

let state = initPagination(config);

for (let page = 0; page < 5 && state.hasMore; page++) {
  const res = client.get("/api/items", { ...state.nextParams });
  runChecks(res, [statusCheck(200)]);
  state = advancePagination(state, res, config);
  sleep(THINK.FAST);
}
```

**Styles:** `offset` (limit/offset), `page` (page/per_page), `cursor` (cursor-based)

---

## 24. SETUP / TEARDOWN LIFECYCLE

```typescript
import { standardSetup, standardTeardown } from "../../../../src/core/execution-engine";

export function setup(): ReturnType<typeof standardSetup> {
  return standardSetup({
    name: "my-scenario",
    client: "my-client",
    profile: __ENV["K6_PROFILE"] || "smoke",
  });
}

export default function (_data: ReturnType<typeof setup>): void {
  // Test logic
}

export function teardown(data: ReturnType<typeof setup>): void {
  standardTeardown(data);
}
```

**Rules:**
- `setup()` runs once before all VUs (creates audit entry, validates config)
- `teardown()` runs once after all VUs (cleanup, final stats)
- Data from `setup()` is serialized and shared with all VUs
- Teardown failures are warnings, NEVER test failures

---

## 25. REPORT GENERATION (handleSummary)

```typescript
import { generateHtmlReport, generateJsonSummary, ExecutionContext } from "../../../../src/reporting/...";

export function handleSummary(data: Record<string, unknown>): Record<string, string> {
  const context: ExecutionContext = {
    testName: "my-scenario",
    client: "my-client",
    environment: __ENV["K6_ENV"] || "default",
    profile: __ENV["K6_PROFILE"] || "smoke",
    startTime: new Date().toISOString(),
    tags: { client: "my-client", scenario: "my-scenario" },
  };

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const basePath = `./reports/my-client_my-scenario_${timestamp}`;

  return {
    ...generateHtmlReport(data, context, `${basePath}.html`),
    ...generateJsonSummary(data, context, `${basePath}.json`),
    stdout: "\n>> test complete - reports generated\n",
  };
}
```

---

## 26. REDIS PATTERNS (xk6-redis)

Requires k6 compiled with xk6-redis extension.

### Redis Data Pool

```typescript
import { SharedArray } from "k6/data";
import { RedisHelper } from "../../../../src/helpers/redis-helper";
import { UserPool, StatsCounter } from "../../../../src/patterns/redis-patterns";
import { parseCsv } from "../../../../src/patterns/redis-patterns";

// SharedArray — parsed once, shared across all VUs
const rawUsers = new SharedArray("users", function () {
  return parseCsv(open("../../data/users.csv"));
});

export function setup(): { userPoolSize: number } {
  const redis = new RedisHelper();
  const result = redis.bulkLoadHashes("user:", rawUsers as Array<Record<string, string>>);
  console.log(`[setup] Users loaded: ${result.loaded}`);
  redis.disconnect();
  return { userPoolSize: rawUsers.length };
}

export default function (_data: { userPoolSize: number }): void {
  const redis = new RedisHelper();
  const userPool = new UserPool(redis, { prefix: "user:" });
  const stats = new StatsCounter(redis, "my-test");

  const user = userPool.getForVU(__VU, __ITER);  // Deterministic, no collisions
  if (!user || Object.keys(user).length === 0) return;

  stats.inc("requests");
  // ... use user data ...

  redis.disconnect();
}

export function teardown(): void {
  try {
    const redis = new RedisHelper();
    const pool = new UserPool(redis, { prefix: "user:" });
    pool.cleanup();
    redis.disconnect();
  } catch (err) {
    console.warn(`[teardown] Cleanup warning: ${(err as Error).message}`);
  }
}
```

### Distributed Rate Limiter

```typescript
const limiter = new DistributedRateLimiter(redis, "api-endpoint", 1000); // 1000 req/min
if (limiter.allow()) {
  // proceed with request
} else {
  sleep(1); // backoff
}
```

---

## 27. STRUCTURED LOGGING

```typescript
import { StructuredLogger } from "../../../../src/helpers/structured-logger";

const logger = new StructuredLogger({ service: "my-client", env: "default" });

// Request logging
logger.logRequest("POST", "/api/orders", 201, 450, { orderId: "123" });

// Event logging
logger.logEvent("order.created", { orderId: "123", amount: 99.99 });

// Error logging (auto-masks sensitive data)
logger.logError("payment failed", new Error("timeout"), { retries: 3 });

// Child logger with additional context
const childLogger = logger.child({ traceId: "abc-123" });
```

**Rules:**
- Enable with `K6_STRUCTURED_LOGS=true` env var
- Sensitive keys auto-masked (password, token, secret, authorization)
- URLs sanitized (sensitive query params redacted)
- JSON output format

---

## 28. HELPER UTILITIES

### DataHelper — Random Data Generation

```typescript
import { randomString, randomEmail, randomUser, randomPrice, randomCreditCard } from "../../../../src/helpers/data-helper";

randomString(8);                    // "a3f8k2m1"
randomString(16, "0123456789abcdef"); // Hex string
randomEmail();                      // "user_a3f8@test.com"
randomUser();                       // { id, username, email, firstName }
randomPrice(10, 500);               // 234.56
randomCreditCard();                 // Luhn-valid card number
```

### DateHelper — Date Operations

```typescript
import { DateHelper } from "../../../../src/helpers/date-helper";

DateHelper.now();                           // ISO string
DateHelper.format(date, "YYYY-MM-DD");      // "2024-06-15"
DateHelper.addDays(date, 7);                // Date + 7 days
DateHelper.addHours(date, 2);
DateHelper.range(0, 30);                    // { start, end } spanning 30 days
DateHelper.isPast(date);                    // boolean
DateHelper.toUnixTimestamp(date);            // seconds
```

### ValidationHelper — Input Validation

```typescript
import { ValidationHelper } from "../../../../src/helpers/validation-helper";

ValidationHelper.isValidEmail("user@example.com");   // true
ValidationHelper.isValidUrl("https://api.com");       // true
ValidationHelper.isValidUUID("550e8400-...");          // true
ValidationHelper.isValidCreditCard("4532015112830366"); // Luhn check
ValidationHelper.status(res, 200);                     // { passed, message }
ValidationHelper.hasFields(res, ["id", "name"]);       // { passed, message }
ValidationHelper.responseTime(res, 500);               // { passed, message }
```

### PerformanceHelper — Inline Analysis

```typescript
import { PerformanceHelper } from "../../../../src/helpers/performance-helper";

const durations: number[] = [];
// ... collect during test ...

const pct = PerformanceHelper.percentiles(durations);  // { p50, p90, p95, p99 }
const agg = PerformanceHelper.aggregate(durations);     // { count, min, max, avg, stddev }
PerformanceHelper.compareBaseline("p95", 500, 525, 10); // { withinThreshold, ... }
```

### HeaderHelper — Tracing & Auth

```typescript
import { HeaderHelper } from "../../../../src/helpers/header-helper";

HeaderHelper.tracing();       // { X-Correlation-ID, X-Trace-ID, X-Request-ID }
HeaderHelper.auth("bearer", { token: "tok123" });  // { Authorization: "Bearer tok123" }
HeaderHelper.auth("apikey", { key: "mykey" });      // { X-API-Key: "mykey" }
HeaderHelper.localization("es-CL", "CL");           // { Accept-Language, X-Country }
HeaderHelper.userAgent();     // k6-enterprise-framework identifier
HeaderHelper.instrumentation("trace-id");           // W3C traceparent, B3, Jaeger
```

---

## 29. BENCHMARK PATTERN (Framework Overhead)

The `_benchmark` client measures framework overhead vs raw k6:

```typescript
// Phase 1: Raw k6 HTTP (baseline)
const rawStart = Date.now();
const rawRes = http.get(`${BENCHMARK_URL}/api/ping`);
const rawMs = Date.now() - rawStart;

// Phase 2: Framework-wrapped HTTP
const wrappedStart = Date.now();
const wrappedRes = benchHelper.get("/api/ping", undefined, { tags: { benchmark: "wrapped" } });
const wrappedMs = Date.now() - wrappedStart;

// Phase 3: Record overhead
const overhead = wrappedMs - rawMs;
frameworkOverhead.add(Math.max(0, overhead));
```

**Custom threshold:** `framework_overhead_ms: ["p(95)<5"]` — overhead must be < 5ms at p95.

---

## 30. ENVIRONMENT CONFIG HIERARCHY

Multi-environment config support:

```
config/
  default.json      # Base config (always loaded)
  staging.json       # Staging overrides (longer timeouts, test auth)
  production.json    # Production overrides (shorter timeouts, real auth)
```

Selected via `__ENV["K6_ENV"]` (defaults to `"default"`).

**Staging config adds:**
- Longer timeouts (15s vs 10s default)
- Auth config with `loginUrl`, `tokenPath`

**Production config:**
- Shorter timeouts (8s — optimized for prod latency)

---

## 31. MULTI-PROTOCOL TESTING

### GraphQL

```typescript
function gqlPost(query: string, variables: Record<string, unknown>): SafeResponse {
  return client.post("/graphql", { query, variables });
}

const res = gqlPost(`
  query GetUser($id: ID!) {
    user(id: $id) { id name email }
  }
`, { id: "user-1" });

check(null, {
  "no GraphQL errors": () => {
    const body = res.json<Record<string, unknown>>();
    return !body || !("errors" in body);
  },
});
```

### WebSocket

```typescript
import ws from "k6/ws";

const res = ws.connect(WS_URL, {}, (socket) => {
  socket.on("open", () => socket.send("Hello"));
  socket.on("message", (data) => {
    check(null, { "echo received": () => data === "Hello" });
    socket.close();
  });
  socket.setTimeout(() => socket.close(), 5000);
});

check(res, { "ws: connected (101)": (r) => r.status === 101 });
```

### File Upload

```typescript
const file = http.file(csvContent, "data.csv", "text/csv");
const res = http.post(`${BASE_URL}/upload`, {
  file,
  description: "Test upload",
});
```

---

## 32. RATE LIMITING HANDLING

```typescript
import { Counter } from "k6/metrics";
const rateLimited = new Counter("rate_limited_requests");

function requestWithBackoff(url: string, maxRetries = 3): SafeResponse | null {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const res = client.get(url);
    if (res.status === 429) {
      rateLimited.add(1);
      const retryAfter = parseInt(res.headers["Retry-After"] || "2", 10);
      sleep(Math.min(retryAfter, 10));
      continue;
    }
    return res;
  }
  return null;
}
```

---

## 33. CUSTOM CHECK REGISTRATION

```typescript
import { registerCheck } from "../../../../src/core/check-system";

// Register in init context
registerCheck("has-correlation-header", (res) => {
  const r = res as { headers: Record<string, string> };
  return "X-Correlation-Id" in r.headers || "X-Correlation-ID" in r.headers;
});

// Use in scenarios
runChecks(res, [
  statusCheck(200),
  { name: "has-correlation-header", type: "custom" as const, fn: getRegisteredCheck("has-correlation-header") },
]);
```

---

## 34. IDEMPOTENCY PATTERN

For write operations that may be retried:

```typescript
import { randomString } from "../../../../src/helpers/data-helper";

const res = client.post("/api/orders", orderData, {
  extraHeaders: {
    "X-Idempotency-Key": randomString(16),
  },
});
```

---

## 35. EXISTING CLIENTS REFERENCE

| Client | Purpose | Scenarios | Key Patterns |
|--------|---------|-----------|--------------|
| `_reference` | Framework reference implementation | smoke-users, auth-flow, checkout-flow, test-helpers, test-redis | All patterns demonstrated |
| `_benchmark` | Framework overhead measurement | baseline, benchmark-heavy-load | Raw vs wrapped HTTP, overhead metrics |
| `airline-accelerator` | Production airline API | 13 scenarios (api/integration/mixed) | Funnel, weighted, correlation, factory |
| `falabella-seguros` | Insurance SOAP campaign | 23 scenarios (14 unit + 9 flows) | Multi-endpoint, encrypted responses, domain generators |
| `examples` | Pattern cookbook (15 examples) | See index below | One pattern per file |

---

## 36. EXAMPLES COOKBOOK INDEX

The `examples` client provides one-file-per-pattern demonstrations. Each maps to a skill section:

| # | File | Pattern | Skill Section | Key Technique |
|---|------|---------|---------------|---------------|
| 01 | `api/01-auth-bearer.ts` | Bearer Token Auth | S20 | `Authorization: Bearer ${TOKEN}`, env var fallback |
| 02 | `api/02-contract-validation.ts` | JSON Schema Validation | S21 | Inline `requiredFields.every(f => f in parsed)`, field presence |
| 03 | `api/03-pagination.ts` | Offset Pagination | S23 | `page * PAGE_SIZE` loop, verify offset echo in response |
| 04 | `api/04-retry-backoff.ts` | Exponential Backoff | S22 | `BASE_DELAY * Math.pow(2, attempt)`, retry on `status >= 500` |
| 05 | `api/05-correlation.ts` | Request Chaining | S10 | Extract userId from POST response, pass as query param + header |
| 06 | `api/06-weighted-execution.ts` | Weighted Random | S4.D | `pickWeighted([{weight:60,value:browse}, ...])` selection |
| 07 | `api/07-structured-logging.ts` | JSON Logging | S27 | `JSON.stringify({timestamp,level,vu,message,...})`, conditional on `K6_DEBUG` |
| 08 | `api/08-rate-limiting.ts` | 429 Handling | S32 | `Retry-After` header parsing, `Counter("rate_limited_requests")` |
| 09 | `mixed/09-ecommerce-flow.ts` | Multi-Step Journey | S4.C | `group("Browse/Search/Cart/Checkout")`, variable think times, data correlation |
| 10 | `api/10-graphql.ts` | GraphQL Testing | S31 | `{query, variables}` structure, `"errors" in json` check |
| 11 | `api/11-file-upload.ts` | File Upload | S31 | `http.file(content, name, mime)`, multipart POST |
| 12 | `integration/12-websocket.ts` | WebSocket | S31 | `ws.connect()`, `socket.on("message")`, `setTimeout` guard |
| 13 | `mixed/13-multi-protocol.ts` | REST + GraphQL | S31 | REST auth -> GraphQL query -> REST update in one iteration |
| 14 | `api/14-advanced-headers.ts` | Header Tracing | S28 (HeaderHelper) | `X-Request-ID` echo validation, `X-Trace-ID` correlation chain, content negotiation |
| 15 | `integration/15-smoke-baseline.ts` | CI/CD Smoke | S4.B | `group("Health check")`, status + time + content-type + body checks, 1 VU / 15s |

### Example Patterns Summary

**Standalone examples** (no framework dependencies, raw k6):
- Use `http.get/post` directly (no `RequestHelper`)
- Use `__ENV["BASE_URL"]` with httpbin.org fallback
- Hardcode `options` (not `scenarioOptions`) since they demonstrate isolated patterns
- Use `group()` for multi-step flows (09, 13, 14, 15)

**Production clients** upgrade these patterns by:
- Wrapping HTTP in service classes with `RequestHelper`
- Using `scenarioOptions()` for profile inheritance
- Adding `runChecks()` with check factories
- Using `THINK.*` constants instead of raw `sleep()` values
- Capping error logs via `logError()` pattern
