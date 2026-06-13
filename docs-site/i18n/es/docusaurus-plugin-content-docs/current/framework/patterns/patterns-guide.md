---
title: "Guía de Patrones"
sidebar_position: 1
---
# Guía de Patrones

Patrones de ejecución reutilizables para autenticación, retry, paginación, correlación, distribución ponderada, inyección de caos, validación de contratos, funnels, mock servers y coordinación distribuida con Redis.

---

## Tabla de Contenidos

1. [Resumen](#resumen)
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

## Resumen

Todos los patrones viven en `src/patterns/` y se exportan desde `src/patterns/index.ts`. Impórtalos directamente o vía el barrel export:

```typescript
import { authenticate, withRetry, weightedSwitch } from "../../src/patterns";
```

Los patrones corren en el **runtime goja de k6** salvo que se indique lo contrario.

---

## AuthPattern

**Archivo:** `src/patterns/auth-pattern.ts`

Factory unificado de autenticación. Devuelve un `AuthSession` con un `RequestHelper` preconfigurado.

| Tipo | Flujo | Headers |
|------|-------|---------|
| `bearer` | POST al login URL, extrae el token | `Authorization: Bearer <token>` |
| `basic` | Credenciales embebidas por request | `Authorization: Basic <base64>` |
| `oauth2` | Client credentials grant | `Authorization: Bearer <access_token>` |
| `apikey` | Key estática como header | `X-API-Key: <key>` (configurable) |

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

if (!isSessionValid(session)) { /* re-autenticar */ }
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

**Archivo:** `src/patterns/retry-pattern.ts`

Exponential backoff con jitter. Reintenta por defecto en status codes 429, 500, 502, 503, 504.

```typescript
import { withRetry, retryRequest } from "../../src/patterns/retry-pattern";

const res = retryRequest(() => client.get("/endpoint"), { maxAttempts: 5, baseDelaySeconds: 2 });

const result = withRetry(
  (attempt) => client.get("/api/data"),
  { maxAttempts: 3, baseDelaySeconds: 1, maxDelaySeconds: 30, jitter: 0.3 }
);
// result: { value: SafeResponse, attempts: number, lastError?: string }
```

| Campo | Tipo | Default | Descripción |
|-------|------|---------|-------------|
| `maxAttempts` | `number` | `3` | Intentos máximos |
| `baseDelaySeconds` | `number` | `1` | Delay base |
| `maxDelaySeconds` | `number` | `30` | Tope máximo de delay |
| `jitter` | `number` | `0.3` | Factor de aleatoriedad (0-1) |
| `retryOnStatus` | `number[]` | `[429,500,502,503,504]` | Status codes reintentables |
| `retryOnError` | `boolean` | `true` | Reintenta en excepciones |

Delay: `min(base * 2^n, max) +/- jitter`.

---

## PaginationPattern

**Archivo:** `src/patterns/pagination-pattern.ts`

Recorre APIs paginadas. Soporta estilos offset, cursor y por página.

```typescript
import { traverseAll, initPagination, advancePagination } from "../../src/patterns/pagination-pattern";

const allUsers = traverseAll<User>(client, "/api/users", {
  style: "offset", pageSize: 50, itemsPath: "data", totalPath: "meta.total",
}, 20);

// Recorrido manual
const config = { style: "cursor" as const, cursorParam: "after", nextCursorPath: "pagination.next", itemsPath: "results" };
let state = initPagination(config);
while (state.hasMore) {
  const res = client.get("/api/items", state.nextParams);
  state = advancePagination(state, res, config);
}
```

| Estilo | Config Clave | Condición de Stop |
|--------|--------------|-------------------|
| `offset` | `limitParam`, `offsetParam`, `pageSize` | Items < pageSize |
| `cursor` | `cursorParam`, `nextCursorPath` | El siguiente cursor es null |
| `page` | `pageParam`, `sizeParam`, `totalPagesPath` | Page >= totalPages |

---

## CorrelationPattern

**Archivo:** `src/patterns/correlation-pattern.ts`

Extrae valores de las respuestas y los inyecta en requests subsecuentes.

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

Métodos de extracción: `jsonPath` (dot-notation), `header` (header de respuesta), `regex` (capture group). Define `required: true` para lanzar excepción en caso de fallo.

---

## WeightedExecution

**Archivo:** `src/patterns/weighted-execution.ts`

Distribuye iteraciones entre escenarios por pesos relativos.

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

Los pesos son relativos (no necesitan sumar 100). Usa `weightedSelect()` para obtener la selección sin ejecutarla.

---

## ChaosInjection

**Archivo:** `src/patterns/chaos-injection.ts`

Inyección de fallas controlada con distribución determinista. Ver [MOCKS_CHAOS.md](/es/docs/framework/patterns/mocks-chaos).

| Tipo de Falla | Descripción | Params Clave |
|---------------|-------------|--------------|
| `latency` | Delay artificial | `delayMs` (default: 2000) |
| `http_error` | Respuesta de error HTTP | `statusCode` (default: 503) |
| `disconnect` | Caída de conexión | `afterBytes` |
| `corruption` | Body de respuesta alterado | `corruptionType` |
| `partial_timeout` | Respuesta incompleta | `initialBytes`, `hangMs` |
| `rate_limit` | 429 Too Many Requests | `retryAfterSec` (default: 30) |

Se configura vía `clients/{name}/config/chaos.json`. Los reportes separan los errores inyectados por caos de los errores genuinos.

---

## ContractValidation

**Archivo:** `src/patterns/contract-validation.ts`

Validación de JSON Schema usando AJV con soporte de formatos.

```typescript
import { ContractValidator } from "../../src/patterns/contract-validation";

const validator = new ContractValidator();
validator.registerSchema("user", {
  type: "object", required: ["id", "email"],
  properties: { id: { type: "string", format: "uuid" }, email: { type: "string", format: "email" } },
});

const result = validator.validate("user", res.json());
validator.assertValid("user", res.json());  // lanza excepción en caso de fallo
```

Registra los schemas en tiempo de init. Se exporta un singleton `defaultValidator`.

---

## FunnelPattern

**Archivo:** `src/patterns/funnel-pattern.ts`

Pasos secuenciales con tracking de drop-off. Cada paso corre dentro de un `group()` de k6.

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
initFunnelMetrics(config);  // DEBE estar a nivel de módulo

export default function () {
  const result = runFunnel(config);
  // { completed, stepsEntered, stepsCompleted, dropOffStep }
}
```

Métricas Counter por paso: `funnel_{name}__{step}_entered` y `funnel_{name}__{step}_completed`.

---

## MockServer

**Archivo:** `src/node/mock-server.ts` (Solo Node — reubicado desde `src/patterns/` en Phase 4 / ARC-06)

Servidor de mocks HTTP liviano (contexto Node.js). Ver [MOCKS_CHAOS.md](/es/docs/framework/patterns/mocks-chaos).

Templates: `{{counter}}`, `{{timestamp}}`, `{{uuid}}`, `{{randomInt(min,max)}}`. Latencia: ms fijos o `{ mean, stddev }`.

---

## RedisPatterns

**Archivo:** `src/patterns/redis-patterns.ts`

Tres patrones distribuidos de coordinación (requieren xk6-redis):

- **UserPool** -- datos únicos por VU con política de agotamiento `recycle` o `error`
- **DistributedRateLimiter** -- rate limiting cross-VU vía INCR atómico
- **StatsCounter** -- contadores atómicos para métricas en vivo

También exporta `parseCsv()` y `parseCsvLine()`.

---

## Documentación Relacionada

- [Mocks & Chaos Injection](/es/docs/framework/patterns/mocks-chaos)
- Helpers Reference
- [Redis Data Support](/es/docs/framework/helpers/redis-data)
- [Workflow](/es/docs/framework/workflow)
