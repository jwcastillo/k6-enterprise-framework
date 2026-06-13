---
title: "Test Types Guide"
sidebar_position: 3
---
# Test Types Guide

**T-179 (Phase 8)** · k6 Enterprise Framework

The framework supports four test type categories, each suited to different validation goals. Choose based on what you need to validate.

---

## Test Type Selection

```
What do you need to validate?
│
├── API endpoints / HTTP services ──────────────────► Unit (API)
│
├── End-to-end user flows (multiple services) ──────► Flow (Integration)
│
├── Real browser interactions (JS-rendered pages) ──► Browser
│
└── Multiple protocols in a single test ────────────► Mixed
```

---

## 1. Unit (API) Tests

**Directory:** `scenarios/api/`
**Protocol:** HTTP/1.1, HTTP/2, gRPC

### When to Use
- Validating a single API endpoint in isolation
- Smoke testing after deployment
- Benchmarking a specific microservice
- Contract testing against an OpenAPI spec

### Example

```typescript
// scenarios/api/smoke-users.ts
import { sleep } from "k6";
import { UsersService } from "../../lib/services/users.service";

export const options = {
  scenarios: {
    "smoke-users": {
      executor: "constant-vus",
      vus: 2,
      duration: "1m",
    },
  },
  thresholds: {
    http_req_duration: ["p(95)<500"],
    http_req_failed: ["rate<0.01"],
  },
};

const BASE_URL = __ENV.BASE_URL || "https://api.example.com";

export default function () {
  const svc = new UsersService(BASE_URL);
  svc.list();
  sleep(1);
}
```

### Run

```bash
./bin/run-test.sh --client=my-team --scenario=api/smoke-users --profile=smoke
```

---

## 2. Flow (Integration) Tests

**Directory:** `scenarios/integration/`
**Protocol:** HTTP + service dependencies

### When to Use
- Validating multi-step user journeys (login → browse → checkout)
- Integration between multiple microservices
- Data consistency across service boundaries
- Realistic user behavior simulation

### Example

```typescript
// scenarios/integration/checkout-flow.ts
import { sleep } from "k6";
import { group, check } from "k6";
import { UsersService } from "../../lib/services/users.service";
import { OrdersService } from "../../lib/services/orders.service";
import { PaymentsService } from "../../lib/services/payments.service";

export const options = {
  scenarios: {
    "checkout-flow": {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "1m", target: 10 },
        { duration: "3m", target: 10 },
        { duration: "1m", target: 0 },
      ],
    },
  },
  thresholds: {
    "http_req_duration{flow:checkout}": ["p(95)<2000"],
    http_req_failed: ["rate<0.02"],
  },
};

const BASE_URL = __ENV.BASE_URL || "https://api.example.com";

export default function () {
  const users = new UsersService(BASE_URL);
  const orders = new OrdersService(BASE_URL);
  const payments = new PaymentsService(BASE_URL);

  group("checkout", () => {
    users.login({ email: "test@example.com", password: "pass" });
    orders.create({ items: [{ id: 1, qty: 2 }] });
    payments.charge({ amount: 99.99, currency: "USD" });
  });

  sleep(2);
}
```

### Run

```bash
./bin/run-test.sh --client=my-team --scenario=integration/checkout-flow --profile=load
```

---

## 3. Browser Tests

**Directory:** `scenarios/browser/`
**Protocol:** Browser (Chromium via k6 browser module)
**Requirement:** k6 compiled with browser support (`xk6-browser`)

### When to Use
- Testing JS-rendered SPAs (React, Vue, Angular)
- Measuring real Core Web Vitals (LCP, CLS, FID)
- Validating forms, navigation, and dynamic interactions
- Capturing screenshots for visual regression
- End-user experience from a real browser perspective

### Example

```typescript
// scenarios/browser/login-flow.ts
import { browser } from "k6/experimental/browser";
import { check } from "k6";

export const options = {
  scenarios: {
    "login-browser": {
      executor: "shared-iterations",
      vus: 2,
      iterations: 10,
      options: {
        browser: { type: "chromium" },
      },
    },
  },
};

export default async function () {
  const page = await browser.newPage();

  try {
    await page.goto(__ENV.BASE_URL + "/login");

    await page.locator('input[name="email"]').type("test@example.com");
    await page.locator('input[name="password"]').type("password");
    await page.locator('button[type="submit"]').click();

    check(page, {
      "redirected to dashboard": () => page.url().includes("/dashboard"),
    });

    // Screenshot captured automatically for HTML report
    await page.screenshot({ path: `reports/screenshots/login-${Date.now()}.png` });
  } finally {
    await page.close();
  }
}
```

### Run

```bash
# Requires K6_BROWSER_ENABLED=true or xk6-browser binary
K6_BROWSER_ENABLED=true \
  ./bin/run-test.sh --client=my-team --scenario=browser/login-flow --profile=smoke
```

---

## 4. Mixed Tests

**Directory:** `scenarios/mixed/`
**Protocol:** HTTP + WebSocket + Browser (or any combination)

### When to Use
- Testing real-time features (chat, notifications, live dashboards) alongside REST APIs
- GraphQL APIs with subscription support
- Applications mixing REST and WebSocket protocols
- Comprehensive load tests covering multiple communication channels

### Example

```typescript
// scenarios/mixed/realtime-dashboard.ts
import http from "k6/http";
import { WebSocket } from "k6/experimental/websockets";
import { check, sleep } from "k6";
import { Trend } from "k6/metrics";

const wsLatency = new Trend("ws_message_latency");

export const options = {
  scenarios: {
    "http-api": {
      executor: "constant-vus",
      vus: 10,
      duration: "5m",
    },
    "ws-realtime": {
      executor: "constant-vus",
      vus: 5,
      duration: "5m",
    },
  },
  thresholds: {
    http_req_duration: ["p(95)<500"],
    ws_message_latency: ["p(95)<200"],
    http_req_failed: ["rate<0.01"],
  },
};

const BASE_URL = __ENV.BASE_URL || "https://api.example.com";
const WS_URL = __ENV.WS_URL || "wss://api.example.com/ws";

export function httpScenario() {
  const res = http.get(`${BASE_URL}/dashboard/metrics`);
  check(res, { "metrics: 200": (r) => r.status === 200 });
  sleep(1);
}

export function wsScenario() {
  const ws = new WebSocket(WS_URL);
  const start = Date.now();

  ws.onmessage = (msg) => {
    wsLatency.add(Date.now() - start);
    check(msg, { "received update": () => msg.data.length > 0 });
  };

  ws.send(JSON.stringify({ subscribe: "dashboard" }));
  sleep(5);
  ws.close();
}

export default httpScenario;
```

### Run

```bash
./bin/run-test.sh \
  --client=my-team \
  --scenario=mixed/realtime-dashboard \
  --profile=load
```

---

## Comparison Table

| Type | Protocol | Metrics | Artifacts | Typical VUs |
|------|----------|---------|-----------|-------------|
| Unit (API) | HTTP/gRPC | p95, error rate, RPS | HTML, JSON | 1–500 |
| Flow | HTTP | p95 per group, checks | HTML, JSON | 5–100 |
| Browser | Chromium | LCP, CLS, FID, TTFB | HTML + screenshots | 1–10 |
| Mixed | HTTP + WS + more | All combined | HTML + screenshots | 5–200 |

---

## Configuration Hierarchy

```
Environment defaults (BASE_URL, API_TOKEN, ...)
        │
        ▼
clients/<name>/config/default.json   ← base config
        │
        ▼
clients/<name>/config/<env>.json     ← environment override (staging, production)
        │
        ▼
--profile=<name> CLI flag            ← load profile override (VUs, stages, thresholds)
        │
        ▼
scenario options object              ← final merged configuration (highest precedence)
```

### Precedence rules

1. **Scenario `options`** — always wins (hardcoded in the `.ts` file)
2. **`--profile` flag** — overrides executor settings (VUs, stages, duration)
3. **Environment config** — `config/staging.json` overrides `config/default.json`
4. **Default config** — `config/default.json` is the base

```bash
# Example: staging environment + stress profile
./bin/run-test.sh \
  --client=my-team \
  --scenario=api/smoke-users \
  --env=staging \
  --profile=stress
```

---

## Scenario File Location Reference

```
clients/
└── my-team/
    └── scenarios/
        ├── api/            # Unit API tests (HTTP)
        │   ├── smoke-users.ts
        │   └── load-orders.ts
        ├── integration/    # Multi-service flow tests
        │   ├── checkout-flow.ts
        │   └── auth-flow.ts
        ├── browser/        # Browser tests (Chromium)
        │   └── login-flow.ts
        └── mixed/          # Multi-protocol tests
            └── realtime-dashboard.ts
```

---

## Test Gating (quarantine / experimental / unsafe)

**T-261** introduces an orthogonal safety axis for scenario execution, inspired by the GitLab
Performance Tool (GPT) gating conventions. A gated scenario self-declares its status with a
single top-level export; the runner refuses to execute it unless the matching CLI flag is
supplied.

> **Gating is NOT a 6th bucket.** Gated scenarios still live inside one of the five canonical
> buckets (`api/`, `flow/`, `domain/`, `chaos/`, `perf/`). The gate controls whether the runner
> will execute the scenario without an explicit opt-in flag — it does not affect file location.

### Gate marker

Add one of these constants to the top level of your scenario file. The value **must use double
quotes** (Prettier-enforced style; single-quoted values are intentionally ignored by the runner):

```typescript
// scenarios/perf/stress-new-checkout.ts
export const gate = "quarantined";   // blocked unless --quarantined is passed
// or:
export const gate = "experimental";  // blocked unless --experimental is passed
// or:
export const gate = "unsafe";        // blocked unless --unsafe is passed
```

Scenarios without a `gate` export are never blocked.

### CLI flags

| Flag             | Unlocks                  |
|------------------|--------------------------|
| `--quarantined`  | `gate = "quarantined"`   |
| `--experimental` | `gate = "experimental"`  |
| `--unsafe`       | `gate = "unsafe"`        |

Each flag is exclusive — passing `--experimental` does **not** unlock a `quarantined` scenario.

### Default-deny behavior

Without the matching flag the runner exits immediately with code **108**:

```bash
# Blocked — exits 108
./bin/run-test.sh --client=my-team --scenario=perf/stress-new-checkout --profile=stress

# Allowed — runs normally
./bin/run-test.sh --client=my-team --scenario=perf/stress-new-checkout --profile=stress \
  --quarantined
```

### Use cases

| Gate kind      | Typical use case |
|----------------|-----------------|
| `quarantined`  | Known-broken scenario kept in the repo for investigation |
| `experimental` | Scenario under active development, not yet CI-gate-ready |
| `unsafe`       | Scenario that causes destructive side-effects (data wipe, DDOS-level load) |

---

*See also: [LOAD_PROFILES.md](/docs/framework/load-profiles) · [WORKFLOW.md](/docs/framework/workflow) · [DOCKER.md](/docs/framework/observability/docker)*
