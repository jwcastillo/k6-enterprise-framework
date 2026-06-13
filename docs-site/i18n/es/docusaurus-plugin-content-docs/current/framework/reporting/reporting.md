---
title: "Sistema de Reportes"
sidebar_position: 1
---
# Sistema de Reportes

Reportes HTML interactivos, exportación PDF/PNG, reportes de análisis LLM, comparación automática, análisis de tendencias, branding y redacción de PII.

---

## Tabla de Contenidos

1. [Resumen](#resumen)
2. [Secciones del Reporte HTML](#secciones-del-reporte-html)
3. [Generación de Reportes](#generación-de-reportes)
4. [Exportación PDF y PNG](#exportación-pdf-y-png)
5. [Reportes de Análisis LLM](#reportes-de-análisis-llm)
6. [Comparación Automática](#comparación-automática)
7. [Análisis de Tendencias](#análisis-de-tendencias)
8. [Branding y Personalización](#branding-y-personalización)
9. [Redacción de PII](#redacción-de-pii)
10. [Artefactos del Reporte](#artefactos-del-reporte)

---

## Resumen

El framework genera reportes HTML completos, con capacidad offline, después de cada ejecución de prueba. Los reportes son autocontenidos (cero dependencias CDN), accesibles según WCAG, e incluyen visualizaciones interactivas de Chart.js con tooltips, zoom y desplazamiento.

Capacidades clave:
- **17+ secciones de reporte** cubriendo KPIs, SLAs, latencia, throughput, errores, grupos, métricas personalizadas, web vitals y más
- **Exportación PDF/PNG** vía renderizado headless con Puppeteer
- **Análisis LLM** usando Claude para insights inteligentes de rendimiento
- **Comparación automática** con ejecuciones anteriores (tablas delta con badges de color)
- **Análisis de tendencias** a través de múltiples ejecuciones históricas
- **Branding personalizado** con logo de la organización, colores y nombre
- **Redacción de PII** de valores de tags sensibles

---

## Secciones del Reporte HTML

Cada reporte HTML generado incluye las siguientes secciones:

| # | Sección | Descripción |
|---|---------|-------------|
| 1 | **Header** | Metadatos del test: cliente, servicio, entorno, perfil, usuario, ID de ejecución, timestamp |
| 2 | **KPI Strip** | Métricas clave de un vistazo: tasa de checks aprobados, latencia avg/p95/p99, tasa de error, throughput, APDEX, estado SLA |
| 3 | **APDEX Gauge** | Indicador visual (0-1) con calificación de satisfacción codificada por colores |
| 4 | **Cumplimiento SLA/SLO** | Tabla tipo semáforo (verde/amarillo/rojo) por métrica SLO con valores reales vs objetivo |
| 5 | **Distribución de Latencia** | Gráfico interactivo con líneas de latencia p50, p95, p99 a lo largo del tiempo |
| 6 | **Gráfico de Throughput** | Requests por segundo a lo largo del tiempo con overlay de VUs |
| 7 | **Distribución de Errores** | Gráfico de desglose de errores 4xx vs 5xx |
| 8 | **Análisis de Grupos** | Timing y checks por grupo con indicadores de aprobado/fallido |
| 9 | **Métricas Personalizadas** | Paneles de Trends, Counters, Rates y Gauges para métricas definidas por el usuario |
| 10 | **Web Vitals** | Puntuaciones LCP, FCP, CLS, TTFB, INP con calificaciones bueno/necesita-mejora/deficiente |
| 11 | **Detalle de Checks** | Todos los checks de k6 con conteos de aprobados/fallidos y tasas de éxito |
| 12 | **Thresholds** | Todos los thresholds con estado aprobado/fallido y valores reales |
| 13 | **Comparación de Rendimiento** | Tabla delta vs ejecución anterior con cambios absolutos y porcentuales, badges de color, sparkline de evolución |
| 14 | **Salud del Generador** | Gráficos de CPU y memoria del generador de carga durante la prueba |
| 15 | **Alertas de Anomalías** | Anomalías detectadas y recomendaciones auto-generadas |
| 16 | **Detalles HTTP** | Detalles de request/response por endpoint |
| 17 | **Resumen Ejecutivo** | Resumen de alto nivel para stakeholders no técnicos |

---

## Generación de Reportes

Los reportes se generan automáticamente después de cada ejecución de prueba:

```bash
./bin/run-test.sh --client=acme --service=users --test=load

# Ubicación del reporte:
# reports/acme/users/YYYY-MM-DD_HHMMSS/
#   report.html        # Reporte HTML interactivo
#   summary.json       # Resumen JSON legible por máquina
#   metrics.json       # Datos de métricas en bruto
```

### Generación Manual de Reportes

```bash
# Regenerar reporte a partir de datos JSON existentes
node bin/generate-report.js \
  --input=reports/acme/users/2026-02-18_100000/summary.json \
  --output=reports/acme/users/2026-02-18_100000/report.html
```

---

## Exportación PDF y PNG

Exporta reportes a PDF o PNG para compartir en correos, presentaciones o documentación.

### Exportación PDF

```bash
# Exportar reporte HTML a PDF
node bin/export-report.js \
  --input=reports/acme/users/2026-02-18_100000/report.html \
  --format=pdf \
  --output=reports/acme/users/2026-02-18_100000/report.pdf
```

### Exportación PNG

```bash
# Exportar reporte HTML a PNG (captura de pantalla completa)
node bin/export-report.js \
  --input=reports/acme/users/2026-02-18_100000/report.html \
  --format=png \
  --output=reports/acme/users/2026-02-18_100000/report.png
```

### Requisitos

- Puppeteer debe estar instalado: `npm install puppeteer`
- Chromium se descarga automáticamente en el primer uso
- El renderizado PDF/PNG usa el mismo estilo que el HTML interactivo

### Opciones

| Opción | Descripción | Valor por defecto |
|--------|-------------|-------------------|
| `--format` | `pdf` o `png` | `pdf` |
| `--width` | Ancho del viewport en píxeles | `1200` |
| `--scale` | Factor de escala del PDF | `1.0` |
| `--landscape` | Orientación horizontal | `false` |

---

## Reportes de Análisis LLM

El framework puede generar análisis inteligente de rendimiento usando Claude LLM, produciendo reportes detallados en markdown con insights, explicaciones de anomalías y recomendaciones accionables.

### Archivos Generados

Después de cada análisis LLM, se crean dos archivos:

| Archivo | Descripción |
|---------|-------------|
| `analysis-{timestamp}.md` | Análisis técnico con anomalías, causas raíz, correlaciones y recomendaciones |
| `message-{timestamp}.md` | Resumen ejecutivo adecuado para distribución por Slack/Teams/email |

### Ejecutar Análisis LLM

```bash
# Analizar la última ejecución
node bin/analyze-report.js \
  --client=acme \
  --service=users \
  --latest

# Analizar una ejecución específica
node bin/analyze-report.js \
  --input=reports/acme/users/2026-02-18_100000/summary.json
```

### Contenido del Reporte de Análisis

El archivo `analysis-*.md` incluye:

- **Resumen de rendimiento**: evaluación general del estado de salud
- **Detección de anomalías**: anomalías estadísticas identificadas vía z-score, IQR, CUSUM
- **Análisis de causa raíz**: correlaciones entre métricas (ej., pico de CPU + aumento de latencia)
- **Evaluación de cumplimiento SLO**: estado actual y proyecciones de riesgo
- **Comparación con datos históricos**: detección de regresiones contra la mejor ejecución histórica
- **Recomendaciones accionables**: lista priorizada de mejoras con impacto esperado

### Contenido del Reporte de Mensaje

El archivo `message-*.md` incluye:

- **Veredicto en una línea**: aprobado/fallido/en-riesgo con métrica clave
- **Resumen tipo semáforo**: indicadores rojo/amarillo/verde por categoría
- **Top 3 hallazgos**: observaciones más críticas
- **Acciones recomendadas**: pasos inmediatos para el equipo

### Configuración

```bash
# Variables de entorno
export ANTHROPIC_API_KEY=sk-ant-...
export AI_ANALYSIS_MODEL=claude-sonnet-4-6  # valor por defecto
export AI_MAX_TOKENS=4096                    # tokens máximos de salida
```

---

## Comparación Automática

Cada ejecución se compara automáticamente con la ejecución anterior de la misma combinación cliente/servicio/perfil.

### Tabla de Comparación

El reporte HTML incluye una sección "Comparación de Rendimiento" con:

| Columna | Descripción |
|---------|-------------|
| Métrica | Nombre de la métrica (ej., `http_req_duration p95`) |
| Anterior | Valor de la ejecución anterior |
| Actual | Valor de la ejecución actual |
| Delta | Cambio absoluto |
| Delta % | Cambio porcentual |
| Estado | Badge de color: verde (mejoró), amarillo (estable), rojo (degradado) |

### Sparkline

Un mini gráfico sparkline muestra la evolución de las métricas clave a lo largo de las últimas 10 ejecuciones.

### Respaldo en Primera Ejecución

Si no existe una ejecución anterior, la sección de comparación muestra "Primera ejecución — no hay línea base disponible" en lugar de datos vacíos.

### Forzar Comparación

```bash
# Comparar contra una ejecución anterior específica
./bin/run-test.sh --client=acme --service=users --test=load \
  --compare-with=reports/acme/users/2026-02-15_100000/summary.json
```

---

## Análisis de Tendencias

El `TrendVisualizer` (`src/reporting/trend-visualizer.ts`) agrega datos de múltiples ejecuciones históricas para identificar tendencias.

### Indicadores de Tendencia

| Tendencia | Criterio | Acción |
|-----------|----------|--------|
| Mejorando | 3+ mejoras consecutivas | Ninguna |
| Estable | Varianza < 5% en las últimas 5 ejecuciones | Ninguna |
| Degradando | 3+ degradaciones consecutivas | Investigar |
| Volátil | Varianza > 20% en las últimas 5 ejecuciones | Estabilizar entorno |

### Generación de Reportes de Tendencia

```bash
# Generar análisis de tendencia de los últimos 30 días
node bin/trend-report.js \
  --client=acme \
  --service=users \
  --days=30
```

---

## Branding y Personalización

Personaliza la apariencia del reporte con el branding de tu organización.

### Configuración

Coloca los assets de branding en `clients/{nombre}/branding/`:

```
clients/acme/branding/
  logo.png           # o logo.svg, logo.jpg
  branding.json      # configuración de branding
```

### branding.json

```json
{
  "orgName": "Acme Corp",
  "primaryColor": "#0066cc",
  "logoMaxBytes": 512000
}
```

### Formatos de Logo Soportados

| Formato | Tamaño Máximo | Notas |
|---------|---------------|-------|
| PNG | 512 KB | Recomendado para mejor compatibilidad |
| JPG | 512 KB | Soportado |
| SVG | 512 KB | Sanitizado por seguridad (sin scripts, sin manejadores de eventos) |

---

## Redacción de PII

El generador de reportes redacta automáticamente los valores de tags que puedan contener información de identificación personal.

### Patrones de Tags Redactados

Los tags que coincidan con estos patrones tienen sus valores reemplazados con `****`:

- `email`, `phone`, `ssn`, `user_id`, `ip_addr`, `userid`, `username`, `personal`

### Ejemplo

```
# Tag original: user_email=alice@example.com
# En el reporte: user_email=****
```

El HTML generado incluye el comentario `<!-- Tags (PII fields redacted) -->` para trazabilidad de auditoría.

---

## Artefactos del Reporte

### Estructura de Directorios

```
reports/{cliente}/{servicio}/{timestamp}/
  report.html              # Reporte HTML interactivo
  summary.json             # Resumen legible por máquina
  metrics.json             # Métricas en bruto
  report.pdf               # (opcional) Exportación PDF
  report.png               # (opcional) Exportación PNG
  analysis-{ts}.md         # (opcional) Análisis LLM
  message-{ts}.md          # (opcional) Mensaje ejecutivo LLM
  comparison.json          # (opcional) Datos de comparación
```

### Extensiones de Archivo Permitidas

Por seguridad, solo se permiten estas extensiones al escribir artefactos de reporte:

`.html` `.json` `.jsonl` `.csv` `.txt` `.md`

### Integración CI/CD

Los reportes pueden subirse como artefactos de CI/CD:

```yaml
# GitHub Actions
- name: Upload test report
  uses: actions/upload-artifact@v4
  with:
    name: k6-report-${{ github.run_id }}
    path: reports/acme/users/*/report.html

# GitLab CI
artifacts:
  paths:
    - reports/acme/users/*/report.html
  expire_in: 30 days
```

---

## Insignia de Puntuación Global

Cada reporte HTML renderiza una celda KPI **Overall** en la franja de métricas (T-262). El valor es
un entero de 0 a 100 y el umbral de color sigue la convención de instancia saludable de GPT:

| Rango de puntuación | Color  | Significado                            |
|---------------------|--------|----------------------------------------|
| ≥ 90                | Verde  | Saludable — todos o casi todos los checks pasan |
| 70–89               | Ámbar  | Degradado — algunas advertencias o fallos       |
| < 70                | Rojo   | No saludable — fallos significativos            |

### Orden de resolución de la puntuación

El reporte prefiere la puntuación más completa del motor cuando está disponible; de lo contrario
utiliza una derivación solo de checks para que siempre se renderice una insignia:

1. **`extendedMetrics.score`** — si `MetricsEngine` se ejecutó y el resumen JSON contiene
   `extendedMetrics.score`, ese valor (ponderado pass/warn/fail sobre todas las categorías de
   métricas) se usa tal cual.
2. **Derivación solo de checks** — si `extendedMetrics.score` no está disponible, el generador
   llama a `scoreFromCounts({ pass: checks.pass, warn: 0, fail: checks.fail })` usando los datos
   de checks de k6. Esta fórmula solo cuenta pass y fail (sin peso para warn) y siempre produce
   una calificación.
3. **Fallback vacío** — si ninguna fuente está disponible, `scoreFromCounts({ pass:0, warn:0, fail:0 })`
   devuelve 100/A para que la celda nunca quede en blanco.

Consulta [Motor de Métricas → Puntuación Global de Resultados](/es/docs/framework/metrics/metrics-engine#puntuación-global-de-resultados)
para la tabla completa de calificaciones y la API de `scoreFromCounts`.

---

## Documentación Relacionada

- [Dashboards Grafana](/es/docs/framework/observability/grafana) — visualización en tiempo real durante la ejecución de pruebas
- [SLA/SLO](/es/docs/framework/metrics/sla-slo) — definiciones de SLO y evaluación
- [Grupos y Métricas Personalizadas](/es/docs/framework/helpers/groups-custom-metrics) — análisis de grupos y métricas personalizadas en reportes
- [Motor de Métricas](/es/docs/framework/metrics/metrics-engine) — 125+ métricas recolectadas por el framework
