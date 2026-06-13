---
title: "Guía del Motor de Métricas"
sidebar_position: 1
---
# Guía del Motor de Métricas

**Fase 9** · Framework Empresarial k6

El Motor de Métricas (`src/metrics/`) calcula más de 125 métricas de rendimiento agrupadas por dominio a partir de los datos de `handleSummary` de k6 y métricas externas opcionales de Prometheus.

---

## Arquitectura

```
handleSummary data (k6)
        │
        ▼
MetricsEngine.calculate(input)
        │
        ├── PerformanceCalculator  → 50 PERF metrics (CHK-API-175–224)
        ├── ThroughputCalculator   → 25 THRU metrics (CHK-API-225–249)
        ├── ErrorCalculator        → 30 ERR  metrics (CHK-API-250–279)
        └── SlaCalculator          → 20 SLA  metrics (CHK-API-330–349)
                │
                ▼
        MetricsReport
        ├── byCategory: { performance: [...], throughput: [...], ... }
        ├── all: MetricResult[]
        └── summary: { total, pass, warn, fail, na }
```

---

## Inicio Rápido

```typescript
import { MetricsEngine, buildMetricsInput } from "./src/metrics";

export function handleSummary(data) {
  const context = { client: "my-team", environment: "staging",
                    profile: "load", testName: "smoke-users",
                    startTime: new Date().toISOString() };

  const engine = MetricsEngine.withP1Calculators();
  const report = engine.calculate(buildMetricsInput(data, context, {
    sloConfig: {
      availabilityTarget: 0.999,
      latencyP95TargetMs: 500,
    },
  }));

  // report.summary → { total: 125, pass: 87, warn: 5, fail: 3, na: 30 }
  // report.byCategory.performance → MetricResult[]

  return generateHtmlReport(data, context, "./reports/report.html",
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    report  // metricsReport parameter
  );
}
```

---

## Estado de las Métricas

| Estado | Significado |
|--------|-------------|
| `pass` | El valor está dentro del umbral |
| `warn` | El valor está en la zona de advertencia (umbral × 1.1) |
| `fail` | El valor excede el umbral |
| `na`   | No se puede calcular — requiere datos externos |

---

## Métricas N/A: Instrumentación del SUT

Muchas métricas requieren datos externos de tu SUT. Agrégalas a `externalMetrics`:

```typescript
const prometheusClient = new PrometheusClient("http://prometheus:9090");

// Obtener durante/después del test
const cpuSamples = await prometheusClient.queryRange(
  'avg(rate(process_cpu_seconds_total[1m])) * 100',
  startTs, endTs, "15s"
);

const input = buildMetricsInput(data, context, {
  externalMetrics: {
    "cpu_usage_percent":    PrometheusClient.timeSeries(cpuSamples),
    "http_req_duration_p95": PrometheusClient.timeSeries(p95Samples),
    "error_rate_percent":    PrometheusClient.timeSeries(errorSamples),
    "rps":                   PrometheusClient.timeSeries(rpsSamples),
  },
});
```

### Consultas de Prometheus requeridas por dominio

| Clave de `externalMetrics` | Consulta de Prometheus | Desbloquea |
|-----------------------|-----------------|---------|
| `cpu_usage_percent` | `avg(rate(process_cpu_seconds_total[1m])) * 100` | PERF-041, métricas SAT |
| `memory_usage_bytes` | `process_resident_memory_bytes` | PERF-042, métricas STAB |
| `http_req_duration_p95` | `histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[1m])) * 1000` | PERF-021, 023 |
| `rps` | `rate(http_requests_total[1m])` | THRU-009, 010 |
| `vus` | (desde k6 cloud o métrica personalizada) | THRU-010 |
| `error_rate_percent` | `rate(http_requests_total{status=~"5.."}[1m]) / rate(http_requests_total[1m]) * 100` | ERR-010, 011, 021 |
| `http_errors_4xx` | `increase(http_requests_total{status=~"4.."}[1m])` | ERR-004, 013 |
| `http_errors_5xx` | `increase(http_requests_total{status=~"5.."}[1m])` | ERR-002, 013 |
| `http_errors_429` | `increase(http_requests_total{status="429"}[1m])` | ERR-003 |
| `slo_breach` | `(rate(http_requests_total{status=~"5.."}[1m]) / rate(http_requests_total[1m])) > 0.001` | SLA-012–014 |
| `circuit_breaker_open` | `resilience4j_circuitbreaker_state{state="open"}` | ERR-020 |

---

## Configuración (`shared/schemas/metrics-config.json`)

```json
{
  "enabled": ["performance", "throughput", "error", "sla"],
  "prometheus": {
    "url": "http://prometheus:9090",
    "enabled": true,
    "queryTimeout": 10
  },
  "slo": {
    "availabilityTarget": 0.999,
    "latencyP95TargetMs": 500,
    "latencyP99TargetMs": 1000,
    "errorBudgetWindowDays": 30
  },
  "profiles": {
    "smoke": { "enabled": ["performance", "error"] },
    "load":  { "enabled": ["performance", "throughput", "error", "sla"] },
    "soak":  { "enabled": "all" }
  }
}
```

---

## Calculadores por Dominio

| Calculador | Métricas | Rango CHK-API | Prioridad |
|-----------|---------|---------------|---------|
| `PerformanceCalculator` | 50 | CHK-API-175–224 | P1 |
| `ThroughputCalculator`  | 25 | CHK-API-225–249 | P1 |
| `ErrorCalculator`       | 30 | CHK-API-250–279 | P1 |
| `SlaCalculator`         | 20 | CHK-API-330–349 | P1 |

### Métricas clave por calculador

**Rendimiento** (nativas de k6):
- `PERF-001–007`: Tiempo de respuesta p50/p90/p95/p99/máx/mín/promedio
- `PERF-010–012`: TTFB promedio/p95/p99
- `PERF-013–019`: DNS, TCP, TLS, envío, recepción, transferencia de contenido, procesamiento del servidor
- `PERF-020`: Puntuación Apdex (T=500ms configurable)
- `PERF-024`: Eficiencia de VU (RPS/VU)
- `PERF-035–038`: Tamaños de carga útil y datos totales transferidos

**Throughput** (nativas de k6):
- `THRU-001–003`: RPS total, RPS exitosas (goodput), TPS
- `THRU-004–007`: Datos enviados/recibidos en MB y Mbps
- `THRU-008`: Throughput por VU
- `THRU-011`: Desviación de la Ley de Little
- `THRU-012`: Tasa de goodput
- `THRU-013`: Factor de amplificación de reintentos

**Errores** (nativas de k6 + derivadas):
- `ERR-001`: Tasa general de errores HTTP
- `ERR-005`: Indicador de timeout
- `ERR-006–007`: Establecimiento de conexión promedio/máximo
- `ERR-009`: Tasa de fallo de checks
- `ERR-012`: Tasa de consumo de presupuesto de errores
- `ERR-017`: Tasa estimada de reintentos

**SLA** (nativas de k6 + configuración):
- `SLA-001`: Disponibilidad (basada en solicitudes)
- `SLA-002`: Disponibilidad (basada en checks)
- `SLA-003–004`: Presupuesto de errores restante + proyección de consumo mensual
- `SLA-005–006`: Cumplimiento de SLO p95/p99
- `SLA-008`: Puntuación compuesta multi-SLI (disponibilidad 40% + p95 35% + p99 15% + checks 10%)
- `SLA-011`: Tasa de correctitud

---

## Integración con Reporte HTML

La sección de Métricas Extendidas aparece automáticamente en los reportes HTML cuando se pasa `metricsReport` a `generateHtmlReport()`. Incluye:

- **Barra de resumen**: Conteos de Total / Aprobado / Advertencia / Fallido / N/A
- **Pestañas por dominio**: Haz clic para alternar entre Rendimiento, Throughput, Errores, SLA, etc.
- **Insignias de fallo/advertencia** en los botones de pestaña para escaneo rápido
- **Sección expandible de N/A** por dominio: lista los prerrequisitos para cada métrica no calculada

---

## Integración con Reporte JSON

Cuando se pasa `extendedMetrics` a `generateJsonSummary()`, la salida incluye:

```json
{
  "$schema": "...",
  "schemaVersion": "2.0.0",
  "summary": { ... },
  "extendedMetrics": {
    "generatedAt": "2026-02-18T14:30:52Z",
    "durationMs": 300000,
    "byCategory": {
      "performance": [
        { "id": "PERF-001", "name": "Response Time — Average", "value": 245.3,
          "unit": "ms", "threshold": "< 500", "status": "pass", ... }
      ],
      "error": [ ... ],
      "sla": [ ... ]
    },
    "summary": { "total": 125, "pass": 87, "warn": 5, "fail": 3, "na": 30 }
  }
}
```

---

## Filtrado por Dominio

Usa `--metrics=<dominio,...>` al llamar a `engine.calculate()` para limitar qué calculadores se ejecutan. Los nombres de dominio desconocidos se ignoran silenciosamente. Pasa `all` u omite el flag para ejecutar todos los calculadores registrados.

```typescript
import { MetricsEngine, buildMetricsInput } from "./src/metrics";

// Parse from CLI arg (e.g. K6_METRICS_FILTER="performance,error,sla")
const domains = MetricsEngine.parseDomainsArg(process.env["K6_METRICS_FILTER"]);

const report = MetricsEngine.withAllCalculators()
  .calculate(buildMetricsInput(data, context), domains);

// With a specific CSV string:
const domainsExplicit = MetricsEngine.parseDomainsArg("performance,error,sla");
// → ["performance", "error", "sla"]

// Run all (default):
const domainsAll = MetricsEngine.parseDomainsArg("all");
// → undefined  (all calculators execute)
```

Nombres de dominio válidos: `performance`, `throughput`, `error`, `saturation`, `sla`,
`stability`, `scalability`, `chaos`, `security`, `observability`, `data-integrity`.

### Agrupación de métricas N/A en reportes

Las métricas que no se pueden calcular (estado `"na"`) se agrupan al final de cada sección de dominio en el reporte HTML con una lista colapsable de prerrequisitos:

> **23 métricas requieren instrumentación del SUT.** Consulta [docs/METRICS_ENGINE.md → Métricas N/A](#métricas-na-instrumentación-del-sut) para las consultas de Prometheus requeridas por métrica.

---

---

## Puntuación Global de Resultados

El Motor de Métricas adjunta una puntuación global inspirada en GPT a cada `MetricsReport` (T-262).
La puntuación se expone como `MetricsReport.score` y, al generar el resumen JSON,
como `extendedMetrics.score` en el archivo de salida.

### Fórmula de puntuación

| Estado de métrica | Peso |
|-------------------|------|
| `pass`            | 1.0  |
| `warn`            | 0.5  |
| `fail`            | 0    |
| `na`              | excluido del denominador |

```
value = round( (pass × 1.0 + warn × 0.5) / (pass + warn + fail) × 100 )
```

Cuando no existen métricas puntuables (todas `na` o reporte vacío) el valor es **100** por defecto.

### Tabla de calificaciones

| Calificación | Puntuación mínima |
|--------------|-------------------|
| A            | 90                |
| B            | 80                |
| C            | 70                |
| D            | 60                |
| F            | < 60              |

Una puntuación de 90 o superior se considera **saludable** (`score.healthy === true`),
siguiendo la convención de instancia saludable de GPT.

### Acceso programático

```typescript
import { scoreFromCounts } from "../../src/metrics/score";

const score = scoreFromCounts({ pass: 85, warn: 5, fail: 10 });
// → { value: 91, grade: "A", healthy: true }

// La puntuación también aparece en MetricsReport después de engine.calculate():
// report.score === { value: 91, grade: "A", healthy: true }
```

La función independiente `scoreFromCounts()` se exporta desde `src/metrics/score.ts` para que
el generador de reportes HTML pueda derivar una puntuación a partir de `BuiltSummary.checks`
cuando `extendedMetrics.score` no esté disponible (ver [Reportes → Insignia de puntuación general](#)).

---

## Integración de Métricas Personalizadas

El Motor de Métricas soporta la integración de métricas personalizadas de k6 (Trend, Counter, Rate, Gauge) en el pipeline de cálculo. Esto permite que tus propias métricas específicas de la aplicación sean evaluadas junto con las más de 125 métricas integradas.

### Tipos de Métricas Personalizadas de k6 Soportados

| Tipo k6   | Descripción                          | Caso de Uso de Ejemplo                  |
|-----------|--------------------------------------|-----------------------------------------|
| `Trend`   | Recolecta valores de series temporales (p50, p95, avg, etc.) | Tiempo de respuesta personalizado para un endpoint específico |
| `Counter` | Contador monotónicamente creciente   | Número total de transacciones de negocio |
| `Rate`    | Rastrea el porcentaje de valores distintos de cero | Tasa de éxito de un flujo de trabajo específico |
| `Gauge`   | Almacena el último valor             | Profundidad actual de la cola o tamaño del pool |

### Registro de Métricas Personalizadas

Pasa las métricas personalizadas a través del campo `customMetrics` en `buildMetricsInput()`:

```typescript
import { Trend, Counter, Rate, Gauge } from "k6/metrics";

// Define in your test script
const loginDuration = new Trend("login_duration", true);
const bizTransactions = new Counter("biz_transactions");
const loginSuccess = new Rate("login_success_rate");
const activeConnections = new Gauge("active_connections");

// In handleSummary, pass them to the engine
const input = buildMetricsInput(data, context, {
  customMetrics: {
    "login_duration":      { type: "trend",   values: data.metrics["login_duration"] },
    "biz_transactions":    { type: "counter", values: data.metrics["biz_transactions"] },
    "login_success_rate":  { type: "rate",    values: data.metrics["login_success_rate"] },
    "active_connections":  { type: "gauge",   values: data.metrics["active_connections"] },
  },
  customThresholds: {
    "login_duration":      { p95: 800, p99: 1500, unit: "ms" },
    "biz_transactions":    { min: 1000, unit: "count" },
    "login_success_rate":  { min: 0.98, unit: "ratio" },
    "active_connections":  { max: 100, unit: "count" },
  },
});
```

### Métricas Personalizadas en Reportes

Las métricas personalizadas aparecen en una pestaña dedicada **"Custom"** en el reporte HTML y bajo `extendedMetrics.byCategory.custom` en la salida JSON. Siguen el mismo modelo de estado pass/warn/fail/na que las métricas integradas.

*Ver también: [WORKFLOW.md](/es/docs/framework/workflow) · [TEST_TYPES.md](/es/docs/framework/test-types) · [DISTRIBUTED_TESTING.md](/es/docs/framework/observability/distributed-testing)*
