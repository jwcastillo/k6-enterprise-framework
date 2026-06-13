---
title: Referencia API
sidebar_position: 3
---

# Referencia de API Programatica

k6-report exporta toda la funcionalidad como funciones y clases tipadas. Soporta tanto importaciones CommonJS como ESM.

```typescript
// ESM
import { generateReport, parseK6Summary, checkSLA } from "k6-report";

// CommonJS
const { generateReport, parseK6Summary, checkSLA } = require("k6-report");
```

---

## API de Conveniencia

### `generateReport(input, options?)`

La funcion todo-en-uno: parsear, analizar y generar HTML en una sola llamada.

```typescript
import { readFileSync, writeFileSync } from "fs";
import { generateReport } from "k6-report";

const json = readFileSync("summary.json", "utf8");
const { html, summary, analysis } = generateReport(json, {
  branding: { orgName: "Acme Corp", primaryColor: "#e11d48" },
  compareData: previousSummary,
  apdexConfig: { satisfiedMs: 500, frustratedMs: 2000 },
});
writeFileSync("report.html", html);
```

**Parametros:**

| Parametro | Tipo | Descripcion |
|-----------|------|-------------|
| `input` | `string \| K6Summary` | String JSON crudo de k6 o objeto `K6Summary` pre-parseado |
| `options.branding` | `ReportBranding` | Nombre de organizacion, color primario, logo |
| `options.compareData` | `K6Summary` | Resumen baseline para seccion de comparacion |
| `options.apdexConfig` | `ApdexConfig` | Thresholds APDEX personalizados |
| `options.slaThresholds` | `SLAThreshold[]` | Reglas de threshold SLA personalizadas |
| `options.inputFile` | `string` | Ruta del archivo de entrada (usado para titulo del reporte) |

**Retorna:** `GenerateResult`

| Campo | Tipo | Descripcion |
|-------|------|-------------|
| `html` | `string` | String completo del documento HTML |
| `summary` | `K6Summary` | Resumen k6 parseado |
| `analysis` | `AnalysisResult` | SLA, APDEX, anomalias, recomendaciones, comparacion |

---

## Parser

### `parseK6Summary(data)`

Parsea un valor JSON crudo de k6 en un `K6Summary` tipado.

```typescript
import { parseK6Summary } from "k6-report";

const raw = JSON.parse(readFileSync("summary.json", "utf8"));
const summary: K6Summary = parseK6Summary(raw);
```

### `detectK6Format(data)`

Detecta si la entrada es un resumen JSON de k6 o metricas crudas.

```typescript
import { detectK6Format } from "k6-report";

const format = detectK6Format(jsonData);
// Retorna: "end-of-test" | "cloud" | "unknown"
```

---

## Generacion de Reportes

### `generateHtmlReport(summary, options?)`

Genera un reporte HTML autocontenido a partir de un `K6Summary` parseado.

```typescript
import { generateHtmlReport } from "k6-report";

const html = generateHtmlReport(summary, {
  branding: { orgName: "Acme", primaryColor: "#2563eb" },
  compareData: baselineSummary,
  inputFile: "smoke-test.json",
});
```

**Opciones:**

| Opcion | Tipo | Descripcion |
|--------|------|-------------|
| `branding.orgName` | `string` | Nombre de organizacion mostrado en el header |
| `branding.primaryColor` | `string` | Color hex para acentos del tema |
| `branding.logoBase64` | `string` | Imagen de logo codificada en base64 |
| `compareData` | `K6Summary` | Baseline para seccion de comparacion |
| `inputFile` | `string` | Ruta del archivo usada en el titulo del reporte |
| `context` | `ReportContext` | Nombre del test, metadatos del ambiente |
| `generatorHealth` | `GeneratorHealth` | Metricas de CPU/memoria del generador de carga |

---

## Analisis

### `checkSLA(summary, thresholds?)`

Evalua thresholds SLA y retorna resultados pass/fail.

```typescript
import { checkSLA } from "k6-report";

const result = checkSLA(summary, [
  { metric: "http_req_duration", stat: "p95", operator: "<", value: 500 },
  { metric: "http_req_failed", stat: "rate", operator: "<", value: 0.01 },
]);

console.log(result.overallPassed);  // true/false
console.log(result.passCount);      // numero de thresholds pasados
console.log(result.failCount);      // numero de thresholds fallidos
```

### `calculateApdex(summary, config?)`

Calcula puntuacion APDEX con threshold configurable.

```typescript
import { calculateApdex } from "k6-report";

const apdex = calculateApdex(summary, {
  satisfiedMs: 500,    // default: 500
  frustratedMs: 2000,  // default: 2000
});

// apdex = { score: 0.92, label: "Good", color: "#2563eb" }
```

**Bandas APDEX:**

| Rango | Etiqueta | Color |
|-------|----------|-------|
| >= 0.94 | Excellent | `#16a34a` |
| >= 0.85 | Good | `#2563eb` |
| >= 0.70 | Fair | `#d97706` |
| >= 0.50 | Poor | `#ea580c` |
| < 0.50 | Unacceptable | `#dc2626` |

### `detectAnomalies(summary)`

Detecta anomalias en metricas — outliers, picos y tasas de error altas.

```typescript
import { detectAnomalies } from "k6-report";

const anomalies = detectAnomalies(summary);
// Retorna: AnomalyItem[] — { metric, severity, description, actual, expected }
```

### `generateRecommendations(summary)`

Genera recomendaciones accionables basadas en resultados del test.

```typescript
import { generateRecommendations } from "k6-report";

const recs = generateRecommendations(summary);
// Retorna: Recommendation[] — { category, priority, title, description }
```

### `compareRuns(current, baseline)`

Compara dos ejecuciones k6 y produce una tabla de diferencias.

```typescript
import { compareRuns } from "k6-report";

const result = compareRuns(currentSummary, baselineSummary);
// result.rows: ComparisonRow[] — delta por metrica, pctChange, verdict
// result.summary: { improved, regressed, stable }
```

### `analyzeCapacity(dataPoints)`

Identifica carga maxima sostenible, puntos de inflexion y puntos de quiebre.

```typescript
import { analyzeCapacity } from "k6-report";

const analysis = analyzeCapacity(dataPoints);
// analysis.maxSustainableVUs, analysis.inflectionPoint, analysis.breakingPoint
```

### `projectCapacity(analysis, growthRate)`

Proyecta necesidades futuras de capacidad a una tasa de crecimiento mensual dada.

```typescript
import { projectCapacity } from "k6-report";

const projection = projectCapacity(analysis, 0.1); // 10% crecimiento mensual
```

### `detectTrends(dataPoints, window?)`

Detecta patrones de degradacion, mejora, estabilidad o volatilidad en el tiempo.

```typescript
import { detectTrends } from "k6-report";

const trends = detectTrends(dataPoints, 30); // ventana de 30 dias
// Retorna: TrendAnalysis — { patterns, overallDirection, alerts }
```

---

## Exportacion

### `exportCSV(summary)`

Exporta metricas k6 a formato CSV.

```typescript
import { exportCSV } from "k6-report";

const csv = exportCSV(summary);
writeFileSync("metrics.csv", csv);
```

### `generateMarkdown(summary, analysis?)`

Genera un reporte de analisis en formato Markdown.

```typescript
import { generateMarkdown } from "k6-report";

const md = generateMarkdown(summary, analysisResult);
writeFileSync("report.md", md);
```

### `generateTicket(summary, options, analysis?)`

Genera contenido de ticket en formato Jira wiki markup o GitHub Markdown.

```typescript
import { generateTicket } from "k6-report";

const ticket = generateTicket(summary, {
  format: "jira",         // o "github"
  service: "Payment API",
  environment: "staging",
  profile: "load",
});

// ticket.story: cuerpo principal del ticket
// ticket.comment: comentario de seguimiento con detalle de metricas
```

### `generateMessage(summary, options, analysis?)`

Genera mensajes Slack Block Kit o Teams Adaptive Card.

```typescript
import { generateMessage } from "k6-report";

const slackMsg = generateMessage(summary, {
  platform: "slack",
  service: "Auth API",
  environment: "production",
  reportUrl: "https://reports.example.com/latest.html",
});

const teamsMsg = generateMessage(summary, {
  platform: "teams",
  service: "Auth API",
});
```

---

## Almacenamiento

### `RunStore`

Almacen basado en sistema de archivos para indice historico de ejecuciones.

```typescript
import { RunStore, generateRunId, parseK6Summary } from "k6-report";

const store = new RunStore({ dir: ".k6-report" });

// Agregar una ejecucion
const summary = parseK6Summary(JSON.parse(jsonString));
const id = generateRunId(summary);
store.append({ id, timestamp: new Date().toISOString(), verdict: "pass" }, summary);

// Listar ejecuciones
const runs = store.list(10); // mas reciente primero, limite 10
```

### `generateRunId(summary)`

Genera un ID de ejecucion estable y deterministico a partir de un resumen JSON de k6.

```typescript
import { generateRunId } from "k6-report";

const id = generateRunId(summary); // ej., "a1b2c3d4"
```

---

## Tipos

Todos los tipos son exportados y disponibles para consumidores TypeScript:

```typescript
import type {
  K6Summary,
  K6Options,
  K6Metric,
  K6MetricValues,
  K6Check,
  K6Group,
  K6Threshold,
  ReportContext,
  EnrichedSummary,
  GeneratorHealth,
  ReportOptions,
  ReportBranding,
  SLAThreshold,
  SLAResult,
  SLAComplianceResult,
  ApdexConfig,
  ApdexResult,
  AnomalyItem,
  Recommendation,
  ComparisonRow,
  ComparisonResult,
  CapacityAnalysis,
  CapacityProjection,
  TrendDataPoint,
  TrendAnalysis,
  TrendWindow,
  TicketOptions,
  TicketResult,
  MessageOptions,
  AnalysisResult,
  GenerateOptions,
  GenerateResult,
  RunIndexEntry,
  StoreOptions,
} from "k6-report";
```
