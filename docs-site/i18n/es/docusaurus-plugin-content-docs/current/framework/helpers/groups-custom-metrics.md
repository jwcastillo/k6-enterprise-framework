---
title: "Análisis de Grupos y Métricas Personalizadas"
sidebar_position: 4
---
# Análisis de Grupos y Métricas Personalizadas

Temporización automática de grupos con inyección sintética de thresholds, definiciones de métricas personalizadas (Trend, Counter, Rate, Gauge), convenciones de nombrado Prometheus y auto-detección en Grafana.

---

## Tabla de Contenidos

1. [Análisis de Grupos](#análisis-de-grupos)
   - [Cómo Funcionan los Grupos](#cómo-funcionan-los-grupos)
   - [Inyección Sintética de Thresholds](#inyección-sintética-de-thresholds)
   - [Grupos en Reportes](#grupos-en-reportes)
   - [Grupos en Grafana](#grupos-en-grafana)
2. [Métricas Personalizadas](#métricas-personalizadas)
   - [Tipos de Métricas](#tipos-de-métricas)
   - [Definición de Métricas Personalizadas](#definición-de-métricas-personalizadas)
   - [Nombrado Prometheus](#nombrado-prometheus)
   - [Métricas Personalizadas en Grafana](#métricas-personalizadas-en-grafana)
   - [Métricas Personalizadas en Reportes](#métricas-personalizadas-en-reportes)
3. [Demo Completo del Dashboard](#demo-completo-del-dashboard)

---

## Análisis de Grupos

### Cómo Funcionan los Grupos

Los grupos de k6 (`group()`) organizan la lógica del test en bloques nombrados. El framework rastrea automáticamente la temporización y los checks de cada grupo en tu test, proporcionando un análisis detallado de rendimiento por grupo.

```typescript
import { group, check } from "k6";
import http from "k6/http";

export default function () {
  group("Browse Catalog", () => {
    const res = http.get("https://api.example.com/products");
    check(res, {
      "browse: status 200": (r) => r.status === 200,
    });
  });

  group("Add to Cart", () => {
    const res = http.post("https://api.example.com/cart", JSON.stringify({ productId: "123" }));
    check(res, {
      "cart: status 200": (r) => r.status === 200,
      "cart: echoed json": (r) => r.json("json") !== undefined,
    });
  });

  group("Checkout", () => {
    const res = http.post("https://api.example.com/checkout", JSON.stringify({ cartId: "abc" }));
    check(res, {
      "checkout: order confirmed": (r) => r.status === 200,
    });
  });
}
```

### Inyección Sintética de Thresholds

El framework inyecta automáticamente thresholds `group_duration` para cada grupo detectado en tu test. Solo necesitas definir thresholds para los grupos donde quieras valores personalizados — el framework se encarga del resto.

#### Cómo Funciona

1. Al iniciar el test, el framework escanea todos los grupos referenciados en tu código
2. Para cualquier grupo **sin** un threshold explícito de `group_duration`, se inyecta un threshold sintético (por defecto: `p(95)<5000`)
3. Esto asegura que todos los grupos aparezcan en los resultados con datos de temporización, incluso si no definiste thresholds para ellos

#### Ejemplo

```typescript
export const options = {
  thresholds: {
    // Only define threshold for Checkout (the critical path)
    "group_duration{group:::Checkout}": ["p(95)<3000"],
    // Browse Catalog and Add to Cart get automatic synthetic thresholds
  },
};
```

Después de la inyección sintética, los thresholds efectivos son:

```
group_duration{group:::Browse Catalog}  → p(95)<5000  (synthetic)
group_duration{group:::Add to Cart}     → p(95)<5000  (synthetic)
group_duration{group:::Checkout}        → p(95)<3000  (user-defined)
```

#### Configuración

```bash
# Change default synthetic threshold
export K6_SYNTHETIC_GROUP_THRESHOLD="p(95)<10000"

# Disable synthetic injection entirely
export K6_DISABLE_SYNTHETIC_THRESHOLDS=true
```

#### Suplementación de root_group.groups

El `root_group.groups` de k6 en el resumen JSON a veces omite grupos que fueron ejecutados. El framework suplementa estos datos rastreando todas las ejecuciones de grupos de forma independiente, asegurando datos completos de grupos en los reportes incluso cuando el reporte nativo de k6 está incompleto.

### Grupos en Reportes

El reporte HTML incluye una sección **"Análisis de Grupos"** con:

| Columna | Descripción |
|---------|-------------|
| Nombre del Grupo | Nombre del grupo |
| Duración (p95) | Percentil 95 del tiempo de ejecución del grupo |
| Duración (avg) | Tiempo promedio de ejecución del grupo |
| Checks | Número de checks en el grupo (aprobados/total) |
| Estado | Aprobado/Fallido basado en el threshold |

Los grupos con thresholds fallidos se resaltan en rojo.

### Grupos en Grafana

Los dashboards **Load Test Overview** y **Enterprise Analytics** incluyen una fila **Groups Analysis** con:

- Panel **Groups Duration**: gráfico de barras mostrando la duración p95 por grupo
- Panel **Groups Checks**: conteos de checks aprobados/fallidos por grupo
- Variable de template `$group` para filtrar por grupo específico

---

## Métricas Personalizadas

### Tipos de Métricas

k6 proporciona cuatro tipos de métricas personalizadas. El framework auto-detecta todas las métricas personalizadas y las muestra en reportes y dashboards de Grafana.

| Tipo | Descripción | Caso de Uso | Ejemplo |
|------|-------------|-------------|---------|
| **Counter** | Conteo acumulativo | Total de transacciones de negocio, conteo de errores | `new Counter("business_transactions")` |
| **Trend** | Distribución de valores (avg, min, max, p90, p95, p99) | Latencia de API, tamaño de payloads | `new Trend("api_latency_ms")` |
| **Rate** | Porcentaje de valores no-cero | Tasa de éxito, tasa de conversión | `new Rate("business_success_rate")` |
| **Gauge** | Último valor registrado | Usuarios activos, profundidad de cola | `new Gauge("active_users_gauge")` |

### Definición de Métricas Personalizadas

Las métricas personalizadas se definen en el ámbito del módulo (contexto init) y se usan dentro de las funciones del test:

```typescript
import { Counter, Trend, Rate, Gauge } from "k6/metrics";

// Define at module scope
const businessTransactions = new Counter("business_transactions");
const apiLatency = new Trend("api_latency_ms");
const successRate = new Rate("business_success_rate");
const activeUsers = new Gauge("active_users_gauge");

export default function () {
  const res = http.get("https://api.example.com/data");

  // Record values
  businessTransactions.add(1);
  apiLatency.add(res.timings.duration);
  successRate.add(res.status === 200 ? 1 : 0);
  activeUsers.add(__VU);
}
```

### Configuración de Thresholds para Métricas Personalizadas

```typescript
export const options = {
  thresholds: {
    business_success_rate: ["rate>0.95"],
    api_latency_ms: ["p(95)<2500"],
    business_transactions: ["count>100"],
  },
};
```

### Nombrado Prometheus

Cuando las métricas se exportan a Prometheus (a través del stack de observabilidad), el framework aplica convenciones de nombrado:

| Nombre de Métrica k6 | Nombre Prometheus | Labels |
|----------------------|-------------------|--------|
| `business_transactions` | `k6_business_transactions_total` | `client`, `service`, `env` |
| `api_latency_ms` | `k6_api_latency_ms` | `client`, `service`, `env`, `quantile` |
| `business_success_rate` | `k6_business_success_rate` | `client`, `service`, `env` |
| `active_users_gauge` | `k6_active_users_gauge` | `client`, `service`, `env` |

Reglas:
- Las métricas Counter reciben el sufijo `_total`
- Todas las métricas reciben el prefijo `k6_`
- Los labels se sanitizan según la especificación de Prometheus (ver [Seguridad](/es/docs/framework/security/#sanitizacion-de-labels-prometheus-t-135))

### Métricas Personalizadas en Grafana

Los tres dashboards de Grafana auto-detectan las métricas personalizadas y las muestran en paneles dedicados:

#### Dashboard Load Test Overview

- **Custom Metrics — Trends**: gráfico de series temporales para todas las métricas personalizadas tipo Trend
- **Custom Metrics — Counters**: gráfico de barras para todas las métricas personalizadas tipo Counter
- **Custom Metrics — Rates & Gauges**: panel combinado para métricas Rate y Gauge

#### Dashboard Enterprise Analytics

- Fila **Custom Metrics** con paneles detallados incluyendo desgloses de percentiles para Trends

#### Dashboard Web Vitals

- Se enfoca en métricas del navegador pero incluye superposición de métricas personalizadas si están definidas

### Métricas Personalizadas en Reportes

El reporte HTML incluye una sección **"Métricas Personalizadas"** con:

| Tipo de Métrica | Valores Mostrados |
|----------------|-------------------|
| Counter | Conteo total, tasa por segundo |
| Trend | avg, min, max, p90, p95, p99 |
| Rate | Porcentaje (0-100%) |
| Gauge | Último valor, min, max |

---

## Demo Completo del Dashboard

El escenario `99-full-dashboard-demo` ejercita todos los paneles del reporte en un solo test:

```bash
./bin/run-test.sh --client=examples --scenario=mixed/99-full-dashboard-demo --profile=smoke
```

### Qué Incluye

| Característica | Detalle |
|---------------|---------|
| **5 Grupos** | Browse Catalog, Search Products, View Product, Add to Cart, Checkout |
| **6 Métricas Personalizadas** | 2 Counters (`business_transactions`, `business_errors`), 2 Trends (`api_latency_ms`, `response_payload_bytes`), 1 Rate (`business_success_rate`), 1 Gauge (`active_users_gauge`) |
| **Web Vitals** | LCP, FCP, CLS, TTFB, INP vía escenario de navegador Chromium |
| **Thresholds SLA** | Mezcla de aprobados/fallidos para demostración del panel SLA |
| **Dos Escenarios** | `api_flow` (grupos HTTP + métricas personalizadas) + `browser_vitals` (Web Vitals con Chromium) |

### Paneles Esperados Poblados

Después de ejecutar el demo, estos paneles de reporte/dashboard deberían mostrar datos:

- Franja KPI (Checks, Avg, p95, p99, Tasa de Error, Throughput, APDEX, SLA)
- Indicador APDEX
- Tabla de cumplimiento SLA
- Gráfico de distribución de percentiles
- Alertas de Anomalía / Recomendación
- Análisis de Grupos (5 grupos con temporización + checks)
- Métricas Personalizadas (6 métricas personalizadas en los 4 tipos)
- Web Vitals (LCP, FCP, CLS, TTFB, INP)
- Comparación Histórica (en re-ejecuciones)

---

## Documentación Relacionada

- [Sistema de Reportes](/es/docs/framework/reporting/) — reportes HTML, exportación PDF/PNG, análisis LLM
- [Dashboards Grafana](/es/docs/framework/observability/grafana) — visualización en tiempo real con 3 dashboards
- [Motor de Métricas](/es/docs/framework/metrics/metrics-engine) — 125+ métricas integradas
- [Tipos de Test](/es/docs/framework/test-types) — todos los tipos de test incluyendo tests de navegador Web Vitals
