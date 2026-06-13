---
title: Formatos de Exportacion
sidebar_position: 6
---

# Formatos de Exportacion

k6-report puede generar resultados de tests en 7 formatos. HTML es la salida principal; los otros formatos sirven para necesidades especificas de integracion y flujo de trabajo.

---

## HTML

Dashboard HTML autocontenido con CSS, JavaScript y graficos SVG embebidos. Funciona offline sin dependencias externas.

```bash
npx k6-report generate summary.json -f html -o report.html
```

```typescript
import { generateHtmlReport } from "k6-report";
const html = generateHtmlReport(summary, { branding: { orgName: "Acme" } });
```

**Caracteristicas:**
- 18 secciones de reporte organizadas en 4 bloques
- Toggle de tema oscuro/claro
- Branding personalizado (nombre org, color, logo)
- Comparacion con baseline cuando se usa `--compare`
- Graficos SVG embebidos (sin CDN)
- Modo claro amigable para impresion

---

## CSV

Exportacion plana de metricas para analisis en hojas de calculo o ingestion en pipelines de datos.

```bash
npx k6-report generate summary.json -f csv -o metrics.csv
```

```typescript
import { exportCSV } from "k6-report";
const csv = exportCSV(summary);
```

**Columnas de salida:**
- Nombre de la metrica
- Tipo de metrica (counter, gauge, rate, trend)
- Valores estadisticos (avg, min, max, med, p90, p95, p99, count, rate)

---

## Markdown

Reporte de analisis legible en formato Markdown. Util para documentacion, comentarios de PR y paginas wiki.

```bash
npx k6-report generate summary.json -f markdown -o report.md
```

```typescript
import { generateMarkdown } from "k6-report";
const md = generateMarkdown(summary, analysisResult);
```

**Incluye:**
- Vista general del test y configuracion
- Tabla resumen de metricas clave
- Estado de cumplimiento SLA
- Puntuacion APDEX (cuando se proporciona analisis)
- Anomalias y recomendaciones

---

## Jira Wiki Markup

Genera contenido de ticket formateado en Jira wiki markup, listo para pegar en issues de Jira.

```bash
npx k6-report ticket summary.json -f jira \
  --service-name "Payment API" \
  --environment staging \
  --profile load
```

```typescript
import { generateTicket } from "k6-report";

const { story, comment } = generateTicket(summary, {
  format: "jira",
  service: "Payment API",
  environment: "staging",
  profile: "load",
  reportUrl: "https://reports.internal/latest.html",
});

// story: descripcion principal del ticket (wiki markup)
// comment: comentario de seguimiento con metricas detalladas
```

**Estructura del ticket:**
- **Story**: Resumen del test, veredicto, hallazgos clave, detalles del ambiente
- **Comment**: Tabla completa de metricas, resultados de thresholds, anomalias

---

## GitHub Markdown

Genera contenido de ticket formateado para issues y pull requests de GitHub.

```bash
npx k6-report ticket summary.json -f github \
  --service-name "Auth API" \
  --environment production
```

```typescript
const { story, comment } = generateTicket(summary, {
  format: "github",
  service: "Auth API",
  environment: "production",
});
```

Misma estructura que Jira pero formateada con GitHub-flavored Markdown — secciones colapsables, listas de tareas y badges de estado.

---

## Slack Block Kit

Genera un mensaje de notificacion formateado para canales de Slack usando [Block Kit](https://api.slack.com/block-kit) JSON.

```typescript
import { generateMessage } from "k6-report";

const message = generateMessage(summary, {
  platform: "slack",
  service: "Payment API",
  environment: "production",
  reportUrl: "https://reports.internal/latest.html",
});

// Publicar en Slack via webhook o API
await fetch(webhookUrl, {
  method: "POST",
  body: message,
  headers: { "Content-Type": "application/json" },
});
```

**Incluye:**
- Veredicto pass/fail con color
- Metricas clave (requests, tasa de error, p95)
- Enlace al reporte HTML completo

---

## Microsoft Teams Adaptive Card

Genera una notificacion formateada para Microsoft Teams usando [Adaptive Cards](https://adaptivecards.io/).

```typescript
const message = generateMessage(summary, {
  platform: "teams",
  service: "Auth API",
  environment: "staging",
});

// Publicar en Teams via webhook
await fetch(teamsWebhookUrl, {
  method: "POST",
  body: message,
  headers: { "Content-Type": "application/json" },
});
```

---

## Comparacion de Formatos

| Formato | Caso de Uso | Salida | Analisis |
|---------|------------|--------|----------|
| HTML | Dashboards visuales, compartir con stakeholders | Reporte completo | Integrado |
| CSV | Hojas de calculo, pipelines de datos | Tabla de metricas | No |
| Markdown | Documentacion, comentarios de PR | Reporte de texto | Opcional |
| Jira | Seguimiento de bugs/issues | Story + comment | Opcional |
| GitHub | Seguimiento de issues, comentarios de PR | Story + comment | Opcional |
| Slack | Notificaciones de equipo | Block Kit JSON | Resumen |
| Teams | Notificaciones de equipo | Adaptive Card JSON | Resumen |
