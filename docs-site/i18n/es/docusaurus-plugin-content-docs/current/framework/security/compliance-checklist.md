---
title: "k6 Enterprise Load Testing Framework — Checklist de Cumplimiento de Funcionalidades"
sidebar_position: 4
---
# k6 Enterprise Load Testing Framework — Checklist de Cumplimiento de Funcionalidades

**Versión**: 1.0  
**Última actualización**: 2026-02-23  
**Framework**: k6 Enterprise Load Testing Framework (Service Performance & Resilience)

---

## Cómo Usar Este Checklist

Este documento proporciona un checklist de verificación estructurado y comprobable para cada funcionalidad del k6 Enterprise Load Testing Framework. Está organizado en **16 categorías** con **190+ elementos verificables individualmente**.

### Instrucciones

1. **Recorra cada categoría** secuencialmente o enfóquese en la categoría relevante para su auditoría.
2. **Ejecute el comando de verificación** o la comprobación manual descrita en cada elemento.
3. **Marque la casilla** `[x]` cuando la funcionalidad pase la verificación.
4. **Registre los fallos** en la columna de Notas de la tabla resumen con el ID del elemento fallido.
5. **Calcule la cobertura** por categoría usando: `Cobertura = Verificados / Total * 100`.

### Tipos de Verificación

| Tipo | Descripción |
|------|-------------|
| **CMD** | Ejecutar un comando CLI y verificar la salida |
| **FILE** | Verificar que un archivo existe y contiene el contenido esperado |
| **MANUAL** | Inspección manual o prueba funcional |
| **CONFIG** | Verificar la estructura del archivo de configuración |
| **DOCKER** | Requiere Docker/docker-compose en ejecución |
| **K8S** | Requiere un clúster de Kubernetes |

---

## Resumen

| # | Categoría | Funcionalidades | Verificadas | Cobertura | Notas |
|---|-----------|-----------------|-------------|-----------|-------|
| 1 | [Perfiles de Carga](#1-perfiles-de-carga) | 9 | ___ / 9 | ___% | |
| 2 | [Helpers](#2-helpers) | 14 | ___ / 14 | ___% | |
| 3 | [Patrones y Puntos de Extensión](#3-patrones) | 13 | ___ / 13 | ___% | |
| 4 | [Motor de Métricas](#4-motor-de-métricas) | 25 | ___ / 25 | ___% | |
| 5 | [Reportes](#5-reportes) | 25 | ___ / 25 | ___% | |
| 6 | [Dashboards de Grafana](#6-dashboards-de-grafana) | 9 | ___ / 9 | ___% | |
| 7 | [Métricas Personalizadas](#7-métricas-personalizadas) | 8 | ___ / 8 | ___% | |
| 8 | [Análisis de Grupos](#8-análisis-de-grupos) | 6 | ___ / 6 | ___% | |
| 9 | [SLA/SLO](#9-slaslo) | 10 | ___ / 10 | ___% | |
| 10 | [Seguridad](#10-seguridad) | 14 | ___ / 14 | ___% | |
| 11 | [Integración CI/CD](#11-integración-cicd) | 10 | ___ / 10 | ___% | |
| 12 | [Observabilidad](#12-observabilidad) | 12 | ___ / 12 | ___% | |
| 13 | [Generadores](#13-generadores) | 8 | ___ / 8 | ___% | |
| 14 | [Pruebas Distribuidas](#14-pruebas-distribuidas) | 8 | ___ / 8 | ___% | |
| 15 | [Servidor MCP](#15-servidor-mcp) | 11 | ___ / 11 | ___% | |
| 16 | [Hoja de Ruta IA v2](#16-hoja-de-ruta-ia-v2) | 12 | ___ / 12 | ___% | |
| | **TOTAL** | **194** | ___ / 194 | ___% | |

---

## 1. Perfiles de Carga

El framework proporciona **13 perfiles de carga predefinidos** que cubren el espectro completo desde pruebas de humo hasta ejecuciones de larga duración (soak), incluyendo perfiles de tasa de llegada para pruebas de modelo abierto.

| Perfil | VUs | Duración | Umbrales Clave |
|--------|-----|----------|----------------|
| smoke | 1-2 | 1 min | p95<2000ms, errores<1% |
| quick | 5 | 3 min | p95<1500ms, errores<5% |
| load | 20 | 14 min | p95<1000ms, errores<5% |
| rampup | 50 | 13 min | p95<2000ms |
| capacity | 200 | 20 min | p95<3000ms |
| stress | 400 | 25 min | p95<5000ms, errores<15% |
| spike | 300 ráfaga | ~8 min | p95<5000ms |
| breakpoint | 1000 | 1 h | p95<10000ms |
| soak | 20 | 4 h+ | p95<2000ms |

- [ ] **LP-001** Perfil smoke: 1-2 VUs, 1 minuto, p95<2000ms
  - Tipo: CMD
  - Verificar: `./bin/run-test.sh --client=_reference --scenario=api/smoke-users --profile=smoke`
  - Esperado: Código de salida 0, reporte generado en `reports/_reference/`, tasa de checks aprobados >= 99%

- [ ] **LP-002** Perfil quick: 5 VUs, 3 minutos, retroalimentación rápida para CI/CD
  - Tipo: CMD
  - Verificar: `./bin/run-test.sh --client=_reference --scenario=api/smoke-users --profile=quick`
  - Esperado: Código de salida 0, duración ~3 minutos, p95<1500ms, p99<3000ms

- [ ] **LP-003** Perfil load: 20 VUs, patrón de rampa-meseta-rampa de 14 minutos
  - Tipo: CMD
  - Verificar: `./bin/run-test.sh --client=_reference --scenario=api/smoke-users --profile=load`
  - Esperado: Código de salida 0, las etapas muestran rampa 0->20 (2m), meseta (10m), descenso (2m)

- [ ] **LP-004** Perfil rampup: incremento gradual a 50 VUs durante 13 minutos
  - Tipo: CMD
  - Verificar: `./bin/run-test.sh --client=_reference --scenario=api/smoke-users --profile=rampup`
  - Esperado: Código de salida 0, el conteo de VUs aumenta progresivamente a través de las etapas

- [ ] **LP-005** Perfil capacity: 200 VUs, 20 minutos, encontrar rendimiento máximo
  - Tipo: CMD
  - Verificar: `./bin/run-test.sh --client=_reference --scenario=api/smoke-users --profile=capacity`
  - Esperado: Código de salida 0 o 1 (incumplimiento de umbral aceptable), el reporte muestra meseta de rendimiento

- [ ] **LP-006** Perfil stress: 400 VUs, 25 minutos, encontrar punto de quiebre
  - Tipo: CMD
  - Verificar: `./bin/run-test.sh --client=_reference --scenario=api/smoke-users --profile=stress`
  - Esperado: Reporte generado, tasa de errores y latencia incrementados visibles bajo estrés

- [ ] **LP-007** Perfil spike: ráfaga a 300 VUs, ~8 minutos, probar elasticidad
  - Tipo: CMD
  - Verificar: `./bin/run-test.sh --client=_reference --scenario=api/smoke-users --profile=spike`
  - Esperado: El reporte muestra pico repentino de VUs y patrón de recuperación

- [ ] **LP-008** Perfil breakpoint: rampa a 1000 VUs durante 1 hora
  - Tipo: CMD
  - Verificar: `./bin/run-test.sh --client=_reference --scenario=api/smoke-users --profile=breakpoint`
  - Esperado: La prueba se ejecuta con VUs crecientes; límite del sistema identificado en el reporte

- [ ] **LP-009** Perfil soak: 20 VUs sostenidos durante 4+ horas
  - Tipo: CMD
  - Verificar: `./bin/run-test.sh --client=_reference --scenario=api/smoke-users --profile=soak`
  - Esperado: Ejecución de larga duración completada; detección de fugas de memoria en el reporte; p95<2000ms mantenido

---

## 2. Helpers

El framework proporciona **14 clases helper reutilizables** en `src/helpers/` que encapsulan operaciones comunes de pruebas de carga.

- [ ] **HLP-001** RequestHelper: cliente HTTP con trazabilidad automática e inyección de headers de autenticación
  - Tipo: FILE + MANUAL
  - Verificar: El archivo `src/helpers/request-helper.ts` existe; ejecutar escenario `_reference` que use `RequestHelper`
  - Esperado: Las solicitudes HTTP incluyen automáticamente los headers `X-Request-ID` y `X-Correlation-ID`

- [ ] **HLP-002** DataHelper: carga de datos de prueba desde CSV, JSON y variables de entorno
  - Tipo: FILE + MANUAL
  - Verificar: El archivo `src/helpers/data-helper.ts` existe; el escenario usa `DataHelper.fromCSV()` o `DataHelper.fromJSON()`
  - Esperado: Datos cargados correctamente, los VUs reciben diferentes filas de datos

- [ ] **HLP-003** DateHelper: formateo de fechas, conversión de zona horaria, soporte ISO 8601
  - Tipo: FILE
  - Verificar: El archivo `src/helpers/date-helper.ts` existe con métodos para `format()`, `toISO()`, `addDays()`
  - Esperado: El helper exporta la clase DateHelper con métodos estándar de manipulación de fechas

- [ ] **HLP-004** HeaderHelper: headers de trazabilidad (IDs de correlación UUID v4), gestión de headers personalizados
  - Tipo: FILE + MANUAL
  - Verificar: El archivo `src/helpers/header-helper.ts` existe; `HeaderHelper.tracing()` genera UUIDs v4 RFC 4122
  - Esperado: Los headers contienen IDs de correlación en formato UUID v4 válido (bits 14=4, bits 19=8/9/a/b)

- [ ] **HLP-005** ValidationHelper: validación de respuestas, verificaciones de esquema, utilidades de aserción
  - Tipo: FILE
  - Verificar: El archivo `src/helpers/validation-helper.ts` existe con `validateStatus()`, `validateSchema()`, `validateBody()`
  - Esperado: El helper proporciona métodos de validación encadenables para respuestas HTTP

- [ ] **HLP-006** PerformanceHelper: temporización personalizada, marcadores, anotaciones de rendimiento
  - Tipo: FILE
  - Verificar: El archivo `src/helpers/performance-helper.ts` existe
  - Esperado: El helper proporciona métodos `startTimer()`, `endTimer()`, `mark()` para temporización personalizada

- [ ] **HLP-007** StructuredLogger: logging JSON estructurado con niveles y contexto
  - Tipo: FILE + MANUAL
  - Verificar: El archivo `src/helpers/structured-logger.ts` existe; los logs se generan en formato JSON con `level`, `msg`, `timestamp`
  - Esperado: Las entradas de log son JSON parseables con un esquema consistente

- [ ] **HLP-008** RedisHelper: wrapper del cliente Redis para k6 con pool de conexiones
  - Tipo: FILE
  - Verificar: El archivo `src/helpers/redis-helper.ts` existe con `set()`, `get()`, `del()`, `exists()`, `mset()`, `mget()`
  - Esperado: El helper envuelve el cliente Redis de k6 con métodos convenientes y manejo de errores

- [ ] **HLP-009** UploadHelper: soporte de carga de archivos (multipart/form-data)
  - Tipo: FILE
  - Verificar: El archivo `src/helpers/upload-helper.ts` existe con `uploadFile()`, `uploadMultiple()`
  - Esperado: El helper maneja la construcción de datos multipart form para la carga de archivos

- [ ] **HLP-010** GraphQLHelper: constructor de queries/mutations GraphQL con soporte de variables
  - Tipo: FILE
  - Verificar: El archivo `src/helpers/graphql-helper.ts` existe con `query()`, `mutation()`, `subscribe()`
  - Esperado: El helper construye cuerpos de solicitud GraphQL adecuados con variables y nombres de operación

- [ ] **HLP-011** WebSocketHelper: gestión de conexiones WebSocket con manejadores de mensajes
  - Tipo: FILE
  - Verificar: El archivo `src/helpers/websocket-helper.ts` existe con `connect()`, `send()`, `onMessage()`
  - Esperado: El helper gestiona el ciclo de vida de WebSocket con soporte de timeout y reconexión

- [ ] **HLP-012** DataPool: pool de datos compartido con patrones de acceso round-robin y aleatorio
  - Tipo: FILE + MANUAL
  - Verificar: El archivo `src/helpers/data-pool.ts` existe; el escenario de ejemplo `10-data-pool.ts` lo utiliza
  - Esperado: DataPool distribuye datos entre VUs sin duplicación (round-robin) o con aleatorización

- [ ] **HLP-013** RedisSecurityHelper: operaciones Redis seguras con aislamiento por prefijo de clave
  - Tipo: FILE
  - Verificar: El archivo `src/helpers/redis-security-helper.ts` existe con prefijo de clave por cliente
  - Esperado: Las claves se prefijan automáticamente con el nombre del cliente para prevenir acceso cruzado de datos entre clientes

- [ ] **HLP-014** CheckSystem: registro extensible de checks mediante `registerCheck()`
  - Tipo: FILE
  - Verificar: El directorio `src/core/` exporta la función `registerCheck()`; `src/helpers/` usa el sistema de checks
  - Esperado: Los checks personalizados aparecen en los reportes HTML/JSON del framework sin modificar la capa genérica

---

## 3. Patrones

El framework proporciona **10 patrones reutilizables** en `src/patterns/` para escenarios comunes de pruebas de carga.

- [ ] **PAT-001** Patrón de autenticación: soporte para Bearer, Basic, OAuth2 y API Key
  - Tipo: FILE + MANUAL
  - Verificar: Los archivos `01-auth-bearer.ts`, `02-auth-basic.ts`, `03-auth-oauth2.ts`, `04-auth-apikey.ts` existen en los ejemplos
  - Esperado: Cada método de autenticación funciona con variables `__ENV`; sin credenciales hardcodeadas

- [ ] **PAT-002** Patrón de correlación: extraer y reutilizar valores dinámicos entre solicitudes
  - Tipo: FILE
  - Verificar: El archivo `src/patterns/correlation.ts` o patrón equivalente existe
  - Esperado: El patrón extrae tokens/IDs de las respuestas y los inyecta en solicitudes subsiguientes

- [ ] **PAT-003** Patrón de paginación: iterar a través de respuestas API paginadas
  - Tipo: FILE
  - Verificar: El archivo `src/patterns/pagination.ts` o patrón equivalente existe
  - Esperado: El patrón maneja paginación por offset/límite, basada en cursor y por header de enlace

- [ ] **PAT-004** Patrón de reintentos: reintento configurable con retroceso exponencial
  - Tipo: FILE
  - Verificar: El archivo `src/patterns/retry.ts` o patrón equivalente existe
  - Esperado: El patrón reintenta solicitudes fallidas con intentos máximos, retroceso y jitter configurables

- [ ] **PAT-005** Patrón de ejecución ponderada: distribuir VUs entre escenarios por peso
  - Tipo: FILE
  - Verificar: El archivo `src/patterns/weighted-execution.ts` o equivalente existe
  - Esperado: El tráfico se divide según los pesos configurados (ej., 70% navegación, 20% búsqueda, 10% compra)

- [ ] **PAT-006** Patrón de pruebas de contrato: validar respuestas API contra esquemas
  - Tipo: FILE
  - Verificar: El archivo `src/patterns/contract.ts` o equivalente existe
  - Esperado: El patrón valida la estructura, tipos y campos requeridos de la respuesta contra la definición del contrato

- [ ] **PAT-007** Patrón de servidor mock: mock HTTP ligero para simulación de dependencias
  - Tipo: FILE + CONFIG
  - Verificar: El archivo `src/node/mock-server.ts` existe (reubicado desde `src/patterns/` en Phase 4 / ARC-06); configuración mock en `clients/{name}/mocks/*.json`
  - Esperado: El servidor mock se inicia en `setup()`, sirve endpoints configurados con latencia simulada, se detiene en `teardown()`

- [ ] **PAT-008** Patrón de inyección de caos: inyección de fallos para pruebas de resiliencia
  - Tipo: FILE + CONFIG
  - Verificar: Configuración de caos en `clients/{name}/chaos/` o configuración inline; ejemplo `11-chaos.ts`
  - Esperado: Soporta inyección de latencia, inyección de errores, simulación de timeout; reporte diferenciado para errores de caos vs reales

- [ ] **PAT-009** Patrones Redis: compartición distribuida de datos, limitación de tasa, estadísticas en tiempo real
  - Tipo: FILE
  - Verificar: Patrones Redis documentados en `docs/REDIS_DATA_SUPPORT.md`; ejemplo `15-redis-data-pool.ts`
  - Esperado: Pools de usuarios, contadores distribuidos, limitación de tasa y coordinación entre VUs vía Redis

- [ ] **PAT-010** Patrón de embudo: recorrido de usuario multi-paso con simulación de abandono
  - Tipo: FILE
  - Verificar: El archivo `src/patterns/funnel.ts` o equivalente existe; ejemplo de flujo de compra `06-checkout-flow.ts`
  - Esperado: Simula embudos de usuario realistas donde un porcentaje de usuarios abandona en cada paso

- [ ] **PAT-011** Puntos de extensión: `registerCheck()` para registro personalizado de checks
  - Tipo: FILE
  - Verificar: `src/core/` exporta la función `registerCheck()`; la capa de producto puede llamarla sin bifurcar
  - Esperado: Los checks personalizados registrados vía `registerCheck(name, fn, options)` aparecen automáticamente en los reportes

- [ ] **PAT-012** Puntos de extensión: `registerIntegration()` para conectores de servicios
  - Tipo: FILE
  - Verificar: `src/core/` exporta la función `registerIntegration()`
  - Esperado: Los equipos de producto pueden agregar integraciones (ej., canales de notificación personalizados) sin modificar la capa genérica

- [ ] **PAT-013** Arquitectura de dos capas: Capa Genérica (`src/`) y Capa de Producto (`clients/`)
  - Tipo: FILE
  - Verificar: Verificar la separación: `src/` no contiene código específico de cliente; `clients/` extiende solo vía patrones
  - Esperado: Clara separación; los equipos de producto extienden sin bifurcar; no se requieren modificaciones directas a `src/`

---

## 4. Motor de Métricas

El Motor de Métricas (`src/metrics/`) calcula **125+ métricas de rendimiento** agrupadas por dominio a partir de los datos de `handleSummary` de k6 y métricas externas opcionales de Prometheus. Las métricas se organizan en **11 calculadores**.

### Calculador de Rendimiento (50 métricas)

- [ ] **MET-001** Instanciación del calculador de rendimiento y conteo de métricas
  - Tipo: FILE
  - Verificar: El archivo `src/metrics/calculators/performance-calculator.ts` existe
  - Esperado: El calculador produce ~50 métricas PERF (CHK-API-175 a CHK-API-224)

- [ ] **MET-002** Percentiles de latencia: p50, p90, p95, p99 para `http_req_duration`
  - Tipo: MANUAL
  - Verificar: Ejecutar prueba smoke, inspeccionar la sección de métricas en `summary.json`
  - Esperado: `perf_latency_p50`, `perf_latency_p90`, `perf_latency_p95`, `perf_latency_p99` presentes

- [ ] **MET-003** Cálculo de puntuación APDEX (Índice de Rendimiento de Aplicación 0-1)
  - Tipo: MANUAL
  - Verificar: Ejecutar prueba, verificar la sección del indicador APDEX en el reporte HTML
  - Esperado: Puntuación APDEX entre 0 y 1; indicador renderizado con código de colores (verde/amarillo/rojo)

- [ ] **MET-004** Métricas TTFB (Tiempo hasta el Primer Byte)
  - Tipo: MANUAL
  - Verificar: Inspeccionar la salida de métricas para `perf_ttfb_avg`, `perf_ttfb_p95`
  - Esperado: Métricas TTFB presentes y dentro de los rangos esperados

- [ ] **MET-005** Desglose de duración de solicitud (conexión, TLS, espera, recepción)
  - Tipo: MANUAL
  - Verificar: Inspeccionar métricas para `http_req_connecting`, `http_req_tls_handshaking`, `http_req_waiting`, `http_req_receiving`
  - Esperado: Los componentes del desglose de duración suman aproximadamente la duración total

### Calculador de Rendimiento de Transferencia

- [ ] **MET-006** Calculador de rendimiento de transferencia: 25 métricas THRU (CHK-API-225 a CHK-API-249)
  - Tipo: FILE
  - Verificar: El archivo `src/metrics/calculators/throughput-calculator.ts` existe
  - Esperado: Las métricas incluyen `thru_rps_avg`, `thru_rps_max`, `thru_rps_per_vu`, `thru_data_received`, `thru_data_sent`

- [ ] **MET-007** Solicitudes por segundo (RPS) promedio, máximo y por VU
  - Tipo: MANUAL
  - Verificar: Ejecutar prueba de carga, inspeccionar la sección de throughput del reporte HTML
  - Esperado: Métricas de RPS calculadas y mostradas en el gráfico de throughput

### Calculador de Errores (30 métricas)

- [ ] **MET-008** Calculador de errores: 30 métricas ERR (CHK-API-250 a CHK-API-279)
  - Tipo: FILE
  - Verificar: El archivo `src/metrics/calculators/error-calculator.ts` existe
  - Esperado: Las métricas incluyen tasa de errores, conteo de errores, distribución de errores por código de estado

- [ ] **MET-009** Tasa de errores y distribución de errores (desglose 4xx vs 5xx)
  - Tipo: MANUAL
  - Verificar: Ejecutar prueba con algunos errores esperados, verificar el gráfico de distribución de errores en el reporte HTML
  - Esperado: Errores 4xx y 5xx separados; tasa de errores calculada como fallidos/total

### Calculador de SLA (20 métricas)

- [ ] **MET-010** Calculador de SLA: 20 métricas SLA (CHK-API-330 a CHK-API-349)
  - Tipo: FILE
  - Verificar: El archivo `src/metrics/calculators/sla-calculator.ts` existe
  - Esperado: Las métricas de SLA se evalúan contra los objetivos SLO definidos con estados cumple/en riesgo/incumple/n/a

### Calculador de Saturación

- [ ] **MET-011** Calculador de saturación: métricas de saturación de recursos
  - Tipo: FILE
  - Verificar: El directorio `src/metrics/calculators/saturation/` existe con sub-calculators (`cpu`, `memory`, `io`, `network`, `resource`, `index`); el legacy `saturation-calculator.ts` shim re-exporta la fachada por compatibilidad (split en Phase 4 / ARC-07)
  - Esperado: Detecta saturación de CPU, memoria y conexiones a partir de métricas externas

### Calculador de Estabilidad

- [ ] **MET-012** Calculador de estabilidad: métricas de consistencia y varianza
  - Tipo: FILE
  - Verificar: El archivo `src/metrics/calculators/stability-calculator.ts` existe
  - Esperado: Métricas para varianza de tiempo de respuesta, coeficiente de variación, puntuación de estabilidad

### Calculador de Escalabilidad

- [ ] **MET-013** Calculador de escalabilidad: eficiencia bajo carga creciente
  - Tipo: FILE
  - Verificar: El archivo `src/metrics/calculators/scalability-calculator.ts` existe
  - Esperado: Métricas para factor de escalado de throughput, ratio de degradación de latencia

### Calculador de Caos

- [ ] **MET-014** Calculador de caos: métricas de resiliencia durante inyección de fallos
  - Tipo: FILE
  - Verificar: El archivo `src/metrics/calculators/chaos-calculator.ts` existe
  - Esperado: Métricas para tiempo de recuperación, amplificación de errores, puntuación de degradación controlada

### Calculador de Seguridad

- [ ] **MET-015** Calculador de seguridad: métricas de rendimiento relacionadas con la seguridad
  - Tipo: FILE
  - Verificar: El archivo `src/metrics/calculators/security-calculator.ts` existe
  - Esperado: Métricas para sobrecarga de latencia de autenticación, tiempo de handshake TLS, presencia de headers de seguridad

### Calculador de Observabilidad

- [ ] **MET-016** Calculador de observabilidad: métricas de infraestructura y trazabilidad
  - Tipo: FILE
  - Verificar: El archivo `src/metrics/calculators/observability-calculator.ts` existe
  - Esperado: Métricas de Prometheus, Tempo, Loki, Pyroscope cuando están disponibles; `na` en caso contrario

### Calculador de Integridad de Datos

- [ ] **MET-017** Calculador de integridad de datos: métricas de consistencia de datos
  - Tipo: FILE
  - Verificar: El archivo `src/metrics/calculators/data-integrity-calculator.ts` existe
  - Esperado: Métricas para tasa de corrupción de datos, resultados de verificación de consistencia

### Integración del Motor

- [ ] **MET-018** Método de fábrica MetricsEngine.withP1Calculators()
  - Tipo: FILE
  - Verificar: La clase `MetricsEngine` tiene el método estático `withP1Calculators()`
  - Esperado: Retorna el motor con todos los calculadores P1 pre-configurados

- [ ] **MET-019** Estructura de MetricsReport: byCategory, all, summary
  - Tipo: MANUAL
  - Verificar: Ejecutar prueba, inspeccionar el objeto `MetricsReport` en `summary.json`
  - Esperado: El reporte tiene `byCategory` (objeto de arrays), `all` (array plano), `summary` (total/pass/warn/fail/na)

- [ ] **MET-020** Evaluación de métricas en 4 estados: pass, warn, fail, na
  - Tipo: MANUAL
  - Verificar: Inspeccionar la salida de métricas para variedad de estados
  - Esperado: Cada métrica tiene un campo de estado con uno de: `pass`, `warn`, `fail`, `na`

- [ ] **MET-021** Cálculo de zona de advertencia (umbral x 1.1)
  - Tipo: MANUAL
  - Verificar: Establecer umbral en 500ms; respuesta en 520ms debería ser `warn`
  - Esperado: Valores entre el umbral y umbral*1.1 obtienen estado `warn`

- [ ] **MET-022** Integración de métricas externas vía `externalMetrics` / Prometheus
  - Tipo: MANUAL
  - Verificar: Configurar `externalMetrics` en la prueba; proporcionar datos de Prometheus
  - Esperado: Métricas previamente `na` se convierten en `pass`/`warn`/`fail` con datos externos

- [ ] **MET-023** El helper `buildMetricsInput()` transforma los datos de handleSummary de k6
  - Tipo: FILE
  - Verificar: `src/metrics/` exporta la función `buildMetricsInput`
  - Esperado: La función acepta el objeto `data` de k6, contexto y opciones; retorna un `MetricsInput` válido

- [ ] **MET-024** Agregación de resumen de métricas: conteos de total, pass, warn, fail, na
  - Tipo: MANUAL
  - Verificar: Ejecutar prueba, inspeccionar `report.summary` en la salida JSON
  - Esperado: El objeto `summary` contiene `{ total: N, pass: N, warn: N, fail: N, na: N }` con totales correctos

- [ ] **MET-025** Categorización de métricas: `byCategory` agrupa métricas por dominio
  - Tipo: MANUAL
  - Verificar: Inspeccionar `report.byCategory` en la salida de métricas
  - Esperado: Las claves incluyen `performance`, `throughput`, `error`, `sla`, `saturation`, `stability`, `scalability`, `chaos`, `security`, `observability`, `dataIntegrity`

---

## 5. Reportes

El sistema de reportes genera reportes HTML completos, capaces de funcionar sin conexión, con visualizaciones interactivas.

- [ ] **RPT-001** Generación de reporte HTML interactivo con 17+ secciones
  - Tipo: CMD
  - Verificar: `./bin/run-test.sh --client=_reference --scenario=api/smoke-users --profile=smoke`
  - Esperado: `reports/_reference/*/report.html` generado; autocontenido sin dependencias de CDN

- [ ] **RPT-002** Sección de encabezado: metadatos de la prueba (cliente, servicio, entorno, perfil, usuario, ID de ejecución, marca temporal)
  - Tipo: MANUAL
  - Verificar: Abrir el reporte HTML generado, inspeccionar la sección de encabezado
  - Esperado: Todos los campos de metadatos poblados correctamente

- [ ] **RPT-003** Franja de KPIs: tasa de checks aprobados, latencia avg/p95/p99, tasa de errores, throughput, APDEX, estado SLA
  - Tipo: MANUAL
  - Verificar: Abrir el reporte HTML, inspeccionar la franja de KPIs en la parte superior
  - Esperado: Los 7+ valores de KPI se muestran con código de colores

- [ ] **RPT-004** Indicador APDEX: indicador visual 0-1 con calificación de satisfacción codificada por color
  - Tipo: MANUAL
  - Verificar: Abrir el reporte HTML, localizar la sección del indicador APDEX
  - Esperado: Indicador renderizado con zonas verde (>0.94), amarilla (0.85-0.94), roja (<0.85)

- [ ] **RPT-005** Cumplimiento SLA/SLO: tabla de semáforo con valores reales vs objetivo
  - Tipo: MANUAL
  - Verificar: Abrir el reporte HTML, localizar la sección SLA/SLO
  - Esperado: La tabla muestra indicadores verde/amarillo/rojo por métrica SLO

- [ ] **RPT-006** Gráfico de distribución de latencia: líneas interactivas de p50, p95, p99 a lo largo del tiempo
  - Tipo: MANUAL
  - Verificar: Abrir el reporte HTML, localizar el gráfico de latencia (Chart.js)
  - Esperado: Gráfico interactivo con tooltips, zoom y desplazamiento; tres líneas de percentiles visibles

- [ ] **RPT-007** Gráfico de throughput: solicitudes por segundo a lo largo del tiempo con superposición de VUs
  - Tipo: MANUAL
  - Verificar: Abrir el reporte HTML, localizar la sección de throughput
  - Esperado: Gráfico de línea RPS con conteo de VUs superpuesto en el eje secundario

- [ ] **RPT-008** Gráfico de distribución de errores: desglose 4xx vs 5xx
  - Tipo: MANUAL
  - Verificar: Abrir el reporte HTML, localizar la sección de distribución de errores
  - Esperado: Gráfico de barras o circular mostrando categorías de errores 4xx y 5xx

- [ ] **RPT-009** Sección de análisis de grupos: temporización y checks por grupo
  - Tipo: MANUAL
  - Verificar: Ejecutar prueba con bloques `group()`, abrir el reporte HTML
  - Esperado: Temporización por grupo, conteos de checks aprobados/fallidos e indicadores de estado

- [ ] **RPT-010** Sección de métricas personalizadas: paneles de Trends, Counters, Rates, Gauges
  - Tipo: MANUAL
  - Verificar: Ejecutar prueba con métricas personalizadas, abrir el reporte HTML
  - Esperado: Paneles separados para cada tipo de métrica personalizada con valores

- [ ] **RPT-011** Sección de Web Vitals: puntuaciones LCP, FCP, CLS, TTFB, INP
  - Tipo: MANUAL
  - Verificar: Ejecutar prueba de navegador o prueba que emita web vitals, abrir el reporte HTML
  - Esperado: Web vitals mostrados con calificaciones bueno/necesita mejora/pobre

- [ ] **RPT-012** Salida de resumen JSON (`summary.json`)
  - Tipo: CMD
  - Verificar: Después de la prueba, verificar que `reports/_reference/*/summary.json` existe
  - Esperado: JSON válido con métricas, umbrales, checks y metadatos

- [ ] **RPT-013** Exportación a PDF vía renderizado headless con Puppeteer
  - Tipo: CMD
  - Verificar: `node bin/export-report.js --format=pdf --input=reports/_reference/*/report.html`
  - Esperado: Archivo PDF generado a partir del reporte HTML con todos los gráficos renderizados

- [ ] **RPT-014** Exportación a PNG vía renderizado headless con Puppeteer
  - Tipo: CMD
  - Verificar: `node bin/export-report.js --format=png --input=reports/_reference/*/report.html`
  - Esperado: Capturas PNG del reporte generadas

- [ ] **RPT-015** Reporte de análisis LLM (integración con Claude para insights inteligentes de rendimiento)
  - Tipo: CMD
  - Verificar: Ejecutar prueba con el flag `--llm-analysis` o equivalente; requiere clave API
  - Esperado: Sección de análisis generada por LLM en el reporte con insights y recomendaciones

- [ ] **RPT-016** Comparación automática con ejecución anterior (tablas delta, badges de color, sparkline)
  - Tipo: MANUAL
  - Verificar: Ejecutar la misma prueba dos veces, abrir el segundo reporte
  - Esperado: La sección de comparación muestra cambios absolutos y porcentuales con badges de color y sparkline de evolución

- [ ] **RPT-017** Marca personalizada (logo de la organización, colores, nomenclatura)
  - Tipo: CONFIG
  - Verificar: Configurar la marca en la configuración del cliente; ejecutar prueba; abrir reporte
  - Esperado: El encabezado del reporte muestra logo personalizado, nombre de la organización y esquema de colores

- [ ] **RPT-018** Sección de detalle de checks: todos los checks de k6 con conteos de aprobados/fallidos y tasas de éxito
  - Tipo: MANUAL
  - Verificar: Abrir el reporte HTML, localizar la sección de Detalle de Checks (#11)
  - Esperado: Cada `check()` de k6 listado con conteo de aprobados, conteo de fallidos y porcentaje

- [ ] **RPT-019** Sección de umbrales: todos los umbrales con estado de aprobado/fallido y valores reales
  - Tipo: MANUAL
  - Verificar: Abrir el reporte HTML, localizar la sección de Umbrales (#12)
  - Esperado: Cada umbral listado con su expresión, valor real e indicador de aprobado/fallido

- [ ] **RPT-020** Sección de detalles HTTP: detalles de solicitud/respuesta por endpoint
  - Tipo: MANUAL
  - Verificar: Abrir el reporte HTML, localizar la sección de Detalles HTTP (#16)
  - Esperado: Desglose por endpoint mostrando URL, método, conteo, duración avg/p95, tasa de errores

- [ ] **RPT-021** Sección de resumen ejecutivo: resumen de alto nivel para stakeholders no técnicos
  - Tipo: MANUAL
  - Verificar: Abrir el reporte HTML, localizar la sección de Resumen Ejecutivo (#17)
  - Esperado: Resumen en lenguaje sencillo del resultado de la prueba adecuado para revisión gerencial

- [ ] **RPT-022** Redacción de PII en la salida del reporte
  - Tipo: MANUAL
  - Verificar: Ejecutar prueba con PII en parámetros de URL; inspeccionar el reporte HTML en busca de valores redactados
  - Esperado: Direcciones de correo, tokens, IPs reemplazados con `[REDACTED]` en todas las secciones del reporte

- [ ] **RPT-023** Análisis de tendencias a través de múltiples ejecuciones históricas
  - Tipo: MANUAL
  - Verificar: Ejecutar la misma prueba 3+ veces; abrir el último reporte
  - Esperado: La sección de tendencias muestra la evolución de métricas a través de ejecuciones históricas con líneas de tendencia

- [ ] **RPT-024** Cumplimiento de accesibilidad WCAG para reportes HTML
  - Tipo: MANUAL
  - Verificar: Ejecutar herramienta de auditoría de accesibilidad (ej., axe, Lighthouse) en el reporte HTML generado
  - Esperado: El reporte cumple los requisitos WCAG 2.1 AA; etiquetas ARIA adecuadas, navegación por teclado, ratios de contraste

- [ ] **RPT-025** Visualizaciones interactivas con Chart.js (tooltips, zoom, desplazamiento)
  - Tipo: MANUAL
  - Verificar: Abrir el reporte HTML; pasar el cursor sobre los gráficos para tooltips; usar scroll/pellizco para zoom
  - Esperado: Todos los gráficos soportan tooltips al pasar el cursor, zoom vía scroll/pellizco y desplazamiento vía arrastre

---

## 6. Dashboards de Grafana

El framework incluye **3 dashboards pre-construidos**, provisionados automáticamente vía Docker Compose.

- [ ] **GRF-001** Dashboard de Resumen de Pruebas de Carga provisionado en Grafana
  - Tipo: DOCKER
  - Verificar: `./bin/observability.sh up --full && ./bin/observability.sh open`; navegar a Dashboards
  - Esperado: Dashboard "k6 Load Test Overview" disponible con paneles para latencia, throughput, errores, VUs

- [ ] **GRF-002** Dashboard de Analítica Empresarial provisionado
  - Tipo: DOCKER
  - Verificar: Navegar a Dashboards en Grafana
  - Esperado: Dashboard "k6 Enterprise Analytics" con paneles avanzados de comparación entre pruebas

- [ ] **GRF-003** Dashboard de Web Vitals provisionado
  - Tipo: DOCKER
  - Verificar: Navegar a Dashboards en Grafana
  - Esperado: Dashboard "k6 Web Vitals" con paneles de LCP, FCP, CLS, TTFB, INP

- [ ] **GRF-004** Variables de plantilla: test_name, test_timestamp, client, environment
  - Tipo: DOCKER
  - Verificar: Abrir cualquier dashboard, verificar los desplegables de variables de plantilla
  - Esperado: 4 variables (test_name, test_timestamp, client, environment) auto-pobladas desde etiquetas de Prometheus

- [ ] **GRF-005** Fuente de datos Prometheus auto-configurada
  - Tipo: DOCKER
  - Verificar: Grafana > Configuración > Fuentes de Datos
  - Esperado: Fuente de datos Prometheus apuntando a `http://prometheus:9090` pre-configurada

- [ ] **GRF-006** Archivos de provisionamiento de dashboards en JSON en `grafana/dashboards/`
  - Tipo: FILE
  - Verificar: Verificar el directorio `grafana/dashboards/` en busca de archivos JSON
  - Esperado: Al menos 3 archivos JSON de definición de dashboards presentes

- [ ] **GRF-007** Paneles de métricas personalizadas: panel de Rates & Gauges en los dashboards
  - Tipo: DOCKER
  - Verificar: Ejecutar prueba con métricas personalizadas, abrir Load Test Overview en Grafana
  - Esperado: Los paneles de métricas personalizadas muestran datos de Trend, Counter, Rate y Gauge

- [ ] **GRF-008** Exportación de métricas Prometheus en el puerto 5656
  - Tipo: CMD
  - Verificar: Durante la ejecución de la prueba: `curl http://localhost:5656/metrics`
  - Esperado: Métricas en formato de texto Prometheus con prefijo `k6_` y etiquetas personalizadas

- [ ] **GRF-009** Etiquetas auto-inyectadas (test_name, test_timestamp, client, environment) en todas las métricas
  - Tipo: MANUAL
  - Verificar: Consultar Prometheus para `k6_http_req_duration` y verificar etiquetas
  - Esperado: Las 4 etiquetas personalizadas presentes en cada métrica exportada

---

## 7. Métricas Personalizadas

El framework soporta 4 tipos de métricas personalizadas de k6 con auto-detección, convenciones de nomenclatura de Prometheus e integración con Grafana.

- [ ] **CUS-001** Métrica Trend: auto-detectada y mostrada en reportes y Grafana
  - Tipo: MANUAL
  - Verificar: Definir una métrica `Trend` en la prueba, ejecutar prueba, verificar el reporte HTML y Grafana
  - Esperado: La métrica Trend aparece en la sección de métricas personalizadas con valores p50/p90/p95/p99

- [ ] **CUS-002** Métrica Counter: auto-detectada y mostrada en reportes y Grafana
  - Tipo: MANUAL
  - Verificar: Definir una métrica `Counter` en la prueba, ejecutar prueba, verificar reporte
  - Esperado: La métrica Counter aparece con valor de conteo acumulativo

- [ ] **CUS-003** Métrica Rate: auto-detectada y mostrada en reportes y Grafana
  - Tipo: MANUAL
  - Verificar: Definir una métrica `Rate` en la prueba, ejecutar prueba, verificar reporte
  - Esperado: La métrica Rate aparece como porcentaje (0-100%) en el reporte

- [ ] **CUS-004** Métrica Gauge: auto-detectada y mostrada en reportes y Grafana
  - Tipo: MANUAL
  - Verificar: Definir una métrica `Gauge` en la prueba, ejecutar prueba, verificar reporte
  - Esperado: La métrica Gauge aparece con valor mínimo/máximo/actual

- [ ] **CUS-005** Convención de nomenclatura Prometheus (`k6_custom_<name>`)
  - Tipo: MANUAL
  - Verificar: Durante la prueba con exportación a Prometheus, consultar los nombres de métricas personalizadas
  - Esperado: Las métricas personalizadas siguen la nomenclatura de Prometheus: `k6_custom_my_metric_name` (snake_case)

- [ ] **CUS-006** Métricas personalizadas en el reporte HTML: panel separado por tipo
  - Tipo: MANUAL
  - Verificar: Ejecutar prueba demo del dashboard, abrir el reporte HTML
  - Esperado: La sección de Métricas Personalizadas tiene sub-paneles separados: Trends, Counters, Rates, Gauges

- [ ] **CUS-007** Métricas personalizadas en Grafana: paneles auto-detectados
  - Tipo: DOCKER
  - Verificar: Ejecutar prueba con métricas personalizadas, abrir dashboard de Grafana
  - Esperado: Las métricas personalizadas aparecen en paneles dedicados de Grafana sin configuración manual del dashboard

- [ ] **CUS-008** Umbrales de métricas personalizadas (umbrales definidos por el usuario en métricas personalizadas)
  - Tipo: CONFIG
  - Verificar: Definir umbral para métrica personalizada en las opciones, ejecutar prueba
  - Esperado: El umbral de la métrica personalizada se evalúa y se muestra en la sección de umbrales del reporte

---

## 8. Análisis de Grupos

El framework analiza automáticamente los bloques `group()` de k6 con inyección de umbrales sintéticos y métricas detalladas por grupo.

- [ ] **GRP-001** Inyección de umbrales sintéticos para todos los grupos
  - Tipo: MANUAL
  - Verificar: Definir grupos sin umbrales explícitos, ejecutar prueba, verificar la sección de umbrales del reporte
  - Esperado: Umbrales `group_duration{group:::NombreGrupo}` auto-inyectados (predeterminado: `p(95)<5000`)

- [ ] **GRP-002** Filtrado de `root_group` (excluye el grupo raíz del análisis)
  - Tipo: MANUAL
  - Verificar: Ejecutar prueba con grupos, inspeccionar la sección de análisis de grupos
  - Esperado: `root_group` (el grupo implícito de nivel superior) se filtra de los listados de grupos

- [ ] **GRP-003** Temporización por grupo: percentiles de duración por grupo
  - Tipo: MANUAL
  - Verificar: Ejecutar prueba con múltiples grupos, verificar la sección de grupos en el reporte HTML
  - Esperado: Cada grupo muestra temporización de duración p50, p95

- [ ] **GRP-004** Checks por grupo: conteos de aprobados/fallidos por grupo
  - Tipo: MANUAL
  - Verificar: Ejecutar prueba con checks dentro de grupos, inspeccionar el análisis de grupos
  - Esperado: Cada grupo muestra el número de checks aprobados y fallidos

- [ ] **GRP-005** Análisis de grupos en la sección del reporte HTML (#8)
  - Tipo: MANUAL
  - Verificar: Abrir el reporte HTML, localizar la sección de Análisis de Grupos
  - Esperado: Tabla/tarjetas mostrando cada grupo con temporización, checks y estado de aprobado/fallido

- [ ] **GRP-006** Análisis de grupos en el dashboard de Grafana
  - Tipo: DOCKER
  - Verificar: Ejecutar prueba con grupos, abrir dashboard de Grafana
  - Esperado: Métricas de duración de grupo visibles en el dashboard con filtrado por grupo

---

## 9. SLA/SLO

Definiciones de Objetivos de Nivel de Servicio por servicio con evaluación automática, clasificación de 3 estados, puntuación APDEX y reportes mensuales.

- [ ] **SLO-001** Definición de SLO en `clients/{name}/config/slos.json`
  - Tipo: CONFIG
  - Verificar: Verificar que `clients/_reference/config/slos.json` existe con estructura `version`, `services[]`, `metrics[]`
  - Esperado: Configuración SLO válida con `name`, `target`, `riskMargin`, `unit`, `description` por métrica

- [ ] **SLO-002** Evaluación de 3 estados: cumple (pass) / en_riesgo (at-risk) / incumple (fail)
  - Tipo: MANUAL
  - Verificar: Ejecutar prueba con configuración SLO, inspeccionar la sección SLA/SLO en el reporte HTML
  - Esperado: Cada SLO muestra uno de tres estados con color apropiado (verde/amarillo/rojo)

- [ ] **SLO-003** Cálculo del margen de riesgo (target * riskMargin)
  - Tipo: MANUAL
  - Verificar: Configurar SLO con `target: 500` y `riskMargin: 0.1`; resultado en 520ms
  - Esperado: El estado es `en riesgo` (entre 500ms y 550ms = 500 * 1.1)

- [ ] **SLO-004** Puntuación APDEX (Índice de Rendimiento de Aplicación 0-1)
  - Tipo: MANUAL
  - Verificar: Ejecutar prueba, verificar el indicador APDEX en el reporte HTML
  - Esperado: Puntuación calculada como: (satisfechos + tolerantes/2) / total; satisfechos = <T, tolerantes = <4T

- [ ] **SLO-005** Evaluación de SLO por servicio (soporte multi-servicio)
  - Tipo: CONFIG
  - Verificar: Definir SLOs para múltiples servicios en `slos.json`
  - Esperado: Cada servicio se evalúa independientemente con su propio conjunto de métricas SLO

- [ ] **SLO-006** Reportes de cumplimiento mensual
  - Tipo: MANUAL
  - Verificar: Verificar la agregación mensual en los reportes; ejecutar múltiples pruebas a lo largo del tiempo
  - Esperado: Cumplimiento SLO agregado durante el período de tiempo con consumo de presupuesto de errores

- [ ] **SLO-007** Configuración de SLO vía YAML o JSON
  - Tipo: CONFIG
  - Verificar: Definir SLOs en formatos `slos.json` y `slos.yaml`
  - Esperado: El framework acepta ambos formatos para las definiciones de SLO

- [ ] **SLO-008** Resultados de SLO en la salida de resumen JSON
  - Tipo: CMD
  - Verificar: Ejecutar prueba, inspeccionar `summary.json` en busca de resultados SLO
  - Esperado: El JSON contiene la sección `slo` con resultados de evaluación por métrica

- [ ] **SLO-009** Cálculo y seguimiento del presupuesto de errores
  - Tipo: MANUAL
  - Verificar: Configurar SLO con 99.9% de disponibilidad; ejecutar pruebas; verificar el presupuesto de errores consumido
  - Esperado: El presupuesto de errores restante se calcula como `(1 - target) * período - tiempo_inactivo_real`

- [ ] **SLO-010** Estado de SLO en la tabla de semáforo del reporte HTML
  - Tipo: MANUAL
  - Verificar: Ejecutar prueba con configuración SLO, abrir la sección SLA/SLO del reporte HTML
  - Esperado: Tabla de semáforo con verde (cumple), amarillo (en riesgo), rojo (incumple) por SLO con valores reales vs objetivo

---

## 10. Seguridad

El framework implementa **14 controles de seguridad** que cubren control de acceso, auditoría, aislamiento y endurecimiento.

- [ ] **SEC-001** RBAC: 3 roles (developer, lead, admin) con matriz de permisos
  - Tipo: CONFIG
  - Verificar: Verificar `clients/{name}/config/rbac.json` para las definiciones de roles
  - Esperado: Tres roles con permisos diferenciados (developer: solo smoke/quick/load; lead: todos los perfiles; admin: gestión completa)

- [ ] **SEC-002** Log de auditoría inmutable: todas las acciones registradas con marca temporal, usuario, acción, resultado
  - Tipo: MANUAL
  - Verificar: Ejecutar prueba, verificar el archivo de log de auditoría en busca de entrada con `timestamp`, `userId`, `action`, `result`
  - Esperado: Las entradas de auditoría son de solo escritura (append-only), contienen todos los campos requeridos y no pueden ser modificadas

- [ ] **SEC-003** Aislamiento de clientes: prevención de path traversal
  - Tipo: MANUAL
  - Verificar: Intentar acceder a archivos fuera del directorio del cliente vía `../` en las rutas
  - Esperado: El framework rechaza intentos de path traversal; sin acceso a archivos fuera del alcance del cliente

- [ ] **SEC-004** Endurecimiento de shell: prevención de inyección de comandos en `run-test.sh`
  - Tipo: MANUAL
  - Verificar: Pasar metacaracteres de shell en el parámetro `--client` (ej., `; rm -rf /`)
  - Esperado: La entrada se sanitiza; los metacaracteres de shell se rechazan o escapan; sin ejecución de comandos

- [ ] **SEC-005** Validación de entrada CLI: sanitización de parámetros para todas las entradas CLI
  - Tipo: MANUAL
  - Verificar: Pasar valores inválidos/maliciosos a los parámetros CLI (caracteres especiales, cadenas largas, bytes nulos)
  - Esperado: Todas las entradas se validan contra listas de permitidos; las entradas inválidas se rechazan con mensaje de error claro

- [ ] **SEC-006** Parseo seguro de YAML: sin ejecución de código vía deserialización YAML
  - Tipo: FILE
  - Verificar: Verificar la configuración del parser YAML; intentar cargar YAML con etiquetas `!!js/function`
  - Esperado: El parser YAML configurado en modo seguro; las etiquetas de ejecución de código son rechazadas

- [ ] **SEC-007** Gestión de secretos: inyección de variables de entorno, sin secretos hardcodeados
  - Tipo: FILE + MANUAL
  - Verificar: `grep -rn "password\|token\|api_key\|secret" clients/` muestra solo referencias a `__ENV.*`
  - Esperado: Todas las credenciales se cargan desde variables de entorno; sin literales de cadena que coincidan con patrones de secretos

- [ ] **SEC-008** Redacción de PII en reportes y métricas
  - Tipo: MANUAL
  - Verificar: Ejecutar prueba con PII en etiquetas de URL; verificar el reporte HTML y las métricas de Prometheus
  - Esperado: Valores de etiquetas sensibles redactados (correos electrónicos, IPs, tokens reemplazados con `[REDACTED]`)

- [ ] **SEC-009** Sanitización de métricas de Prometheus (validación de valores de etiqueta)
  - Tipo: MANUAL
  - Verificar: Inyectar métrica con caracteres especiales en las etiquetas; verificar la salida de Prometheus
  - Esperado: Los valores de etiqueta se sanitizan para prevenir inyección; solo caracteres seguros permitidos

- [ ] **SEC-010** Seguridad de configuración: campos bloqueados en perfiles personalizados
  - Tipo: MANUAL
  - Verificar: Crear perfil personalizado con campo `exec`, `env` o `disableSecretMasking`
  - Esperado: El framework rechaza el perfil con error explícito; el intento se registra en el log de auditoría

- [ ] **SEC-011** Aislamiento de ejecución: las pruebas de un cliente no pueden acceder a datos de otros clientes
  - Tipo: MANUAL
  - Verificar: Ejecutar prueba para cliente A; verificar que no hay acceso a reportes, configuración o datos del cliente B
  - Esperado: El acceso al sistema de archivos se limita solo a `clients/{name}/`

- [ ] **SEC-012** Aislamiento de reportes: los reportes HTML son autocontenidos, sin solicitudes externas
  - Tipo: MANUAL
  - Verificar: Abrir el reporte HTML en el navegador con la pestaña de red abierta; verificar solicitudes externas
  - Esperado: Cero solicitudes HTTP externas; todo CSS, JS, fuentes embebidos inline; accesible según WCAG

- [ ] **SEC-013** Sanitización de identidad: validación de identidad de usuario (a-z, A-Z, 0-9, _.@-)
  - Tipo: MANUAL
  - Verificar: Pasar identidad de usuario con caracteres especiales; verificar el valor sanitizado
  - Esperado: Solo `[a-zA-Z0-9_.@-]` permitidos; máximo 128 caracteres; los inválidos se establecen por defecto a `anonymous`

- [ ] **SEC-014** Validación de binario y perfil personalizado
  - Tipo: MANUAL
  - Verificar: Verificar que `profile-validator.ts` valida perfiles personalizados contra lista de permitidos
  - Esperado: Solo los campos `name`, `description`, `stages`, `thresholds` son aceptados; `additionalProperties: false` se aplica

---

## 11. Integración CI/CD

Plantillas y herramientas para integrar el framework en pipelines CI/CD con puertas de calidad.

- [ ] **CI-001** Plantilla de workflow de GitHub Actions
  - Tipo: FILE
  - Verificar: Verificar la plantilla en `.github/workflows/` o `shared/templates/ci/github-actions.yml`
  - Esperado: Plantilla de workflow con pasos de ejecución de prueba, evaluación de umbrales y carga de artefactos

- [ ] **CI-002** Plantilla de pipeline de GitLab CI
  - Tipo: FILE
  - Verificar: Verificar `shared/templates/ci/gitlab-ci.yml` o plantilla `.gitlab-ci.yml`
  - Esperado: Plantilla de pipeline con etapas para ejecución de prueba y evaluación de puerta de calidad

- [ ] **CI-003** Códigos de salida de puerta de calidad (0=aprobado, 1=fallido, 2=error, 99=parcial)
  - Tipo: CMD
  - Verificar: Ejecutar prueba que apruebe umbrales (esperar 0); ejecutar prueba que falle (esperar 1)
  - Esperado: Los códigos de salida coinciden con los valores documentados y pueden usarse para control del pipeline

- [ ] **CI-004** Sobreescritura de umbrales vía variable de entorno (`QG_THRESHOLDS_OVERRIDE`)
  - Tipo: CMD
  - Verificar: `QG_THRESHOLDS_OVERRIDE='{"http_req_duration[p95]": 800}' ./bin/run-test.sh ...`
  - Esperado: Se usa el umbral sobreescrito en lugar del valor del archivo de configuración

- [ ] **CI-005** Integración de detect-secrets para escaneo pre-commit
  - Tipo: FILE
  - Verificar: Verificar `.pre-commit-config.yaml` o configuración de detect-secrets
  - Esperado: Hook pre-commit configurado para escanear secretos hardcodeados antes del commit

- [ ] **CI-006** Carga de artefactos de reporte en plantillas CI
  - Tipo: FILE
  - Verificar: Inspeccionar las plantillas CI en busca de pasos de carga de artefactos
  - Esperado: Reporte HTML, summary.json y métricas cargados como artefactos del pipeline

- [ ] **CI-007** Soporte de suite de regresión nocturna
  - Tipo: FILE
  - Verificar: Las plantillas CI incluyen configuración de trigger programado
  - Esperado: Programación cron para ejecuciones nocturnas con suite completa de perfiles de carga

- [ ] **CI-008** Notificaciones multi-canal (Slack, Teams, correo electrónico)
  - Tipo: FILE + CONFIG
  - Verificar: Verificar las plantillas CI y la configuración del framework para la configuración de notificaciones
  - Esperado: Plantillas de notificación para resultados de aprobado/fallido a los canales configurados

- [ ] **CI-009** Ejecución CI basada en Docker (ejecución de pruebas en contenedor)
  - Tipo: DOCKER
  - Verificar: `docker run --rm -v "$(pwd)/reports:/app/reports" k6-enterprise:latest --client=_reference --scenario=api/smoke-users --profile=smoke`
  - Esperado: La prueba se ejecuta dentro del contenedor Docker con reportes montados en el host

- [ ] **CI-010** Configuración de umbrales específicos por entorno (staging vs producción)
  - Tipo: CONFIG
  - Verificar: Configurar diferentes umbrales por entorno en `config/{env}.json`
  - Esperado: El pipeline usa umbrales correspondientes al entorno para la evaluación de la puerta de calidad

---

## 12. Observabilidad

El stack de observabilidad proporciona **5 servicios principales** más instrumentación específica del framework.

- [ ] **OBS-001** Recolección de métricas Prometheus desde k6
  - Tipo: DOCKER
  - Verificar: `./bin/observability.sh up --full`; ejecutar prueba; consultar `http://localhost:9090`
  - Esperado: Métricas de k6 disponibles en Prometheus con etiquetas personalizadas

- [ ] **OBS-002** Visualización en Grafana (puerto 3000, admin/admin por defecto)
  - Tipo: DOCKER
  - Verificar: `open http://localhost:3000`; iniciar sesión con admin/admin
  - Esperado: Grafana accesible con dashboards y fuentes de datos pre-provisionados

- [ ] **OBS-003** Agregación de logs con Loki
  - Tipo: DOCKER
  - Verificar: Verificar docker-compose para el servicio Loki; consultar logs en Grafana Explore
  - Esperado: Logs estructurados de k6 recolectados y consultables vía fuente de datos Loki en Grafana

- [ ] **OBS-004** Trazabilidad distribuida con Tempo
  - Tipo: DOCKER
  - Verificar: Verificar docker-compose para el servicio Tempo; ejecutar prueba con trazabilidad habilitada
  - Esperado: Trazas visibles en Grafana Explore vía fuente de datos Tempo; correlación traza-a-métricas

- [ ] **OBS-005** Perfilado continuo con Pyroscope
  - Tipo: DOCKER
  - Verificar: Verificar docker-compose para el servicio Pyroscope; acceder a la UI de Pyroscope
  - Esperado: Perfiles de CPU y memoria del generador de carga k6 disponibles para análisis

- [ ] **OBS-006** Perfil de observabilidad en Docker Compose (`--profile observability`)
  - Tipo: CMD
  - Verificar: `docker compose -f infrastructure/docker-compose.standalone.yml --profile observability config` muestra los 5 servicios
  - Esperado: Servicios de Prometheus, Grafana, Loki, Tempo, Pyroscope definidos en el archivo compose

- [ ] **OBS-007** Monitoreo de salud del generador (gráficos de CPU y memoria)
  - Tipo: MANUAL
  - Verificar: Ejecutar prueba de carga, abrir la sección de Salud del Generador (#14) en el reporte HTML
  - Esperado: Gráficos de uso de CPU y memoria del generador de carga durante la prueba

- [ ] **OBS-008** Detección de sobrecarga y advertencias
  - Tipo: CMD
  - Verificar: `./bin/run-test.sh --client=_benchmark --service=baseline --test=smoke`
  - Esperado: Sobrecarga del framework medida; advertencia si la sobrecarga > umbral configurado

- [ ] **OBS-009** Instrumentación de trazabilidad (headers X-Request-ID, X-Correlation-ID)
  - Tipo: MANUAL
  - Verificar: Ejecutar prueba con `HeaderHelper.tracing()`; inspeccionar headers de solicitud
  - Esperado: Cada solicitud incluye UUID v4 `X-Request-ID` y `X-Correlation-ID` para trazabilidad distribuida

- [ ] **OBS-010** Instrumentación de Pyroscope para perfilado de k6
  - Tipo: DOCKER
  - Verificar: Verificar la configuración de Pyroscope para el perfilado del proceso k6
  - Esperado: Binario k6 perfilado durante la ejecución de la prueba; flamegraphs disponibles en la UI de Pyroscope

- [ ] **OBS-011** Detección de anomalías en reportes (sección #15)
  - Tipo: MANUAL
  - Verificar: Ejecutar prueba que produzca anomalías (picos de latencia, ráfagas de errores); verificar la sección #15 del reporte
  - Esperado: Anomalías detectadas con recomendaciones auto-generadas

- [ ] **OBS-012** Cliente benchmark (`_benchmark`) para medir la sobrecarga del framework
  - Tipo: CMD
  - Verificar: `./bin/run-test.sh --client=_benchmark --service=baseline --test=load`
  - Esperado: Reporte de benchmark generado con métricas de sobrecarga del framework (5-10 min de ejecución)

---

## 13. Generadores

Generación de scaffolding para nuevos clientes, escenarios de prueba, servicios y fábricas de datos sin escribir código repetitivo.

- [ ] **GEN-001** Menú interactivo del generador (`node bin/generate.js`)
  - Tipo: CMD
  - Verificar: `node bin/generate.js` (interactivo, dirigido por menú)
  - Esperado: El menú muestra 4 opciones: Nuevo cliente, Nuevo escenario de prueba, Nueva clase de servicio, Nueva fábrica de datos

- [ ] **GEN-002** Scaffolding de cliente (`bin/create-client.sh`)
  - Tipo: CMD
  - Verificar: `bin/create-client.sh test-compliance-client`
  - Esperado: Árbol de directorios completo del cliente creado: `clients/test-compliance-client/{config,scenarios,lib,mocks,data}/`

- [ ] **GEN-003** Generador de escenarios (HTTP, GraphQL, WebSocket, protocolos mixtos)
  - Tipo: CMD
  - Verificar: Usar el generador para crear un escenario con cada tipo de protocolo
  - Esperado: `clients/{client}/scenarios/{name}.ts` creado a partir de `shared/templates/generators/scenario-api.ts`

- [ ] **GEN-004** Generador de clases de servicio
  - Tipo: CMD
  - Verificar: Usar el generador para crear una nueva clase de servicio
  - Esperado: `clients/{client}/lib/services/{Name}Service.ts` creado con métodos base

- [ ] **GEN-005** Generador de fábricas de datos
  - Tipo: CMD
  - Verificar: `node bin/generate-data.js --type=users --count=1000 --format=csv`
  - Esperado: Archivo de datos CSV/JSON generado con datos de prueba realistas

- [ ] **GEN-006** Generación basada en plantillas (usa `shared/templates/generators/`)
  - Tipo: FILE
  - Verificar: Verificar el directorio `shared/templates/generators/` en busca de archivos de plantilla
  - Esperado: Existen plantillas para scenario-api, scenario-graphql, scenario-websocket, service, factory

- [ ] **GEN-007** Modo no interactivo para CI (`bin/create-client.sh <name>`)
  - Tipo: CMD
  - Verificar: `bin/create-client.sh ci-test-client` (sin prompts interactivos)
  - Esperado: Cliente creado sin prompts; código de salida 0

- [ ] **GEN-008** El cliente generado pasa la validación (`validate_schema`)
  - Tipo: CMD
  - Verificar: Crear cliente, luego validar su configuración: `node bin/validate-config.js clients/test-client/config/default.json`
  - Esperado: La configuración generada pasa la validación de esquema con cero errores

---

## 14. Pruebas Distribuidas

Ejecutar pruebas de carga k6 distribuidas a través de múltiples pods de Kubernetes usando k6-operator.

- [ ] **DST-001** Integración con k6-operator vía `bin/run-distributed.sh`
  - Tipo: K8S
  - Verificar: `./bin/run-distributed.sh --client=myapp --scenario=api/checkout --profile=load --image=<registry>/k6:latest`
  - Esperado: CRD TestRun creado; pods generados; la prueba se ejecuta a través de múltiples runners

- [ ] **DST-002** Segmentos de ejecución: configuración de paralelismo
  - Tipo: K8S
  - Verificar: `./bin/run-distributed.sh --parallelism=8 ...`
  - Esperado: 8 pods runner creados; la carga de VUs se divide equitativamente entre los pods

- [ ] **DST-003** Soporte de construcción de imagen de contenedor (flag `--build`)
  - Tipo: K8S
  - Verificar: `./bin/run-distributed.sh --build --registry=registry.example.com/myapp ...`
  - Esperado: Imagen Docker construida y publicada en el registro antes de la ejecución de la prueba

- [ ] **DST-004** NetworkPolicy para seguridad pod-a-pod
  - Tipo: K8S + FILE
  - Verificar: Verificar el directorio `k8s/` o `helm/` en busca de manifiestos NetworkPolicy
  - Esperado: NetworkPolicy limita el egreso de los pods runner solo a los endpoints del SUT y Prometheus

- [ ] **DST-005** RBAC para cuentas de servicio de Kubernetes
  - Tipo: K8S + FILE
  - Verificar: Verificar manifiestos de ServiceAccount, Role, RoleBinding
  - Esperado: Los pods runner de k6 usan una cuenta de servicio con privilegios mínimos

- [ ] **DST-006** Chart de Helm para despliegue
  - Tipo: FILE
  - Verificar: Verificar el directorio `helm/` o `charts/` en busca de archivos de chart de Helm
  - Esperado: Chart de Helm con valores configurables para paralelismo, imagen, recursos y toleraciones

- [ ] **DST-007** Generación de CRD TestRun
  - Tipo: K8S
  - Verificar: `./bin/run-distributed.sh` genera YAML de TestRun válido
  - Esperado: El YAML generado coincide con la especificación CRD TestRun del k6-operator con el paralelismo y referencia de script correctos

- [ ] **DST-008** Escritura remota de Prometheus desde runners distribuidos
  - Tipo: K8S
  - Verificar: Ejecutar prueba distribuida; consultar Prometheus en busca de métricas de todos los pods
  - Esperado: Métricas de todos los pods runner agregadas en Prometheus con etiquetas a nivel de pod

---

## 15. Servidor MCP

Exponer el k6 Enterprise Framework a Claude Desktop y otros clientes compatibles con MCP vía el Model Context Protocol.

### Recursos (Solo Lectura)

- [ ] **MCP-001** Recurso `read_config`: leer configuración del cliente (`k6://config/{client}/{env}`)
  - Tipo: CMD
  - Verificar: Construir servidor MCP (`cd mcp-server && npm run build`); probar recurso vía cliente MCP
  - Esperado: Retorna configuración JSON parseada de `clients/{client}/config/{env}.json`

- [ ] **MCP-002** Recurso `list_scenarios`: listar escenarios de prueba del cliente (`k6://scenarios/{client}`)
  - Tipo: CMD
  - Verificar: Consultar `k6://scenarios/_reference` vía cliente MCP
  - Esperado: Retorna array de rutas de escenarios relativas a `clients/{client}/scenarios/`

- [ ] **MCP-003** Recurso `get_metrics`: recuperar métricas de ejecuciones pasadas (`k6://metrics/{test_id}`)
  - Tipo: CMD
  - Verificar: Consultar `k6://metrics/{client}/{scenario}/{timestamp}` después de ejecutar una prueba
  - Esperado: Retorna métricas de `reports/{client}/{scenario}/{timestamp}/k6-summary.json`

### Herramientas (Acciones)

- [ ] **MCP-004** Herramienta `run_test`: ejecutar una prueba de carga k6
  - Tipo: CMD
  - Verificar: Llamar `run_test({ client: "_reference", test: "api/smoke-users", profile: "smoke" })`
  - Esperado: La prueba se ejecuta; retorna `{ status, exitCode, output, reportPath }`

- [ ] **MCP-005** Herramienta `validate_schema`: validar configuración contra esquemas JSON
  - Tipo: CMD
  - Verificar: Llamar `validate_schema({ file: "clients/_reference/config/default.json" })`
  - Esperado: Retorna `{ valid: true, errors: [] }` para configuración válida

- [ ] **MCP-006** Herramienta `generate_scaffold`: generar nuevos artefactos del framework
  - Tipo: CMD
  - Verificar: Llamar `generate_scaffold({ name: "TestService", type: "service", client: "_reference" })`
  - Esperado: Retorna `{ created: ["clients/_reference/lib/services/TestService.ts"] }`

- [ ] **MCP-007** Herramienta `queryKnowledgeBase`: consulta RAG sobre documentación y código del framework
  - Tipo: CMD
  - Verificar: Llamar la herramienta con una consulta sobre una funcionalidad del framework
  - Esperado: Retorna fragmentos de código relevantes y documentación de la base de conocimiento

- [ ] **MCP-008** Herramienta `getObservabilityData`: consultar datos de Prometheus/Loki/Tempo
  - Tipo: CMD + DOCKER
  - Verificar: Llamar la herramienta con rango de tiempo y consulta de métricas
  - Esperado: Retorna datos de observabilidad de los backends configurados

- [ ] **MCP-009** Herramienta `validateGeneratedCode`: validar scripts k6 generados por IA
  - Tipo: CMD
  - Verificar: Llamar la herramienta con contenido TypeScript a validar
  - Esperado: Retorna resultado de validación con errores de sintaxis, imports faltantes, problemas de seguridad

- [ ] **MCP-010** Herramienta `getTestHistory`: recuperar resultados históricos de pruebas
  - Tipo: CMD
  - Verificar: Llamar la herramienta con nombre de cliente y rango de tiempo opcional
  - Esperado: Retorna lista de ejecuciones de prueba pasadas con estado de aprobado/fallido y métricas clave

- [ ] **MCP-011** Herramienta `createJiraTicket`: crear tickets de Jira para pruebas fallidas
  - Tipo: CMD
  - Verificar: Llamar la herramienta con detalles de fallo de prueba y configuración de Jira
  - Esperado: Retorna URL/ID del ticket de Jira (requiere credenciales de Jira configuradas)

---

## 16. Hoja de Ruta IA v2

La versión 2.0 transforma el framework en una **Plataforma Inteligente de Calidad** a través de 4 agentes de IA especializados.

### Agente Planificador

- [ ] **AI-001** Agente planificador: genera TestPlan a partir de especificación OpenAPI
  - Tipo: CMD
  - Verificar: `npx ts-node src/ai/agents/planner-agent.ts --format=openapi --spec=./openapi.json`
  - Esperado: TestPlan JSON generado con endpoints, tipos de prueba, modelos de tráfico

- [ ] **AI-002** Agente planificador: genera TestPlan a partir de lenguaje natural
  - Tipo: CMD
  - Verificar: `npx ts-node src/ai/agents/planner-agent.ts --format=natural-language --spec="E-commerce API with checkout flow"`
  - Esperado: TestPlan JSON generado a partir de descripción textual

- [ ] **AI-003** Agente planificador: maneja OpenAPI incompleto (EC-AI-003)
  - Tipo: MANUAL
  - Verificar: Proporcionar especificación OpenAPI parcial; verificar las advertencias en la salida
  - Esperado: Plan parcial generado con advertencias sobre endpoints/esquemas faltantes

### Agente Constructor

- [ ] **AI-004** Agente constructor: genera scripts k6 TypeScript ejecutables a partir de TestPlan
  - Tipo: CMD
  - Verificar: `npx ts-node src/ai/agents/builder-agent.ts --plan=./test-plan.json`
  - Esperado: Archivos `.ts` generados; compilan sin errores; usan helpers del framework (RequestHelper, etc.)

- [ ] **AI-005** Agente constructor: tasa de éxito >= 95% (SC-100)
  - Tipo: MANUAL
  - Verificar: Ejecutar el constructor contra 12 fixtures de TestPlan; contar generaciones exitosas
  - Esperado: Al menos 12/12 (o mínimo 11/12) generan scripts válidos y ejecutables

- [ ] **AI-006** Agente constructor: auto-corrección hasta 3 ciclos
  - Tipo: MANUAL
  - Verificar: Proporcionar TestPlan que produce salida inicialmente inválida; verificar comportamiento de reintento
  - Esperado: El constructor reintenta hasta 3 veces con auto-corrección antes de fallar

### Agente Analista

- [ ] **AI-007** Agente analista: correlación de causa raíz desde datos k6 + observabilidad
  - Tipo: CMD
  - Verificar: `npx ts-node src/ai/agents/analyst-agent.ts --results=./summary.json --from=-1h`
  - Esperado: AnalysisReport con anomalías, correlaciones, regresiones, recomendaciones

- [ ] **AI-008** Detector de anomalías: detección estadística (z-score, IQR, CUSUM, percentil)
  - Tipo: CMD
  - Verificar: `npx ts-node src/ai/analysis/anomaly-detector.ts --metrics=./summary.json --baseline-runs=10`
  - Esperado: Detección de anomalías determinista (sin LLM) con anomalías puntuadas

- [ ] **AI-009** Agente analista: comparación con el mejor histórico
  - Tipo: MANUAL
  - Verificar: Ejecutar el analista con múltiples resultados históricos disponibles
  - Esperado: El reporte incluye análisis de regresión vs las mejores métricas históricas

### Agente Reportero

- [ ] **AI-010** Agente reportero: generación de resumen ejecutivo + técnico
  - Tipo: CMD
  - Verificar: Ejecutar el pipeline completo o el agente reportero de forma independiente
  - Esperado: Resumen ejecutivo (no técnico) y resumen técnico (detallado) generados

- [ ] **AI-011** Agente reportero: notificaciones multi-canal (Slack, Teams, Jira)
  - Tipo: CONFIG
  - Verificar: Configurar canales de notificación; ejecutar pipeline con `--notify=slack,jira`
  - Esperado: Notificaciones enviadas a los canales configurados con resultados de prueba enriquecidos

### Orquestador de Pipeline

- [ ] **AI-012** Pipeline completo: Planificador -> Constructor -> run_test -> Analista -> Reportero
  - Tipo: CMD
  - Verificar: `node cmd/ai-pipeline.js --client=acme-corp --spec=./openapi.json --format=openapi --notify=slack`
  - Esperado: El pipeline completo se ejecuta de extremo a extremo; reporte generado; notificaciones enviadas

---

## Resumen Final

### Seguimiento de Completitud

| Estado | Cantidad |
|--------|----------|
| Total de elementos | 194 |
| Verificados | ___ |
| Fallidos | ___ |
| Omitidos | ___ |
| N/A | ___ |

### Completitud por Categoría

| Categoría | Estado |
|-----------|--------|
| Perfiles de Carga (9) | ________ |
| Helpers (14) | ________ |
| Patrones y Puntos de Extensión (13) | ________ |
| Motor de Métricas (25) | ________ |
| Reportes (25) | ________ |
| Dashboards de Grafana (9) | ________ |
| Métricas Personalizadas (8) | ________ |
| Análisis de Grupos (6) | ________ |
| SLA/SLO (10) | ________ |
| Seguridad (14) | ________ |
| Integración CI/CD (10) | ________ |
| Observabilidad (12) | ________ |
| Generadores (8) | ________ |
| Pruebas Distribuidas (8) | ________ |
| Servidor MCP (11) | ________ |
| Hoja de Ruta IA v2 (12) | ________ |

### Registro de Auditoría

| Campo | Valor |
|-------|-------|
| **Auditor** | ________________ |
| **Fecha** | ________________ |
| **Versión del Framework** | ________________ |
| **Entorno** | ________________ |
| **Versión de k6** | ________________ |
| **Versión de Node.js** | ________________ |
| **Versión de Docker** | ________________ |
| **Versión de Kubernetes** | ________________ (si aplica) |
| **Resultado General** | APROBADO / FALLIDO / PARCIAL |
| **Notas** | ________________ |

---

> **Documento generado**: 2026-02-23
> **Framework**: k6 Enterprise Load Testing Framework
> **Total de elementos verificables**: 194
