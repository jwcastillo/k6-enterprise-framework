> [English](README.md) | **Español**

# k6 Enterprise Framework — Escenarios de Ejemplo (T-157 / T-175)

Cliente de referencia que demuestra las funcionalidades del framework en todos los protocolos y patrones soportados.
Los escenarios estan organizados por complejidad: **Basico -> Intermedio -> Avanzado**.

---

## Inicio Rapido

```bash
# Ejecutar todos los ejemplos (perfil smoke)
./bin/run-all-tests.sh --client=examples --profile=smoke

# Ejecutar todos en paralelo
./bin/run-all-tests.sh --client=examples --parallel --concurrency=4

# Ejecutar un escenario individual
./bin/run-test.sh --client=examples --scenario=api/01-auth-bearer --profile=smoke
```

---

## Indice de Escenarios

| # | Archivo | Executor | Protocolo | Nivel | Demuestra | CLI |
|---|---------|----------|-----------|-------|-----------|-----|
| 01 | `api/01-auth-bearer.ts` | constant-vus | HTTP | Basico | Auth Bearer, AuthPattern | `--scenario=api/01-auth-bearer` |
| 02 | `api/02-contract-validation.ts` | constant-vus | HTTP | Basico | Validacion de contrato JSON schema | `--scenario=api/02-contract-validation` |
| 03 | `api/03-pagination.ts` | constant-vus | HTTP | Basico | Paginacion cursor/offset | `--scenario=api/03-pagination` |
| 04 | `api/04-retry-backoff.ts` | constant-vus | HTTP | Intermedio | Backoff exponencial, reintentos | `--scenario=api/04-retry-backoff` |
| 05 | `api/05-correlation.ts` | constant-vus | HTTP | Intermedio | Extraccion de tokens, encadenamiento | `--scenario=api/05-correlation` |
| 06 | `api/06-weighted-execution.ts` | constant-vus | HTTP | Intermedio | Distribucion ponderada de escenarios | `--scenario=api/06-weighted-execution` |
| 07 | `api/07-structured-logging.ts` | constant-vus | HTTP | Intermedio | Logs JSON estructurados | `--scenario=api/07-structured-logging` |
| 08 | `api/08-rate-limiting.ts` | constant-vus | HTTP | Intermedio | Manejo de 429, deteccion de throttle | `--scenario=api/08-rate-limiting` |
| 09 | `mixed/09-ecommerce-flow.ts` | ramping-vus | HTTP | Avanzado | Flujo de usuario multi-paso | `--scenario=mixed/09-ecommerce-flow` |
| 10 | `api/10-graphql.ts` | constant-vus | GraphQL | Avanzado | Query + mutation, variables | `--scenario=api/10-graphql` |
| 11 | `api/11-file-upload.ts` | constant-vus | HTTP | Avanzado | Upload multipart/form-data | `--scenario=api/11-file-upload` |
| 12 | `integration/12-websocket.ts` | constant-vus | WebSocket | Avanzado | Connect, send, receive, close | `--scenario=integration/12-websocket` |
| 13 | `mixed/13-multi-protocol.ts` | ramping-vus | HTTP+WS | Avanzado | Carga de trabajo multi-protocolo | `--scenario=mixed/13-multi-protocol` |
| 14 | `api/14-advanced-headers.ts` | constant-vus | HTTP | Intermedio | Headers custom, tracing | `--scenario=api/14-advanced-headers` |
| 15 | `integration/15-smoke-baseline.ts` | constant-vus | HTTP | Basico | Smoke baseline (gate CI) | `--scenario=integration/15-smoke-baseline` |
| 16 | `integration/16-sli-monitoring.ts` | ramping-vus | HTTP | Avanzado | Tracking de SLIs, thresholds SLO, error budget | `--scenario=integration/16-sli-monitoring` |
| 99 | `mixed/99-full-dashboard-demo.ts` | constant-vus | HTTP+Browser | Avanzado | Grupos, Metricas Custom, Web Vitals, thresholds SLA | `--scenario=mixed/99-full-dashboard-demo` |

---

## Guia de Complejidad

### Basico (1-3): Verifica que tu entorno funciona

```bash
./bin/run-test.sh --client=examples --scenario=api/01-auth-bearer --profile=smoke
```

### Intermedio (4-8, 14): Patrones HTTP comunes

Logica de reintentos, correlacion, rate limiting y patrones de logging usados en servicios reales.

### Avanzado (9-13, 99): Flujos multi-paso y protocolos

Flujos de usuario completos, GraphQL, WebSockets, cargas multi-protocolo y el demo completo del dashboard con grupos, metricas custom y Web Vitals.

---

## Demo Completo del Dashboard (99)

El escenario `99-full-dashboard-demo` ejercita TODOS los paneles del reporte y dashboards Grafana:

```bash
./bin/run-test.sh --client=examples --scenario=mixed/99-full-dashboard-demo --profile=smoke
```

Incluye: 5 grupos con checks, 6 metricas custom (2 Counters, 2 Trends, Rate, Gauge), Web Vitals via Chromium, y thresholds SLA con mix de pass/fail.

---

## Integracion de Observabilidad

Los escenarios 09 y 16 incluyen instrumentacion completa de observabilidad (trazas, logs, profiling). Para enviar datos al stack de observabilidad:

```bash
# 1. Iniciar el stack de observabilidad
docker compose --profile observability up -d

# 2. Ejecutar con observabilidad completa
./bin/run-test.sh --client=examples --scenario=integration/16-sli-monitoring \
  --profile=smoke --observability

# 3. Ver datos en Grafana (http://localhost:3000):
#    - Prometheus: metricas k6_* + metricas SLI custom
#    - Loki: logs estructurados del test con labels (client, profile, env)
#    - Tempo: trazas distribuidas con propagacion W3C
#    - Pyroscope: datos de profiling via headers X-Pyroscope
```

### Flags de Observabilidad

| Flag | Descripcion |
|------|-------------|
| `--prometheus` | Enviar metricas via Prometheus remote-write |
| `--loki` | Enviar logs a Loki (reemplaza salida a archivo) |
| `--tempo` | Enviar trazas a Tempo via OTLP gRPC |
| `--otel` | Enviar metricas via OpenTelemetry |
| `--observability` | Habilitar TODOS: Prometheus + Loki + Tempo + OTEL |

---

## Mejores Practicas

- Siempre ejecutar `npm run build` despues de cambios en el codigo
- Comenzar con `--profile=smoke` para verificar que el escenario funciona
- Usar `--profile=quick` en pipelines CI para feedback rapido (< 3 min)
- Revisar el reporte HTML en `reports/examples/<escenario>/` despues de cada ejecucion
- Usar `--observability` para enviar datos al stack de Grafana para analisis visual
