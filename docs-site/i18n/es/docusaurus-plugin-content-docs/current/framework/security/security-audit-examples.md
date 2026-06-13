---
title: "Escenarios de Ejemplo — Lista de Verificación de Auditoría de Seguridad"
sidebar_position: 2
---
# Escenarios de Ejemplo — Lista de Verificación de Auditoría de Seguridad

**T-139**: Revisión de seguridad de los 15 escenarios de ejemplo y helpers del framework.
**Elementos CHK**: CHK-SEC-080, CHK-SEC-081, CHK-SEC-082, CHK-SEC-127, CHK-SEC-128

---

## Metodología de Revisión

Cada escenario de ejemplo fue auditado según los siguientes criterios:

| # | Verificación | Herramienta / Método |
|---|--------------|----------------------|
| 1 | Sin credenciales hardcodeadas | `grep -rn "password\|token\|api_key" clients/examples/` — solo referencias `__ENV.*` |
| 2 | Los IDs de correlación usan UUID v4 | Inspección de `HeaderHelper.tracing()` — `generateUUID()` usa formato RFC 4122 v4 |
| 3 | Sin IDs secuenciales/predecibles en headers | Los bits 14 y 19 del UUID imponen versión y variante |
| 4 | Las capturas de pantalla del navegador limpian campos sensibles | Los escenarios con etiqueta `browser` incluyen instrucciones de limpieza de campos |
| 5 | Web Vitals contienen solo datos de temporización | Sin hostname/ruta/IP interna en etiquetas de métricas |
| 6 | `__ENV` usado para todos los valores externos | Sin literales de cadena que coincidan con patrones de secretos |

---

## Resultados de Auditoría — 15 Escenarios de Ejemplo

| Escenario | Credenciales vía `__ENV` | IDs de Correlación UUID v4 | Sin PII en métricas | Navegador: limpia campos sensibles | Estado |
|-----------|--------------------------|---------------------------|--------------------|------------------------------------|--------|
| 01-auth-bearer.ts | ✅ `__ENV.APP_TOKEN` | ✅ HeaderHelper.tracing() | ✅ | N/A | **APROBADO** |
| 02-auth-basic.ts | ✅ `__ENV.APP_USER`, `__ENV.APP_PASSWORD` | ✅ | ✅ | N/A | **APROBADO** |
| 03-auth-oauth2.ts | ✅ `__ENV.CLIENT_ID`, `__ENV.CLIENT_SECRET` | ✅ | ✅ | N/A | **APROBADO** |
| 04-auth-apikey.ts | ✅ `__ENV.API_KEY` | ✅ | ✅ | N/A | **APROBADO** |
| 05-crud-products.ts | ✅ (sin autenticación requerida) | ✅ | ✅ | N/A | **APROBADO** |
| 06-checkout-flow.ts | ✅ `__ENV.APP_TOKEN` | ✅ | ✅ | N/A | **APROBADO** |
| 07-graphql.ts | ✅ `__ENV.APP_TOKEN` | ✅ | ✅ | N/A | **APROBADO** |
| 08-websocket.ts | ✅ (sin credenciales) | ✅ | ✅ | N/A | **APROBADO** |
| 09-grpc.ts | ✅ (sin credenciales) | ✅ | ✅ | N/A | **APROBADO** |
| 10-data-pool.ts | ✅ CSV vía `open()` | ✅ | ✅ | N/A | **APROBADO** |
| 11-chaos.ts | ✅ `__ENV.APP_TOKEN` | ✅ | ✅ | N/A | **APROBADO** |
| 12-browser-mixed.ts | ✅ `__ENV.APP_USER`, `__ENV.APP_PASSWORD` | ✅ | ✅ | ✅ `page.fill` limpiado después del envío | **APROBADO** |
| 13-soak-test.ts | ✅ `__ENV.APP_TOKEN` | ✅ | ✅ | N/A | **APROBADO** |
| 14-breakpoint.ts | ✅ (sin autenticación requerida) | ✅ | ✅ | N/A | **APROBADO** |
| 15-redis-data-pool.ts | ✅ `__ENV.REDIS_URL` | ✅ | ✅ | N/A | **APROBADO** |

**Resultado**: Los 15 escenarios pasan la lista de verificación de seguridad. ✅

---

## Generación de UUID en HeaderHelper (CHK-SEC-080)

`HeaderHelper.tracing()` genera tres UUIDs por solicitud:
- `X-Correlation-ID` — vincula la solicitud a un VU/iteración de prueba
- `X-Trace-ID` — utilizado para el contexto de trazabilidad distribuida
- `X-Request-ID` — identificador único por solicitud HTTP

La función `generateUUID()` en `header-helper.ts` produce UUID v4 según RFC 4122:
- El bit 14 es siempre `4` (campo de versión)
- El bit 19 está siempre en el rango `[8, b]` (campo de variante `10xx`)
- Todos los demás bits provienen de `Math.random()`

> **Nota**: `Math.random()` se usa intencionalmente — `crypto.randomUUID()` no está disponible
> en el runtime goja de k6. Estos IDs son solo para **observabilidad**, no para seguridad
> (tokens de sesión, CSRF). Para contextos de Node.js, use `crypto.randomUUID()` directamente.

---

## Datos de Web Vitals (CHK-SEC-082)

Los Web Vitals reportados por escenarios de navegador (FCP, LCP, TTFB, CLS) contienen:
- Nombre de la métrica (cadena de texto)
- Valor numérico de temporización (milisegundos)
- Etiquetas estándar de k6: `scenario`, `group`, `status`

**No** incluyen:
- Nombres de host o direcciones IP del servicio objetivo
- Rutas de URL internas que revelen la topología de infraestructura
- Datos de sesión de usuario o PII

Las etiquetas personalizadas agregadas vía `__ENV.K6_CLIENT` y `__ENV.K6_PROFILE` son sanitizadas a través de `sanitizePrometheusLabel()` antes de su emisión.

---

## Guía de Capturas de Pantalla del Navegador (CHK-SEC-081)

Para escenarios que usan `browser.newPage()` y capturan pantallas:

```typescript
// REQUERIDO antes de la captura de pantalla — limpiar contenido de campos sensibles
await page.fill('input[type="password"]', '');
await page.fill('input[name="card-number"]', '');

// Luego tomar la captura — sin datos sensibles visibles
await page.screenshot({ path: `screenshots/step-${__ITER}.png` });
```

Este patrón está implementado en `12-browser-mixed.ts` y debe seguirse en todos los
escenarios de navegador que interactúen con flujos autenticados o de pago.

---

## Headers de Trazabilidad (CHK-SEC-127, CHK-SEC-128)

Header `traceparent` (W3C Trace Context):
- Formato: `00-{traceId}-{spanId}-01`
- `traceId` es un UUID de 32 caracteres hexadecimales derivado de `generateUUID()` — sin información interna
- **No** contiene: nombre de host, IP, ID de proceso ni versión del framework

Header `X-Pyroscope-Labels` (cuando el perfilado está habilitado):
- Valor: `k6_test=true` — solo indicador genérico
- **No** incluye: nombre del cliente, entorno ni detalles del servicio objetivo

Si se necesitan etiquetas adicionales para el aislamiento de Pyroscope, use:
```
K6_PYROSCOPE_LABELS="app=k6,client=__ENV_CLIENT"
```
donde `__ENV_CLIENT` se establece desde `__ENV.K6_CLIENT` (nunca hardcodeado).
