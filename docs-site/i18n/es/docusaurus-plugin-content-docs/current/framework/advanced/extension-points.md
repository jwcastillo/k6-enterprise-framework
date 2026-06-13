---
title: "Puntos de Extensión — Arquitectura de Dos Capas (T-149)"
sidebar_position: 2
---
# Puntos de Extensión — Arquitectura de Dos Capas (T-149)

El k6 Enterprise Framework utiliza una **arquitectura de dos capas**:

- **Capa Genérica** (`src/`) — helpers reutilizables, perfiles, reporteros, controles de seguridad. Mantenida por el equipo de plataforma.
- **Capa de Producto** (`clients/<name>/`) — escenarios específicos del cliente, mocks e integraciones. Mantenida por los equipos de funcionalidad.

Los equipos de producto extienden el framework sin bifurcarlo mediante dos mecanismos de extensión:

```
┌─────────────────────────────────────────────────────────────┐
│                    Capa Genérica (src/)                      │
│  profiles · reporters · secrets · rbac · execution-engine   │
│                                                             │
│  Puntos de Extensión:                                       │
│  ┌──────────────────┐   ┌──────────────────────────────┐   │
│  │  registerCheck() │   │  registerIntegration()       │   │
│  └──────────────────┘   └──────────────────────────────┘   │
└───────────────────────────────┬─────────────────────────────┘
                                │ extiende (sin fork)
┌───────────────────────────────▼─────────────────────────────┐
│                 Capa de Producto (clients/<name>/)            │
│  scenarios · mocks · checks personalizados · conectores     │
└─────────────────────────────────────────────────────────────┘
```

---

## 1. Checks Personalizados — `registerCheck()`

Registra una función de check con nombre que aparece en los reportes HTML/JSON del framework
sin modificar ningún código de la capa genérica.

### API

```typescript
// src/core/index.ts — re-exportado para equipos de producto
import { registerCheck } from "../../lib/framework";

registerCheck(
  name: string,           // Identificador del check (aparece en reportes)
  fn: (res: Response) => boolean,  // Función evaluadora
  options?: {
    description?: string; // Descripción legible para humanos
    severity?: "info" | "warning" | "critical";  // por defecto: "warning"
  }
): void
```

### Ejemplo 1 — Check de esquema de respuesta

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
import "../lib/checks";  // registrar checks
import { check } from "k6";
import http from "k6/http";

export default function () {
  const res = http.get(`${__ENV.BASE_URL}/api/users/1`);
  check(res, {
    "user-schema-valid": (r) => r.status === 200,  // el framework reporta esto por nombre
  });
}
```

### Ejemplo 2 — Check de cumplimiento de SLA

```typescript
// clients/my-team/lib/checks.ts
registerCheck("sla-p99-under-1s", (res) => {
  return res.timings.duration < 1000;
}, { description: "p99 latency < 1s per SLA", severity: "critical" });
```

---

## 2. Integraciones Personalizadas — `registerIntegration()`

Registra un conector de servicio (mock, stub o servicio real) que se vuelve
accesible desde cualquier escenario en la capa de producto.

### API

```typescript
import { registerIntegration } from "../../lib/framework";

registerIntegration(
  name: string,           // Identificador de la integración
  config: {
    baseUrl: string;      // URL base del servicio
    headers?: Record<string, string>;
    auth?: { type: "bearer" | "basic"; tokenEnvVar?: string };
    timeout?: string;     // ej. "10s"
    healthCheck?: string; // Ruta para verificar conectividad
  }
): Integration
```

El objeto `Integration` retornado expone:
- `integration.get(path, params?)` — HTTP GET
- `integration.post(path, body?, params?)` — HTTP POST
- `integration.put(path, body?, params?)` — HTTP PUT
- `integration.del(path, params?)` — HTTP DELETE

### Ejemplo 1 — Servicio de pago mock

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

### Ejemplo 2 — Conector de servicio de autenticación externo

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

## 3. Garantía de compatibilidad

La capa genérica sigue versionado semántico. Cualquier actualización de `src/` que
rompa extensiones registradas constituye un **cambio incompatible** y
requiere un incremento de versión mayor.

Para verificar la compatibilidad después de una actualización del framework:

```bash
# Ejecutar la suite de pruebas de compatibilidad del framework
npm run test:compatibility

# O ejecutar las pruebas de tu cliente contra la nueva versión
./bin/run-test.sh --client=my-team --scenario=api/smoke-users --profile=smoke
```

La prueba de integración del framework (`clients/_reference/`) sirve como el
contrato de compatibilidad canónico — si `_reference` pasa, los puntos de
extensión son estables.

---

## 4. Agregar nuevos tipos de extensión

Si necesitas un punto de extensión no listado aquí, abre un issue del framework con:
1. Caso de uso y justificación de negocio
2. Firma de API propuesta
3. Impacto en compatibilidad hacia atrás

**No** bifurques `src/` — todos los cambios a la capa genérica deben pasar por el
proceso de revisión del equipo de plataforma.
