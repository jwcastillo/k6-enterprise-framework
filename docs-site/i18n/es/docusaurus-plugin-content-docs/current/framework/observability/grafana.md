---
title: "Guia de Observabilidad con Grafana"
sidebar_position: 1
---
# Guia de Observabilidad con Grafana

k6 Enterprise Framework — Dashboards de Grafana, variables de plantilla y referencia PromQL.

---

## Inicio Rapido

```bash
# 1. Iniciar el stack de observabilidad
docker compose --profile observability up -d

# 2. Abrir Grafana
open http://localhost:3000
# Credenciales por defecto: admin / admin

# 3. Ejecutar un test con observabilidad completa (metricas + logs + trazas + profiling)
./bin/run-test.sh --client=examples --scenario=integration/16-sli-monitoring \
  --profile=smoke --observability

# 4. Navegar a: Dashboards → k6 Load Test Overview
# Las metricas aparecen en ~15 segundos desde el inicio del test
```

> **Nuevo:** Usa `--observability` para enviar datos a Prometheus, Loki, Tempo y Pyroscope en un solo comando.

---

## Prerequisitos: Habilitar Exportacion a Prometheus

Agrega `metricsBackends` en el `config.json` (o `config.yaml`) de tu cliente:

```json
{
  "scenarios": { ... },
  "metricsBackends": [
    { "type": "prometheus" }
  ]
}
```

Esto exporta todas las metricas de k6 a Prometheus en el puerto `5656` (objetivo de scraping preconfigurado en el stack).

El framework inyecta automaticamente **4 etiquetas personalizadas** en cada metrica exportada:

| Etiqueta | Variable de entorno | Valor de ejemplo |
|----------|-------------------|-----------------|
| `test_name` | `K6_TEST_NAME` | `auth-flow` |
| `test_timestamp` | `K6_TEST_TIMESTAMP` | `20260218-143052` |
| `client` | `K6_CLIENT` | `my-team` |
| `environment` | `K6_ENVIRONMENT` | `staging` |

Estas etiquetas se configuran automaticamente por `run-test.sh` — no requiere configuracion manual.

---

## Dashboards

El framework incluye **3 dashboards preconstruidos**, cada uno disenado para un caso de uso diferente. Todos se provisionan automaticamente y comparten las mismas variables de plantilla.

| Dashboard | Archivo | Ideal Para |
|-----------|---------|------------|
| **k6 Load Test Overview** | `k6-load-test-overview.json` | Monitoreo diario de pruebas de carga |
| **k6 Enterprise Analytics** | `k6-enterprise-analytics.json` | Cumplimiento de SLA, reportes ejecutivos, deteccion de anomalias |
| **k6 Web Vitals** | `k6-web-vitals.json` | Pruebas basadas en navegador con Core Web Vitals |

---

### Dashboard 1: k6 Load Test Overview

El dashboard operativo principal. Proporciona una vista integral de la ejecucion de una prueba de carga con metricas en tiempo real.

**Archivo:** `infrastructure/grafana/dashboards/k6-load-test-overview.json`

#### Fila Overview (Resumen)

Estadisticas de resumen de nivel superior mostradas como paneles stat y gauges:

| Panel | Tipo | Descripcion |
|-------|------|-------------|
| Active VUs | stat | Numero actual de usuarios virtuales activos |
| HTTP Request Rate | stat | Solicitudes por segundo |
| p95 Response Time | stat | Tiempo de respuesta en el percentil 95 (ms) |
| Error Rate | stat | Porcentaje de solicitudes HTTP fallidas |
| Check Pass Rate | gauge | Porcentaje de checks de k6 que pasan |

#### Fila Virtual Users & Throughput

| Panel | Descripcion |
|-------|-------------|
| Virtual Users Over Time | Serie temporal de VUs activos durante la prueba |
| Iterations Over Time | Iteraciones completadas por segundo |
| HTTP Request Rate | Serie temporal de RPS con ventana deslizante |

#### Fila Latency Percentiles

| Panel | Descripcion |
|-------|-------------|
| Response Time Percentiles | p50, p90, p95, p99 superpuestos en un solo grafico |
| Request Duration Breakdown | Desglose por fase de solicitud: DNS, TLS, connect, waiting, receiving |

#### Fila Errors & Checks

| Panel | Descripcion |
|-------|-------------|
| HTTP Error Rate | Solicitudes fallidas como porcentaje a lo largo del tiempo |
| Check Pass / Fail Rate | Tasas de checks que pasan y fallan a lo largo del tiempo |

#### Fila Data Transfer

| Panel | Descripcion |
|-------|-------------|
| Network Throughput | Datos enviados y recibidos (bytes/s) a lo largo del tiempo |

#### Fila Groups Analysis (colapsada)

Rendimiento de grupos detectados automaticamente. Expandir para ver:

| Panel | Descripcion |
|-------|-------------|
| Group Duration -- p95 by Group | Bar gauge mostrando latencia p95 por grupo |
| Group Duration -- Avg by Group | Bar gauge mostrando latencia promedio por grupo |
| Group Performance Breakdown | Tabla con avg, p90, p95, p99 por grupo |
| Group Duration Over Time | Serie temporal de p95 por grupo a lo largo del tiempo |

#### Fila Custom Metrics (colapsada)

Metricas personalizadas detectadas automaticamente. Expandir para ver:

| Panel | Descripcion |
|-------|-------------|
| Custom Trends -- p95 | Bar gauge de valores p95 para metricas Trend personalizadas |
| Custom Counters | Bar gauge de totales para metricas Counter personalizadas |
| Custom Rates & Gauges | Bar gauge de valores de metricas Rate y Gauge personalizadas |
| Custom Metrics Over Time | Serie temporal de todas las metricas personalizadas |

---

### Dashboard 2: k6 Enterprise Analytics

Un dashboard de analisis avanzado orientado a lideres de ingenieria y stakeholders. Agrega seguimiento de cumplimiento de SLA, puntuacion APDEX y deteccion de anomalias sobre las metricas principales.

**Archivo:** `infrastructure/grafana/dashboards/k6-enterprise-analytics.json`

#### Fila Executive Summary

| Panel | Tipo | Descripcion |
|-------|------|-------------|
| Active VUs | gauge | Usuarios virtuales actuales con umbral visual |
| Request Rate | stat | RPS actual |
| p95 Response | stat | Latencia en el percentil 95 |
| p99 Response | stat | Latencia en el percentil 99 |
| Error Rate % | stat | Porcentaje de solicitudes fallidas |
| Check Pass % | gauge | Tasa de checks aprobados con indicadores de umbral |
| APDEX Score | gauge | Indice de Rendimiento de Aplicacion (0-1) |
| Throughput | stat | Throughput total de datos |

#### Fila SLA Compliance & Anomaly Detection

| Panel | Descripcion |
|-------|-------------|
| SLA Compliance | Tabla mostrando metrica, objetivo, valor real y estado de cumplimiento |
| Anomaly Detection -- Latency vs SLA | Serie temporal superponiendo latencia real contra lineas de umbral SLA |

#### Fila Latency Analysis

| Panel | Descripcion |
|-------|-------------|
| Percentiles Over Time | Series temporales de p50, p90, p95, p99 |
| Latency Distribution | Bar gauge mostrando la distribucion de percentiles de latencia |
| Request Phase Breakdown | Desglose en serie temporal: DNS lookup, TLS handshake, connect, waiting, receiving |

#### Fila Errors & Checks

| Panel | Descripcion |
|-------|-------------|
| Error Rate Over Time | Serie temporal del porcentaje de errores HTTP |
| Check Pass Rate Over Time | Serie temporal de tasa de checks aprobados |
| Per-Check Breakdown | Tabla listando cada nombre de check con conteos de pasa/falla |

#### Fila Virtual Users & Throughput

| Panel | Descripcion |
|-------|-------------|
| VUs Over Time | Serie temporal de VUs activos |
| Request Rate Over Time | Serie temporal de RPS |
| Iteration Duration | Tiempo por iteracion a lo largo del tiempo |

#### Fila Network & Connection

| Panel | Descripcion |
|-------|-------------|
| Data Transfer | Bytes enviados/recibidos a lo largo del tiempo |
| Connection Overhead | Tiempos de TLS handshake y TCP connect |

#### Fila Groups Analysis (colapsada)

Mismos paneles de analisis de grupos que el dashboard Overview:

| Panel | Descripcion |
|-------|-------------|
| Group Duration -- p95 by Group | Bar gauge de p95 por grupo |
| Group Duration -- Avg by Group | Bar gauge de promedio por grupo |
| Group Performance Breakdown | Tabla con avg, p90, p95, p99 por grupo |
| Group Duration Over Time | p95 por grupo a lo largo del tiempo |

#### Fila Custom Metrics (colapsada)

Mismos paneles de metricas personalizadas que el dashboard Overview:

| Panel | Descripcion |
|-------|-------------|
| Custom Trends -- p95 | Valores p95 para metricas Trend personalizadas |
| Custom Counters | Totales para metricas Counter personalizadas |
| Custom Rates & Gauges | Valores de metricas Rate y Gauge personalizadas |
| Custom Metrics Over Time | Todas las metricas personalizadas a lo largo del tiempo |

---

### Dashboard 3: k6 Web Vitals

Disenado para pruebas de carga basadas en navegador usando el modulo browser de k6. Rastrea Core Web Vitals junto con metricas de carga estandar.

**Archivo:** `infrastructure/grafana/dashboards/k6-web-vitals.json`

> **Nota:** Este dashboard requiere pruebas que usen el modulo browser de k6 y emitan metricas de web vitals (`browser_web_vital_lcp`, `browser_web_vital_fcp`, etc.).

#### Fila Core Web Vitals -- Gauges (p90)

Cada metrica se muestra como un gauge con umbrales codificados por color (Bueno / Necesita Mejora / Pobre):

| Panel | Metrica | Bueno | Necesita Mejora | Pobre |
|-------|---------|-------|----------------|-------|
| LCP (Largest Contentful Paint) | `browser_web_vital_lcp` | < 2500ms | 2500-4000ms | > 4000ms |
| FCP (First Contentful Paint) | `browser_web_vital_fcp` | < 1800ms | 1800-3000ms | > 3000ms |
| INP (Interaction to Next Paint) | `browser_web_vital_inp` | < 200ms | 200-500ms | > 500ms |
| CLS (Cumulative Layout Shift) | `browser_web_vital_cls` | < 0.1 | 0.1-0.25 | > 0.25 |
| TTFB (Time to First Byte) | `browser_web_vital_ttfb` | < 800ms | 800-1800ms | > 1800ms |

#### Fila Web Vitals Over Time

| Panel | Descripcion |
|-------|-------------|
| LCP & FCP Over Time | Tendencias de Largest Contentful Paint y First Contentful Paint |
| INP Over Time | Interaction to Next Paint a lo largo del tiempo |
| TTFB Over Time | Time to First Byte a lo largo del tiempo |
| CLS Over Time | Cumulative Layout Shift a lo largo del tiempo |

#### Fila Web Vitals by Page URL

| Panel | Descripcion |
|-------|-------------|
| Web Vitals Breakdown by URL | Tabla mostrando LCP, FCP, INP, CLS, TTFB por URL de pagina |

#### Fila Concurrent Load Metrics

Metricas de carga estandar para contextualizar los web vitals:

| Panel | Descripcion |
|-------|-------------|
| VUs & Iterations | Usuarios virtuales e iteraciones a lo largo del tiempo |
| HTTP Request Rate | Solicitudes por segundo |
| HTTP Response Times (p90, p95) | Percentiles de tiempo de respuesta |
| Error Rate (%) | Porcentaje de errores HTTP a lo largo del tiempo |

---

## Variables de Plantilla

Los tres dashboards comparten los mismos 4 filtros desplegables en la parte superior. Usalos para segmentar y comparar ejecuciones:

| Variable | Etiqueta | Descripcion |
|----------|----------|-------------|
| `$test_name` | Test Name | Filtrar por nombre de escenario (ej. `auth-flow`) |
| `$client` | Client | Filtrar por directorio de cliente (ej. `my-team`) |
| `$environment` | Environment | Filtrar por entorno objetivo (ej. `staging`, `production`) |
| `$test_timestamp` | Timestamp | Filtrar por timestamp de ejecucion — soporta seleccion multiple |

**Como se pueblan las variables**: Cada desplegable usa una consulta `label_values()` contra Prometheus. Se pueblan automaticamente despues de la primera ejecucion de prueba que exporta metricas.

> **Sin datos en los desplegables?**
>
> No se encontraron ejecuciones de prueba. Ejecuta un test con etiquetas de Prometheus para poblar este dashboard:
> ```bash
> ./bin/run-test.sh --client=_reference --scenario=api/smoke-users --profile=smoke
> ```
> Luego espera ~15 segundos para que Prometheus recopile las primeras metricas.

### Comparar Dos Ejecuciones

1. Haz clic en el desplegable **Timestamp**
2. Habilita **multi-value** (el toggle en el editor de variables, o manten Ctrl/Cmd y haz clic en dos valores)
3. Todos los paneles muestran ambas ejecuciones superpuestas — la leyenda muestra el timestamp de cada serie

---

## Metricas Personalizadas en Dashboards

La fila Custom Metrics (presente tanto en el dashboard Overview como en Enterprise Analytics) **detecta automaticamente** cualquier metrica personalizada que definas en tus tests y las muestra sin necesidad de configurar el dashboard.

### Como k6 Exporta Metricas Personalizadas a Prometheus

Cuando k6 exporta metricas a Prometheus, cada tipo de metrica produce series temporales especificas:

| Tipo de Metrica k6 | Serie de Prometheus | Ejemplo |
|--------------------|---------------------|---------|
| `Trend` | `k6_<nombre>_avg`, `k6_<nombre>_min`, `k6_<nombre>_med`, `k6_<nombre>_max`, `k6_<nombre>_p90`, `k6_<nombre>_p95`, `k6_<nombre>_p99` | `k6_my_api_latency_p95` |
| `Counter` | `k6_<nombre>_total` | `k6_payment_count_total` |
| `Rate` | `k6_<nombre>_rate` | `k6_login_success_rate` |
| `Gauge` | `k6_<nombre>` | `k6_queue_depth` |

### Paneles de Auto-Deteccion

Tres paneles de bar gauge detectan automaticamente metricas personalizadas usando coincidencia regex de `__name__`:

| Panel | Coincide Con | Patron de Consulta |
|-------|-------------|-------------------|
| **Custom Trends -- p95** | `k6_*_p95` (excluyendo built-ins) | `{__name__=~"k6_.+_p95", __name__!~"k6_http_req.*\|k6_iteration.*\|..."}` |
| **Custom Counters** | `k6_*_total` (excluyendo built-ins) | `{__name__=~"k6_.+_total", __name__!~"k6_http_req.*\|k6_http_reqs.*\|..."}` |
| **Custom Rates & Gauges** | `k6_*_rate` + gauges sin procesar (excluyendo built-ins) | `{__name__=~"k6_.+_rate", __name__!~"..."}` combinado con consulta de gauge |

### Regex de Exclusion

El regex de exclusion filtra todas las metricas integradas de k6 para que solo aparezcan tus metricas personalizadas:

```
k6_http_req.*|k6_http_reqs.*|k6_iteration.*|k6_group_duration.*|k6_browser.*|k6_vus.*|k6_data_.*|k6_checks.*|k6_grpc_.*|k6_ws_.*
```

### Transformacion de Visualizacion

El panel Custom Rates & Gauges usa una transformacion `renameByRegex` para producir nombres de visualizacion limpios:

- **Regex:** `k6_(.+?)(?:_rate)?$`
- **Patron de renombrado:** `$1`

Esto elimina el prefijo `k6_` y el sufijo opcional `_rate` para que `k6_login_success_rate` se muestre como `login_success`.

---

## Analisis de Grupos en Dashboards

La fila Groups Analysis (presente tanto en el dashboard Overview como en Enterprise Analytics) **detecta automaticamente** los grupos de k6 y visualiza sus tiempos.

### Como se Detectan los Grupos

Los grupos de k6 producen metricas `group_duration` con una etiqueta `group`. Al exportarse a Prometheus, se convierten en:

```
k6_group_duration_avg{group="Login Flow", ...}
k6_group_duration_p90{group="Login Flow", ...}
k6_group_duration_p95{group="Login Flow", ...}
k6_group_duration_p99{group="Login Flow", ...}
```

Los paneles consultan `group=~".+"` para detectar automaticamente todos los grupos.

### Paneles

| Panel | PromQL | Descripcion |
|-------|--------|-------------|
| Group Duration -- p95 by Group | `avg by (group)(last_over_time(k6_group_duration_p95{...}[$__range]))` | Bar gauge de p95 por grupo |
| Group Duration -- Avg by Group | `avg by (group)(last_over_time(k6_group_duration_avg{...}[$__range]))` | Bar gauge de promedio por grupo |
| Group Performance Breakdown | Multiples consultas: avg, p90, p95, p99 | Tabla con todos los percentiles por grupo |
| Group Duration Over Time | `avg by (group)(k6_group_duration_p95{...})` | Serie temporal rastreando p95 por grupo |

### Prerequisito: Inyeccion Sintetica de Threshold

Para que las metricas de grupo se exporten a Prometheus, k6 requiere al menos un threshold que referencie `group_duration`. El script `run-test.sh` maneja esto automaticamente inyectando un threshold sintetico:

```javascript
// Inyectado por run-test.sh cuando la exportacion a Prometheus esta habilitada
thresholds: {
  'group_duration': ['avg>=0']  // Threshold que siempre pasa para asegurar la exportacion
}
```

Sin este threshold, k6 no exporta metricas `group_duration` al endpoint de Prometheus. Si ejecutas pruebas con `k6 run` directamente (sin usar `run-test.sh`), debes agregar este threshold manualmente a las opciones de tu test.

---

## Referencia PromQL

Todas las consultas a continuacion usan las 4 etiquetas personalizadas para filtrado. Copia y pega directamente en la vista **Explore** de Grafana o en el editor de paneles.

### 1. Tiempo de Respuesta p95 por Ejecucion

```promql
histogram_quantile(
  0.95,
  sum by (le, test_name, test_timestamp) (
    rate(k6_http_req_duration_bucket{
      test_name=~"$test_name",
      client=~"$client",
      environment=~"$environment",
      test_timestamp=~"$test_timestamp"
    }[1m])
  )
)
```

> Muestra el tiempo de respuesta en el percentil 95 en milisegundos. Usa esto para detectar regresiones de latencia entre ejecuciones.

---

### 2. Tasa de Solicitudes HTTP (RPS)

```promql
sum by (test_name, test_timestamp) (
  rate(k6_http_reqs_total{
    test_name=~"$test_name",
    client=~"$client",
    environment=~"$environment",
    test_timestamp=~"$test_timestamp"
  }[1m])
)
```

> Solicitudes por segundo en una ventana deslizante de 1 minuto, agrupadas por ejecucion. Compara el throughput entre ejecuciones.

---

### 3. Tasa de Errores HTTP (%)

```promql
100 * sum by (test_name, test_timestamp) (
  rate(k6_http_req_failed_total{
    test_name=~"$test_name",
    client=~"$client",
    environment=~"$environment",
    test_timestamp=~"$test_timestamp"
  }[1m])
)
/
sum by (test_name, test_timestamp) (
  rate(k6_http_reqs_total{
    test_name=~"$test_name",
    client=~"$client",
    environment=~"$environment",
    test_timestamp=~"$test_timestamp"
  }[1m])
)
```

> Porcentaje de errores (0-100). Alerta cuando supere tu umbral de SLO (ej. `> 1`).

---

### 4. Usuarios Virtuales Activos a lo Largo del Tiempo

```promql
k6_vus{
  test_name=~"$test_name",
  client=~"$client",
  environment=~"$environment",
  test_timestamp=~"$test_timestamp"
}
```

> Numero actual de VUs activos. Util para correlacionar picos de latencia con fases de ramp-up/ramp-down.

---

### 5. Tasa de Checks Aprobados (%)

```promql
100 * sum by (test_name, test_timestamp) (
  rate(k6_checks_total{
    result="pass",
    test_name=~"$test_name",
    client=~"$client",
    environment=~"$environment",
    test_timestamp=~"$test_timestamp"
  }[1m])
)
/
sum by (test_name, test_timestamp) (
  rate(k6_checks_total{
    test_name=~"$test_name",
    client=~"$client",
    environment=~"$environment",
    test_timestamp=~"$test_timestamp"
  }[1m])
)
```

> Porcentaje de checks (aserciones) de k6 que pasaron. Un valor inferior al 100% indica fallos de logica de negocio — no solo errores HTTP.

---

### 6. Metrica Trend Personalizada (p95)

```promql
max by (__name__)(
  last_over_time({
    __name__=~"k6_.+_p95",
    __name__!~"k6_http_req.*|k6_iteration.*|k6_group_duration.*|k6_browser.*|k6_vus.*|k6_data_.*|k6_checks.*|k6_grpc_.*|k6_ws_.*|k6_http_reqs.*",
    test_name=~"$test_name",
    client=~"$client",
    environment=~"$environment",
    test_timestamp=~"$test_timestamp"
  }[$__range])
)
```

> Retorna el valor p95 para cada metrica Trend personalizada, excluyendo todas las metricas integradas de k6. Cada serie resultado se etiqueta por `__name__`.

---

### 7. Duracion de Grupo (p95) por Grupo

```promql
avg by (group)(
  last_over_time(
    k6_group_duration_p95{
      test_name=~"$test_name",
      client=~"$client",
      environment=~"$environment",
      test_timestamp=~"$test_timestamp",
      group=~".+"
    }[$__range]
  )
)
```

> Retorna la duracion de grupo p95 para cada grupo detectado. Reemplaza `_p95` con `_avg`, `_p90` o `_p99` para otros percentiles.

---

### Consultas Utiles Adicionales

**Comparacion de latencia p50 / p99:**
```promql
histogram_quantile(0.50, sum by (le, test_timestamp) (rate(k6_http_req_duration_bucket{test_name=~"$test_name", client=~"$client"}[1m])))
histogram_quantile(0.99, sum by (le, test_timestamp) (rate(k6_http_req_duration_bucket{test_name=~"$test_name", client=~"$client"}[1m])))
```

**Datos recibidos / enviados (bytes/s):**
```promql
rate(k6_data_received_total{test_name=~"$test_name", client=~"$client", test_timestamp=~"$test_timestamp"}[1m])
rate(k6_data_sent_total{test_name=~"$test_name", client=~"$client", test_timestamp=~"$test_timestamp"}[1m])
```

**Totales de Counters personalizados:**
```promql
sum by (__name__)(
  last_over_time({
    __name__=~"k6_.+_total",
    __name__!~"k6_http_req.*|k6_http_reqs.*|k6_data_.*|k6_iterations.*|k6_iteration_duration.*|k6_browser_.*|k6_vus.*|k6_checks.*|k6_grpc_.*|k6_ws_.*|k6_group_duration.*",
    test_name=~"$test_name",
    client=~"$client",
    environment=~"$environment",
    test_timestamp=~"$test_timestamp"
  }[$__range])
)
```

**Tabla de rendimiento de grupo (todos los percentiles):**
```promql
avg by (group)(last_over_time(k6_group_duration_avg{test_name=~"$test_name", group=~".+"}[$__range]))
avg by (group)(last_over_time(k6_group_duration_p90{test_name=~"$test_name", group=~".+"}[$__range]))
avg by (group)(last_over_time(k6_group_duration_p95{test_name=~"$test_name", group=~".+"}[$__range]))
avg by (group)(last_over_time(k6_group_duration_p99{test_name=~"$test_name", group=~".+"}[$__range]))
```

**Verificar que las etiquetas personalizadas estan presentes (verificacion de sanidad):**
```promql
{test_name!=""}
```
> Retorna todas las metricas que tienen una etiqueta `test_name` — confirma que Prometheus esta recibiendo metricas etiquetadas de k6.

---

## Flujo de Datos de Observabilidad

El framework envia datos a cuatro backends via flags del CLI `run-test.sh`:

```
┌──────────┐     --prometheus     ┌─────────────┐
│          │ ──────────────────── │ Prometheus   │ ── Metricas (PromQL)
│          │     --loki           ├─────────────┤
│   k6     │ ──────────────────── │ Loki         │ ── Logs (LogQL)
│  runner  │     --tempo          ├─────────────┤
│          │ ──────────────────── │ Tempo        │ ── Trazas (TraceQL)
│          │     (headers)        ├─────────────┤
│          │ ──────────────────── │ Pyroscope    │ ── Perfiles
└──────────┘                      └──────┬──────┘
                                         │
                                    ┌────▼────┐
                                    │ Grafana  │ ── Vista unificada
                                    └─────────┘
```

### Habilitando Cada Salida

| Flag | Mecanismo k6 | Backend | Tipo de Datos |
|------|-------------|---------|---------------|
| `--prometheus` | `--out experimental-prometheus-rw` | Prometheus | Metricas (remote-write) |
| `--loki` | `--log-output loki=URL,...` | Loki | Logs estructurados con labels |
| `--tempo` | `--traces-output otel` (OTLP gRPC) | Tempo | Trazas distribuidas |
| `--otel` | `--out experimental-opentelemetry` | Colector OTEL | Metricas via OTLP |
| `--observability` | Todos los anteriores | Todos los backends | Pipeline completo |

### Cross-Linking Entre Datasources

Los datasources de Grafana estan preconfigurados para referencias cruzadas:

| Desde | Hacia | Mecanismo |
|-------|-------|-----------|
| Loki → Tempo | Campo `trace_id` en logs JSON | Campos derivados regex: `"trace_id":"([^"]+)"` |
| Tempo → Loki | Labels de contexto de traza | `tracesToLogsV2` con tags `client`, `environment` |
| Prometheus → Tempo | IDs de traza en exemplars | `exemplarTraceIdDestinations` → `trace_id` |

### Ejemplo: Ejecucion con Observabilidad Completa

```bash
# Iniciar el stack
docker compose --profile observability up -d

# Ejecutar con todas las salidas habilitadas
./bin/run-test.sh --client=examples --scenario=integration/16-sli-monitoring \
  --profile=smoke --observability

# Verificar datos en Grafana:
#   Explore → Prometheus: consultar metricas k6_*
#   Explore → Loki: {client="examples"} para ver logs del test
#   Explore → Tempo: buscar trazas por nombre de servicio
#   Explore → Pyroscope: ver datos de profiling
```

### Versiones del Stack

| Componente | Version |
|------------|---------|
| Grafana | 12.4.0 |
| Prometheus | v3.10.0 |
| Loki | 3.6.7 |
| Tempo | 2.10.1 |
| Pyroscope | 1.18.1 |
| k6 | 1.6.1 |

---

## Solucion de Problemas "Sin Datos"

| Sintoma | Causa | Solucion |
|---------|-------|----------|
| Desplegables vacios | No hay ejecucion de test aun | Ejecuta un test: `./bin/run-test.sh --client=_reference --scenario=api/smoke-users --profile=smoke` |
| Desplegables vacios despues de ejecutar | `metricsBackends` no configurado | Agrega `"metricsBackends": [{"type": "prometheus"}]` a `config.json` |
| Paneles muestran "No data" | Filtro de variable incorrecto | Configura todos los desplegables en `All` y verifica el data source de Prometheus en Explore |
| Metricas sin etiquetas | `K6_CLIENT` / `K6_ENVIRONMENT` no configurados | Estos se configuran automaticamente por `run-test.sh`; verifica que estas usando el runner, no llamando a `k6 run` directamente |
| Prometheus no recopila | Stack no esta corriendo | Ejecuta `docker compose --profile observability ps` — todos los servicios deben estar en estado `running` |
| Datos dejan de aparecer | Test termino; `refresh` es `5s` | Normal — los paneles muestran los ultimos valores conocidos despues de que el test finaliza |
| Fila de Groups vacia | No hay grupos en el test | Agrega llamadas `group()` en tu script de test, o verifica que `run-test.sh` inyecto el threshold sintetico |
| Fila de Custom Metrics vacia | No hay metricas personalizadas definidas | Define metricas personalizadas en tu test (`new Trend(...)`, `new Counter(...)`, etc.) |
| Web Vitals vacios | No hay metricas de navegador | Asegurate de que tu test usa `chromium.launch()` a traves del modulo browser de k6 |
| Loki no muestra logs | No se uso el flag `--loki` | Agrega `--loki` o `--observability` a run-test.sh |
| Tempo no muestra trazas | No se uso el flag `--tempo` | Agrega `--tempo` o `--observability` a run-test.sh |
| Loki/Tempo/Pyroscope inalcanzable | Perfil observability no activo | Inicia con `docker compose --profile observability up -d` |
| Contenedor Loki reiniciando | Falta configuracion `delete_request_store` | Agrega `delete_request_store: filesystem` a la seccion compactor de loki-config.yml |

---

## Aprovisionamiento de Grafana

Los dashboards y el datasource se aprovisionan automaticamente mediante:

```
infrastructure/grafana/
├── provisioning/
│   ├── dashboards/     <- dashboard.yaml (apunta al directorio dashboards/)
│   └── datasources/    <- prometheus.yaml (configura el datasource de Prometheus)
└── dashboards/
    ├── k6-load-test-overview.json
    ├── k6-enterprise-analytics.json
    └── k6-web-vitals.json
```

Para **agregar un dashboard personalizado**: coloca un archivo `.json` en `infrastructure/grafana/dashboards/` y reinicia Grafana:

```bash
docker compose --profile observability restart grafana
```

Para **exportar un dashboard modificado**: en Grafana, ve a Configuracion del Dashboard > JSON Model > copia y guarda en el directorio `dashboards/`.

---

## Puertos del Stack de Observabilidad

| Servicio | Puerto Interno | Expuesto al Host | Proposito |
|----------|---------------|-------------------|-----------|
| Grafana | 3000 | Si (3000) | UI de Dashboard (admin/admin) |
| Prometheus | 9090 | No (solo interno) | Consulta de metricas / targets |
| Loki | 3100 | No (solo interno) | Agregacion de logs (consultado via Grafana) |
| Tempo | 3200, 4317, 4318 | No (solo interno) | Trazas distribuidas (OTLP gRPC/HTTP) |
| Pyroscope | 4040 | No (solo interno) | Perfilado continuo (consultado via Grafana) |
| k6 API | 6565 | Si (6565) | API REST de k6 (solo cuando perfil `run` activo) |

> Solo Grafana y la API de k6 estan expuestos al host. Los demas servicios son internos en la red Docker `k6-net`. Usa `docker-compose.override.yml` para exponerlos en depuracion local.

Iniciar el stack completo:

```bash
docker compose --profile observability up -d
```

Detener sin perder datos:

```bash
docker compose --profile observability stop
```
