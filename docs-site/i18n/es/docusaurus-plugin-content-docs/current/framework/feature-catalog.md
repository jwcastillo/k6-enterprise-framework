---
title: "k6 Enterprise Framework — Catálogo Completo de Funcionalidades"
sidebar_position: 1
---
# k6 Enterprise Framework — Catálogo Completo de Funcionalidades

> **196+ funcionalidades en 16 categorías** — Un listado exhaustivo de cada capacidad del k6 Enterprise Load Testing Framework.

---

## Matriz Resumen

| #  | Categoría                    | Funcionalidades | Estado      |
|----|------------------------------|-----------------|-------------|
| 1  | Perfiles de Carga            | 15              | Estable     |
| 2  | Helpers                      | 15              | Estable     |
| 3  | Patrones                     | 10              | Estable     |
| 4  | Motor de Métricas            | 125+            | Estable     |
| 5  | Reportes                     | 18+             | Estable     |
| 6  | Dashboards de Grafana        | 3               | Estable     |
| 7  | Métricas Personalizadas      | 4 tipos         | Estable     |
| 8  | Análisis de Grupos           | 3               | Estable     |
| 9  | SLA / SLO                    | 5               | Estable     |
| 10 | Seguridad                    | 14              | Estable     |
| 11 | CI/CD                        | 3               | Estable     |
| 12 | Observabilidad               | 9               | Estable     |
| 13 | Generadores                  | 4               | Estable     |
| 14 | Distribución (K8s)           | 5               | Estable     |
| 15 | Servidor MCP                 | 8 herramientas  | Estable     |
| 16 | Hoja de Ruta IA v2           | 4 agentes       | Beta        |
|    | **Total**                    | **192+**        |             |

---

## 1. Perfiles de Carga (15)

Configuraciones de perfiles de carga predefinidas que definen patrones de rampa de usuarios virtuales, duraciones y criterios de umbral. Cada perfil es un archivo JSON autocontenido consumido por el runner mediante el flag `--profile`.

### LP-001: smoke

- **VUs:** 1-2
- **Duración:** 1 min
- **Umbrales:** p(95) < 2000 ms, tasa de error < 1%, checks >= 99%
- **Etapas:** 30s rampa a 1 VU, 30s rampa a 0 VU
- **Duración Máxima:** 2 min
- **Propósito:** Carga mínima para verificar que el sistema está operativo antes de pruebas más intensas
- **Archivo:** `shared/profiles/smoke.json`

### LP-002: quick

- **VUs:** 5
- **Duración:** 3 min
- **Umbrales:** p(95) < 1500 ms, p(99) < 3000 ms, tasa de error < 5%, checks >= 95%
- **Etapas:** 30s rampa a 5, 2m mantener en 5, 30s rampa a 0
- **Propósito:** Ciclo de retroalimentación rápida para desarrollo — valida el rendimiento básico durante el desarrollo de funcionalidades
- **Archivo:** `shared/profiles/quick.json`

### LP-003: load

- **VUs:** 20
- **Duración:** 14 min
- **Umbrales:** p(95) < 1000 ms, p(99) < 2000 ms, tasa de error < 5%, checks >= 95%
- **Etapas:** 2m rampa a 20, 10m mantener en 20, 2m rampa a 0
- **Propósito:** Prueba de carga estándar — valida el comportamiento del sistema bajo tráfico esperado a nivel de producción
- **Archivo:** `shared/profiles/load.json`

### LP-004: rampup

- **VUs:** 10 a 50
- **Duración:** 13 min
- **Umbrales:** p(95) < 1500 ms, tasa de error < 10%, checks >= 90%
- **Etapas:** 2m rampa a 10, 3m rampa a 30, 3m rampa a 50, 3m mantener en 50, 2m rampa a 0
- **Propósito:** Incremento gradual de carga — identifica el punto donde el rendimiento comienza a degradarse
- **Archivo:** `shared/profiles/rampup.json`

### LP-005: capacity

- **VUs:** 50 a 200
- **Duración:** 20 min
- **Umbrales:** p(95) < 2000 ms, p(99) < 5000 ms, tasa de error < 15%, checks >= 85%
- **Etapas:** 3m rampa a 50, 4m rampa a 100, 4m rampa a 150, 4m rampa a 200, 3m mantener en 200, 2m rampa a 0
- **Propósito:** Planificación de capacidad — determina el rendimiento máximo que el sistema puede sostener
- **Archivo:** `shared/profiles/capacity.json`

### LP-006: stress

- **VUs:** 100 a 400
- **Duración:** 25 min
- **Umbrales:** p(95) < 5000 ms, tasa de error < 30%, checks >= 70%
- **Etapas:** 3m rampa a 100, 5m rampa a 200, 5m rampa a 300, 5m rampa a 400, 3m mantener en 400, 4m rampa a 0
- **Propósito:** Prueba de estrés — lleva el sistema muy por encima de los límites normales para encontrar puntos de quiebre
- **Archivo:** `shared/profiles/stress.json`

### LP-007: spike

- **VUs:** Ráfaga hasta 300
- **Duración:** 8 min
- **Umbrales:** p(95) < 5000 ms, tasa de error < 25%, checks >= 75%
- **Etapas:** 30s rampa a 300, 1m mantener en 300, 30s rampa a 50, 3m mantener en 50, 30s rampa a 300, 1m mantener en 300, 1m30s rampa a 0
- **Propósito:** Prueba de picos — valida el comportamiento del sistema ante ráfagas repentinas de tráfico
- **Archivo:** `shared/profiles/spike.json`

### LP-008: breakpoint

- **VUs:** Rampa hasta 1000
- **Duración:** 1 hora
- **Umbrales:** p(95) < 60000 ms, tasa de error < 50%
- **Etapas:** Rampa lineal continua de 0 a 1000 durante 1h
- **Propósito:** Prueba de punto de quiebre — encuentra el límite superior absoluto donde el sistema falla
- **Archivo:** `shared/profiles/breakpoint.json`

### LP-009: soak

- **VUs:** 20
- **Duración:** 4 horas+
- **Umbrales:** p(95) < 1500 ms, p(99) < 3000 ms, tasa de error < 5%, checks >= 95%
- **Etapas:** 5m rampa a 20, 3h50m mantener en 20, 5m rampa a 0
- **Propósito:** Prueba de resistencia — detecta fugas de memoria, agotamiento de recursos y degradación a largo plazo
- **Archivo:** `shared/profiles/soak.json`

### LP-010: throughput-low

- **Ejecutor:** constant-arrival-rate
- **Tasa:** 10 iteraciones/segundo
- **Duración:** 5 min
- **VUs:** 20 pre-asignados, 50 máximo
- **Umbrales:** p(95) < 2000 ms, p(99) < 5000 ms, tasa de error < 5%, checks >= 95%
- **Propósito:** Throughput constante bajo — prueba base de modelo abierto
- **Archivo:** `shared/profiles/throughput-low.json`

### LP-011: throughput-medium

- **Ejecutor:** constant-arrival-rate
- **Tasa:** 50 iteraciones/segundo
- **Duración:** 5 min
- **VUs:** 60 pre-asignados, 150 máximo
- **Umbrales:** p(95) < 1500 ms, p(99) < 3000 ms, tasa de error < 5%, checks >= 95%
- **Propósito:** Throughput constante medio — simula tráfico típico de producción con modelo abierto
- **Archivo:** `shared/profiles/throughput-medium.json`

### LP-012: throughput-high

- **Ejecutor:** constant-arrival-rate
- **Tasa:** 100 iteraciones/segundo
- **Duración:** 5 min
- **VUs:** 120 pre-asignados, 300 máximo
- **Umbrales:** p(95) < 1000 ms, p(99) < 2000 ms, tasa de error < 5%, checks >= 95%
- **Propósito:** Throughput constante alto — simulación de tráfico pico con modelo abierto
- **Archivo:** `shared/profiles/throughput-high.json`

### LP-013: throughput-ramp

- **Ejecutor:** ramping-arrival-rate
- **Tasa:** 10→100 iteraciones/segundo (rampa)
- **Duración:** 12 min
- **VUs:** 120 pre-asignados, 300 máximo
- **Umbrales:** p(95) < 2000 ms, p(99) < 5000 ms, tasa de error < 10%, checks >= 90%
- **Etapas:** 2m → 10/s, 3m → 50/s, 3m → 100/s, 2m mantener en 100/s, 2m → 0
- **Propósito:** Throughput creciente — encuentra la tasa máxima sostenible de solicitudes con modelo abierto
- **Archivo:** `shared/profiles/throughput-ramp.json`

### LP-014: Modelo de Throughput (usuarios → RPS)

- **Propósito:** Fórmula inspirada en GPT que convierte un número objetivo de usuarios concurrentes en RPS recomendados y valores máximos de VUs por clase de endpoint
- **Clases de endpoint:** `"api"` (20 RPS/1k usuarios), `"web"` (2), `"git-pull"` (2), `"git-push"` (0.4, mínimo ≥1)
- **Recomendación de VUs máximos:** `min(targetRps × 5, 2000)`
- **Funciones:** `targetRpsForUsers(users, class)`, `recommendMaxVUs(rps)`, `buildThroughputPlan(users)`
- **Archivo:** `src/core/throughput-model.ts`

### LP-015: Control de Ejecución por Nivel de Riesgo (quarantine / experimental / unsafe)

- **Propósito:** Eje de seguridad ortogonal que impide la ejecución de escenarios riesgosos a menos que se pase un flag de opt-in explícito en el CLI
- **Tipos de gate:** `"quarantined"`, `"experimental"`, `"unsafe"` (declarados con `export const gate = "<kind>"`)
- **Flags del runner:** `--quarantined`, `--experimental`, `--unsafe` (denegación por defecto; flag faltante sale con 108)
- **Nota:** NO es un sexto bucket — los escenarios controlados siguen en uno de los 5 buckets canónicos
- **Archivos:** `src/core/gating.ts`, `bin/run-test.sh` (bloque de verificación de gate)

---

## 2. Helpers (15)

Módulos TypeScript reutilizables que proporcionan utilidades comunes para scripts de prueba k6. Todos los helpers son importables desde `src/helpers/index.ts`.

### HLP-001: RequestHelper

- **Propósito:** Wrapper de cliente HTTP con cabeceras de trazabilidad automáticas e inyección de autenticación
- **Métodos:** `get()`, `post()`, `put()`, `patch()`, `delete()`
- **Características:** Auto-adjunta IDs de correlación, soporta todos los verbos HTTP, se integra con patrones de autenticación
- **Archivo:** `src/helpers/request-helper.ts`

### HLP-002: DataHelper

- **Propósito:** Generación de datos de prueba aleatorios con formatos realistas
- **Métodos:** `randomString()`, `randomEmail()`, `randomCreditCard()` (válido Luhn), `randomUser()`, `randomPrice()`
- **Características:** Algoritmo de Luhn para tarjetas de crédito, longitudes de cadena configurables, nombres adaptados a locale
- **Archivo:** `src/helpers/data-helper.ts`

### HLP-003: DateHelper

- **Propósito:** Manipulación y formateo de fechas para escenarios de prueba
- **Métodos:** `format()`, `range()`, `addDays()`, `addHours()`, `addMinutes()`, `toUnixTimestamp()`, `isPast()`, `isFuture()`, `dayOfWeek()`
- **Características:** Formateo ISO 8601, conversión a timestamp Unix, aritmética de fechas
- **Archivo:** `src/helpers/date-helper.ts`

### HLP-004: HeaderHelper

- **Propósito:** Construcción de cabeceras HTTP para trazabilidad, autenticación e instrumentación
- **Métodos:** Cabeceras de trazabilidad (basadas en UUID), cabeceras de autenticación, cabeceras estándar, cabeceras de localización, cabeceras de instrumentación
- **Características:** Compatible con W3C Trace Context, generación automática de IDs de correlación
- **Archivo:** `src/helpers/header-helper.ts`

### HLP-005: ValidationHelper

- **Propósito:** Utilidades de validación de respuestas para aserciones
- **Métodos:** `status()`, `hasFields()`, `responseTime()`, validadores de email/URL/UUID/tarjeta de crédito
- **Características:** Verificaciones de presencia de campos tipo esquema, validación de formato, verificaciones de tiempo basadas en umbrales
- **Archivo:** `src/helpers/validation-helper.ts`

### HLP-006: PerformanceHelper

- **Propósito:** Análisis estadístico de distribuciones de tiempo de respuesta
- **Métodos:** Cálculo de percentiles (p50/p90/p95/p99), `aggregate()`, `compareBaseline()`
- **Características:** Comparación con línea base con análisis de delta, agregación multi-ejecución
- **Archivo:** `src/helpers/performance-helper.ts`

### HLP-007: StructuredLogger

- **Propósito:** Logging estructurado en JSON con enmascaramiento de secretos
- **Métodos:** `logRequest()`, `logEvent()`, `logError()`, `sanitizeUrl()`
- **Características:** Detección automática de PII/secretos y enmascaramiento, sanitización de credenciales en URLs, salida JSON estructurada
- **Archivo:** `src/helpers/structured-logger.ts`

### HLP-008: RedisHelper

- **Propósito:** Wrapper de operaciones Redis para pruebas basadas en datos
- **Métodos:** `set()`, `get()`, `del()`, `hset()`, `hget()`, `hgetall()`, `lpush()`, `rpush()`, `lpop()`, `lrange()`, `sadd()`, `smembers()`, `incr()`, `decr()`, `scan()`, `bulkLoad()`
- **Características:** Soporte completo de estructuras de datos Redis (strings, hashes, listas, conjuntos), carga masiva, gestión de TTL
- **Archivo:** `src/helpers/redis-helper.ts`

### HLP-009: UploadHelper

- **Propósito:** Operaciones de carga/descarga de archivos para pruebas multipart
- **Métodos:** `uploadFile()` (multipart/form-data), `downloadFile()`, `withRateLimitHandling()`
- **Características:** Codificación multipart, reintento automático en 429, detección de límite de tasa
- **Archivo:** `src/helpers/upload-helper.ts`

### HLP-010: GraphQLHelper

- **Propósito:** Ejecución de consultas y mutaciones GraphQL
- **Métodos:** `query()`, `mutate()` — ambos con soporte de variables
- **Características:** Inyección de variables, manejo parcial de respuestas, extracción de errores
- **Archivo:** `src/helpers/graphql-helper.ts`

### HLP-011: WebSocketHelper

- **Propósito:** Gestión del ciclo de vida de conexiones WebSocket
- **Métodos:** `runWebSocket()`, `wsEchoTest()`
- **Características:** Aplicación automática de `wss://`, envío/recepción de mensajes, hooks de ciclo de vida de conexión
- **Archivo:** `src/helpers/websocket-helper.ts`

### HLP-012: DataPool

- **Propósito:** Gestión de pool de datos de prueba con estrategias de asignación
- **Métodos:** Inicialización de pool CSV/JSON, acceso round-robin, acceso aleatorio, asignación basada en VU
- **Características:** Políticas de agotamiento (reciclar, detener, error), asignación por afinidad de VU, acceso thread-safe
- **Archivo:** `src/helpers/data-pool.ts`

### HLP-013: CheckSystem

- **Propósito:** Framework de aserciones estructuradas con grupos de verificación nombrados
- **Métodos:** `registerCheck()`, `statusCheck()`, `schemaCheck()`, `thresholdCheck()`, `runChecks()`
- **Características:** Registro de verificaciones nombradas, ejecución por lotes, agregación de resultados
- **Archivo:** `src/core/check-system.ts`

### HLP-014: RedisSecurityHelper

- **Propósito:** Operaciones Redis seguras con control de acceso
- **Métodos:** Wrappers de seguridad Redis, validación de acceso
- **Características:** Control de acceso a nivel de clave, auditoría de operaciones, seguridad de conexión
- **Archivo:** `src/helpers/redis-security.ts`

### HLP-015: ThinkTimeHelper

- **Propósito:** Simulación realista de tiempos de espera de usuario para pruebas de carga
- **Métodos:** `thinkTime()` (aleatorio uniforme), `thinkTimeNormal()` (distribución normal), `randomNormal()` (Box-Muller), `pace()` (pacing de iteración)
- **Características:** Rangos preestablecidos (FAST/NORMAL/SLOW/READING), distribución normal acotada, pacing de iteración para throughput constante
- **Archivo:** `src/helpers/think-time-helper.ts`

---

## 3. Patrones (10)

Patrones arquitectónicos reutilizables para escenarios comunes de pruebas de carga. Todos los patrones son importables desde `src/patterns/index.ts`.

### PAT-001: Autenticación

- **Propósito:** Flujos de autenticación multi-protocolo
- **Funciones:** `authenticate()`, `isSessionValid()`, `sessionRequestOptions()`
- **Protocolos:** Bearer Token, Basic Auth, OAuth2 (credenciales de cliente, código de autorización), API Key
- **Características:** Caché de tokens, renovación automática, validación de sesión
- **Archivo:** `src/patterns/auth-pattern.ts`

### PAT-002: Correlación e Interpolación

- **Propósito:** Extracción dinámica de datos y sustitución de plantillas
- **Funciones:** `extractFromResponse()`, `interpolate()`
- **Características:** Extracción JSONPath/regex, interpolación de plantillas estilo Mustache, extracción encadenada
- **Archivo:** `src/patterns/correlation-pattern.ts`

### PAT-003: Paginación

- **Propósito:** Recorrido automatizado de endpoints de API paginados
- **Funciones:** `initPagination()`, `traverseAll()`
- **Modos:** Basado en offset, basado en cursor, basado en número de página
- **Características:** Detección automática de página siguiente, tamaño de página configurable, acumulación de resultados
- **Archivo:** `src/patterns/pagination-pattern.ts`

### PAT-004: Reintento con Backoff

- **Propósito:** Ejecución resiliente de peticiones con backoff exponencial
- **Funciones:** `withRetry()`, `retryRequest()`
- **Características:** Backoff exponencial con jitter, máximo de reintentos configurable, predicados de condición de reintento
- **Archivo:** `src/patterns/retry-pattern.ts`

### PAT-005: Ejecución Ponderada

- **Propósito:** Distribución probabilística de escenarios
- **Funciones:** `weightedSwitch()`
- **Características:** Selección aleatoria ponderada, mezcla de escenarios, distribución basada en porcentajes
- **Archivo:** `src/patterns/weighted-execution.ts`

### PAT-006: Validación de Contrato

- **Propósito:** Validación de contratos de API basada en JSON Schema
- **Clase:** `ContractValidator`
- **Características:** Validación JSON Schema basada en ajv, mensajes de error personalizados, soporte draft-07
- **Archivo:** `src/patterns/contract-validation.ts`

### PAT-007: Mock Server

- **Propósito:** Configuración de mock server y gestión de URLs
- **Funciones:** `loadMockConfigs()`, `getMockUrl()`
- **Características:** Definiciones de mock por endpoint, resolución de URLs según entorno, stubbing de respuestas
- **Archivo:** `src/node/mock-server.ts` (Node-only; reubicado desde `src/patterns/` en Phase 4 / ARC-06)

### PAT-008: Inyección de Caos

- **Propósito:** Inyección de fallos para pruebas de resiliencia
- **Funciones:** `loadChaosConfig()`, `evaluateChaosRules()`
- **Características:** Inyección de latencia, inyección de errores, inyección de abortos, tasas de fallo configurables
- **Archivo:** `src/patterns/chaos-injection.ts`

### PAT-009: Patrones con Respaldo Redis

- **Propósito:** Coordinación distribuida mediante Redis
- **Clases/Funciones:** `UserPool`, `DistributedRateLimiter`, `StatsCounter`
- **Características:** Pool de usuarios distribuido con checkout/checkin, limitación de tasa global, contadores atómicos
- **Archivo:** `src/patterns/redis-patterns.ts`

### PAT-010: Análisis de Embudo

- **Propósito:** Ejecución de embudos multi-paso con seguimiento de abandono
- **Funciones:** `initFunnelMetrics()`, `runFunnel()`
- **Características:** Seguimiento de conversión paso a paso, tasa de abandono por paso, datos de visualización del embudo
- **Archivo:** `src/patterns/funnel-pattern.ts`

---

## 4. Motor de Métricas (125+ métricas en 11 calculadores)

Un pipeline central que recopila, calcula, verifica umbrales y reporta métricas. El motor sigue una arquitectura `recopilar -> calcular -> verificar umbrales -> reportar`. Cada calculador se registra y se ejecuta en orden.

**Arquitectura:**
- **Archivo:** `src/metrics/metrics-engine.ts` — Orquestador central
- **Tipos:** `src/metrics/types.ts` — Tipos compartidos y funciones utilitarias

### 4.1 Calculador de Rendimiento (50 métricas: PERF-001 a PERF-050)

Calcula métricas de tiempo de respuesta y latencia a partir de datos nativos de k6.

| Rango de ID   | Grupo de Métricas                   | Descripción                                           |
|----------------|-------------------------------------|-------------------------------------------------------|
| PERF-001..009  | Percentiles de Tiempo de Respuesta  | avg, min, mediana, max, p90, p95, p99, stddev, CV     |
| PERF-010..018  | TTFB y Fases de Conexión            | TTFB, búsqueda DNS, conexión TCP, handshake TLS, procesamiento del servidor, transferencia de contenido |
| PERF-019..025  | APDEX y Satisfacción                | Puntuación APDEX (T configurable), ratios satisfecho/tolerando/frustrado |
| PERF-026..035  | Análisis de Tendencia               | Pendiente de tendencia de tiempo de respuesta (regresión lineal), indicador de estabilización de calentamiento |
| PERF-036..050  | Latencia Avanzada                   | Tiempo inactivo, marcadores específicos de protocolo, índice de degradación |

- **Archivo:** `src/metrics/calculators/performance-calculator.ts`

### 4.2 Calculador de Throughput (25 métricas: THRU-001 a THRU-025)

Calcula métricas de throughput, ancho de banda y capacidad.

| Rango de ID   | Grupo de Métricas                   | Descripción                                           |
|----------------|-------------------------------------|-------------------------------------------------------|
| THRU-001..005  | Throughput Base                     | RPS alcanzado, bytes entrada/salida, TPS              |
| THRU-006..010  | Análisis de Ratios                  | Ratio pico-a-media, throughput por VU                 |
| THRU-011..015  | Detección de Techo                  | Techo de throughput, validación de Ley de Little      |
| THRU-016..020  | Goodput y Amplificación             | Goodput, factor de amplificación de reintentos        |
| THRU-021..025  | Margen y Límites                    | Margen de límite de tasa, proximidad a límite de conexiones |

- **Archivo:** `src/metrics/calculators/throughput-calculator.ts`

### 4.3 Calculador de Errores (30 métricas: ERR-001 a ERR-030)

Calcula distribución de errores, tendencias y métricas de correlación.

| Rango de ID   | Grupo de Métricas                   | Descripción                                           |
|----------------|-------------------------------------|-------------------------------------------------------|
| ERR-001..005   | Tasas de Error Base                 | Tasa de error general, tasa 5xx, tasa 429, tasa 4xx  |
| ERR-006..010   | Modos de Fallo                      | Tasa de timeout, fallos de conexión, fallos DNS, fallos TLS |
| ERR-011..015   | Picos y Tendencia                   | Pico de error (ventana máx. 1 min), pendiente de tendencia de error |
| ERR-016..020   | Presupuesto y Reintento             | Tasa de consumo de presupuesto de error, tasa de éxito de reintentos, indicadores de circuit breaker |
| ERR-021..025   | Entropía de Shannon                 | Entropía de distribución de códigos de error, diversidad de errores |
| ERR-026..030   | Cascada y Correlación               | Detección de fallos en cascada, análisis de correlación de errores |

- **Archivo:** `src/metrics/calculators/error-calculator.ts`

### 4.4 Calculador de Saturación (50 métricas: SAT-001 a SAT-050)

Calcula la saturación de recursos en 11 subsistemas. Requiere métricas externas de Prometheus.

| Rango de ID   | Grupo de Métricas                   | Descripción                                           |
|----------------|-------------------------------------|-------------------------------------------------------|
| SAT-001..005   | Saturación de VU                    | VU pico, punto de saturación, margen                  |
| SAT-006..010   | CPU                                 | CPU de aplicación, CPU de host, eventos de throttle   |
| SAT-011..015   | Memoria                             | RSS, pendiente de crecimiento, indicador OOM          |
| SAT-016..020   | GC                                  | Pausa p99, frecuencia, sobrecarga, utilización de heap |
| SAT-021..025   | Sistema                             | Hilos, profundidad de cola de pool, descriptores de archivo, backlog de sockets |
| SAT-026..030   | Almacenamiento                      | E/S de disco, IOPS, latencia                          |
| SAT-031..035   | Red                                 | Ancho de banda, descartes, retransmisiones, puertos efímeros |
| SAT-036..040   | Pool de Conexiones                  | Agotamiento, tiempo de espera, utilización            |
| SAT-041..045   | Base de Datos                       | Uso de pool, latencia de consultas, espera de bloqueo, deadlocks |
| SAT-046..048   | Caché                               | Ratio de aciertos, tasa de desalojo, latencia         |
| SAT-049..050   | Cola                                | Profundidad, latencia de publicación, retraso de consumidor |

- **Archivos:** `src/metrics/calculators/saturation/` (5 sub-calculators: `cpu`, `memory`, `io`, `network`, `resource`) + `saturation/index.ts` (fachada). El legacy `saturation-calculator.ts` es un shim de 5 líneas mantenido por compatibilidad (Phase 4 / ARC-07).

### 4.5 Calculador de SLA (20 métricas: SLA-001 a SLA-020)

Calcula el cumplimiento de Acuerdos de Nivel de Servicio.

| Rango de ID   | Grupo de Métricas                   | Descripción                                           |
|----------------|-------------------------------------|-------------------------------------------------------|
| SLA-001..005   | Disponibilidad                      | Disponibilidad basada en peticiones, disponibilidad basada en tiempo |
| SLA-006..010   | Presupuesto de Error                | Presupuesto de error restante, tasa de consumo        |
| SLA-011..015   | Cumplimiento de SLO                 | Cumplimiento de SLO de latencia, cumplimiento de SLO de throughput, puntuación compuesta multi-SLI |
| SLA-016..020   | Recuperación e Incumplimiento       | MTTR, duración de incumplimiento, frecuencia de incumplimiento, tasa de corrección, idempotencia |

- **Archivo:** `src/metrics/calculators/sla-calculator.ts`

### 4.6 Calculador de Estabilidad / Soak (20 métricas: STAB-001 a STAB-020)

Detecta patrones de degradación en ejecuciones prolongadas mediante análisis de regresión.

| Rango de ID   | Grupo de Métricas                   | Descripción                                           |
|----------------|-------------------------------------|-------------------------------------------------------|
| STAB-001..005  | Detección de Fugas                  | Pendiente de fuga de memoria, fuga de handles, fuga de hilos, fuga de conexiones |
| STAB-006..010  | Deriva de Latencia                  | Comparación p95 temprano vs tardío, índice de degradación de latencia |
| STAB-011..015  | Deriva de Throughput                | Comparación RPS temprano vs tardío, estabilidad de throughput |
| STAB-016..020  | Deriva de Errores y Logs            | Deriva de tasa de error, detección de picos, anomalía de volumen de logs, evaluación de aptitud para soak |

- **Archivo:** `src/metrics/calculators/stability-calculator.ts`

### 4.7 Calculador de Escalabilidad (20 métricas: SCALE-001 a SCALE-020)

Evalúa cómo escala el sistema con carga creciente.

| Rango de ID   | Grupo de Métricas                   | Descripción                                           |
|----------------|-------------------------------------|-------------------------------------------------------|
| SCALE-001..005 | Índice de Escalabilidad             | Índice de escalabilidad lineal (proxy de Ley de Amdahl), ratio de eficiencia |
| SCALE-006..010 | Análisis Multi-Carga                | Throughput a 2x/5x/10x línea base, latencia a 2x/5x/10x línea base |
| SCALE-011..015 | Eficiencia                          | RPS por VU, factor de amplificación de peticiones     |
| SCALE-016..020 | Techo y Curva                       | Detección de techo de throughput, curva de degradación de latencia (pendiente p95 vs VU) |

- **Archivo:** `src/metrics/calculators/scalability-calculator.ts`

### 4.8 Calculador de Ingeniería del Caos (20 métricas: CHAOS-001 a CHAOS-020)

Mide la resiliencia bajo inyección de fallos.

| Rango de ID   | Grupo de Métricas                   | Descripción                                           |
|----------------|-------------------------------------|-------------------------------------------------------|
| CHAOS-001..005 | Recuperación                        | Tiempo de recuperación (proxy MTTR), ciclos de activación/reinicio de circuit breaker |
| CHAOS-006..010 | Tormenta y Aislamiento              | Detección de tormenta de reintentos, efectividad de aislamiento por bulkhead |
| CHAOS-011..015 | Degradación y Resiliencia           | Puntuación de degradación gradual, puntuación compuesta de resiliencia |
| CHAOS-016..020 | Específicos de Fallo                | Tasa de error por partición de red, tasa de error por pico de CPU, sobrecarga de latencia por agentes de caos |

- **Archivo:** `src/metrics/calculators/chaos-calculator.ts`

### 4.9 Calculador de Seguridad Bajo Carga (20 métricas: SEC-001 a SEC-020)

Evalúa la postura de seguridad durante pruebas de carga.

| Rango de ID   | Grupo de Métricas                   | Descripción                                           |
|----------------|-------------------------------------|-------------------------------------------------------|
| SEC-001..005   | Autenticación                       | Tasa de fallo de autenticación bajo carga, tasa de fallo de renovación de token, tasa de expiración JWT/sesión |
| SEC-006..010   | Limitación de Tasa y TLS            | Precisión de limitación de tasa (429 vs esperado), cumplimiento de versión TLS |
| SEC-011..015   | Cabeceras e Entrada                 | Presencia de cabeceras de seguridad, tasa de rechazo de validación de entrada |
| SEC-016..020   | Avanzado                            | Detección de escalación de privilegios, indicadores de fuga de PII, mala configuración de CORS |

- **Archivo:** `src/metrics/calculators/security-calculator.ts`

### 4.10 Calculador de Observabilidad Bajo Carga (20 métricas: OBS-001 a OBS-020)

Evalúa la salud del stack de observabilidad durante la carga.

| Rango de ID   | Grupo de Métricas                   | Descripción                                           |
|----------------|-------------------------------------|-------------------------------------------------------|
| OBS-001..005   | Logs y Trazas                       | Tasa/completitud de ingesta de logs, completitud de trazas, tasa de muestreo |
| OBS-006..010   | Alertas y Correlación               | Latencia de alertas, tasa de propagación de IDs de correlación |
| OBS-011..015   | Dashboard y Scrape                  | Tasa de actualización de dashboard, tasa de éxito de scrape de métricas |
| OBS-016..020   | Instrumentación                     | Cumplimiento de logging estructurado, cobertura de trazas distribuidas, tasa de error de spans, sobrecarga |

- **Archivo:** `src/metrics/calculators/observability-calculator.ts`

### 4.11 Calculador de Integridad de Datos (13 métricas: DI-001 a DI-013)

Valida la corrección de datos bajo carga concurrente.

| Rango de ID   | Grupo de Métricas                   | Descripción                                           |
|----------------|-------------------------------------|-------------------------------------------------------|
| DI-001..003    | Consistencia                        | Consistencia lectura-después-escritura, lecturas obsoletas, detección de peticiones duplicadas |
| DI-004..006    | Transacciones                       | Tasa de rollback de transacciones, eventos de pérdida de datos, consistencia de esquema de respuesta |
| DI-007..010    | Lógica de Negocio                   | Violaciones de invariantes de negocio, corrección de idempotencia, detección de escrituras parciales |
| DI-011..013    | Ordenamiento e Integridad           | Deriva de contadores/saldos, violaciones de ordenamiento de eventos, fallos de validación de checksum/hash |

- **Archivo:** `src/metrics/calculators/data-integrity-calculator.ts`

### ME-001: Puntuación Global de Resultados

- **Propósito:** Puntuación de 0–100 inspirada en GPT, calculada a partir de los conteos de métricas pass/warn/fail; adjunta a cada `MetricsReport` como `score`
- **Calificaciones:** A ≥ 90 / B ≥ 80 / C ≥ 70 / D ≥ 60 / F < 60; saludable = valor ≥ 90
- **Ponderación:** pass = 1.0, warn = 0.5, fail = 0; métricas `na` excluidas del denominador
- **Se expone como:** `MetricsReport.score` → JSON `extendedMetrics.score`
- **Archivo:** `src/metrics/score.ts`

---

## 5. Reportes (18+ funcionalidades)

Un pipeline de reportes completo que produce salidas interactivas en HTML, PDF, JSON y Markdown.

### RPT-001: Reporte HTML Interactivo

- **Secciones:** 17+ secciones en un reporte interactivo de página única
- **Características:**
  - Franja de KPI (checks, tiempo de respuesta promedio, p95, p99, tasa de error, throughput, APDEX)
  - Visualización de medidor APDEX con rangos codificados por color
  - Tabla de cumplimiento de SLA con indicadores de aprobado/fallido
  - Gráfico de distribución de percentiles (histograma + superposición)
  - Panel de análisis de grupos con desglose por grupo
  - Panel de métricas personalizadas (Counters, Gauges, Rates, Trends)
  - Panel de Web Vitals (LCP, FID, CLS, TTFB)
  - Comparación histórica (tablas de delta + sparklines)
  - Secciones expandibles de datos crudos
- **Archivo:** `src/reporting/html-report-generator.ts`

### RPT-002: Exportación PDF / PNG

- **Propósito:** Exportación automatizada de reportes HTML a PDF y PNG mediante Puppeteer headless
- **Características:** Tamaño de página configurable, horizontal/vertical, márgenes personalizados
- **Archivo:** `src/reporting/html-report-generator.ts` (métodos de exportación)

### RPT-003: Reportes de Análisis LLM

- **Propósito:** Análisis narrativo generado por IA de resultados de pruebas
- **Salidas:** `analysis-*.md` (análisis técnico), `message-*.md` (resumen para stakeholders)
- **Características:** Análisis contextual, generación de recomendaciones, clasificación por severidad

### RPT-004: Auto-Comparación

- **Propósito:** Comparación automática con la ejecución anterior para el mismo cliente/escenario
- **Características:** Cálculo de deltas, detección de regresiones, resaltado de mejoras

### RPT-005: Análisis de Tendencias

- **Propósito:** Visualización de tendencias históricas a través de múltiples ejecuciones
- **Características:** Gráficos sparkline, promedios móviles, indicadores de dirección de tendencia
- **Archivo:** `src/reporting/trend-visualizer.ts`

### RPT-006: Salida de Resumen JSON

- **Propósito:** Resumen legible por máquina en formato JSON (esquema v2.0.0)
- **Características:** Salida estructurada para consumo de pipelines CI/CD, estado de aprobado/fallido de umbrales
- **Archivo:** `src/reporting/json-summary-generator.ts`

### RPT-007: Análisis de Capacidad

- **Propósito:** Proyección de capacidad del sistema basada en resultados de pruebas
- **Características:** Estimación de carga máxima sostenible, identificación de cuellos de botella
- **Archivo:** `src/reporting/capacity-analyzer.ts`, `src/reporting/capacity-report-generator.ts`

### RPT-008: Personalización de Marca

- **Propósito:** Personalización de marca en reportes
- **Características:** Logo personalizado, colores de marca, inyección de nombre de organización
- **Archivo:** `src/core/branding-validator.ts`

### RPT-009: Accesibilidad WCAG

- **Propósito:** Salida de reportes accesible conforme a las pautas WCAG
- **Características:** Jerarquía correcta de encabezados (h1-h6), aria-labels, contraste de color, navegación por teclado

### RPT-010: Franja de KPI

- **Propósito:** Barra resumen de KPI de un vistazo en la parte superior de los reportes HTML
- **Métricas:** Tasa de aprobación de checks, tiempo de respuesta promedio, p95, p99, tasa de error, throughput (RPS), puntuación APDEX

### RPT-011: Medidor APDEX

- **Propósito:** Representación visual de la puntuación APDEX
- **Características:** Medidor codificado por color (Excelente/Bueno/Aceptable/Pobre/Inaceptable), umbral T configurable

### RPT-012: Tabla de Cumplimiento de SLA

- **Propósito:** Evaluación tabular de SLA con estado de aprobado/fallido
- **Características:** Fila por SLO con objetivo, real, estado y margen

### RPT-013: Gráfico de Distribución de Percentiles

- **Propósito:** Visualización de distribución de tiempos de respuesta
- **Características:** Histograma con líneas superpuestas de p50/p90/p95/p99

### RPT-014: Panel de Análisis de Grupos

- **Propósito:** Desglose de rendimiento por grupo
- **Características:** Métricas a nivel de grupo (avg, p95, tasa de error), umbrales sintéticos por grupo

### RPT-015: Panel de Métricas Personalizadas

- **Propósito:** Visualización de métricas personalizadas k6 definidas por el usuario
- **Tipos:** Counters, Gauges, Rates, Trends
- **Características:** Auto-detección, visualización tabular con sparklines

### RPT-016: Panel de Web Vitals

- **Propósito:** Métricas de Web Vitals orientadas al navegador
- **Métricas:** LCP (Largest Contentful Paint), FID (First Input Delay), CLS (Cumulative Layout Shift), TTFB
- **Características:** Clasificación Bueno/Necesita Mejora/Pobre según umbrales de Core Web Vitals

### RPT-017: Comparación Histórica

- **Propósito:** Comparación lado a lado con ejecuciones históricas
- **Características:** Tablas de delta (absoluto + porcentaje), gráficos sparkline de tendencia, alertas de regresión

### RPT-018: Insignia de Puntuación Global

- **Propósito:** Celda KPI en la franja de métricas del reporte HTML que muestra una puntuación de salud global de 0 a 100 con código de color
- **Umbrales de color:** verde ≥ 90 / ámbar 70–89 / rojo < 70
- **Resolución de puntuación:** prefiere `extendedMetrics.score` (puntuación completa del motor); cae a derivación solo de checks vía `scoreFromCounts`
- **Archivo:** `src/reporting/artifacts/html-generator.ts`

---

## 6. Dashboards de Grafana (3)

Modelos de dashboard de Grafana predefinidos en JSON, aprovisionados a través del stack de infraestructura.

### GRF-001: Vista General de Prueba de Carga

- **Propósito:** Dashboard de monitoreo de pruebas k6 en tiempo real
- **Paneles:** Conteo de VU, RPS, percentiles de tiempo de respuesta, tasa de error, checks, iteraciones
- **Fuente de Datos:** Prometheus (salida k6 statsd/prometheus)
- **Archivo:** `infrastructure/grafana/dashboards/k6-load-test-overview.json`

### GRF-002: Analítica Empresarial

- **Propósito:** Analítica entre ejecuciones y análisis de tendencias históricas
- **Paneles:** Historial de pruebas, comparaciones de tendencias, seguimiento de SLA, proyecciones de capacidad
- **Fuente de Datos:** Prometheus
- **Archivo:** `infrastructure/grafana/dashboards/k6-enterprise-analytics.json`

### GRF-003: Web Vitals

- **Propósito:** Dashboard de métricas de rendimiento del navegador
- **Paneles:** LCP, FID, CLS, TTFB con umbrales Bueno/Necesita Mejora/Pobre
- **Fuente de Datos:** Prometheus
- **Archivo:** `infrastructure/grafana/dashboards/k6-web-vitals.json`

---

## 7. Métricas Personalizadas (4 tipos)

Soporte para tipos de métricas personalizadas de k6 en scripts de prueba, con recopilación automática, evaluación de umbrales e integración con reportes.

### CM-001: Counter

- **Propósito:** Conteo acumulativo de eventos
- **Uso:** `new Counter('my_counter')` — rastrear ocurrencias totales (ej. transacciones de negocio, aciertos de caché)
- **Reporte:** Valor total, tasa por segundo

### CM-002: Gauge

- **Propósito:** Seguimiento de valor instantáneo
- **Uso:** `new Gauge('my_gauge')` — rastrear estado actual (ej. profundidad de cola, sesiones activas)
- **Reporte:** Último valor, mín, máx

### CM-003: Rate

- **Propósito:** Porcentaje de valores no cero
- **Uso:** `new Rate('my_rate')` — rastrear ratios de éxito/fallo (ej. tasa de acierto de caché, tasa de éxito de autenticación)
- **Reporte:** Valor porcentual con umbral de aprobado/fallido

### CM-004: Trend

- **Propósito:** Seguimiento de distribución estadística
- **Uso:** `new Trend('my_trend')` — rastrear distribuciones de tiempo (ej. latencia de operación personalizada)
- **Reporte:** avg, min, max, med, p90, p95, p99

---

## 8. Análisis de Grupos (3)

Organización jerárquica de pruebas con métricas por grupo y umbrales sintéticos.

### GRP-001: Definición de Grupo

- **Propósito:** Organizar pasos de prueba en grupos nombrados mediante la API `group()` de k6
- **Características:** Soporte de grupos anidados, temporización automática por grupo

### GRP-002: Métricas por Grupo

- **Propósito:** Desglose automático de métricas por grupo
- **Métricas:** avg, p95, p99, tasa de error, tasa de aprobación de checks por grupo
- **Características:** Umbrales sintéticos por grupo, aprobado/fallido a nivel de grupo

### GRP-003: Análisis de Grupos en Reportes

- **Propósito:** Panel dedicado en reportes para análisis a nivel de grupo
- **Características:** Tabla ordenable, sparklines por grupo, resaltado del grupo con peor rendimiento

---

## 9. SLA / SLO (5)

Framework de evaluación de Acuerdos de Nivel de Servicio y Objetivos de Nivel de Servicio.

### SLO-001: Definición de SLO

- **Propósito:** Definiciones declarativas de SLO por servicio
- **Formato:** Configuración JSON en `clients/{name}/config/slos.json`
- **Características:** Objetivos de latencia, objetivos de disponibilidad, configuración de presupuesto de error

### SLO-002: Evaluación de Tres Estados

- **Propósito:** Clasificación de cumplimiento de SLO
- **Estados:** `cumple` (cumple objetivo), `en_riesgo` (dentro del margen de riesgo), `incumple` (excede objetivo)
- **Archivo:** `src/core/slo-evaluator.ts`

### SLO-003: Seguimiento de Presupuesto de Error

- **Propósito:** Monitoreo del consumo del presupuesto de error
- **Características:** Porcentaje de presupuesto restante, tasa de consumo, agotamiento proyectado

### SLO-004: Puntuación Compuesta Multi-SLI

- **Propósito:** Puntuación compuesta ponderada a través de múltiples Indicadores de Nivel de Servicio
- **Características:** Pesos de SLI configurables, puntuación normalizada

### SLO-005: Integración de SLO en Reportes

- **Propósito:** Resultados de SLO integrados en reportes HTML y JSON
- **Características:** Tabla de cumplimiento de SLA, seguimiento de tendencias entre ejecuciones

---

## 10. Seguridad (14)

Controles de seguridad de defensa en profundidad a través del framework.

### SEC-001: RBAC (Control de Acceso Basado en Roles)

- **Propósito:** Sistema de roles de tres niveles para control de acceso al framework
- **Roles:** `developer` (ejecutar pruebas, ver reportes), `lead` (gestionar clientes, configurar SLOs), `admin` (acceso completo, gestionar roles)
- **Características:** Matriz granular de permisos, herencia de roles
- **Archivos:** `src/core/rbac.ts`, `src/core/rbac-enforcer.ts`, `src/types/rbac.d.ts`

### SEC-002: Log de Auditoría Inmutable

- **Propósito:** Registro de auditoría a prueba de manipulación usando cadena de hash SHA-256
- **Formato:** JSONL con cadena de hash (cada entrada incluye el hash de la entrada anterior)
- **Eventos:** Ejecución de pruebas, cambios de configuración, modificaciones de roles, acceso a reportes
- **Archivos:** `src/core/audit-logger.ts`, `src/types/audit.d.ts`

### SEC-003: Aislamiento de Clientes

- **Propósito:** Protección contra traversal de rutas para directorios de clientes multi-tenant
- **Características:** Resolución de rutas canónicas, detección de symlinks, aplicación de límites de directorio
- **Archivos:** `src/core/client-resolver.ts`, `src/core/client-validator.ts`

### SEC-004: Endurecimiento de Shell

- **Propósito:** Prevención de inyección de comandos para operaciones de shell
- **Características:** Sanitización de entrada, escape de argumentos, lista blanca de backend de secretos
- **Archivo:** `src/core/config-security.ts`

### SEC-005: Análisis Seguro de YAML

- **Propósito:** Deserialización segura de YAML con límites de recursos
- **Características:** Límites de tamaño, límites de profundidad, protección contra billion laughs (bomba YAML)
- **Archivo:** `src/core/yaml-parser.ts`

### SEC-006: Gestión de Secretos

- **Propósito:** Detección y protección de secretos en configuraciones y salidas
- **Características:** Detección de secretos basada en patrones (claves API, tokens, contraseñas), sanitización de credenciales en URLs
- **Archivo:** `src/core/secrets-manager.ts`

### SEC-007: Redacción de PII

- **Propósito:** Eliminación automática de PII de reportes HTML
- **Características:** Detección y enmascaramiento de patrones de email, teléfono, SSN, tarjeta de crédito
- **Archivo:** `src/reporting/html-report-generator.ts`

### SEC-008: Sanitizador de Prometheus

- **Propósito:** Sanitización de etiquetas y valores para métricas de Prometheus
- **Características:** Validación de nombres de etiquetas, escape de valores, control de cardinalidad
- **Archivo:** `src/core/prometheus-sanitizer.ts`

### SEC-009: Seguridad de Configuración

- **Propósito:** Detección de secretos hardcodeados en archivos de configuración
- **Características:** Escaneo basado en regex, integración con hooks de pre-commit
- **Archivo:** `src/core/config-security.ts`

### SEC-010: Aislamiento de Ejecución

- **Propósito:** Aislamiento a nivel de proceso para ejecuciones de pruebas
- **Características:** Variables de entorno aisladas, tags aislados, directorio temporal por ejecución
- **Archivo:** `src/core/execution-isolation.ts`

### SEC-011: Aislamiento de Reportes

- **Propósito:** Protección contra traversal de rutas para directorios de salida de reportes
- **Características:** Validación de directorio de salida, prevención de acceso a reportes entre clientes
- **Archivo:** `src/core/report-isolation.ts`

### SEC-012: Autenticación CLI

- **Propósito:** Aplicación de RBAC en el límite del CLI
- **Características:** Autenticación basada en token, verificación de rol antes de la ejecución de comandos
- **Archivo:** `src/core/cli-auth.ts`

### SEC-013: Validación de Entrada

- **Propósito:** Validación exhaustiva de entrada para todos los parámetros suministrados por el usuario
- **Características:** Verificación de campos requeridos, validación de formato, límites de longitud, prevención de coerción de tipos
- **Archivo:** `src/core/input-validator.ts`

### SEC-014: Validación de Binario

- **Propósito:** Verificación de integridad del binario k6
- **Características:** Validación de checksum, verificación de versión, aplicación de fuente confiable
- **Archivo:** `src/core/binary-validator.ts`

---

## 11. CI/CD (3)

Plantillas de pipeline listas para usar para pruebas de rendimiento continuas.

### CI-001: Plantilla de GitHub Actions

- **Propósito:** Workflow de GitHub Actions para ejecución automatizada de pruebas de carga
- **Características:** Estrategia de matriz para múltiples clientes/escenarios, carga de artefactos, verificaciones de estado
- **Archivo:** `infrastructure/ci-templates/github-actions-client.yml`

### CI-002: Plantilla de GitLab CI

- **Propósito:** Pipeline de GitLab CI para ejecución automatizada de pruebas de carga
- **Características:** Ejecución basada en etapas, recopilación de artefactos, integración con merge requests
- **Archivo:** `infrastructure/ci-templates/gitlab-ci-client.yml`

### CI-003: Integración con detect-secrets

- **Propósito:** Escaneo de secretos en pre-commit
- **Características:** Gestión de línea base, soporte de plugins personalizados, integración con pipeline CI

---

## 12. Observabilidad (9)

Integración completa del stack de observabilidad para monitoreo de infraestructura y resultados de pruebas de carga.

### OBS-001: Recopilación de Métricas con Prometheus

- **Propósito:** Ingesta de métricas desde k6 y sistemas objetivo
- **Características:** Consultas PromQL, consultas de rango, consultas instantáneas, caché
- **Archivo:** `infrastructure/prometheus/prometheus.yml`, `src/metrics/metrics-engine.ts` (PrometheusClient)

### OBS-002: Dashboards de Grafana

- **Propósito:** Monitoreo visual (ver Sección 6 para detalles)
- **Dashboards:** Vista General de Prueba de Carga, Analítica Empresarial, Web Vitals
- **Archivo:** `infrastructure/grafana/dashboards/`

### OBS-003: Agregación de Logs con Loki

- **Propósito:** Recopilación centralizada de logs y consultas
- **Características:** Consultas LogQL, ingesta de logs estructurados, correlación con trazas
- **Archivo:** `infrastructure/loki/loki-config.yml`

### OBS-004: Trazado Distribuido con Tempo

- **Propósito:** Recopilación y visualización de trazas distribuidas
- **Características:** Correlación traza-a-log, mapas de servicio, histogramas de latencia
- **Archivo:** `infrastructure/tempo/tempo-config.yml`

### OBS-005: Perfilado con Pyroscope

- **Propósito:** Perfilado continuo de aplicaciones objetivo durante pruebas de carga
- **Características:** Flame graphs de CPU y memoria, modo de comparación

### OBS-006: Monitoreo de Salud de Generadores

- **Propósito:** Monitorear la salud de los propios generadores de carga k6
- **Características:** Uso de CPU/memoria de nodos generadores, detección de iteraciones descartadas

### OBS-007: Detección de Sobrecarga

- **Propósito:** Medir la sobrecarga de observabilidad en la precisión de las pruebas
- **Características:** Impacto de latencia de instrumentación, costo de recursos del monitoreo

### OBS-008: Instrumentación de Trazado

- **Propósito:** Propagación automática de contexto de traza en peticiones de prueba
- **Formatos:** W3C Trace Context, Jaeger, B3, Datadog
- **Características:** Formato de propagación configurable, inyección de cabeceras vía HeaderHelper

### OBS-009: Instrumentación de Pyroscope

- **Propósito:** Recopilación automática de datos de perfilado durante la ejecución de pruebas
- **Características:** Perfilado agnóstico al lenguaje, generación de flame graphs por endpoint

---

## 13. Generadores (4)

Herramientas de scaffolding para la creación rápida de artefactos de prueba.

### GEN-001: Scaffolding de Cliente

- **Comando:** `node bin/generate.js --type=client --name=<client-name>`
- **Genera:** Estructura de directorio de cliente con config, escenarios, servicios, directorios de datos
- **Salida:** `clients/<name>/config/`, `clients/<name>/scenarios/`, `clients/<name>/services/`

### GEN-002: Scaffolding de Escenario

- **Comando:** `node bin/generate.js --type=scenario --client=<client> --name=<scenario>`
- **Genera:** Archivo de escenario de prueba con imports, setup, función por defecto y teardown
- **Salida:** `clients/<client>/scenarios/<name>.ts`

### GEN-003: Scaffolding de Servicio

- **Comando:** `node bin/generate.js --type=service --client=<client> --name=<service>`
- **Genera:** Capa de abstracción de servicio con métodos de petición tipados
- **Salida:** `clients/<client>/services/<name>-service.ts`

### GEN-004: Scaffolding de Data Factory

- **Comando:** `node bin/generate.js --type=factory --client=<client> --name=<factory>`
- **Genera:** Data factory con patrón builder para creación de datos de prueba
- **Salida:** `clients/<client>/data/<name>-factory.ts`

---

## 14. Distribución — Kubernetes (5)

Ejecución distribuida de pruebas de carga en Kubernetes mediante el Operador k6.

### DIST-001: Integración con Operador k6

- **Propósito:** Orquestar ejecuciones distribuidas de k6 a través de múltiples pods
- **Características:** Escalado automático de pods, distribución de pruebas, agregación de resultados
- **Archivo:** `infrastructure/k8s/k6-testrun.yaml`

### DIST-002: Segmentos de Ejecución

- **Propósito:** Dividir la carga de prueba entre múltiples instancias de k6
- **Características:** Distribución de VU basada en segmentos, inicio sincronizado

### DIST-003: NetworkPolicy

- **Propósito:** Aislamiento a nivel de red para pods de prueba de carga
- **Características:** Reglas de ingreso/egreso, aislamiento de namespace
- **Archivo:** `infrastructure/k8s/network-policy.yaml`

### DIST-004: RBAC de K8s

- **Propósito:** Control de acceso nativo de Kubernetes para ejecución de pruebas
- **Recursos:** ServiceAccount, Role, RoleBinding
- **Archivo:** `infrastructure/k8s/rbac.yaml`, `infrastructure/k8s/helm/k6-enterprise/templates/rbac.yaml`

### DIST-005: Helm Charts

- **Propósito:** Despliegue templado de Kubernetes para el framework
- **Características:** Valores configurables, soporte multi-entorno
- **Archivos:** `infrastructure/k8s/helm/k6-enterprise/Chart.yaml`, `infrastructure/k8s/helm/k6-enterprise/values.yaml`

---

## 15. Servidor MCP (8 herramientas)

Servidor de Model Context Protocol que permite a agentes de IA e integraciones de IDE interactuar con el framework de forma programática.

### MCP-001: run_test

- **Propósito:** Ejecutar una prueba k6 mediante el runner CLI
- **Parámetros:** `client`, `test`, `profile` (por defecto: smoke), `env` (por defecto: default)
- **Retorna:** Estado (aprobado/fallido), código de salida, salida, ruta del reporte
- **Seguridad:** Sanitización de entrada, guarda de concurrencia (una prueba por cliente+escenario)
- **Archivo:** `mcp-server/src/tools/index.ts`

### MCP-002: validate_schema

- **Propósito:** Validar un archivo de configuración contra JSON schema
- **Parámetros:** Ruta o contenido del archivo de configuración
- **Retorna:** Resultado de validación con detalles de errores
- **Archivo:** `mcp-server/src/tools/index.ts`

### MCP-003: generate_scaffold

- **Propósito:** Crear scaffolding de cliente, prueba o servicio
- **Parámetros:** Tipo (client/scenario/service/factory), nombre, cliente
- **Retorna:** Rutas de archivos generados
- **Archivo:** `mcp-server/src/tools/index.ts`

### MCP-004: query_knowledge_base

- **Propósito:** Búsqueda basada en RAG a través de la documentación del framework
- **Parámetros:** `query`, `collection`, `top_k`, `type` (script/doc/helper/pattern), `client_id`
- **Retorna:** Documentos coincidentes con puntuaciones de relevancia
- **Archivo:** `mcp-server/src/tools/ai-tools.ts`

### MCP-005: get_observability_data

- **Propósito:** Obtener datos de monitoreo de Prometheus, Tempo, Loki y Pyroscope
- **Parámetros:** Fuente de datos, expresión de consulta, rango de tiempo
- **Retorna:** Resultados de consulta con timestamps
- **Archivo:** `mcp-server/src/tools/ai-tools.ts`

### MCP-006: validate_generated_code

- **Propósito:** Validar la calidad del código TypeScript para scripts de prueba generados por IA
- **Parámetros:** Contenido del código o ruta del archivo
- **Retorna:** Reporte de validación (sintaxis, imports, patrones, seguridad)
- **Archivo:** `mcp-server/src/tools/ai-tools.ts`

### MCP-007: get_test_history

- **Propósito:** Recuperar datos históricos de ejecución para una combinación cliente/prueba
- **Parámetros:** Cliente, prueba, límite
- **Retorna:** Historial de ejecuciones con resúmenes de métricas
- **Archivo:** `mcp-server/src/tools/ai-tools.ts`

### MCP-008: create_jira_ticket

- **Propósito:** Crear un ticket de Jira para bugs de rendimiento o regresiones
- **Parámetros:** Proyecto, resumen, descripción, prioridad, etiquetas
- **Retorna:** Clave del ticket y URL
- **Seguridad:** Enmascaramiento de credenciales en la salida
- **Archivo:** `mcp-server/src/tools/ai-tools.ts`

---

## 16. Hoja de Ruta IA v2 (4 agentes)

Pipeline de agentes de IA de próxima generación para planificación, generación, análisis y reportes autónomos de pruebas de carga.

### AI-001: Agente Planificador

- **Propósito:** Analizar requisitos y generar planes de prueba
- **Capacidades:** Descubrimiento de endpoints, recomendación de perfil de carga, sugerencia de SLO, diseño de escenarios
- **Archivo:** `src/ai/agents/planner-agent.ts`

### AI-002: Agente Constructor

- **Propósito:** Generar scripts de prueba k6 a partir de planes de prueba
- **Capacidades:** Generación de código TypeScript, integración de helpers/patrones, creación de data factory
- **Validación:** Suite de validación integrada para calidad del código generado
- **Archivos:** `src/ai/agents/builder-agent.ts`, `src/ai/agents/builder-validation-suite.ts`

### AI-003: Agente Analista

- **Propósito:** Analizar resultados de pruebas y detectar anomalías
- **Capacidades:** Análisis estadístico, detección de anomalías, análisis de causa raíz, identificación de regresiones
- **Validación:** Suite de validación específica para analista
- **Archivos:** `src/ai/agents/analyst-agent.ts`, `src/ai/agents/analyst-validation-suite.ts`, `src/ai/analysis/anomaly-detector.ts`

### AI-004: Agente Reportero

- **Propósito:** Generar reportes en lenguaje natural a partir de resultados de análisis
- **Capacidades:** Resúmenes dirigidos a stakeholders, profundizaciones técnicas, informes ejecutivos
- **Archivo:** `src/ai/agents/reporter-agent.ts`

### Infraestructura de Soporte de IA

| Componente             | Propósito                                            | Archivo                                     |
|------------------------|------------------------------------------------------|---------------------------------------------|
| Orquestador de Pipeline | Encadena agentes en secuencia: Planificar -> Construir -> Analizar -> Reportar | `src/ai/pipeline/orchestrator.ts`           |
| Base de Conocimiento   | Recuperación de conocimiento respaldada por RAG (ChromaDB) | `src/ai/knowledge-base/knowledge-base.ts`   |
| Gestor de Presupuesto  | Seguimiento de tokens/costos a través de invocaciones de agentes IA | `src/ai/core/budget-manager.ts`             |
| Auto-Recuperación      | Ajuste adaptativo de pruebas basado en errores de ejecución | `src/ai/adaptive/self-healing.ts`           |
| Clientes de Observabilidad | Acceso de agentes IA a Prometheus/Tempo/Loki/Pyroscope | `src/ai/observability/observability-clients.ts` |
| PoC del Stack IA       | Prueba de concepto de integración del stack completo de IA | `src/ai/poc/ai-stack-poc.ts`                |

---

## Apéndice: Estructura de Directorios

```
k6-framework/
├── bin/                              # Scripts CLI y generadores
│   ├── generate.js                   # Generador de scaffolding
│   └── generate-data.js              # Utilidades de generación de datos
├── clients/                          # Proyectos de prueba de clientes
│   └── _reference/                   # Plantilla de cliente de referencia
├── docs/                             # Documentación del framework
├── infrastructure/
│   ├── ci-templates/                 # Plantillas de pipelines CI/CD
│   ├── grafana/dashboards/           # Modelos JSON de dashboards de Grafana
│   ├── k8s/                          # Manifiestos de Kubernetes y Helm charts
│   ├── loki/                         # Configuración de Loki
│   ├── prometheus/                   # Configuración de Prometheus
│   └── tempo/                        # Configuración de Tempo
├── mcp-server/src/                   # Implementación del servidor MCP
│   ├── tools/                        # Definiciones de herramientas MCP
│   ├── resources/                    # Definiciones de recursos MCP
│   └── utils/                        # Utilidades compartidas
├── shared/
│   └── profiles/                     # Definiciones JSON de perfiles de carga
└── src/
    ├── ai/                           # Pipeline de agentes IA (v2)
    │   ├── agents/                   # Planificador, Constructor, Analista, Reportero
    │   ├── analysis/                 # Detección de anomalías
    │   ├── adaptive/                 # Auto-recuperación
    │   ├── core/                     # Gestión de presupuesto
    │   ├── knowledge-base/           # Integración RAG/ChromaDB
    │   ├── observability/            # Clientes de observabilidad IA
    │   ├── pipeline/                 # Orquestador de agentes
    │   └── poc/                      # Prueba de concepto
    ├── core/                         # Núcleo del framework
    │   ├── rbac.ts                   # Control de acceso basado en roles
    │   ├── audit-logger.ts           # Log de auditoría inmutable
    │   ├── secrets-manager.ts        # Detección de secretos
    │   ├── slo-evaluator.ts          # Evaluación de SLO
    │   ├── check-system.ts           # Framework de aserciones
    │   └── ...                       # 20+ módulos del núcleo
    ├── helpers/                      # 14 helpers reutilizables
    ├── integrations/                 # Integraciones externas (Slack, notificaciones)
    ├── metrics/                      # Motor de métricas
    │   ├── metrics-engine.ts         # Orquestador central
    │   └── calculators/              # 11 calculadores de dominio
    ├── patterns/                     # 10 patrones arquitectónicos
    ├── reporting/                    # Pipeline de generación de reportes
    └── types/                        # Definiciones de tipos TypeScript
```

---

> **Versión del documento:** 1.0.0  
> **Última actualización:** 2026-02-23  
> **Total de funcionalidades catalogadas:** 192+
