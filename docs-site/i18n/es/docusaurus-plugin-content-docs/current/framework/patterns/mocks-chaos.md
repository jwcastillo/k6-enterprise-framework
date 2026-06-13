---
title: "Mocks y Chaos Injection"
sidebar_position: 2
---
# Mocks y Chaos Injection

Configuracion del mock server para simular dependencias y de la inyeccion de caos para pruebas de resiliencia.

---

## Tabla de contenidos

1. [Mock server](#mock-server)
   - [Configuracion](#configuracion-del-mock-server)
   - [Templates dinamicos](#templates-dinamicos)
   - [Latencia simulada](#latencia-simulada)
   - [Uso en escenarios k6](#uso-en-escenarios-k6)
2. [Chaos injection](#chaos-injection)
   - [Tipos de fault](#tipos-de-fault)
   - [Configuracion](#configuracion-de-chaos)
   - [Reporteria diferenciada](#reporteria-diferenciada)
3. [Tabla comparativa](#tabla-comparativa)

---

## Mock server

El mock server (`src/node/mock-server.ts` — Node-only, reubicado desde `src/patterns/` en Phase 4 / ARC-06) es un servidor HTTP ligero que arranca durante la fase `setup` del test y se apaga en `teardown`. Simula dependencias externas (APIs de terceros, servicios upstream) sin necesidad de acceso real a ellas.

Corre en el contexto Node.js (no en el runtime k6/goja).

### Configuracion del mock server

Los archivos de configuracion viven en `clients/{nombre}/mocks/`:

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

### Templates dinamicos

El motor de templates procesa variables dinamicas en los campos `body`:

| Variable                    | Descripcion                                      | Ejemplo de salida        |
|-----------------------------|--------------------------------------------------|--------------------------|
| `{{counter}}`               | Entero auto-incremental por cada request         | `1`, `2`, `3`, ...       |
| `{{timestamp}}`             | Fecha y hora ISO 8601 del momento del request    | `2026-02-17T15:30:00Z`   |
| `{{uuid}}`                  | UUID v4 aleatorio                                | `f47ac10b-58cc-...`      |
| `{{randomInt(min,max)}}`    | Entero aleatorio en el rango `[min, max]`        | `{{randomInt(1,100)}}` → `42` |

Los templates funcionan en strings y en objetos JSON anidados.

### Latencia simulada

El campo `latency` acepta dos formatos:

```json
// Latencia fija (ms)
"latency": 200

// Distribucion normal (Box-Muller): mean +/- stddev
"latency": { "mean": 100, "stddev": 20 }
```

Con distribucion normal, la mayoria de responses caen cerca del `mean`, con variabilidad natural. Util para simular servicios reales con jitter.

### Uso en escenarios k6

```typescript
// clients/acme/scenarios/payments-with-mock.ts
import { setup, teardown } from "../../../src/node/mock-server";
import http from "k6/http";

export function setup() {
  // El mock server arranca antes de que los VUs comiencen
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

## Chaos injection

El modulo de chaos injection (`src/patterns/chaos-injection.ts`) introduce fallos controlados y deterministas durante la ejecucion de tests para verificar la resiliencia del sistema bajo prueba.

### Tipos de fault

| Tipo              | Descripcion                                                        | Config key       |
|-------------------|--------------------------------------------------------------------|------------------|
| `network_delay`   | Agrega latencia artificial a los requests (ms fijos o distribucion)| `delay`          |
| `error_rate`      | Retorna errores HTTP (503, 500) con probabilidad configurable      | `errorRate`      |
| `timeout`         | Simula timeouts dejando la conexion colgada                        | `timeout`        |
| `corruption`      | Altera el body de la respuesta (campos nulos, tipos incorrectos)   | `corruption`     |
| `partial_timeout` | Responde parcialmente y cierra la conexion (chunked transfer)      | `partialTimeout` |
| `rate_limiting`   | Retorna 429 Too Many Requests con `Retry-After` header             | `rateLimiting`   |

### Configuracion de chaos

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

**Campos clave**:

- `enabled`: `false` desactiva el chaos sin eliminar la configuracion.
- `targetService`: nombre del servicio al que aplican los fallos.
- `probability`: fraccion de requests afectados por este fault (`0.1` = 10%). La distribucion es determinista (< 5% de varianza sobre el target).

### Activacion desde CLI

```bash
# Chaos activado via config/chaos.json del cliente
./bin/run-test.sh --client=acme --service=payments --test=load

# Chaos desactivado temporalmente sin modificar chaos.json
./bin/run-test.sh --client=acme --service=payments --test=load --no-chaos
```

### Reporteria diferenciada

El sistema distingue entre errores de caos (introducidos intencionalmente) y errores reales del servicio bajo prueba.

En el reporte HTML, aparece una seccion **"Chaos Breakdown"**:

```
Total requests:        10,000
  ↳ Chaos faults:        1,250  (12.5%)
      network_delay:       950  (9.5%)
      error_rate:          250  (2.5%)
      rate_limiting:        50  (0.5%)
  ↳ Errores reales:         18  (0.18%)
  ↳ Exitosas (netas):    8,732  (87.32%)
```

En el JSON summary, el campo `chaosBreakdown`:

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

La tasa de error neta (`netSuccessRate`) excluye los fallos intencionales de chaos, permitiendo evaluar la resiliencia real del servicio.

---

## Tabla comparativa

| Caracteristica              | Mock server                        | Chaos injection                         |
|-----------------------------|------------------------------------|-----------------------------------------|
| Proposito                   | Simular dependencias               | Probar resiliencia bajo fallos           |
| Cuando usarlo               | Dependencia no disponible en test  | Verificar retry, timeout, circuit breaker|
| Donde se configura          | `clients/{nombre}/mocks/`          | `clients/{nombre}/config/chaos.json`    |
| Afecta el servicio real     | No (sustituye la dependencia)      | No (inyecta fallos en el cliente k6)    |
| Reporteria diferenciada     | No aplica                          | Si — chaos vs errores reales            |
| Desactivar sin borrar config| Eliminar endpoint del mock         | `"enabled": false` en chaos.json        |
