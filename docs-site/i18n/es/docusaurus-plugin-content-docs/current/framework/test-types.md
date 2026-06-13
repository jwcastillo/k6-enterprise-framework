---
title: "Guia de Tipos de Prueba"
sidebar_position: 3
---
# Guia de Tipos de Prueba

**T-179 (Fase 8)** · k6 Enterprise Framework

El framework soporta cuatro categorias de tipos de prueba, cada una adecuada para diferentes objetivos de validacion. Elige segun lo que necesites validar.

---

## Seleccion del Tipo de Prueba

```
¿Que necesitas validar?
│
├── Endpoints de API / servicios HTTP ────────────────► Unit (API)
│
├── Flujos de usuario de extremo a extremo (multiples servicios) ──► Flow (Integracion)
│
├── Interacciones reales del navegador (paginas renderizadas con JS) ──► Browser
│
└── Multiples protocolos en una sola prueba ──────────► Mixed
```

---

## 1. Pruebas Unitarias (API)

**Directorio:** `scenarios/api/`
**Protocolo:** HTTP/1.1, HTTP/2, gRPC

### Cuando Usar
- Validar un endpoint de API individual de forma aislada
- Pruebas de humo despues de un despliegue
- Benchmarking de un microservicio especifico
- Pruebas de contrato contra una especificacion OpenAPI

### Ejemplo

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

### Ejecutar

```bash
./bin/run-test.sh --client=my-team --scenario=api/smoke-users --profile=smoke
```

---

## 2. Pruebas de Flujo (Integracion)

**Directorio:** `scenarios/integration/`
**Protocolo:** HTTP + dependencias de servicios

### Cuando Usar
- Validar recorridos de usuario de multiples pasos (login → navegar → pagar)
- Integracion entre multiples microservicios
- Consistencia de datos a traves de fronteras de servicios
- Simulacion realista del comportamiento del usuario

### Ejemplo

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

### Ejecutar

```bash
./bin/run-test.sh --client=my-team --scenario=integration/checkout-flow --profile=load
```

---

## 3. Pruebas de Navegador

**Directorio:** `scenarios/browser/`
**Protocolo:** Navegador (Chromium via modulo browser de k6)
**Requisito:** k6 compilado con soporte de navegador (`xk6-browser`)

### Cuando Usar
- Probar SPAs renderizadas con JS (React, Vue, Angular)
- Medir Core Web Vitals reales (LCP, CLS, FID)
- Validar formularios, navegacion e interacciones dinamicas
- Capturar capturas de pantalla para regresion visual
- Experiencia del usuario final desde la perspectiva de un navegador real

### Ejemplo

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
      "redirigido al dashboard": () => page.url().includes("/dashboard"),
    });

    // Captura de pantalla tomada automaticamente para el informe HTML
    await page.screenshot({ path: `reports/screenshots/login-${Date.now()}.png` });
  } finally {
    await page.close();
  }
}
```

### Ejecutar

```bash
# Requiere K6_BROWSER_ENABLED=true o el binario xk6-browser
K6_BROWSER_ENABLED=true \
  ./bin/run-test.sh --client=my-team --scenario=browser/login-flow --profile=smoke
```

---

## 4. Pruebas Mixtas

**Directorio:** `scenarios/mixed/`
**Protocolo:** HTTP + WebSocket + Navegador (o cualquier combinacion)

### Cuando Usar
- Probar funcionalidades en tiempo real (chat, notificaciones, dashboards en vivo) junto con APIs REST
- APIs GraphQL con soporte de suscripciones
- Aplicaciones que mezclan protocolos REST y WebSocket
- Pruebas de carga integrales que cubren multiples canales de comunicacion

### Ejemplo

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
    check(msg, { "actualizacion recibida": () => msg.data.length > 0 });
  };

  ws.send(JSON.stringify({ subscribe: "dashboard" }));
  sleep(5);
  ws.close();
}

export default httpScenario;
```

### Ejecutar

```bash
./bin/run-test.sh \
  --client=my-team \
  --scenario=mixed/realtime-dashboard \
  --profile=load
```

---

## Tabla Comparativa

| Tipo | Protocolo | Metricas | Artefactos | VUs Tipicos |
|------|-----------|----------|------------|-------------|
| Unit (API) | HTTP/gRPC | p95, tasa de error, RPS | HTML, JSON | 1–500 |
| Flow | HTTP | p95 por grupo, checks | HTML, JSON | 5–100 |
| Browser | Chromium | LCP, CLS, FID, TTFB | HTML + capturas de pantalla | 1–10 |
| Mixed | HTTP + WS + mas | Todos combinados | HTML + capturas de pantalla | 5–200 |

---

## Jerarquia de Configuracion

```
Variables de entorno por defecto (BASE_URL, API_TOKEN, ...)
        │
        ▼
clients/<name>/config/default.json   ← configuracion base
        │
        ▼
clients/<name>/config/<env>.json     ← sobreescritura de entorno (staging, production)
        │
        ▼
--profile=<name> flag del CLI        ← sobreescritura del perfil de carga (VUs, stages, thresholds)
        │
        ▼
scenario options object              ← configuracion final combinada (mayor precedencia)
```

### Reglas de precedencia

1. **`options` del escenario** — siempre gana (definido en el archivo `.ts`)
2. **Flag `--profile`** — sobreescribe la configuracion del ejecutor (VUs, stages, duration)
3. **Configuracion del entorno** — `config/staging.json` sobreescribe `config/default.json`
4. **Configuracion por defecto** — `config/default.json` es la base

```bash
# Ejemplo: entorno staging + perfil stress
./bin/run-test.sh \
  --client=my-team \
  --scenario=api/smoke-users \
  --env=staging \
  --profile=stress
```

---

## Referencia de Ubicacion de Archivos de Escenario

```
clients/
└── my-team/
    └── scenarios/
        ├── api/            # Pruebas unitarias de API (HTTP)
        │   ├── smoke-users.ts
        │   └── load-orders.ts
        ├── integration/    # Pruebas de flujo multi-servicio
        │   ├── checkout-flow.ts
        │   └── auth-flow.ts
        ├── browser/        # Pruebas de navegador (Chromium)
        │   └── login-flow.ts
        └── mixed/          # Pruebas multi-protocolo
            └── realtime-dashboard.ts
```

---

## Control de Ejecución por Nivel de Riesgo (quarantine / experimental / unsafe)

**T-261** introduce un eje de seguridad ortogonal para la ejecución de escenarios, inspirado en las
convenciones de gatekeeping de la herramienta GitLab Performance Tool (GPT). Un escenario controlado
declara su estado con una única exportación de nivel superior; el runner se niega a ejecutarlo a
menos que se pase el flag CLI correspondiente.

> **El gatekeeping NO es un sexto bucket.** Los escenarios controlados siguen residiendo dentro de
> uno de los cinco buckets canónicos (`api/`, `flow/`, `domain/`, `chaos/`, `perf/`). El gate
> controla si el runner ejecutará el escenario sin un flag de opt-in explícito — no afecta a la
> ubicación del archivo.

### Marcador de gate

Añade una de estas constantes al nivel superior de tu archivo de escenario. El valor **debe usar
comillas dobles** (estilo impuesto por Prettier; los valores con comillas simples son ignorados
intencionalmente por el runner):

```typescript
// scenarios/perf/stress-new-checkout.ts
export const gate = "quarantined";   // bloqueado sin --quarantined
// o:
export const gate = "experimental";  // bloqueado sin --experimental
// o:
export const gate = "unsafe";        // bloqueado sin --unsafe
```

Los escenarios sin exportación `gate` nunca son bloqueados.

### Flags del CLI

| Flag             | Desbloquea               |
|------------------|--------------------------|
| `--quarantined`  | `gate = "quarantined"`   |
| `--experimental` | `gate = "experimental"`  |
| `--unsafe`       | `gate = "unsafe"`        |

Cada flag es exclusivo — pasar `--experimental` **no** desbloquea un escenario `quarantined`.

### Comportamiento de denegación por defecto

Sin el flag correspondiente el runner termina inmediatamente con código **108**:

```bash
# Bloqueado — sale con 108
./bin/run-test.sh --client=my-team --scenario=perf/stress-new-checkout --profile=stress

# Permitido — se ejecuta normalmente
./bin/run-test.sh --client=my-team --scenario=perf/stress-new-checkout --profile=stress \
  --quarantined
```

### Casos de uso

| Tipo de gate   | Caso de uso típico |
|----------------|--------------------|
| `quarantined`  | Escenario roto conocido, mantenido en el repo para investigación |
| `experimental` | Escenario en desarrollo activo, aún no listo para CI |
| `unsafe`       | Escenario con efectos secundarios destructivos (borrado de datos, carga a nivel DDoS) |

---

*Ver tambien: [LOAD_PROFILES.es.md](/es/docs/framework/load-profiles) · [WORKFLOW.es.md](/es/docs/framework/workflow) · [DOCKER.es.md](/es/docs/framework/observability/docker)*
