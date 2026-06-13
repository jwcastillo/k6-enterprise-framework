---
title: Analisis de Capacidad y Tendencias
sidebar_position: 7
---

# Analisis de Capacidad y Tendencias

k6-report proporciona dos modos de analisis avanzado que trabajan con multiples ejecuciones de test: analisis de capacidad (comportamiento de escalado) y analisis de tendencias (rendimiento en el tiempo).

---

## Analisis de Capacidad

El analisis de capacidad toma multiples ejecuciones k6 con **niveles de carga crecientes** y determina los limites de tu sistema.

### Que Encuentra

| Metrica | Descripcion |
|---------|-------------|
| **Carga Maxima Sostenible** | Mayor conteo de VUs donde p95 se mantiene bajo el threshold |
| **Punto de Inflexion** | Nivel de VUs donde la latencia comienza a aumentar no-linealmente |
| **Punto de Quiebre** | Nivel de VUs donde los errores se disparan o la latencia excede el threshold |
| **Curva de Saturacion** | Como el throughput escala relativo a los VUs |

### Uso por CLI

```bash
# Ejecutar tests a diferentes niveles de carga
k6 run script.js -u 50  --summary-export=run-50.json
k6 run script.js -u 100 --summary-export=run-100.json
k6 run script.js -u 200 --summary-export=run-200.json
k6 run script.js -u 400 --summary-export=run-400.json

# Generar analisis de capacidad
npx k6-report capacity run-50.json run-100.json run-200.json run-400.json \
  --threshold 2000 \
  --growth-rate 0.1 \
  -o capacity.html
```

### Opciones

| Flag | Descripcion | Default |
|------|-------------|---------|
| `--threshold <ms>` | Threshold de latencia p95 en milisegundos | `2000` |
| `--growth-rate <decimal>` | Tasa de crecimiento mensual para proyeccion de capacidad | `0.1` (10%) |

### API Programatica

```typescript
import {
  analyzeCapacity,
  projectCapacity,
  generateCapacityReportHtml,
} from "k6-report";

// Preparar data points de multiples ejecuciones
const dataPoints = [
  { vus: 50,  rps: 120,  p95: 180,  errorRate: 0.001 },
  { vus: 100, rps: 230,  p95: 220,  errorRate: 0.002 },
  { vus: 200, rps: 410,  p95: 480,  errorRate: 0.008 },
  { vus: 400, rps: 520,  p95: 2100, errorRate: 0.05 },
];

// Analizar
const analysis = analyzeCapacity(dataPoints);
console.log("VUs maximos sostenibles:", analysis.maxSustainableVUs);
console.log("Punto de inflexion:", analysis.inflectionPoint);
console.log("Punto de quiebre:", analysis.breakingPoint);

// Proyectar crecimiento
const projection = projectCapacity(analysis, 0.1); // 10% crecimiento mensual
console.log("Meses hasta limite de capacidad:", projection.monthsRemaining);

// Generar reporte HTML
const html = generateCapacityReportHtml(analysis, {
  threshold: 2000,
  growthRate: 0.1,
});
```

### Secciones del Reporte de Capacidad

El reporte HTML de capacidad incluye:
- **Grafico de curva de escalado** — VUs vs. throughput (RPS) con visualizacion de rendimientos decrecientes
- **Curva de latencia** — VUs vs. latencia p95 con linea de threshold
- **Curva de tasa de error** — VUs vs. porcentaje de error
- **Tabla resumen de capacidad** — Puntos maximo sostenible, inflexion y quiebre
- **Proyeccion de crecimiento** — Cuantos meses hasta alcanzar el limite a la tasa de crecimiento dada

---

## Analisis de Tendencias

El analisis de tendencias toma multiples ejecuciones k6 **en el tiempo** y detecta patrones de rendimiento.

### Que Encuentra

| Patron | Descripcion |
|--------|-------------|
| **Degradando** | Metricas empeorando progresivamente en el tiempo |
| **Mejorando** | Metricas mejorando progresivamente |
| **Estable** | Sin cambio significativo |
| **Volatil** | Grandes oscilaciones sin direccion clara |

### Uso por CLI

```bash
# Generar analisis de tendencias desde ejecuciones historicas
npx k6-report trend \
  results/2026-01-*.json \
  results/2026-02-*.json \
  results/2026-03-*.json \
  --window 90 \
  --baseline-p95 500 \
  -o trend.html
```

### Opciones

| Flag | Descripcion | Default |
|------|-------------|---------|
| `--window <days>` | Ventana de analisis: `30`, `60` o `90` dias | `30` |
| `--baseline-p95 <ms>` | Valor p95 de referencia para comparacion | -- |

### API Programatica

```typescript
import {
  detectTrends,
  extractTrendPoint,
  generateTrendHtml,
} from "k6-report";

// Extraer data points de resumenes de ejecuciones
const dataPoints = summaries.map((s) => extractTrendPoint(s));

// Detectar tendencias
const trends = detectTrends(dataPoints, 30);

console.log("Direccion general:", trends.overallDirection);
// "degrading" | "improving" | "stable" | "volatile"

for (const pattern of trends.patterns) {
  console.log(`${pattern.metric}: ${pattern.direction} (${pattern.confidence}%)`);
}

// Verificar alertas
for (const alert of trends.alerts) {
  console.log(`ALERTA: ${alert.message}`);
}

// Generar reporte HTML
const html = generateTrendHtml(trends, { baselineP95: 500 });
```

### Secciones del Reporte de Tendencias

El reporte HTML de tendencias incluye:
- **Grafico de tendencia de latencia** — p95 en el tiempo con linea de referencia baseline
- **Tendencia de throughput** — RPS en el tiempo
- **Tendencia de tasa de error** — Porcentaje de error en el tiempo
- **Tabla de patrones** — Direccion de tendencia por metrica con nivel de confianza
- **Alertas** — Alertas generadas automaticamente para patrones preocupantes

---

## Combinando Capacidad y Tendencias

Para planificacion de capacidad integral, combina ambos analisis:

1. **Analisis de tendencias semanal** — detecta si el rendimiento esta degradando
2. **Analisis de capacidad mensual** — mide el margen actual
3. **Proyeccion de crecimiento** — predice cuando necesitas escalar

```bash
# Tendencia semanal (automatizado via CI)
npx k6-report trend results/week-*.json --window 30 -o trend-weekly.html

# Capacidad mensual (despues de suite de load test)
npx k6-report capacity \
  results/capacity-50.json \
  results/capacity-100.json \
  results/capacity-200.json \
  --growth-rate 0.15 \
  -o capacity-monthly.html
```
