---
title: "Extension Points — Two-Layer Architecture (T-149)"
sidebar_position: 2
---
# Extension Points — Two-Layer Architecture (T-149)

The k6 Enterprise Framework uses a **two-layer architecture**:

- **Generic Layer** (`src/`) — reusable helpers, profiles, reporters, security controls. Maintained by the platform team.
- **Product Layer** (`clients/<name>/`) — client-specific scenarios, mocks, and integrations. Maintained by feature teams.

Product teams extend the framework without forking it via two extension mechanisms:

```
┌─────────────────────────────────────────────────────────────┐
│                    Generic Layer (src/)                     │
│  profiles · reporters · secrets · rbac · execution-engine  │
│                                                             │
│  Extension Points:                                          │
│  ┌──────────────────┐   ┌──────────────────────────────┐   │
│  │  registerCheck() │   │  registerIntegration()       │   │
│  └──────────────────┘   └──────────────────────────────┘   │
└───────────────────────────────┬─────────────────────────────┘
                                │ extends (no fork)
┌───────────────────────────────▼─────────────────────────────┐
│                 Product Layer (clients/<name>/)              │
│  scenarios · mocks · custom checks · service connectors     │
└─────────────────────────────────────────────────────────────┘
```

---

## 1. Custom Checks — `registerCheck()`

Register a named check function that appears in framework HTML/JSON reports
without modifying any generic layer code.

### API

```typescript
// src/core/index.ts — re-exported for product teams
import { registerCheck } from "../../lib/framework";

registerCheck(
  name: string,           // Check identifier (appears in reports)
  fn: (res: Response) => boolean,  // Evaluator function
  options?: {
    description?: string; // Human-readable description
    severity?: "info" | "warning" | "critical";  // default: "warning"
  }
): void
```

### Example 1 — Response schema check

```typescript
// clients/my-team/lib/checks.ts
import { registerCheck } from "../../lib/framework";

registerCheck("user-schema-valid", (res) => {
  try {
    const body = JSON.parse(res.body as string);
    return (
      typeof body.id === "number" &&
      typeof body.email === "string" &&
      typeof body.role === "string"
    );
  } catch {
    return false;
  }
}, { description: "User response matches expected schema", severity: "critical" });
```

```typescript
// clients/my-team/scenarios/api/get-users.ts
import "../lib/checks";  // register checks
import { check } from "k6";
import http from "k6/http";

export default function () {
  const res = http.get(`${__ENV.BASE_URL}/api/users/1`);
  check(res, {
    "user-schema-valid": (r) => r.status === 200,  // framework reports this by name
  });
}
```

### Example 2 — SLA compliance check

```typescript
// clients/my-team/lib/checks.ts
registerCheck("sla-p99-under-1s", (res) => {
  return res.timings.duration < 1000;
}, { description: "p99 latency < 1s per SLA", severity: "critical" });
```

---

## 2. Custom Integrations — `registerIntegration()`

Register a service connector (mock, stub, or real service) that becomes
accessible from any scenario in the client layer.

### API

```typescript
import { registerIntegration } from "../../lib/framework";

registerIntegration(
  name: string,           // Integration identifier
  config: {
    baseUrl: string;      // Service base URL
    headers?: Record<string, string>;
    auth?: { type: "bearer" | "basic"; tokenEnvVar?: string };
    timeout?: string;     // e.g. "10s"
    healthCheck?: string; // Path to verify connectivity
  }
): Integration
```

The returned `Integration` object exposes:
- `integration.get(path, params?)` — HTTP GET
- `integration.post(path, body?, params?)` — HTTP POST
- `integration.put(path, body?, params?)` — HTTP PUT
- `integration.del(path, params?)` — HTTP DELETE

### Example 1 — Mock payment service

```typescript
// clients/my-team/lib/integrations.ts
import { registerIntegration } from "../../lib/framework";

export const paymentService = registerIntegration("payment-mock", {
  baseUrl: __ENV.PAYMENT_MOCK_URL || "http://localhost:8080",
  headers: { "X-Mock-Service": "payment" },
  timeout: "5s",
  healthCheck: "/health",
});
```

```typescript
// clients/my-team/scenarios/checkout-flow.ts
import { paymentService } from "../lib/integrations";
import { check } from "k6";

export default function () {
  const res = paymentService.post("/api/payments", {
    amount: 99.99,
    currency: "USD",
    cardToken: "tok_test_123",
  });
  check(res, {
    "payment accepted": (r) => r.status === 201,
    "payment id returned": (r) => JSON.parse(r.body as string).paymentId !== undefined,
  });
}
```

### Example 2 — External auth service connector

```typescript
// clients/my-team/lib/integrations.ts
export const authService = registerIntegration("auth-service", {
  baseUrl: __ENV.AUTH_URL,
  auth: { type: "bearer", tokenEnvVar: "PLATFORM_TOKEN" },
  timeout: "10s",
  healthCheck: "/health",
});
```

---

## 3. Compatibility guarantee

The generic layer follows semantic versioning. Any update to `src/` that
would break registered extensions constitutes a **breaking change** and
requires a major version bump.

To verify compatibility after a framework update:

```bash
# Run the framework compatibility test suite
npm run test:compatibility

# Or run your client's tests against the new version
./bin/run-test.sh --client=my-team --scenario=api/smoke-users --profile=smoke
```

The framework's integration test (`clients/_reference/`) serves as the
canonical compatibility contract — if `_reference` passes, the extension
points are stable.

---

## 4. Adding new extension types

If you need an extension point not listed here, open a framework issue with:
1. Use case and business justification
2. Proposed API signature
3. Backward-compatibility impact

Do **not** fork `src/` — all generic layer changes must go through the
platform team review process.
