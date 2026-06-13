---
title: k6-report
sidebar_position: 1
slug: /k6-report
---

# k6-report

Transforma la salida JSON de k6 en reportes HTML de alta calidad, analisis y formatos de exportacion. Cero dependencias de runtime para la API principal.

---

## Funcionalidades

| Funcionalidad | Descripcion |
|---------------|-------------|
| **Reportes HTML** | Dashboards autocontenidos, funcionales offline con graficos SVG embebidos y tema dual (claro/oscuro) |
| **Motor de Analisis** | Cumplimiento SLA, puntuacion APDEX, deteccion de anomalias y recomendaciones accionables |
| **Analisis de Capacidad** | Analisis multi-ejecucion para identificar carga maxima sostenible, puntos de inflexion y proyecciones |
| **Deteccion de Tendencias** | Analisis historico de tendencias en ventanas de 30/60/90 dias |
| **Comparacion de Ejecuciones** | Diff lado a lado de dos ejecuciones k6 con deteccion de regresion |
| **Formatos de Exportacion** | CSV, Markdown, Jira wiki, GitHub Markdown, Slack Block Kit, Teams Adaptive Card |
| **Generacion de Tickets** | Auto-generacion de issues Jira o GitHub desde resultados de tests |
| **Almacenamiento de Ejecuciones** | Indice historico basado en JSONL para seguimiento de tendencias |

---

## Instalacion

```bash
npm install k6-report
```

---

## Inicio Rapido

### 1. Ejecuta tu test k6 con `--summary-export`

```bash
k6 run script.js --summary-export=summary.json
```

### 2. Genera un reporte HTML

```bash
npx k6-report generate summary.json -o report.html
```

### 3. Abre `report.html` en tu navegador

El reporte generado es completamente autocontenido — sin CDN, funciona offline.

---

## Como Funciona

k6-report sigue una arquitectura de pipeline:

```
Salida JSON de k6
    |
    v
  Parser         -- parseK6Summary(): valida y normaliza el JSON crudo
    |
    v
  Enriquecimiento -- enrichSummary(): agrega version de schema, salud del generador
    |
    v
  Analisis       -- checkSLA(), calculateApdex(), detectAnomalies(), generateRecommendations()
    |
    v
  Reporte/Export -- generateHtmlReport(), exportCSV(), generateMarkdown(), generateTicket()
    |
    v
  Almacenamiento -- RunStore.append(): persiste la ejecucion para seguimiento historico
```

### API de Conveniencia

La funcion `generateReport()` ejecuta todo el pipeline en una sola llamada:

```typescript
import { readFileSync, writeFileSync } from "fs";
import { generateReport } from "k6-report";

const json = readFileSync("summary.json", "utf8");
const { html, analysis } = generateReport(json, {
  branding: { orgName: "Acme Corp", primaryColor: "#e11d48" },
});
writeFileSync("report.html", html);
```

---

## Requisitos

- **Node.js** >= 18.0.0
- **k6** (para ejecutar tests — k6-report solo necesita la salida JSON)

---

## Codigos de Salida

| Codigo | Significado |
|--------|-------------|
| `0` | Exito |
| `1` | Error (entrada invalida, archivo faltante, etc.) |
| `2` | Violaciones de threshold detectadas |
