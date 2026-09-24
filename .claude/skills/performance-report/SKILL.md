---
name: performance-report
description: Assemble and present a client-facing performance test report from k6-enterprise-framework run artifacts. Use when the user wants to turn run outputs (summary JSON, resumen etapa×escalón, analysis/message MD, comparison) into a deliverable report for a client — e.g. "armá el informe para Falabella", "present the load test results", "generá el reporte de la corrida". Delivered under the consultancy brand (default Timestamp) to the client.
---

# Performance Report — entregable para el cliente

Convierte los artefactos de una o varias corridas del framework en **un informe
que la consultora (Timestamp) presenta al cliente** (p. ej. Falabella). No corre
tests ni toca producción: solo consume artefactos ya generados y arma/presenta
el documento.

## Cuándo usarlo

- El usuario pide armar/generar/presentar el informe de una campaña de carga.
- Hay corridas hechas y sus artefactos en `reports/<cliente>/<escenario>/`.
- Se necesita un entregable formal para el cliente, no el volcado técnico crudo.

## Entradas (artefactos del run)

Por cada escenario corrido (`smoke`, `baseline`, `exploratoria`, `cyber`), en
`reports/<cliente>/<flujo>/`:

| Artefacto | Qué aporta |
|---|---|
| `summary-<ts>.json` | Métricas enriquecidas (p50/p95/p99, error rate, throughput, APDEX, SLA) |
| `resumen-<escenario>.json` / `.txt` | Tablas etapa × escalón, aseguradora × escalón, primer escalón de degradación/quiebre |
| `analysis-<ts>.md` | Análisis técnico por corrida |
| `message-<ts>.md` | Resumen corto por corrida |
| `comparison-<ts>.md` | Comparación vs baseline (regresión) |
| `metrics-<ts>.csv` | Serie para gráficos |

Contexto adicional: `clients/<cliente>/docs/PLAN.md` (objetivos §1, alcance §3,
umbrales §11, entregables §16, límites conocidos como el techo del replay §5.5).

## Estructura del informe (el entregable)

1. **Encabezado** — "Timestamp · Informe de pruebas de carga · <Cliente>",
   fecha, ventana horaria de la campaña, ambiente (prod/preprod), Run IDs.
2. **Resumen ejecutivo** (media página) — capacidad sostenible por etapa, punto
   de quiebre y a qué tasa, veredicto para el evento (¿aguanta el pico Cyber?),
   1–3 hallazgos clave. Lead = la respuesta, no "este documento describe…".
3. **Objetivos y respuestas** — mapear una a una las preguntas del PLAN §1
   (cotizaciones/s antes de degradar, dónde/cuándo quiebra, qué aseguradora cae
   primero, si aguanta el pico).
4. **Resultados por escenario** — tabla **etapa × escalón** (n, p50, p95, p99,
   éxito de negocio, error HTTP) y el **primer escalón de degradación y de
   quiebre** por etapa. Baseline, exploratoria y Cyber por separado.
5. **Por aseguradora** (si el flujo cotiza) — presencia, p95 y cuál se degrada o
   cae primero.
6. **Hallazgos** — con evidencia y número (p. ej. `quotation` p95 = 13,7 s con
   1 usuario, sobre el timeout de negocio de 10 s).
7. **Límites de la prueba** — inyector (techo por `dropped_iterations`),
   ambiente (preprod ≠ prod), origen de la medición (EIP nube, no ISP chileno),
   y las limitaciones de método que apliquen (ver Guardarraíles).
8. **Recomendaciones** — accionables, priorizadas.
9. **Anexos** — Run IDs, config (escenarios, umbrales), lista de artefactos.

Sizing: informe sobrio, tablas antes que prosa. Cada tabla y sección responde a
un objetivo del §1; nada de relleno.

## Cómo armarlo

1. Identificar cliente, flujo y escenarios corridos; listar los artefactos.
2. Leer cada `resumen-*.json` (tablas etapa × escalón) y `summary-*.json`
   (SLA, APDEX). Tomar los números de ahí, no estimarlos.
3. Llenar la estructura de arriba. Un dato faltante = una línea de "pendiente",
   nunca inventado.
4. Para "capacidad sostenible": el mayor escalón antes de cruzar degradación por
   etapa (del campo primer-escalón del resumen). Para "quiebre": el escalón que
   cruzó el umbral de quiebre.
5. Convertir fechas relativas a absolutas; incluir la ventana de la corrida.

## Cómo presentarlo

- **Documento vivo (preferido):** crear un Claude Doc titulado
  `Informe de carga <Cliente> — <fecha>` para que el cliente lo lea/comente.
- **HTML/PDF:** si piden archivo, reusar el banner/dashboard HTML del framework
  (`generate-artifacts.js --html`) o exportar el MD.
- Marca **Timestamp** en encabezado y pie; el título lleva fecha (timestamp de
  la campaña). **Identidad visual** (logo SVG, paleta, fuentes) en
  `references/timestamp-brand.md`: fondo `#faf9f7`, texto `#1a1a1a`, acento
  terracota `#c97a4e`, PASS en verde `#2d8a56`; títulos Space Grotesk, cuerpo
  Inter, métricas/IDs JetBrains Mono. Aplicarla al HTML/PDF y a la portada.

## Guardarraíles

- **Sin PII ni secretos.** Nunca RUT reales, cookies, tokens, correos de
  personas, ni `data/replay-capturado.json`. Solo métricas agregadas.
- **Honestidad de método.** Declarar las limitaciones que apliquen a esa
  campaña, tomándolas del PLAN, por ejemplo:
  - **Replay (techo, PLAN §5.5):** con replay de capturas se mide capacidad del
    path de lectura/cómputo (`vehicle`->`quotation`); la escritura
    `savequotation` **no se mide** (repite `quoteId`, el backend puede rechazar
    duplicados). No presentar la capacidad de `savequotation` como del sistema.
  - **Ambiente:** preprod no se extrapola a prod sin declararlo.
  - **Techo del inyector:** lo que exceda es `dropped_iterations`, límite de la
    prueba, no del sistema.
- **Números exactos con unidades**; nada de adjetivos sin cifra.
- El informe es para humanos del cliente: prosa clara y normal, sin jerga de
  tooling ni Run IDs en el cuerpo (van al anexo).

## Ejemplo de invocación

> "armá el informe para Falabella de la corrida de esta noche"

Lee `reports/falabella-auto/flow_replay-cifrado/` (o el flujo corrido), toma las
tablas etapa × escalón, arma la estructura, aplica el guardarraíl del techo del
replay, y publica el Claude Doc "Informe de carga Falabella — <fecha>".
