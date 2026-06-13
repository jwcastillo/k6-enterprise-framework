---
title: "Plan de Pruebas Integral — k6 Enterprise Framework v0.2.0"
sidebar_position: 5
---
# Plan de Pruebas Integral — k6 Enterprise Framework v0.2.0

> **Fecha:** 2026-03-07
> **Alcance:** Validacion funcional completa de las 192+ funcionalidades del framework
> **Documento de referencia:** FEATURE_CATALOG.md, COMPLIANCE_CHECKLIST.md, documentacion oficial

---

## Indice

1. [CAT-01 — Perfiles de Carga](#cat-01--perfiles-de-carga)
2. [CAT-02 — Helpers](#cat-02--helpers)
3. [CAT-03 — Patrones](#cat-03--patrones)
4. [CAT-04 — Core](#cat-04--core)
5. [CAT-05 — Motor de Metricas](#cat-05--motor-de-metricas)
6. [CAT-06 — Reporting](#cat-06--reporting)
7. [CAT-07 — Observabilidad](#cat-07--observabilidad)
8. [CAT-08 — AI Agents](#cat-08--ai-agents)
9. [CAT-09 — Integraciones](#cat-09--integraciones)
10. [CAT-10 — CLI Tools](#cat-10--cli-tools)
11. [CAT-11 — Schemas y Validacion](#cat-11--schemas-y-validacion)
12. [CAT-12 — Build Pipeline](#cat-12--build-pipeline)
13. [CAT-13 — Unit Tests](#cat-13--unit-tests)
14. [CAT-14 — Escenarios de Referencia](#cat-14--escenarios-de-referencia)
15. [CAT-15 — Seguridad](#cat-15--seguridad)
16. [CAT-16 — SLO/SLA](#cat-16--slosla)
17. [Matriz de Trazabilidad](#matriz-de-trazabilidad)

---

## Convenciones

| Simbolo | Significado |
|---------|-------------|
| **PRE** | Precondicion |
| **PASO** | Paso de ejecucion |
| **ESPERADO** | Resultado esperado |
| **DOC** | Documento de referencia |
| **ARCHIVO** | Archivo fuente validado |

---

## CAT-01 — Perfiles de Carga

**DOC:** `docs/LOAD_PROFILES.md` | **ARCHIVOS:** `shared/profiles/*.json`, `src/types/profile.d.ts`

### TC-01.01 — Perfil smoke (VU-based)

| Campo | Detalle |
|-------|---------|
| **PRE** | Framework construido (`npm run build`), mock server disponible |
| **PASO 1** | Verificar que existe `shared/profiles/smoke.json` |
| **PASO 2** | Validar estructura: `name=smoke`, `stages` array con 2 etapas, `thresholds` con 3 metricas |
| **PASO 3** | Ejecutar: `./bin/run-test.sh --client=_reference --scenario=api/smoke-users --profile=smoke` |
| **PASO 4** | Verificar que k6 usa 1-2 VUs durante max 1 min |
| **PASO 5** | Verificar thresholds: `p(95)<2000`, `rate<0.01`, `rate>=0.99` |
| **ESPERADO** | Test pasa con 0 errores, duracion ~1 min, thresholds verdes |

### TC-01.02 — Perfil quick (VU-based)

| Campo | Detalle |
|-------|---------|
| **PRE** | Framework construido |
| **PASO 1** | Verificar `shared/profiles/quick.json`: `stages` con ramp a 5 VUs |
| **PASO 2** | Ejecutar: `./bin/run-test.sh --client=_reference --scenario=api/smoke-users --profile=quick` |
| **PASO 3** | Verificar thresholds: `p(95)<1500`, `p(99)<3000`, `rate<0.05`, `rate>=0.95` |
| **ESPERADO** | Test completa en ~3 min, 5 VUs simultaneos |

### TC-01.03 — Perfil load (VU-based)

| Campo | Detalle |
|-------|---------|
| **PASO 1** | Verificar `shared/profiles/load.json`: stages `[2m→20, 10m→20, 2m→0]` |
| **PASO 2** | Ejecutar con profile=load |
| **PASO 3** | Confirmar ramp-up 2m, hold 10m a 20 VUs, ramp-down 2m |
| **ESPERADO** | Duracion total ~14 min, thresholds `p(95)<1000`, `p(99)<2000` |

### TC-01.04 — Perfil rampup (VU-based)

| Campo | Detalle |
|-------|---------|
| **PASO 1** | Verificar `shared/profiles/rampup.json`: escalones 10→20→30→40→50 VUs |
| **PASO 2** | Ejecutar con profile=rampup |
| **ESPERADO** | 5 escalones de 2m cada uno + 3m ramp-down, ~13 min total |

### TC-01.05 — Perfil capacity (VU-based)

| Campo | Detalle |
|-------|---------|
| **PASO 1** | Verificar `shared/profiles/capacity.json`: escalones 50→100→150→200 |
| **PASO 2** | Ejecutar con profile=capacity |
| **ESPERADO** | Hold 5m a 200 VUs, ~20 min total, thresholds `p(95)<2000`, `p(99)<5000` |

### TC-01.06 — Perfil stress (VU-based)

| Campo | Detalle |
|-------|---------|
| **PASO 1** | Verificar `shared/profiles/stress.json`: 100→200→300→400→300→0 |
| **PASO 2** | Ejecutar con profile=stress |
| **ESPERADO** | ~25 min, picos de 400 VUs, puede tener threshold failures (esperado) |

### TC-01.07 — Perfil spike (VU-based)

| Campo | Detalle |
|-------|---------|
| **PASO 1** | Verificar `shared/profiles/spike.json`: warm 10 VUs, spike a 300 en 30s |
| **PASO 2** | Ejecutar con profile=spike |
| **ESPERADO** | Burst a 300 VUs, hold 3m, drop a 10 en 30s, ~8 min total |

### TC-01.08 — Perfil breakpoint (VU-based)

| Campo | Detalle |
|-------|---------|
| **PASO 1** | Verificar `shared/profiles/breakpoint.json`: ramp lineal 0→1000 en 1h |
| **PASO 2** | Ejecutar con profile=breakpoint (ambiente controlado) |
| **ESPERADO** | Ramp lineal, se esperan failures — el objetivo es encontrar el limite |

### TC-01.09 — Perfil soak (VU-based)

| Campo | Detalle |
|-------|---------|
| **PASO 1** | Verificar `shared/profiles/soak.json`: 5m ramp, 4h hold a 20 VUs, 5m down |
| **PASO 2** | Ejecutar con profile=soak |
| **ESPERADO** | Duracion 4h+, monitorear RSS memory, heap, GC pauses |

### TC-01.10 — Perfil throughput-low (arrival-rate)

| Campo | Detalle |
|-------|---------|
| **PASO 1** | Verificar `shared/profiles/throughput-low.json`: `executor=constant-arrival-rate`, `rate=10`, `timeUnit=1s` |
| **PASO 2** | Verificar `preAllocatedVUs=20`, `maxVUs=50` |
| **PASO 3** | Ejecutar con profile=throughput-low |
| **ESPERADO** | 10 iteraciones/segundo constantes durante 5 min, thresholds `p(95)<2000` |

### TC-01.11 — Perfil throughput-medium (arrival-rate)

| Campo | Detalle |
|-------|---------|
| **PASO 1** | Verificar `throughput-medium.json`: `rate=50`, `preAllocatedVUs=60`, `maxVUs=150` |
| **PASO 2** | Ejecutar con profile=throughput-medium |
| **ESPERADO** | 50 req/s constantes durante 5 min |

### TC-01.12 — Perfil throughput-high (arrival-rate)

| Campo | Detalle |
|-------|---------|
| **PASO 1** | Verificar `throughput-high.json`: `rate=100`, `preAllocatedVUs=120`, `maxVUs=300` |
| **PASO 2** | Ejecutar con profile=throughput-high |
| **ESPERADO** | 100 req/s constantes, thresholds `p(95)<1000`, `p(99)<2000` |

### TC-01.13 — Perfil throughput-ramp (arrival-rate)

| Campo | Detalle |
|-------|---------|
| **PASO 1** | Verificar `throughput-ramp.json`: `executor=ramping-arrival-rate`, stages 10→50→100/s |
| **PASO 2** | Ejecutar con profile=throughput-ramp |
| **ESPERADO** | Ramp 12 min, preAllocatedVUs=120, maxVUs=300 |

### TC-01.14 — Tipo ProfileName en TypeScript

| Campo | Detalle |
|-------|---------|
| **PASO 1** | Verificar `src/types/profile.d.ts` contiene exactamente 13 valores en `ProfileName` |
| **PASO 2** | Confirmar que cada valor corresponde a un archivo en `shared/profiles/` |
| **PASO 3** | Verificar interfaces `VUBasedProfile` y `ArrivalRateProfile` |
| **ESPERADO** | 13 perfiles, union type `LoadProfile = VUBasedProfile | ArrivalRateProfile` |

### TC-01.15 — Jerarquia de Thresholds (5 niveles)

| Campo | Detalle |
|-------|---------|
| **DOC** | LOAD_PROFILES.md seccion "Threshold Hierarchy" |
| **PASO 1** | Crear config de cliente con thresholds globales |
| **PASO 2** | Agregar SLO config con target mas estricto |
| **PASO 3** | Agregar override en scenario options |
| **PASO 4** | Ejecutar con `K6_THRESHOLD_P95=300` como env var |
| **ESPERADO** | El threshold CLI (nivel 5) prevalece sobre todos los demas |

---

## CAT-02 — Helpers

**DOC:** `docs/FEATURE_CATALOG.md` seccion Helpers | **ARCHIVOS:** `src/helpers/*.ts`

### TC-02.01 — RequestHelper

| Campo | Detalle |
|-------|---------|
| **ARCHIVO** | `src/helpers/request-helper.ts` |
| **PASO 1** | Instanciar `new RequestHelper(baseUrl)` |
| **PASO 2** | Ejecutar GET, POST, PUT, DELETE, PATCH |
| **PASO 3** | Verificar que agrega headers de tracing automaticamente |
| **PASO 4** | Verificar timeout configurable |
| **ESPERADO** | Todas las operaciones HTTP funcionan, headers X-Request-ID presentes |

### TC-02.02 — DataHelper

| Campo | Detalle |
|-------|---------|
| **ARCHIVO** | `src/helpers/data-helper.ts` |
| **PASO 1** | Cargar datos desde CSV con `loadCSV()` |
| **PASO 2** | Cargar datos desde JSON con `loadJSON()` |
| **PASO 3** | Usar `randomItem()` para seleccion aleatoria |
| **PASO 4** | Usar `SharedArray` para datos entre VUs |
| **ESPERADO** | Datos cargados correctamente, sin duplicacion en memoria entre VUs |

### TC-02.03 — DateHelper

| Campo | Detalle |
|-------|---------|
| **ARCHIVO** | `src/helpers/date-helper.ts` |
| **PASO 1** | Formatear fechas con `formatDate()` |
| **PASO 2** | Calcular diferencias con `dateDiff()` |
| **PASO 3** | Generar timestamps ISO con `now()` |
| **ESPERADO** | Formatos correctos, compatible con k6 runtime (sin dependencias Node.js) |

### TC-02.04 — HeaderHelper

| Campo | Detalle |
|-------|---------|
| **ARCHIVO** | `src/helpers/header-helper.ts` |
| **PASO 1** | Construir headers base con `buildHeaders()` |
| **PASO 2** | Agregar auth headers (Bearer, Basic, API-Key) |
| **PASO 3** | Merge con headers custom |
| **ESPERADO** | Headers correctos para cada tipo de autenticacion |

### TC-02.05 — ValidationHelper

| Campo | Detalle |
|-------|---------|
| **ARCHIVO** | `src/helpers/validation-helper.ts` |
| **PASO 1** | Validar response status con `validateStatus()` |
| **PASO 2** | Validar response body schema |
| **PASO 3** | Validar campos requeridos |
| **ESPERADO** | Checks k6 generados correctamente para cada validacion |

### TC-02.06 — CryptoHelper

| Campo | Detalle |
|-------|---------|
| **ARCHIVO** | `src/helpers/crypto-helper.ts` |
| **PASO 1** | Generar UUID con `generateUUID()` |
| **PASO 2** | Hash SHA-256 con `sha256()` |
| **PASO 3** | HMAC signature |
| **ESPERADO** | Funciones crypto usando k6 crypto API (no Node.js) |

### TC-02.07 — BrowserHelper

| Campo | Detalle |
|-------|---------|
| **ARCHIVO** | `src/helpers/browser-helper.ts` |
| **PASO 1** | Inicializar browser con `newPage()` |
| **PASO 2** | Navegar a URL, capturar Web Vitals (LCP, FCP, CLS, TTFB, INP) |
| **PASO 3** | Tomar screenshot |
| **ESPERADO** | Metricas Web Vitals capturadas, screenshot generado |

### TC-02.08 — WebSocketHelper (v1)

| Campo | Detalle |
|-------|---------|
| **ARCHIVO** | `src/helpers/websocket-helper.ts` |
| **PASO 1** | Conectar a WS endpoint |
| **PASO 2** | Enviar y recibir mensajes |
| **PASO 3** | Medir latencia round-trip |
| **ESPERADO** | Conexion estable, metricas de latencia generadas |

### TC-02.09 — WebSocketHelper v2

| Campo | Detalle |
|-------|---------|
| **ARCHIVO** | `src/helpers/websocket-v2-helper.ts` |
| **PASO 1** | Conectar con la API mejorada v2 |
| **PASO 2** | Verificar reconexion automatica |
| **PASO 3** | Verificar message handlers tipados |
| **ESPERADO** | Mejoras v2 sobre v1: reconexion, tipado, handlers |

### TC-02.10 — GraphQLHelper

| Campo | Detalle |
|-------|---------|
| **ARCHIVO** | `src/helpers/graphql-helper.ts` |
| **PASO 1** | Enviar query GraphQL |
| **PASO 2** | Enviar mutation con variables |
| **PASO 3** | Verificar error handling de errores GraphQL |
| **ESPERADO** | Queries/mutations ejecutadas, errores parseados correctamente |

### TC-02.11 — UploadHelper

| Campo | Detalle |
|-------|---------|
| **ARCHIVO** | `src/helpers/upload-helper.ts` |
| **PASO 1** | Upload de archivo con multipart/form-data |
| **PASO 2** | Verificar content-type y boundary |
| **ESPERADO** | Archivo enviado correctamente via HTTP multipart |

### TC-02.12 — RedisHelper

| Campo | Detalle |
|-------|---------|
| **ARCHIVO** | `src/helpers/redis-helper.ts` |
| **DOC** | `docs/REDIS_DATA_SUPPORT.md` |
| **PASO 1** | Conectar a Redis |
| **PASO 2** | Ejecutar operaciones basicas: set, get, del, exists, expire, ttl |
| **PASO 3** | Ejecutar operaciones de lista: lpush, rpush, lpop, rpop, llen, lrange |
| **PASO 4** | Ejecutar operaciones hash: hset, hmset, hget, hgetall, hdel |
| **PASO 5** | Verificar disconnect limpio |
| **ESPERADO** | Todas las 23 operaciones documentadas funcionan correctamente |

### TC-02.13 — RedisSecurityHelper

| Campo | Detalle |
|-------|---------|
| **ARCHIVO** | `src/helpers/redis-security.ts` |
| **PASO 1** | Verificar sanitizacion de keys |
| **PASO 2** | Verificar proteccion contra injection |
| **ESPERADO** | Keys validadas, no se permiten caracteres peligrosos |

### TC-02.14 — DataPoolHelper

| Campo | Detalle |
|-------|---------|
| **ARCHIVO** | `src/helpers/data-pool.ts` |
| **PASO 1** | Crear pool con datos de test |
| **PASO 2** | Obtener item sin colision entre VUs |
| **PASO 3** | Verificar rotacion de datos |
| **ESPERADO** | Pool funciona como User Pool pattern documentado en REDIS_DATA_SUPPORT.md |

### TC-02.15 — StructuredLogger

| Campo | Detalle |
|-------|---------|
| **ARCHIVO** | `src/helpers/structured-logger.ts` |
| **PASO 1** | Log con nivel INFO, WARN, ERROR, DEBUG |
| **PASO 2** | Verificar formato JSON estructurado |
| **PASO 3** | Verificar campos: timestamp, level, message, context |
| **ESPERADO** | Logs en JSON valido con todos los campos requeridos |

### TC-02.16 — PerformanceHelper

| Campo | Detalle |
|-------|---------|
| **ARCHIVO** | `src/helpers/performance-helper.ts` |
| **PASO 1** | Medir duracion de operacion |
| **PASO 2** | Registrar metricas custom de rendimiento |
| **ESPERADO** | Metricas registradas como k6 Trend/Counter |

### TC-02.17 — ThinkTimeHelper

| Campo | Detalle |
|-------|---------|
| **DOC** | LOAD_PROFILES.md seccion "Think Time Helper" |
| **PASO 1** | Usar `thinkTime(1, 3)` — sleep uniforme 1-3s |
| **PASO 2** | Usar `thinkTime(...THINK_TIME.NORMAL)` — preset [1,3] |
| **PASO 3** | Usar `thinkTime(...THINK_TIME.READING)` — preset [3,8] |
| **PASO 4** | Usar `thinkTimeNormal(2, 0.5)` — distribucion normal |
| **PASO 5** | Usar `pace(5000, iterStart)` — pacing fijo |
| **ESPERADO** | Delays aplicados correctamente, pace ajusta al target |

### TC-02.18 — Helpers Index (barrel export)

| Campo | Detalle |
|-------|---------|
| **ARCHIVO** | `src/helpers/index.ts` |
| **PASO 1** | Verificar que exporta todos los 17 helpers |
| **PASO 2** | Importar desde `../../src/helpers` en un scenario |
| **ESPERADO** | Todas las exportaciones accesibles desde el barrel |

---

## CAT-03 — Patrones

**DOC:** `docs/FEATURE_CATALOG.md` seccion Patterns, `docs/MOCKS_CHAOS.md` | **ARCHIVOS:** `src/patterns/*.ts`

### TC-03.01 — Auth Pattern

| Campo | Detalle |
|-------|---------|
| **ARCHIVO** | `src/patterns/auth-pattern.ts` |
| **PASO 1** | Configurar auth tipo Bearer token |
| **PASO 2** | Configurar auth tipo Basic |
| **PASO 3** | Configurar auth tipo API-Key |
| **PASO 4** | Verificar token refresh automatico |
| **ESPERADO** | Los 3 tipos de auth funcionan, token se renueva antes de expirar |

### TC-03.02 — Retry Pattern

| Campo | Detalle |
|-------|---------|
| **ARCHIVO** | `src/patterns/retry-pattern.ts` |
| **PASO 1** | Configurar retry con maxRetries=3, backoffMs=1000 |
| **PASO 2** | Simular respuestas 500, 502, 503 |
| **PASO 3** | Verificar backoff exponencial |
| **PASO 4** | Verificar que no reintenta en 4xx |
| **ESPERADO** | Reintentos con backoff, parada en max retries o exito |

### TC-03.03 — Pagination Pattern

| Campo | Detalle |
|-------|---------|
| **ARCHIVO** | `src/patterns/pagination-pattern.ts` |
| **PASO 1** | Paginar recurso con offset/limit |
| **PASO 2** | Paginar con cursor-based pagination |
| **PASO 3** | Verificar acumulacion de resultados |
| **ESPERADO** | Todos los registros obtenidos, sin duplicados |

### TC-03.04 — Correlation Pattern

| Campo | Detalle |
|-------|---------|
| **ARCHIVO** | `src/patterns/correlation-pattern.ts` |
| **PASO 1** | Extraer campo de response body (ej: `id`) |
| **PASO 2** | Usar campo extraido en request subsiguiente |
| **PASO 3** | Verificar chain de correlaciones multiples |
| **ESPERADO** | Valores dinamicos propagados correctamente entre requests |

### TC-03.05 — Weighted Execution Pattern

| Campo | Detalle |
|-------|---------|
| **ARCHIVO** | `src/patterns/weighted-execution.ts` |
| **PASO 1** | Configurar 3 operaciones con pesos 70%, 20%, 10% |
| **PASO 2** | Ejecutar 1000 iteraciones |
| **PASO 3** | Verificar que la distribucion es aproximada a los pesos |
| **ESPERADO** | Distribucion dentro de ±5% del peso configurado |

### TC-03.06 — Chaos Injection Pattern

| Campo | Detalle |
|-------|---------|
| **ARCHIVO** | `src/patterns/chaos-injection.ts` |
| **DOC** | `docs/MOCKS_CHAOS.md` |
| **PASO 1** | Configurar chaos con `shared/schemas/chaos-config.schema.json` |
| **PASO 2** | Inyectar `network_delay` con probabilidad 30% |
| **PASO 3** | Inyectar `error_rate` con probabilidad 10% |
| **PASO 4** | Inyectar `timeout` con probabilidad 5% |
| **PASO 5** | Inyectar `corruption`, `partial_timeout`, `rate_limiting` |
| **PASO 6** | Verificar reporte diferenciado: errores chaos vs reales |
| **ESPERADO** | 6 tipos de fallo inyectados, reporte `chaos_breakdown` separa intencionales |

### TC-03.07 — Contract Validation Pattern

| Campo | Detalle |
|-------|---------|
| **ARCHIVO** | `src/patterns/contract-validation.ts` |
| **PASO 1** | Definir contrato esperado (status, headers, body schema) |
| **PASO 2** | Validar response contra contrato |
| **PASO 3** | Reportar violaciones |
| **ESPERADO** | Violaciones de contrato generan checks fallidos con detalle |

### TC-03.08 — Mock Server Pattern

| Campo | Detalle |
|-------|---------|
| **ARCHIVO** | `src/node/mock-server.ts` (reubicado desde `src/patterns/` en Phase 4 / ARC-06) |
| **DOC** | `docs/MOCKS_CHAOS.md` |
| **PASO 1** | Configurar mock con `shared/schemas/mock-config.schema.json` |
| **PASO 2** | Definir endpoint con templates dinamicos (counter, timestamp, uuid, randomInt) |
| **PASO 3** | Configurar latencia simulada (fija y distribucion normal) |
| **PASO 4** | Iniciar mock server: `node bin/mock-server.js --client=_reference` |
| **PASO 5** | Ejecutar test contra mock |
| **ESPERADO** | Templates resueltos dinamicamente, latencia simulada aplicada |

### TC-03.09 — Patterns Index (barrel export)

| Campo | Detalle |
|-------|---------|
| **ARCHIVO** | `src/patterns/index.ts` |
| **PASO 1** | Verificar exportacion de todos los patrones |
| **ESPERADO** | 8 patrones accesibles desde el barrel export |

---

## CAT-04 — Core

**ARCHIVOS:** `src/core/*.ts`

### TC-04.01 — ConfigLoader

| Campo | Detalle |
|-------|---------|
| **ARCHIVO** | `src/core/config-loader.ts` |
| **PASO 1** | Cargar config de cliente desde `clients/<name>/config/config.json` |
| **PASO 2** | Cargar config con environment override |
| **PASO 3** | Verificar merge de configs |
| **ESPERADO** | Config cargada y mergeada correctamente segun jerarquia |

### TC-04.02 — ConfigValidator

| Campo | Detalle |
|-------|---------|
| **ARCHIVO** | `src/core/config-validator.ts` |
| **PASO 1** | Validar config valida — debe pasar sin errores |
| **PASO 2** | Validar config con campo faltante (client) — debe fallar |
| **PASO 3** | Validar config con formato invalido de baseUrl |
| **ESPERADO** | Errores descriptivos para configs invalidas |

### TC-04.03 — CLI Parser

| Campo | Detalle |
|-------|---------|
| **ARCHIVO** | `src/core/cli.ts` |
| **PASO 1** | Parsear `--client=test --scenario=api/users --profile=smoke` |
| **PASO 2** | Verificar valores por defecto |
| **PASO 3** | Verificar validacion de parametros requeridos |
| **ESPERADO** | Parametros parseados, defaults aplicados, errores en faltantes |

### TC-04.04 — CLI Auth

| Campo | Detalle |
|-------|---------|
| **ARCHIVO** | `src/core/cli-auth.ts` |
| **PASO 1** | Verificar autenticacion de usuario CLI |
| **PASO 2** | Verificar roles asignados |
| **ESPERADO** | Usuario autenticado con rol correcto |

### TC-04.05 — RBAC

| Campo | Detalle |
|-------|---------|
| **ARCHIVO** | `src/core/rbac.ts`, `src/core/rbac-enforcer.ts` |
| **DOC** | `docs/SECURITY.md` |
| **PASO 1** | Verificar rol `developer`: puede ejecutar smoke, quick |
| **PASO 2** | Verificar rol `lead`: puede ejecutar load, stress, ver reportes |
| **PASO 3** | Verificar rol `admin`: acceso total, puede gestionar RBAC |
| **PASO 4** | Verificar denegacion de operacion no autorizada |
| **ESPERADO** | 3 roles, 14 operaciones protegidas, denegaciones con mensaje claro |

### TC-04.06 — Audit Logger

| Campo | Detalle |
|-------|---------|
| **ARCHIVO** | `src/core/audit-logger.ts` |
| **DOC** | `docs/SECURITY.md` |
| **PASO 1** | Ejecutar operacion auditada |
| **PASO 2** | Verificar log en formato JSONL |
| **PASO 3** | Verificar hash chain SHA-256 (cada entrada refiere al hash anterior) |
| **PASO 4** | Intentar modificar una entrada — hash chain debe romperse |
| **ESPERADO** | Log inmutable con hash chain, tamper-evident |

### TC-04.07 — SLO Evaluator

| Campo | Detalle |
|-------|---------|
| **ARCHIVO** | `src/core/slo-evaluator.ts` |
| **PASO 1** | Evaluar metricas contra SLO config |
| **PASO 2** | Verificar clasificacion: `cumple`, `en_riesgo`, `incumple` |
| **PASO 3** | Verificar calculo APDEX |
| **ESPERADO** | Evaluacion correcta con 3 estados, APDEX 0-1 |

### TC-04.08 — Threshold Manager

| Campo | Detalle |
|-------|---------|
| **ARCHIVO** | `src/core/threshold-manager.ts` |
| **PASO 1** | Merge thresholds de 5 niveles de precedencia |
| **PASO 2** | Verificar que nivel 5 (CLI) prevalece |
| **PASO 3** | Verificar que thresholds invalidos son rechazados |
| **ESPERADO** | Merge correcto segun jerarquia documentada |

### TC-04.09 — Secrets Manager

| Campo | Detalle |
|-------|---------|
| **ARCHIVO** | `src/core/secrets-manager.ts` |
| **DOC** | `docs/SECURITY.md` |
| **PASO 1** | Cargar secreto desde variable de entorno |
| **PASO 2** | Verificar que secretos no aparecen en logs |
| **PASO 3** | Verificar deteccion de secretos hardcodeados |
| **ESPERADO** | Secretos gestionados sin exposicion, hardcoded detectados |

### TC-04.10 — Config Security

| Campo | Detalle |
|-------|---------|
| **ARCHIVO** | `src/core/config-security.ts` |
| **PASO 1** | Verificar sanitizacion de paths (path traversal prevention) |
| **PASO 2** | Verificar aislamiento de variables de entorno entre clientes |
| **ESPERADO** | No se permite `../` en paths, env vars aisladas |

### TC-04.11 — Input Validator

| Campo | Detalle |
|-------|---------|
| **ARCHIVO** | `src/core/input-validator.ts` |
| **PASO 1** | Validar client name: solo `[a-zA-Z0-9_-]` |
| **PASO 2** | Validar scenario path |
| **PASO 3** | Validar profile name |
| **PASO 4** | Intentar inyeccion de comandos shell |
| **ESPERADO** | Inputs validados, shell injection bloqueada |

### TC-04.12 — YAML Parser

| Campo | Detalle |
|-------|---------|
| **ARCHIVO** | `src/core/yaml-parser.ts` |
| **PASO 1** | Parsear YAML valido |
| **PASO 2** | Intentar YAML bomb (billion laughs) — debe ser rechazado |
| **PASO 3** | Verificar limite de profundidad |
| **ESPERADO** | YAML seguro parseado, bombs/depth overflow rechazados |

### TC-04.13 — Prometheus Sanitizer

| Campo | Detalle |
|-------|---------|
| **ARCHIVO** | `src/core/prometheus-sanitizer.ts` |
| **PASO 1** | Sanitizar label names (solo alfanumerico + underscore) |
| **PASO 2** | Sanitizar label values |
| **ESPERADO** | Labels compatibles con Prometheus naming conventions |

### TC-04.14 — Execution Isolation

| Campo | Detalle |
|-------|---------|
| **ARCHIVO** | `src/core/execution-isolation.ts` |
| **PASO 1** | Verificar que dos clientes trabajando, no concurrente en paralelo no interfieren |
| **ESPERADO** | Datos, configs y reportes aislados por cliente |

### TC-04.15 — Report Isolation

| Campo | Detalle |
|-------|---------|
| **ARCHIVO** | `src/core/report-isolation.ts` |
| **PASO 1** | Generar reporte para cliente A |
| **PASO 2** | Verificar que no contiene datos de cliente B |
| **ESPERADO** | Reportes aislados por cliente |

### TC-04.16 — Binary Validator

| Campo | Detalle |
|-------|---------|
| **ARCHIVO** | `src/core/binary-validator.ts` |
| **PASO 1** | Validar binario k6 estandar |
| **PASO 2** | Validar binario xk6 custom — verificar checksum |
| **ESPERADO** | Binarios whitelist validados, checksums verificados |

### TC-04.17 — Branding Validator

| Campo | Detalle |
|-------|---------|
| **ARCHIVO** | `src/core/branding-validator.ts` |
| **PASO 1** | Validar logo (formato, tamano) |
| **PASO 2** | Validar colores (hex valido) |
| **PASO 3** | Validar nombre de organizacion |
| **ESPERADO** | Branding valido aceptado, invalido rechazado con error descriptivo |

### TC-04.18 — Client Resolver y Validator

| Campo | Detalle |
|-------|---------|
| **ARCHIVOS** | `src/core/client-resolver.ts`, `src/core/client-validator.ts` |
| **PASO 1** | Resolver cliente por nombre |
| **PASO 2** | Validar estructura de directorio del cliente |
| **PASO 3** | Verificar archivos requeridos (config.json) |
| **ESPERADO** | Cliente resuelto, estructura validada |

### TC-04.19 — Check System

| Campo | Detalle |
|-------|---------|
| **ARCHIVO** | `src/core/check-system.ts` |
| **PASO 1** | Registrar check con `registerCheck()` |
| **PASO 2** | Ejecutar checks con severidad (critical, warning, info) |
| **PASO 3** | Verificar que checks criticos fallan el test |
| **ESPERADO** | Sistema de checks extensible con severidades |

### TC-04.20 — Quality Gate _(REMOVED in Phase 4 / ARC-02)_

> Eliminado: `src/core/quality-gate.ts` y su test fueron borrados en plan 04-02 (orphan triage)
> tras confirmar 0 callers fuera de tests. Ver `.planning/phases/04-architecture-consolidation/04-02-orphan-decisions.md`.

### TC-04.21 — Declarative Engine _(REMOVED in Phase 4 / ARC-02)_

> Eliminado: `src/core/declarative-engine.ts` y su test fueron borrados en plan 04-02 (orphan triage)
> tras confirmar 0 callers fuera de tests. Ver `.planning/phases/04-architecture-consolidation/04-02-orphan-decisions.md`.

### TC-04.22 — Execution Engine

| Campo | Detalle |
|-------|---------|
| **ARCHIVO** | `src/core/execution-engine.ts` |
| **PASO 1** | Ejecutar scenario via engine |
| **PASO 2** | Verificar lifecycle hooks (setup, teardown) |
| **ESPERADO** | Ciclo de vida completo del test manejado |

### TC-04.23 — Profile Loader y Validator

| Campo | Detalle |
|-------|---------|
| **ARCHIVOS** | `src/core/client-config.ts` (contiene profile-loader) |
| **PASO 1** | Cargar perfil por nombre |
| **PASO 2** | Validar perfil contra schema |
| **PASO 3** | Intentar cargar perfil inexistente |
| **ESPERADO** | Perfil cargado, invalidos rechazados, error descriptivo para inexistentes |

### TC-04.24 — Inline Config Loader

| Campo | Detalle |
|-------|---------|
| **ARCHIVO** | `src/core/inline-config-loader.ts` |
| **PASO 1** | Pasar config como JSON en env var `TEST_CONFIG` |
| **PASO 2** | Verificar que se parsea y aplica |
| **ESPERADO** | Config inline funciona para CI/CD sin archivos |

### TC-04.25 — Regression Suite _(REMOVED in Phase 4 / ARC-02)_

> Eliminado: `src/core/regression-suite.ts` y su test fueron borrados en plan 04-02 (orphan triage)
> tras confirmar 0 callers fuera de tests. Ver `.planning/phases/04-architecture-consolidation/04-02-orphan-decisions.md`.

### TC-04.26 — Assertion Helper

| Campo | Detalle |
|-------|---------|
| **ARCHIVO** | `src/core/assertion-helper.ts` |
| **PASO 1** | Usar assertions tipadas |
| **PASO 2** | Verificar mensajes de error descriptivos |
| **ESPERADO** | Assertions con mensajes claros al fallar |

---

## CAT-05 — Motor de Metricas

**DOC:** `docs/METRICS_ENGINE.md` | **ARCHIVOS:** `src/metrics/*.ts`, `src/metrics/calculators/*.ts`

### TC-05.01 — MetricsEngine

| Campo | Detalle |
|-------|---------|
| **ARCHIVO** | `src/metrics/metrics-engine.ts` |
| **PASO 1** | Inicializar engine con datos de test |
| **PASO 2** | Ejecutar todos los calculadores |
| **PASO 3** | Verificar output con status (pass/warn/fail/na) por metrica |
| **ESPERADO** | Engine orquesta 11 calculadores, output unificado |

### TC-05.02 — PerformanceCalculator (50 metricas)

| Campo | Detalle |
|-------|---------|
| **ARCHIVO** | `src/metrics/calculators/performance-calculator.ts` |
| **PASO 1** | Calcular p50, p90, p95, p99, max, min, avg |
| **PASO 2** | Calcular TTFB, DNS, TCP, TLS, send, receive |
| **PASO 3** | Calcular APDEX score |
| **PASO 4** | Calcular VU efficiency |
| **ESPERADO** | 50 metricas de performance calculadas (CHK-API-175 a 224) |

### TC-05.03 — ThroughputCalculator (25 metricas)

| Campo | Detalle |
|-------|---------|
| **ARCHIVO** | `src/metrics/calculators/throughput-calculator.ts` |
| **PASO 1** | Calcular RPS total y exitoso |
| **PASO 2** | Calcular TPS (transactions per second) |
| **PASO 3** | Calcular data sent/received |
| **PASO 4** | Calcular Little's Law deviation |
| **ESPERADO** | 25 metricas de throughput (CHK-API-225 a 249) |

### TC-05.04 — ErrorCalculator (30 metricas)

| Campo | Detalle |
|-------|---------|
| **ARCHIVO** | `src/metrics/calculators/error-calculator.ts` |
| **PASO 1** | Calcular HTTP error rate (4xx, 5xx separados) |
| **PASO 2** | Calcular timeout rate |
| **PASO 3** | Calcular error budget burn rate |
| **PASO 4** | Calcular check failure rate |
| **ESPERADO** | 30 metricas de errores (CHK-API-250 a 279) |

### TC-05.05 — SlaCalculator (20 metricas)

| Campo | Detalle |
|-------|---------|
| **ARCHIVO** | `src/metrics/calculators/sla-calculator.ts` |
| **PASO 1** | Calcular availability |
| **PASO 2** | Calcular error budget remaining |
| **PASO 3** | Calcular p95/p99 compliance |
| **PASO 4** | Calcular multi-SLI composite score |
| **ESPERADO** | 20 metricas SLA (CHK-API-330 a 349) |

### TC-05.06 — StabilityCalculator

| Campo | Detalle |
|-------|---------|
| **ARCHIVO** | `src/metrics/calculators/stability-calculator.ts` |
| **PASO 1** | Calcular varianza de latencia en el tiempo |
| **PASO 2** | Detectar degradacion gradual |
| **ESPERADO** | Metricas de estabilidad temporal |

### TC-05.07 — ScalabilityCalculator

| Campo | Detalle |
|-------|---------|
| **ARCHIVO** | `src/metrics/calculators/scalability-calculator.ts` |
| **PASO 1** | Calcular eficiencia de escalado (RPS vs VUs) |
| **PASO 2** | Identificar punto de saturacion |
| **ESPERADO** | Curva de escalabilidad, bottleneck detectado |

### TC-05.08 — SaturationCalculator

| Campo | Detalle |
|-------|---------|
| **ARCHIVOS** | `src/metrics/calculators/saturation/{index,cpu-calculator,memory-calculator,io-calculator,network-calculator,resource-calculator}.ts` (split en Phase 4 / ARC-07; legacy `saturation-calculator.ts` es un shim de 5 líneas que re-exporta la fachada) |
| **PASO 1** | Calcular nivel de saturacion del sistema |
| **ESPERADO** | Metricas de saturacion (CPU, memoria, conexiones) |

### TC-05.09 — ChaosCalculator

| Campo | Detalle |
|-------|---------|
| **ARCHIVO** | `src/metrics/calculators/chaos-calculator.ts` |
| **PASO 1** | Calcular impacto de cada tipo de fallo inyectado |
| **PASO 2** | Separar metricas chaos de metricas reales |
| **ESPERADO** | Metricas diferenciadas chaos vs produccion |

### TC-05.10 — SecurityCalculator

| Campo | Detalle |
|-------|---------|
| **ARCHIVO** | `src/metrics/calculators/security-calculator.ts` |
| **PASO 1** | Calcular metricas de seguridad (auth failures, etc) |
| **ESPERADO** | Metricas de seguridad calculadas |

### TC-05.11 — ObservabilityCalculator

| Campo | Detalle |
|-------|---------|
| **ARCHIVO** | `src/metrics/calculators/observability-calculator.ts` |
| **PASO 1** | Calcular metricas de observabilidad del framework |
| **ESPERADO** | Overhead del framework, metricas de instrumentacion |

### TC-05.12 — DataIntegrityCalculator

| Campo | Detalle |
|-------|---------|
| **ARCHIVO** | `src/metrics/calculators/data-integrity-calculator.ts` |
| **PASO 1** | Verificar integridad de datos en respuestas |
| **ESPERADO** | Metricas de consistencia y correctitud de datos |

### TC-05.13 — Metrics Types

| Campo | Detalle |
|-------|---------|
| **ARCHIVO** | `src/metrics/types.ts` |
| **PASO 1** | Verificar que MetricStatus tiene 4 estados: pass, warn, fail, na |
| **PASO 2** | Verificar interfaz MetricResult |
| **ESPERADO** | Tipos correctos para el motor de metricas |

---

## CAT-06 — Reporting

**DOC:** `docs/REPORTING.md` | **ARCHIVOS:** `src/reporting/*.ts`

### TC-06.01 — HTML Report Generator (17 secciones)

| Campo | Detalle |
|-------|---------|
| **ARCHIVO** | `src/reporting/html-report-generator.ts` |
| **PASO 1** | Generar reporte HTML post-test |
| **PASO 2** | Verificar las 17 secciones: Header, KPI Strip, APDEX Gauge, SLA/SLO, Latency Distribution, Throughput Chart, Error Distribution, Groups Analysis, Custom Metrics, Web Vitals, Checks Detail, Thresholds, Performance Comparison, Generator Health, Anomaly Alerts, HTTP Details, Executive Summary |
| **PASO 3** | Verificar charts interactivos |
| **PASO 4** | Verificar branding (logo, colores, nombre org) |
| **PASO 5** | Verificar PII redaction en tags sensibles |
| **ESPERADO** | HTML completo con todas las 17 secciones renderizadas |

### TC-06.02 — JSON Summary Generator

| Campo | Detalle |
|-------|---------|
| **ARCHIVO** | `src/reporting/json-summary-generator.ts` |
| **PASO 1** | Generar summary JSON post-test |
| **PASO 2** | Verificar estructura: metricas, thresholds, checks, metadata |
| **ESPERADO** | JSON valido con todos los campos requeridos |

### TC-06.03 — Capacity Analyzer

| Campo | Detalle |
|-------|---------|
| **ARCHIVO** | `src/reporting/capacity-analyzer.ts` |
| **PASO 1** | Analizar datos de test de capacidad |
| **PASO 2** | Identificar punto de saturacion |
| **PASO 3** | Generar recomendaciones |
| **ESPERADO** | Analisis con punto de saturacion y recomendaciones |

### TC-06.04 — Capacity Report Generator

| Campo | Detalle |
|-------|---------|
| **ARCHIVO** | `src/reporting/capacity-report-generator.ts` |
| **PASO 1** | Generar reporte de capacidad visual |
| **ESPERADO** | Reporte con graficos de saturacion |

### TC-06.05 — Trend Visualizer

| Campo | Detalle |
|-------|---------|
| **ARCHIVO** | `src/reporting/trend-visualizer.ts` |
| **PASO 1** | Comparar resultados de multiples ejecuciones |
| **PASO 2** | Generar visualizacion de tendencias |
| **PASO 3** | Detectar regresiones |
| **ESPERADO** | Tendencias historicas visualizadas, regresiones resaltadas |

### TC-06.06 — PDF/PNG Export

| Campo | Detalle |
|-------|---------|
| **DOC** | REPORTING.md seccion export |
| **PASO 1** | Exportar reporte HTML a PDF via Puppeteer |
| **PASO 2** | Exportar reporte a PNG |
| **ESPERADO** | Archivos PDF y PNG generados correctamente |

### TC-06.07 — LLM Analysis

| Campo | Detalle |
|-------|---------|
| **DOC** | REPORTING.md seccion LLM |
| **PASO 1** | Generar analisis con Claude API |
| **PASO 2** | Verificar secciones: anomaly detection, root cause, recommendations |
| **ESPERADO** | Analisis inteligente integrado en el reporte |

### TC-06.08 — Performance Comparison

| Campo | Detalle |
|-------|---------|
| **DOC** | REPORTING.md seccion comparison |
| **PASO 1** | Ejecutar test dos veces |
| **PASO 2** | Generar comparacion automatica |
| **PASO 3** | Verificar delta table y sparklines |
| **ESPERADO** | Comparacion con deltas porcentuales y visuales |

---

## CAT-07 — Observabilidad

**DOC:** `docs/BENCHMARKING.md` | **ARCHIVOS:** `src/observability/*.ts`

### TC-07.01 — Overhead Detector

| Campo | Detalle |
|-------|---------|
| **ARCHIVO** | `src/observability/overhead-detector.ts` |
| **PASO 1** | Ejecutar benchmark baseline |
| **PASO 2** | Verificar medicion de overhead per-request (target < 2ms) |
| **PASO 3** | Verificar warnings: DEBUG_IN_FORMAL, CHAOS_IN_FORMAL, HIGH_VU_COUNT, HIGH_OVERHEAD |
| **ESPERADO** | Overhead < 1% del p95 latency, warnings apropiados |

### TC-07.02 — Generator Health

| Campo | Detalle |
|-------|---------|
| **ARCHIVO** | `src/node/generator-health.ts` (reubicado desde `src/observability/` en Phase 4 / ARC-06) |
| **PASO 1** | Monitorear CPU cada 5s (warning > 80%) |
| **PASO 2** | Monitorear Memory RSS (warning > 85% RAM) |
| **PASO 3** | Monitorear Heap usage (warning > 90% max) |
| **PASO 4** | Verificar compatibilidad Docker (cgroup detection) |
| **ESPERADO** | Metricas de salud en seccion Generator Health del reporte |

### TC-07.03 — Infra Metrics Collector

| Campo | Detalle |
|-------|---------|
| **ARCHIVO** | `src/observability/infra-metrics-collector.ts` |
| **PASO 1** | Recopilar metricas de infraestructura |
| **ESPERADO** | Metricas de CPU, memoria, disco del generador |

### TC-07.04 — Pyroscope Instrumentation

| Campo | Detalle |
|-------|---------|
| **ARCHIVO** | `src/observability/pyroscope-instrumentation.ts` |
| **PASO 1** | Habilitar profiling con Pyroscope |
| **PASO 2** | Verificar envio de profiles |
| **ESPERADO** | Profiles de CPU/memoria enviados a Pyroscope |

### TC-07.05 — Tracing Instrumentation

| Campo | Detalle |
|-------|---------|
| **ARCHIVO** | `src/observability/tracing-instrumentation.ts` |
| **PASO 1** | Habilitar distributed tracing |
| **PASO 2** | Verificar propagacion de trace headers (W3C traceparent) |
| **PASO 3** | Verificar envio a Tempo/Jaeger |
| **ESPERADO** | Traces distribuidos con span correlation |

---

## CAT-08 — AI Agents

**ARCHIVOS:** `src/ai/**/*.ts`

### TC-08.01 — Planner Agent

| Campo | Detalle |
|-------|---------|
| **ARCHIVO** | `src/ai/agents/planner-agent.ts` |
| **PASO 1** | Generar plan de test desde descripcion natural |
| **PASO 2** | Verificar output: TestPlan con scenarios, profiles, metricas |
| **ESPERADO** | Plan coherente generado por AI |

### TC-08.02 — Builder Agent

| Campo | Detalle |
|-------|---------|
| **ARCHIVO** | `src/ai/agents/builder-agent.ts` |
| **PASO 1** | Generar script k6 desde plan |
| **PASO 2** | Verificar que usa imports del framework |
| **PASO 3** | Verificar que compila con webpack |
| **ESPERADO** | Script valido generado, compilable |

### TC-08.03 — Analyst Agent

| Campo | Detalle |
|-------|---------|
| **ARCHIVO** | `src/ai/agents/analyst-agent.ts` |
| **PASO 1** | Analizar resultados de test |
| **PASO 2** | Generar insights y recomendaciones |
| **ESPERADO** | Analisis con root causes y action items |

### TC-08.04 — Reporter Agent

| Campo | Detalle |
|-------|---------|
| **ARCHIVO** | `src/ai/agents/reporter-agent.ts` |
| **PASO 1** | Generar executive summary desde metricas |
| **ESPERADO** | Resumen ejecutivo legible para stakeholders no tecnicos |

### TC-08.05 — Anomaly Detector

| Campo | Detalle |
|-------|---------|
| **ARCHIVO** | `src/ai/analysis/anomaly-detector.ts` |
| **PASO 1** | Detectar anomalias en metricas de latencia |
| **PASO 2** | Detectar anomalias en error rate |
| **ESPERADO** | Anomalias marcadas con severidad y timestamp |

### TC-08.06 — Knowledge Base

| Campo | Detalle |
|-------|---------|
| **ARCHIVO** | `src/ai/knowledge-base/knowledge-base.ts` |
| **PASO 1** | Indexar patrones de performance conocidos |
| **PASO 2** | Consultar base de conocimiento |
| **ESPERADO** | Patrones accesibles para agentes AI |

### TC-08.07 — Budget Manager

| Campo | Detalle |
|-------|---------|
| **ARCHIVO** | `src/ai/core/budget-manager.ts` |
| **PASO 1** | Configurar budget de tokens |
| **PASO 2** | Verificar tracking de uso |
| **PASO 3** | Verificar corte al alcanzar limite |
| **ESPERADO** | Gasto de tokens controlado, no excede budget |

### TC-08.08 — Orchestrator Pipeline

| Campo | Detalle |
|-------|---------|
| **ARCHIVO** | `src/ai/pipeline/orchestrator.ts` |
| **PASO 1** | Orquestar pipeline: planner → builder → analyst → reporter |
| **PASO 2** | Verificar paso de contexto entre agentes |
| **ESPERADO** | Pipeline completo ejecutado secuencialmente |

### TC-08.09 — Self-Healing

| Campo | Detalle |
|-------|---------|
| **ARCHIVO** | `src/ai/adaptive/self-healing.ts` |
| **PASO 1** | Detectar fallo en test |
| **PASO 2** | Verificar propuesta de correccion automatica |
| **ESPERADO** | Sugerencias de fix generadas automaticamente |

### TC-08.10 — Validation Suites

| Campo | Detalle |
|-------|---------|
| **ARCHIVOS** | `src/ai/agents/analyst-validation-suite.ts`, `builder-validation-suite.ts` |
| **PASO 1** | Ejecutar suite de validacion del analyst agent |
| **PASO 2** | Ejecutar suite de validacion del builder agent |
| **ESPERADO** | Agentes producen output valido segun suites |

---

## CAT-09 — Integraciones

**ARCHIVOS:** `src/integrations/*.ts`

### TC-09.01 — Notification Service

| Campo | Detalle |
|-------|---------|
| **ARCHIVO** | `src/integrations/notification-service.ts` |
| **DOC** | `docs/CI_CD_INTEGRATION.md` |
| **PASO 1** | Enviar notificacion Slack (Block Kit con tabla de metricas) |
| **PASO 2** | Enviar notificacion email (HTML body) |
| **PASO 3** | Enviar webhook generico (JSON POST versionado) |
| **PASO 4** | Verificar condiciones: always, on_failure, on_regression |
| **PASO 5** | Verificar --notify=none deshabilita notificaciones |
| **ESPERADO** | 3 canales de notificacion + condiciones + disable |

### TC-09.02 — Bot Engine

| Campo | Detalle |
|-------|---------|
| **ARCHIVO** | `src/integrations/bot/bot-engine.ts` |
| **PASO 1** | Procesar comando de bot |
| **PASO 2** | Generar respuesta |
| **ESPERADO** | Bot responde a comandos predefinidos |

### TC-09.03 — Bot Interface

| Campo | Detalle |
|-------|---------|
| **ARCHIVO** | `src/integrations/bot/bot-interface.ts` |
| **PASO 1** | Verificar interfaz de bot |
| **ESPERADO** | Interfaz abstracta correctamente definida |

### TC-09.04 — Slack Adapter

| Campo | Detalle |
|-------|---------|
| **ARCHIVO** | `src/integrations/bot/slack-adapter.ts` |
| **PASO 1** | Conectar a Slack workspace |
| **PASO 2** | Enviar mensaje formateado |
| **ESPERADO** | Mensajes Slack enviados con Block Kit formatting |

---

## CAT-10 — CLI Tools

**ARCHIVOS:** `bin/*.sh`, `bin/*.js`

### TC-10.01 — run-test.sh

| Campo | Detalle |
|-------|---------|
| **ARCHIVO** | `bin/run-test.sh` |
| **PASO 1** | Ejecutar: `./bin/run-test.sh --client=_reference --scenario=api/smoke-users --profile=smoke` |
| **PASO 2** | Verificar build automatico si necesario |
| **PASO 3** | Verificar seleccion de profile |
| **PASO 4** | Verificar generacion de reporte post-test |
| **ESPERADO** | Test ejecutado, reporte generado en `reports/` |

### TC-10.02 — create-client.sh

| Campo | Detalle |
|-------|---------|
| **ARCHIVO** | `bin/create-client.sh` |
| **PASO 1** | Ejecutar: `./bin/create-client.sh nuevo-cliente` |
| **PASO 2** | Verificar creacion de directorio estructura (config/, data/, scenarios/) |
| **PASO 3** | Verificar config.json scaffold |
| **ESPERADO** | Estructura de cliente creada lista para usar |

### TC-10.03 — validate-config.js

| Campo | Detalle |
|-------|---------|
| **ARCHIVO** | `bin/validate-config.js` |
| **PASO 1** | Validar config valida: `node bin/validate-config.js --file=clients/_reference/config/config.json` |
| **PASO 2** | Validar config invalida — debe reportar errores |
| **ESPERADO** | Validacion contra JSON Schema, errores descriptivos |

### TC-10.04 — generate-report.js

| Campo | Detalle |
|-------|---------|
| **ARCHIVO** | `bin/generate-report.js` |
| **PASO 1** | Generar reporte desde k6 JSON output |
| **PASO 2** | Verificar HTML generado con 17 secciones |
| **ESPERADO** | Reporte HTML completo generado |

### TC-10.05 — generate-artifacts.js

| Campo | Detalle |
|-------|---------|
| **ARCHIVO** | `bin/generate-artifacts.js` |
| **PASO 1** | Generar artefactos completos (HTML + JSON + comparacion) |
| **ESPERADO** | Todos los artefactos generados en directorio de salida |

### TC-10.06 — load-redis-data.js

| Campo | Detalle |
|-------|---------|
| **ARCHIVO** | `bin/load-redis-data.js` |
| **DOC** | `docs/REDIS_DATA_SUPPORT.md` |
| **PASO 1** | Cargar datos desde CSV: `node bin/load-redis-data.js --file=data/users.csv --prefix=user` |
| **PASO 2** | Cargar datos desde JSON |
| **PASO 3** | Cargar datos JSONL con streaming |
| **PASO 4** | Verificar --clear limpia datos previos |
| **ESPERADO** | Datos cargados en Redis, formatos CSV/JSON/JSONL soportados |

### TC-10.07 — clean-redis-data.js

| Campo | Detalle |
|-------|---------|
| **ARCHIVO** | `bin/clean-redis-data.js` |
| **PASO 1** | Limpiar por patron: `node bin/clean-redis-data.js --pattern=user:*` |
| **PASO 2** | Limpiar todo |
| **ESPERADO** | Datos eliminados segun patron o todos |

### TC-10.08 — compare-results.js

| Campo | Detalle |
|-------|---------|
| **ARCHIVO** | `bin/compare-results.js` |
| **PASO 1** | Comparar dos archivos de resultados k6 |
| **PASO 2** | Verificar tabla de deltas |
| **ESPERADO** | Comparacion con mejoras/regresiones resaltadas |

### TC-10.09 — slo-report.js

| Campo | Detalle |
|-------|---------|
| **ARCHIVO** | `bin/slo-report.js` |
| **PASO 1** | Generar reporte SLO compliance |
| **ESPERADO** | Reporte con compliance %, tendencias, recomendaciones |

### TC-10.10 — trend-analysis.js

| Campo | Detalle |
|-------|---------|
| **ARCHIVO** | `bin/trend-analysis.js` |
| **PASO 1** | Analizar tendencias de ultimas N ejecuciones |
| **ESPERADO** | Visualizacion de tendencias historicas |

### TC-10.11 — generate-data.js

| Campo | Detalle |
|-------|---------|
| **ARCHIVO** | `bin/generate-data.js` |
| **PASO 1** | Generar datos sinteticos de prueba |
| **ESPERADO** | Datos generados en formato CSV/JSON |

### TC-10.12 — mock-server.js

| Campo | Detalle |
|-------|---------|
| **ARCHIVO** | `bin/mock-server.js` |
| **PASO 1** | Iniciar mock server: `node bin/mock-server.js --client=_reference` |
| **PASO 2** | Verificar endpoints configurados |
| **PASO 3** | Verificar templates dinamicos |
| **ESPERADO** | Mock server corriendo con endpoints del cliente |

### TC-10.13 — notify.js

| Campo | Detalle |
|-------|---------|
| **ARCHIVO** | `bin/notify.js` |
| **PASO 1** | Enviar notificacion post-test |
| **ESPERADO** | Notificacion enviada al canal configurado |

### TC-10.14 — export-client.sh

| Campo | Detalle |
|-------|---------|
| **ARCHIVO** | `bin/export-client.sh` |
| **PASO 1** | Exportar cliente como paquete independiente |
| **PASO 2** | Verificar que incluye framework + client files |
| **ESPERADO** | ZIP/tar exportado con todo lo necesario |

### TC-10.15 — export-data.js

| Campo | Detalle |
|-------|---------|
| **ARCHIVO** | `bin/export-data.js` |
| **PASO 1** | Exportar datos de ejecucion |
| **ESPERADO** | Datos exportados en formato solicitado |

### TC-10.16 — audit-query.js

| Campo | Detalle |
|-------|---------|
| **ARCHIVO** | `bin/audit-query.js` |
| **PASO 1** | Consultar audit log |
| **PASO 2** | Filtrar por usuario, accion, fecha |
| **ESPERADO** | Entradas de audit filtradas y mostradas |

### TC-10.17 — detect-secrets.sh

| Campo | Detalle |
|-------|---------|
| **ARCHIVO** | `bin/detect-secrets.sh` |
| **PASO 1** | Escanear codebase por secretos hardcodeados |
| **ESPERADO** | Secretos detectados y reportados |

### TC-10.18 — build-binary.sh / build-binary-standalone.sh

| Campo | Detalle |
|-------|---------|
| **ARCHIVOS** | `bin/build-binary.sh`, `bin/build-binary-standalone.sh` |
| **PASO 1** | Compilar binario xk6 custom |
| **PASO 2** | Verificar extensiones incluidas |
| **ESPERADO** | Binario compilado con extensiones solicitadas |

### TC-10.19 — verify-binary.sh / test-binary.sh

| Campo | Detalle |
|-------|---------|
| **ARCHIVOS** | `bin/verify-binary.sh`, `bin/test-binary.sh` |
| **PASO 1** | Verificar checksum del binario |
| **PASO 2** | Ejecutar test basico con binario custom |
| **ESPERADO** | Binario verificado, test basico pasa |

### TC-10.20 — run-distributed.sh

| Campo | Detalle |
|-------|---------|
| **ARCHIVO** | `bin/run-distributed.sh` |
| **DOC** | `docs/DISTRIBUTED_TESTING.md` |
| **PASO 1** | Verificar prerequisitos (k8s, k6-operator) |
| **PASO 2** | Verificar los 6 pasos automatizados |
| **ESPERADO** | Test distribuido en K8s (requiere cluster) |

### TC-10.21 — observability.sh

| Campo | Detalle |
|-------|---------|
| **ARCHIVO** | `bin/observability.sh` |
| **PASO 1** | Levantar stack de observabilidad (Grafana, Prometheus, Loki, Tempo, Pyroscope) |
| **ESPERADO** | Stack accesible en puertos configurados |

### TC-10.22 — version.sh

| Campo | Detalle |
|-------|---------|
| **ARCHIVO** | `bin/version.sh` |
| **PASO 1** | `./bin/version.sh patch` — bump version |
| **ESPERADO** | Version bumpeada en package.json |

### TC-10.23 — run-regression.sh

| Campo | Detalle |
|-------|---------|
| **ARCHIVO** | `bin/run-regression.sh` |
| **PASO 1** | Ejecutar suite de regresion completa |
| **ESPERADO** | Todos los escenarios ejecutados, resultados comparados |

---

## CAT-11 — Schemas y Validacion

**ARCHIVOS:** `shared/schemas/*.json`

### TC-11.01 — client-config.schema.json

| Campo | Detalle |
|-------|---------|
| **PASO 1** | Validar config con todos los campos opcionales |
| **PASO 2** | Validar `client` es requerido y match `^[a-zA-Z0-9_-]+$` |
| **PASO 3** | Validar `baseUrl` es URI valida |
| **PASO 4** | Validar `auth.type` enum: none, bearer, basic, api-key |
| **PASO 5** | Validar `services` con baseUrl requerido |
| **PASO 6** | Validar `retries` con limites (maxRetries 0-10) |
| **ESPERADO** | Schema valida todos los campos documentados |

### TC-11.02 — test-config.schema.json

| Campo | Detalle |
|-------|---------|
| **PASO 1** | Validar campos requeridos: name, profile, client, script |
| **PASO 2** | Validar `profile` contra ProfileName enum |
| **ESPERADO** | Test config validada contra schema |

### TC-11.03 — slo-config.schema.json

| Campo | Detalle |
|-------|---------|
| **PASO 1** | Validar definicion SLO con metricas y targets |
| **PASO 2** | Validar risk margin |
| **ESPERADO** | SLO config validada |

### TC-11.04 — rbac-config.schema.json

| Campo | Detalle |
|-------|---------|
| **PASO 1** | Validar roles: admin, lead, developer |
| **PASO 2** | Validar permisos por rol |
| **ESPERADO** | RBAC config validada |

### TC-11.05 — chaos-config.schema.json

| Campo | Detalle |
|-------|---------|
| **PASO 1** | Validar 6 tipos de fallo |
| **PASO 2** | Validar probabilidad (0-1) |
| **ESPERADO** | Chaos config validada |

### TC-11.06 — mock-config.schema.json

| Campo | Detalle |
|-------|---------|
| **PASO 1** | Validar endpoints mock con templates |
| **PASO 2** | Validar latencia simulada |
| **ESPERADO** | Mock config validada |

### TC-11.07 — data-pool-config.schema.json

| Campo | Detalle |
|-------|---------|
| **PASO 1** | Validar configuracion de pool de datos |
| **ESPERADO** | Data pool config validada |

### TC-11.08 — threshold-override.schema.json

| Campo | Detalle |
|-------|---------|
| **PASO 1** | Validar overrides de thresholds |
| **ESPERADO** | Override config validada |

### TC-11.09 — metrics-config.json

| Campo | Detalle |
|-------|---------|
| **PASO 1** | Validar configuracion de metricas custom |
| **ESPERADO** | Metrics config validada |

### TC-11.10 — test-definition.schema.json

| Campo | Detalle |
|-------|---------|
| **PASO 1** | Validar definicion declarativa de test |
| **ESPERADO** | Test definition validada |

---

## CAT-12 — Build Pipeline

**ARCHIVOS:** `webpack.config.js`, `tsconfig.json`, `package.json`

### TC-12.01 — Webpack Build

| Campo | Detalle |
|-------|---------|
| **PASO 1** | Ejecutar `npm run build` |
| **PASO 2** | Verificar auto-discovery de entries en `clients/*/scenarios/**/*.ts` |
| **PASO 3** | Verificar output en `dist/<client>/<scenario>.js` |
| **PASO 4** | Verificar target `web` (k6 goja runtime) |
| **PASO 5** | Verificar externals: k6 builtins, jslib URLs |
| **PASO 6** | Verificar CopyWebpackPlugin copia data/ y config/ |
| **ESPERADO** | Build exitoso, archivos en dist/ con datos copiados |

### TC-12.02 — Path Aliases

| Campo | Detalle |
|-------|---------|
| **PASO 1** | Verificar `@core/*` resuelve a `src/core/*` |
| **PASO 2** | Verificar `@helpers/*` resuelve a `src/helpers/*` |
| **PASO 3** | Verificar `@observability/*` resuelve a `src/observability/*` |
| **PASO 4** | Verificar `@patterns/*` resuelve a `src/patterns/*` |
| **PASO 5** | Verificar `@types-k6/*` resuelve a `src/types/*` |
| **ESPERADO** | Aliases resueltos en build y typecheck |

### TC-12.03 — TypeScript Typecheck

| Campo | Detalle |
|-------|---------|
| **PASO 1** | Ejecutar `npm run typecheck` |
| **PASO 2** | Verificar 0 errores |
| **ESPERADO** | Sin errores de tipo |

### TC-12.04 — ESLint

| Campo | Detalle |
|-------|---------|
| **PASO 1** | Ejecutar `npm run lint` |
| **PASO 2** | Verificar 0 errores (warnings aceptables) |
| **ESPERADO** | Sin errores de linting |

### TC-12.05 — Prettier Format

| Campo | Detalle |
|-------|---------|
| **PASO 1** | Ejecutar `npm run format` |
| **PASO 2** | Verificar que no hay cambios (ya formateado) |
| **ESPERADO** | Codigo formateado consistentemente |

### TC-12.06 — Validate (typecheck + lint)

| Campo | Detalle |
|-------|---------|
| **PASO 1** | Ejecutar `npm run validate` |
| **ESPERADO** | Typecheck y lint pasan |

---

## CAT-13 — Unit Tests

**ARCHIVOS:** `test/**/*.test.ts`

### TC-13.01 — Test Suite Completa

| Campo | Detalle |
|-------|---------|
| **PASO 1** | Ejecutar `npm run test` |
| **PASO 2** | Verificar que los 15 archivos de test pasan |
| **ESPERADO** | Todos los tests pasan (exit code 0) |

### TC-13.02 — Tests de Helpers

| Campo | Detalle |
|-------|---------|
| **ARCHIVOS** | `test/helpers/browser-helper.test.ts`, `crypto-helper.test.ts`, `data-helper.test.ts`, `date-helper.test.ts`, `header-helper.test.ts`, `validation-helper.test.ts`, `websocket-v2-helper.test.ts`, `think-time-helper.test.ts` |
| **PASO 1** | Ejecutar: `npx vitest run test/helpers/` |
| **PASO 2** | Verificar cobertura de funciones principales |
| **ESPERADO** | 8 archivos de test de helpers pasan |

### TC-13.03 — Tests de Metrics

| Campo | Detalle |
|-------|---------|
| **ARCHIVOS** | `test/metrics/calculators/error-calculator.test.ts`, `performance-calculator.test.ts`, `sla-calculator.test.ts`, `throughput-calculator.test.ts`, `test/metrics/types.test.ts` |
| **PASO 1** | Ejecutar: `npx vitest run test/metrics/` |
| **ESPERADO** | 5 archivos de test de metricas pasan |

### TC-13.04 — Tests de Core

| Campo | Detalle |
|-------|---------|
| **ARCHIVOS** | `test/core/assertion-helper.test.ts` |
| **PASO 1** | Ejecutar: `npx vitest run test/core/` |
| **ESPERADO** | Test de assertion-helper pasa |

### TC-13.05 — Tests de Bin

| Campo | Detalle |
|-------|---------|
| **ARCHIVOS** | `test/bin/generate-report.test.ts` |
| **PASO 1** | Ejecutar: `npx vitest run test/bin/` |
| **ESPERADO** | Test de generate-report pasa |

### TC-13.06 — Test Coverage

| Campo | Detalle |
|-------|---------|
| **PASO 1** | Ejecutar: `npm run test:coverage` |
| **PASO 2** | Revisar reporte de cobertura |
| **ESPERADO** | Cobertura medida con v8, reporte generado |

---

## CAT-14 — Escenarios de Referencia

**ARCHIVOS:** `clients/_reference/`, `clients/_benchmark/`, `clients/examples/`

### TC-14.01 — Reference: smoke-users

| Campo | Detalle |
|-------|---------|
| **ARCHIVO** | `clients/_reference/scenarios/api/smoke-users.ts` |
| **PASO 1** | Build y ejecutar con profile smoke |
| **PASO 2** | Verificar patrones demostrados: auth, correlation, check system, RequestHelper, WeightedSwitch |
| **ESPERADO** | Test pasa con checks verdes |

### TC-14.02 — Reference: quick-request

| Campo | Detalle |
|-------|---------|
| **ARCHIVO** | `clients/_reference/scenarios/api/quick-request.ts` |
| **DOC** | `docs/QUICK_REQUEST.md` |
| **PASO 1** | Ejecutar con REQUEST_URL, REQUEST_METHOD, REQUEST_BODY |
| **PASO 2** | Probar 5 body sources: inline JSON, single file, JSONL, array, cycling |
| **PASO 3** | Probar 3 auth types: bearer, basic, api-key |
| **ESPERADO** | 15 env vars soportadas, request generico funcional |

### TC-14.03 — Reference: auth-flow

| Campo | Detalle |
|-------|---------|
| **ARCHIVO** | `clients/_reference/scenarios/integration/auth-flow.ts` |
| **PASO 1** | Ejecutar flujo de autenticacion completo |
| **ESPERADO** | Login -> token -> request autenticado -> logout |

### TC-14.04 — Reference: checkout-flow

| Campo | Detalle |
|-------|---------|
| **ARCHIVO** | `clients/_reference/scenarios/mixed/checkout-flow.ts` |
| **PASO 1** | Ejecutar flujo mixto (HTTP + correlacion) |
| **ESPERADO** | Flujo multi-paso completo |

### TC-14.05 — Reference: redis-data-pool

| Campo | Detalle |
|-------|---------|
| **ARCHIVO** | `clients/_reference/scenarios/api/16-redis-data-pool.ts` |
| **PRE** | Redis disponible con datos precargados |
| **PASO 1** | Ejecutar escenario que usa Redis data pool |
| **ESPERADO** | Datos leidos de Redis sin colisiones entre VUs |

### TC-14.06 — Reference: test-helpers

| Campo | Detalle |
|-------|---------|
| **ARCHIVO** | `clients/_reference/scenarios/test-helpers.ts` |
| **PASO 1** | Ejecutar escenario que demuestra multiples helpers |
| **ESPERADO** | Todos los helpers demostrados funcionan |

### TC-14.07 — Benchmark: baseline

| Campo | Detalle |
|-------|---------|
| **ARCHIVO** | `clients/_benchmark/scenarios/baseline.ts` |
| **DOC** | `docs/BENCHMARKING.md` |
| **PASO 1** | Ejecutar benchmark baseline |
| **PASO 2** | Verificar framework init time < 500ms |
| **PASO 3** | Verificar per-request overhead < 2ms |
| **PASO 4** | Verificar memory per VU < 5MB |
| **ESPERADO** | Overhead dentro de limites aceptables |

### TC-14.08 — Benchmark: heavy-load

| Campo | Detalle |
|-------|---------|
| **ARCHIVO** | `clients/_benchmark/scenarios/benchmark-heavy-load.ts` |
| **PASO 1** | Ejecutar benchmark con carga pesada |
| **PASO 2** | Comparar con baseline |
| **ESPERADO** | Overhead se mantiene lineal con carga |

### TC-14.09 — Examples: cookbook completo (21 escenarios)

| Campo | Detalle |
|-------|---------|
| **ARCHIVOS** | `clients/examples/scenarios/api/01-auth-bearer.ts` a `16-realistic-traffic.ts`, `integration/12-websocket.ts`, `13-websocket-v2.ts`, `15-smoke-baseline.ts`, `16-sli-monitoring.ts`, `browser/web-vitals-demo.ts`, `browser/browser-helper-demo.ts`, `mixed/09-ecommerce-flow.ts`, `13-multi-protocol.ts`, `99-full-dashboard-demo.ts` |
| **PASO 1** | Build: `npm run build` |
| **PASO 2** | Verificar que todos los 21 escenarios compilan sin errores |
| **PASO 3** | Ejecutar al menos 3 escenarios representativos con profile=smoke |
| **ESPERADO** | Todos compilan, escenarios seleccionados ejecutan correctamente |

---

## CAT-15 — Seguridad

**DOC:** `docs/SECURITY.md`

### TC-15.01 — RBAC 3 Roles

| Campo | Detalle |
|-------|---------|
| **PASO 1** | Verificar rol developer: permisos limitados |
| **PASO 2** | Verificar rol lead: permisos intermedios |
| **PASO 3** | Verificar rol admin: todos los permisos |
| **PASO 4** | Verificar 14 operaciones protegidas |
| **ESPERADO** | Matriz de permisos correcta segun SECURITY.md |

### TC-15.02 — Audit Log Inmutable

| Campo | Detalle |
|-------|---------|
| **PASO 1** | Ejecutar operacion sensible |
| **PASO 2** | Verificar entrada en audit log JSONL |
| **PASO 3** | Verificar hash chain SHA-256 |
| **PASO 4** | Verificar deteccion de tampering |
| **ESPERADO** | Log tamper-evident funcional |

### TC-15.03 — Client Isolation

| Campo | Detalle |
|-------|---------|
| **PASO 1** | Intentar acceder a datos de otro cliente via path traversal |
| **PASO 2** | Verificar aislamiento de env vars |
| **ESPERADO** | Path traversal bloqueado, env vars aisladas |

### TC-15.04 — Shell Hardening

| Campo | Detalle |
|-------|---------|
| **PASO 1** | Intentar inyeccion de comandos en parametros CLI |
| **PASO 2** | Verificar validacion de input |
| **PASO 3** | Verificar whitelist de backends de secretos |
| **ESPERADO** | Inyeccion bloqueada, inputs validados |

### TC-15.05 — YAML Bomb Protection

| Campo | Detalle |
|-------|---------|
| **PASO 1** | Enviar YAML con billion laughs attack |
| **PASO 2** | Enviar YAML con profundidad excesiva |
| **ESPERADO** | Ambos rechazados con error descriptivo |

### TC-15.06 — PII Redaction en Reportes

| Campo | Detalle |
|-------|---------|
| **PASO 1** | Generar reporte con tags que contienen datos sensibles |
| **PASO 2** | Verificar que valores PII estan enmascarados |
| **ESPERADO** | PII redactado automaticamente en reportes HTML |

### TC-15.07 — Secrets Detection

| Campo | Detalle |
|-------|---------|
| **PASO 1** | Ejecutar `./bin/detect-secrets.sh` |
| **PASO 2** | Verificar que detecta tokens hardcodeados |
| **ESPERADO** | Secretos detectados, reporte generado |

### TC-15.08 — Binary Validation

| Campo | Detalle |
|-------|---------|
| **PASO 1** | Verificar binario k6 contra whitelist |
| **PASO 2** | Verificar checksum de binario custom |
| **ESPERADO** | Solo binarios validados aceptados |

---

## CAT-16 — SLO/SLA

**DOC:** `docs/SLA_SLO.md` | **ARCHIVOS:** `src/core/slo-evaluator.ts`, `src/types/slo.d.ts`

### TC-16.01 — SLO Definition

| Campo | Detalle |
|-------|---------|
| **PASO 1** | Crear `clients/<name>/config/slos.json` |
| **PASO 2** | Definir SLOs para 7 metricas disponibles |
| **PASO 3** | Configurar risk margin (default 0.1) |
| **ESPERADO** | SLO config valida creada |

### TC-16.02 — Automatic Evaluation

| Campo | Detalle |
|-------|---------|
| **PASO 1** | Ejecutar test con SLO config |
| **PASO 2** | Verificar evaluacion automatica post-test |
| **PASO 3** | Verificar clasificacion por metrica |
| **ESPERADO** | Evaluacion automatica con resultados por metrica |

### TC-16.03 — Three-State Classification

| Campo | Detalle |
|-------|---------|
| **PASO 1** | Generar resultado que cumple SLO |
| **PASO 2** | Generar resultado en zona de riesgo (dentro del risk margin) |
| **PASO 3** | Generar resultado que incumple SLO |
| **ESPERADO** | 3 estados correctos: `cumple`, `en_riesgo`, `incumple` |

### TC-16.04 — APDEX Score

| Campo | Detalle |
|-------|---------|
| **PASO 1** | Calcular APDEX con datos de latencia |
| **PASO 2** | Verificar escala 0-1 |
| **PASO 3** | Verificar 6 niveles de rating |
| **ESPERADO** | APDEX calculado: Excellent (>0.93), Good, Fair, Poor, Unacceptable, Critical |

### TC-16.05 — SLO Monthly Report

| Campo | Detalle |
|-------|---------|
| **PASO 1** | Generar reporte mensual: `node bin/slo-report.js` |
| **PASO 2** | Verificar compliance %, tendencias, periodos de incumplimiento |
| **PASO 3** | Verificar recomendaciones automaticas |
| **ESPERADO** | Reporte mensual con metricas de compliance |

### TC-16.06 — SLO en HTML Report

| Campo | Detalle |
|-------|---------|
| **PASO 1** | Generar reporte HTML con SLO activos |
| **PASO 2** | Verificar seccion SLA/SLO Compliance con traffic light table |
| **ESPERADO** | Tabla visual con verde/amarillo/rojo por SLO |

### TC-16.07 — SLO Types

| Campo | Detalle |
|-------|---------|
| **ARCHIVO** | `src/types/slo.d.ts` |
| **PASO 1** | Verificar SloStatus: `cumple | en_riesgo | incumple` |
| **PASO 2** | Verificar SloConfig, SloEvaluation, SloComplianceReport |
| **ESPERADO** | Tipos correctos segun documentacion |

---

## Matriz de Trazabilidad

### Documentacion -> Casos de Prueba

| Documento | Casos de Prueba |
|-----------|----------------|
| `LOAD_PROFILES.md` | TC-01.01 a TC-01.15 |
| `FEATURE_CATALOG.md` | TC-02.01 a TC-02.18, TC-03.01 a TC-03.09 |
| `MOCKS_CHAOS.md` | TC-03.06, TC-03.08 |
| `SECURITY.md` | TC-04.05, TC-04.06, TC-04.09 a TC-04.12, TC-15.01 a TC-15.08 |
| `METRICS_ENGINE.md` | TC-05.01 a TC-05.13 |
| `REPORTING.md` | TC-06.01 a TC-06.08 |
| `BENCHMARKING.md` | TC-07.01 a TC-07.05, TC-14.07, TC-14.08 |
| `REDIS_DATA_SUPPORT.md` | TC-02.12 a TC-02.14, TC-10.06, TC-10.07 |
| `SLA_SLO.md` | TC-16.01 a TC-16.07 |
| `TEST_TYPES.md` | TC-14.01 a TC-14.09 |
| `CI_CD_INTEGRATION.md` | TC-04.20, TC-09.01 |
| `QUICK_REQUEST.md` | TC-14.02 |
| `GRAFANA.md` | (validacion manual de dashboards) |
| `DOCKER.md` | (validacion manual de contenedores) |
| `DISTRIBUTED_TESTING.md` | TC-10.20 |
| `MCP_SERVER.md` | (validacion manual — 8 tools MCP) |
| `EXTENSION_POINTS.md` | TC-04.19 |
| `WORKFLOW.md` | TC-10.01, TC-10.02 |
| `COMPLIANCE_CHECKLIST.md` | Todos los TC (referencia cruzada) |

### Schemas -> Casos de Prueba

| Schema | Caso de Prueba |
|--------|---------------|
| `client-config.schema.json` | TC-11.01 |
| `test-config.schema.json` | TC-11.02 |
| `slo-config.schema.json` | TC-11.03 |
| `rbac-config.schema.json` | TC-11.04 |
| `chaos-config.schema.json` | TC-11.05 |
| `mock-config.schema.json` | TC-11.06 |
| `data-pool-config.schema.json` | TC-11.07 |
| `threshold-override.schema.json` | TC-11.08 |
| `metrics-config.json` | TC-11.09 |
| `test-definition.schema.json` | TC-11.10 |

### Archivos TypeScript -> Casos de Prueba

| Modulo | Archivos | Casos |
|--------|----------|-------|
| Core | 26 archivos en `src/core/` | TC-04.01 a TC-04.26 |
| Helpers | 18 archivos en `src/helpers/` | TC-02.01 a TC-02.18 |
| Patterns | 9 archivos en `src/patterns/` | TC-03.01 a TC-03.09 |
| Metrics | 14 archivos en `src/metrics/` | TC-05.01 a TC-05.13 |
| Reporting | 6 archivos en `src/reporting/` | TC-06.01 a TC-06.08 |
| Observability | 6 archivos en `src/observability/` | TC-07.01 a TC-07.05 |
| AI | 11 archivos en `src/ai/` | TC-08.01 a TC-08.10 |
| Integrations | 4 archivos en `src/integrations/` | TC-09.01 a TC-09.04 |
| Types | 9 archivos en `src/types/` | TC-01.14, TC-05.13, TC-16.07 |

---

## Resumen Ejecutivo

| Categoria | Casos | Descripcion |
|-----------|-------|-------------|
| CAT-01 Perfiles de Carga | 15 | 13 perfiles + types + jerarquia thresholds |
| CAT-02 Helpers | 18 | 17 helpers + barrel export |
| CAT-03 Patrones | 9 | 8 patrones + barrel export |
| CAT-04 Core | 26 | 26 modulos core del framework |
| CAT-05 Motor de Metricas | 13 | Engine + 11 calculadores + types |
| CAT-06 Reporting | 8 | HTML, JSON, capacity, trends, PDF, LLM, comparison |
| CAT-07 Observabilidad | 5 | Overhead, health, infra, Pyroscope, tracing |
| CAT-08 AI Agents | 10 | 4 agentes + anomaly + KB + budget + orchestrator + self-healing + validation |
| CAT-09 Integraciones | 4 | Notifications, bot engine, bot interface, Slack |
| CAT-10 CLI Tools | 23 | Scripts bash y node en bin/ |
| CAT-11 Schemas | 10 | 10 JSON schemas de validacion |
| CAT-12 Build Pipeline | 6 | Webpack, aliases, typecheck, lint, format, validate |
| CAT-13 Unit Tests | 6 | Suite completa, helpers, metrics, core, bin, coverage |
| CAT-14 Escenarios Referencia | 9 | Reference, benchmark, examples (21 cookbook) |
| CAT-15 Seguridad | 8 | RBAC, audit, isolation, hardening, YAML, PII, secrets, binary |
| CAT-16 SLO/SLA | 7 | Definition, evaluation, classification, APDEX, monthly, HTML, types |
| **TOTAL** | **177** | |

---

> **Nota:** Este plan cubre 177 casos de prueba funcionales. Algunos escenarios (Grafana dashboards, Docker, K8s distributed, MCP server) requieren infraestructura adicional y se validan manualmente. El total de funcionalidades documentadas es 192+, las 15+ restantes corresponden a variantes y sub-features validadas implicitamente en los casos principales.
