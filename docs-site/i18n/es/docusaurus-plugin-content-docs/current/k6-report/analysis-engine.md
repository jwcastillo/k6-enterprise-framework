---
title: Motor de Analisis
sidebar_position: 5
---

# Motor de Analisis

k6-report incluye un motor de analisis integrado que evalua los resultados de tests en cuatro dimensiones: cumplimiento SLA, puntuacion APDEX, deteccion de anomalias y recomendaciones accionables.

---

## Cumplimiento SLA

### Como Funciona

`checkSLA()` evalua dos fuentes de thresholds:

1. **Thresholds nativos de k6** — definidos en `options.thresholds` y evaluados por k6 durante la ejecucion del test
2. **Thresholds SLA personalizados** — reglas adicionales pasadas programaticamente

Para los thresholds nativos de k6, la funcion lee el campo `thresholds` en el JSON de resumen. k6 marca cada threshold como `true` cuando **falla** (la convencion es "tainted = failed").

### Thresholds Personalizados

Define reglas adicionales mas alla de lo que k6 evalua:

```typescript
const result = checkSLA(summary, [
  { metric: "http_req_duration", stat: "p95", operator: "<", value: 500 },
  { metric: "http_req_duration", stat: "avg", operator: "<", value: 200 },
  { metric: "http_req_failed", stat: "rate", operator: "<", value: 0.01 },
  { metric: "http_reqs", stat: "count", operator: ">", value: 1000 },
]);
```

### Estructura del Resultado

```typescript
interface SLAComplianceResult {
  results: SLAResult[];    // Pass/fail por threshold
  overallPassed: boolean;  // Todos los thresholds pasaron
  passCount: number;
  failCount: number;
}

interface SLAResult {
  rule: string;          // Expresion del threshold
  metric: string;        // Nombre de la metrica
  actual: number | null; // Valor medido
  threshold: number;     // Valor objetivo
  passed: boolean;
}
```

---

## Puntuacion APDEX

[Application Performance Index (APDEX)](https://en.wikipedia.org/wiki/Apdex) clasifica la satisfaccion del usuario en tres zonas basadas en tiempo de respuesta:

| Zona | Condicion | Peso |
|------|-----------|------|
| **Satisfecho** | Tiempo de respuesta <= T | 1.0 |
| **Tolerando** | T < Tiempo de respuesta <= 4T | 0.5 |
| **Frustrado** | Tiempo de respuesta > 4T | 0.0 |

### Configuracion

```typescript
const apdex = calculateApdex(summary, {
  satisfiedMs: 500,    // Threshold T (default: 500ms)
  frustratedMs: 2000,  // Threshold 4T (default: 2000ms)
});
```

### Bandas de Puntuacion

| Puntuacion | Etiqueta | Significado |
|------------|----------|-------------|
| >= 0.94 | Excellent | Casi todos los usuarios satisfechos |
| >= 0.85 | Good | La mayoria de usuarios satisfechos |
| >= 0.70 | Fair | Problemas de rendimiento notables |
| >= 0.50 | Poor | Muchos usuarios frustrados |
| < 0.50 | Unacceptable | Mayoria de usuarios frustrados |

### Algoritmo

Como k6 no expone latencias individuales de requests, la puntuacion usa una aproximacion ponderada de la distribucion de percentiles (p50, p90, p99):

1. Clasifica p50 (mediana) en las tres zonas
2. Pondera por la proporcion de requests en cada banda de percentil
3. Aplica formula APDEX: `(Satisfechos + 0.5 * Tolerando) / Total`

---

## Deteccion de Anomalias

`detectAnomalies()` escanea todas las metricas buscando anomalias estadisticas:

### Reglas de Deteccion

| Tipo de Anomalia | Logica de Deteccion |
|-----------------|---------------------|
| **Tasa de error alta** | Tasa de `http_req_failed` > 5% |
| **Outlier de latencia** | Ratio p99/p50 > 10x (latencia de cola extrema) |
| **Pico de latencia** | p95 > 3x promedio (degradacion repentina) |
| **Alta variabilidad** | Coeficiente de variacion > 100% |
| **Throughput cero** | Conteo de `http_reqs` = 0 |

### Resultado

```typescript
interface AnomalyItem {
  metric: string;       // Metrica donde se detecto la anomalia
  severity: "high" | "medium" | "low";
  description: string;  // Explicacion legible
  actual: number;       // Valor observado
  expected: number;     // Referencia de rango normal
}
```

---

## Recomendaciones

`generateRecommendations()` produce sugerencias accionables basadas en patrones detectados:

### Categorias

| Categoria | Disparadores |
|-----------|-------------|
| **Rendimiento** | Alta latencia, percentiles lentos, patrones de request ineficientes |
| **Confiabilidad** | Tasas de error altas, fallos de checks, violaciones de thresholds |
| **Escalabilidad** | Problemas de ratio VU-a-throughput, limites de conexion |
| **Configuracion** | Thresholds faltantes, configuracion suboptima del test |

### Resultado

```typescript
interface Recommendation {
  category: string;    // "performance" | "reliability" | "scalability" | "configuration"
  priority: "high" | "medium" | "low";
  title: string;       // Titulo corto accionable
  description: string; // Explicacion detallada con contexto
}
```

### Ejemplo de Salida

```
[HIGH] Performance: Optimizar latencia p95
  La latencia p95 (2,340ms) excede el threshold de 2,000ms. Considerar:
  - Agregar cache de respuesta para endpoints frecuentemente accedidos
  - Revisar rendimiento de consultas a base de datos
  - Escalar instancias de la aplicacion horizontalmente

[MEDIUM] Configuration: Agregar thresholds de tasa de error
  No hay threshold definido para http_req_failed. Agregar:
  thresholds: { "http_req_failed": ["rate<0.01"] }
```

---

## Usando el Pipeline Completo

La funcion de conveniencia `generateReport()` ejecuta todos los pasos de analisis automaticamente:

```typescript
import { generateReport } from "k6-report";

const { html, analysis } = generateReport(jsonString, {
  slaThresholds: [
    { metric: "http_req_duration", stat: "p95", operator: "<", value: 500 },
  ],
  apdexConfig: { satisfiedMs: 300, frustratedMs: 1200 },
});

// Acceder a resultados individuales de analisis
console.log("SLA pasado:", analysis.sla?.overallPassed);
console.log("Puntuacion APDEX:", analysis.apdex?.score, analysis.apdex?.label);
console.log("Anomalias:", analysis.anomalies?.length);
console.log("Recomendaciones:", analysis.recommendations?.length);
```
