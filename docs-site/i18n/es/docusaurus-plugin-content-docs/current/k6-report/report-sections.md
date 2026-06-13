---
title: Secciones del Reporte HTML
sidebar_position: 4
---

# Secciones del Reporte HTML

El reporte HTML esta organizado en 4 bloques logicos conteniendo 18 secciones. Cada seccion se renderiza condicionalmente — si los datos no estan disponibles, la seccion se omite. El reporte es completamente autocontenido con CSS, JS y graficos SVG embebidos.

---

## Estructura del Reporte

```
Bloque de Vista General
  Header                  -- Nombre del test, timestamp, badge de veredicto, branding
  Alerta de Threshold     -- Banner rojo cuando los thresholds fallan
  Resumen Ejecutivo       -- Evaluacion de rendimiento en lenguaje natural
  Strip de KPI            -- 4 metricas clave de un vistazo
  Vista General del Test  -- Config del escenario, VUs, duracion, iteraciones

Bloque de Latencia
  Distribucion de Latencia -- Grafico de barras p50/p90/p95/p99 con overlay de threshold
  Componentes de Latencia  -- Desglose DNS, TLS, connect, wait, receive

Bloque de Trafico
  Distribucion de VUs     -- Asignacion de usuarios virtuales entre escenarios
  Perfil de Carga         -- Visualizacion de etapas de ramp-up/down
  Desglose de Errores     -- Codigos de error HTTP con conteos y porcentajes

Bloque de Calidad
  Cumplimiento SLA        -- Tabla pass/fail para todos los thresholds de k6
  Detalle de Checks       -- Resultados de check() agrupados por grupo
  Metricas de Negocio     -- Metricas de negocio personalizadas con thresholds
  Metricas Custom         -- Todas las metricas no estandar (counters, gauges, rates, trends)
  Monitoreo de Recursos   -- CPU/memoria del generador cuando hay datos disponibles

Bloque de Analisis
  Deteccion de Anomalias  -- Outliers, picos y patrones sospechosos
  Recomendaciones         -- Sugerencias accionables basadas en resultados
  Comparacion             -- Diff lado a lado con baseline (cuando se usa --compare)
```

---

## Detalle de Secciones

### Header

Se muestra en la parte superior del reporte con:
- Nombre del test (del nombre del archivo o `context.testName`)
- Timestamp de generacion del reporte
- Badge de veredicto pass/fail (verde/rojo)
- Branding de la organizacion (nombre, logo, color primario) cuando esta configurado

### Alerta de Threshold

Un banner rojo prominente que se muestra solo cuando los thresholds de k6 han fallado. Atrae inmediatamente la atencion a violaciones de SLA.

### Resumen Ejecutivo

Un parrafo en lenguaje natural resumiendo el resultado del test. Incluye:
- Veredicto general (pass/fail)
- Indicadores clave de rendimiento en contexto
- Hallazgos notables (tasas de error altas, endpoints lentos, etc.)

### Strip de KPI

Cuatro metricas clave mostradas como numeros grandes:
- **Total de Requests** — conteo de `http_reqs`
- **Tiempo de Respuesta Promedio** — promedio de `http_req_duration`
- **Tasa de Error** — tasa de `http_req_failed`
- **Latencia p95** — `http_req_duration` p(95)

Codificado por colores: verde cuando es saludable, ambar/rojo cuando se violan thresholds.

### Vista General del Test

Detalles de configuracion de la ejecucion del test:
- Nombre del escenario y tipo de executor
- Numero de VUs (min/max)
- Duracion del test
- Total de iteraciones completadas
- Datos enviados/recibidos

### Distribucion de Latencia

Visualizacion en grafico de barras de percentiles de latencia:
- p50 (mediana), p90, p95, p99
- Linea de threshold overlay cuando hay thresholds definidos para `http_req_duration`
- Gradiente de color de verde (p50) a rojo (p99)

### Componentes de Latencia

Desglose de donde se gasta el tiempo en cada request HTTP:
- Busqueda DNS
- Handshake TLS
- Conexion TCP
- Espera (TTFB)
- Recepcion

### Distribucion de VUs

Como se asignan los usuarios virtuales entre escenarios (para tests multi-escenario).

### Perfil de Carga

Representacion visual de las etapas de ramp-up y ramp-down definidas en `options.stages` o `options.scenarios`.

### Desglose de Errores

Tabla de respuestas de error HTTP:
- Codigos de estado (4xx, 5xx)
- Conteo por codigo de estado
- Porcentaje del total de requests
- Ordenado por frecuencia

### Cumplimiento SLA

Tabla pass/fail para cada threshold de k6:
- Expresion del threshold
- Nombre de la metrica
- Valor actual vs. threshold
- Estado pass/fail

### Detalle de Checks

Resultados de llamadas `check()` agrupados por grupo de check:
- Nombre del check
- Conteo de pass / total
- Porcentaje de tasa de pass
- Detalles de fallos

### Metricas de Negocio

Metricas de nivel de negocio personalizadas (etiquetadas con `business:true` o convencion de nombres custom) mostradas con su estado de threshold.

### Metricas Custom

Todas las metricas no estandar recolectadas durante el test:
- Counters, Gauges, Rates, Trends
- Resumen estadistico completo (avg, min, max, p90, p95, p99)

### Monitoreo de Recursos

Salud de la maquina generadora cuando hay datos de `GeneratorHealth` disponibles:
- Uso de CPU
- Uso de memoria
- I/O de red

### Deteccion de Anomalias

Anomalias detectadas automaticamente:
- Outliers estadisticos (metricas fuera del rango normal)
- Picos repentinos en latencia o tasa de error
- Alto coeficiente de variacion

### Recomendaciones

Sugerencias accionables generadas a partir de los resultados del test:
- Oportunidades de optimizacion de rendimiento
- Recomendaciones de escalado de infraestructura
- Mejoras de configuracion
- Priorizadas por impacto (alto/medio/bajo)

### Comparacion

Diff lado a lado con una ejecucion baseline (cuando se usa `--compare`):
- Delta por metrica y cambio porcentual
- Indicadores de regresion/mejora
- Resumen: conteo de metricas mejoradas, regresadas y estables

---

## Temas

El reporte soporta temas duales:
- **Modo oscuro** (default) — optimizado para visualizacion en pantalla
- **Modo claro** — optimizado para impresion y exportacion PDF

Los usuarios pueden alternar entre temas usando el boton en el header del reporte.

---

## Branding

Personaliza la apariencia del reporte via flags CLI u opciones de API:

```bash
npx k6-report generate summary.json \
  --branding-org "Acme Corp" \
  --branding-color "#e11d48" \
  --branding-logo ./logo.png
```

```typescript
generateReport(json, {
  branding: {
    orgName: "Acme Corp",
    primaryColor: "#e11d48",
    logoBase64: "data:image/png;base64,..."
  }
});
```

El color primario se aplica a:
- Gradiente del fondo del header
- Acento del strip de KPI
- Colores de graficos
- Colores de enlaces
