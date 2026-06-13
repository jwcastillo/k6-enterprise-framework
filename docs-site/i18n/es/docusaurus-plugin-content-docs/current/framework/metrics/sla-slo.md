---
title: "SLA / SLO"
sidebar_position: 2
---
# SLA / SLO

Definicion de SLOs por servicio, evaluacion automatica por ejecucion y reportes mensuales de cumplimiento.

---

## Tabla de contenidos

1. [Conceptos](#conceptos)
2. [Definición de SLOs](#definicion-de-slos)
3. [Evaluación automática](#evaluacion-automatica)
4. [Clasificación de tres estados](#clasificacion-de-tres-estados)
5. [Puntuación APDEX](#puntuación-apdex)
6. [Reportes mensuales](#reportes-mensuales)
7. [Mejores prácticas](#mejores-practicas)

---

## Conceptos

- **SLA (Service Level Agreement)**: acuerdo contractual entre un proveedor y un cliente sobre el nivel de servicio esperado.
- **SLO (Service Level Objective)**: objetivo tecnico interno que define cuando un servicio esta cumpliendo su SLA. Un SLO en riesgo es una advertencia temprana antes de incumplir el SLA.
- **Error budget**: margen de incumplimiento permitido por periodo (ej. 99.9% availability = 8.7 horas de downtime/año).
- **APDEX (Application Performance Index)**: puntuación estandarizada (0-1) que mide la satisfacción del usuario basándose en umbrales de tiempo de respuesta.

En este framework, los SLOs se definen por servicio y se evaluan automaticamente al final de cada ejecucion de test.

---

## Definicion de SLOs

Los SLOs se definen en `clients/{nombre}/config/slos.json`:

```json
{
  "version": "1.0",
  "services": [
    {
      "serviceName": "users",
      "metrics": [
        {
          "name": "http_req_duration_p95",
          "target": 500,
          "riskMargin": 0.1,
          "unit": "ms",
          "description": "El P95 de latencia no debe superar 500ms"
        },
        {
          "name": "http_req_failed_rate",
          "target": 0.01,
          "riskMargin": 0.1,
          "unit": "ratio",
          "description": "La tasa de error no debe superar el 1%"
        },
        {
          "name": "http_req_duration_p99",
          "target": 1000,
          "riskMargin": 0.05,
          "unit": "ms",
          "description": "El P99 de latencia no debe superar 1000ms"
        }
      ]
    },
    {
      "serviceName": "payments",
      "metrics": [
        {
          "name": "http_req_duration_p95",
          "target": 300,
          "riskMargin": 0.1,
          "unit": "ms"
        },
        {
          "name": "http_req_failed_rate",
          "target": 0.001,
          "riskMargin": 0.1,
          "unit": "ratio"
        }
      ]
    }
  ]
}
```

### Metricas disponibles

| Nombre de metrica            | Descripcion                          | Unidad |
|------------------------------|--------------------------------------|--------|
| `http_req_duration_avg`      | Latencia promedio                    | ms     |
| `http_req_duration_p90`      | Latencia percentil 90                | ms     |
| `http_req_duration_p95`      | Latencia percentil 95                | ms     |
| `http_req_duration_p99`      | Latencia percentil 99                | ms     |
| `http_req_failed_rate`       | Tasa de solicitudes fallidas         | ratio  |
| `http_req_duration_max`      | Latencia maxima                      | ms     |
| `iterations_rate`            | Iteraciones por segundo              | rps    |

### Campo `riskMargin`

Define el umbral de alerta como fraccion del target. Si `target=500ms` y `riskMargin=0.1`, el rango de riesgo es `[450ms, 500ms]`. Un valor entre 450ms y 500ms clasifica como `en_riesgo`.

---

## Evaluacion automatica

El `SloEvaluator` (`src/core/slo-evaluator.ts`) se ejecuta automaticamente al final de cada test si hay SLOs definidos para el servicio bajo prueba.

```bash
./bin/run-test.sh --client=acme --service=users --test=load

# Al finalizar, el evaluador imprime:
# [SLO] users — http_req_duration_p95: 420ms (target: 500ms) → CUMPLE
# [SLO] users — http_req_failed_rate: 0.008 (target: 0.01)   → EN RIESGO ⚠
# [SLO] users — http_req_duration_p99: 850ms (target: 1000ms) → CUMPLE
```

Si un SLO esta `en_riesgo`, se emite una advertencia preventiva en consola antes de que el SLA sea incumplido.

### Integracion con reportes

Los resultados de SLO se incluyen automaticamente en:

- **Reporte HTML**: seccion "SLA/SLO" con indicadores visuales de semaforo (verde/amarillo/rojo).
- **JSON summary**: campo `sloCompliance` con estructura:

```json
{
  "sloCompliance": [
    {
      "service": "users",
      "metric": "http_req_duration_p95",
      "target": 500,
      "actual": 420,
      "unit": "ms",
      "status": "cumple"
    },
    {
      "service": "users",
      "metric": "http_req_failed_rate",
      "target": 0.01,
      "actual": 0.008,
      "unit": "ratio",
      "status": "en_riesgo"
    }
  ]
}
```

---

## Clasificacion de tres estados

| Estado      | Condicion                                      | Visual | Accion recomendada             |
|-------------|------------------------------------------------|--------|-------------------------------|
| `cumple`    | `actual < target × (1 − riskMargin)`             | Verde    | Ninguna                        |
| `en_riesgo` | `target × (1 − riskMargin) ≤ actual ≤ target`   | Amarillo | Investigar tendencia           |
| `incumple`  | `actual > target`                                | Rojo     | Alerta inmediata, abrir ticket |

Ejemplo con `target=500ms` y `riskMargin=0.1`:

- `actual=400ms` → `cumple` (< 450ms)
- `actual=460ms` → `en_riesgo` (entre 450ms y 500ms)
- `actual=510ms` → `incumple` (> 500ms)

---

## Puntuación APDEX

El framework calcula la puntuación **APDEX** (Application Performance Index) para cada ejecución de test, proporcionando una medida estandarizada de satisfacción del usuario.

### Fórmula

```
APDEX = (satisfied_count + tolerating_count / 2) / total_count
```

Donde:
- **Satisfecho (Satisfied)**: tiempo de respuesta ≤ T (umbral objetivo)
- **Tolerando (Tolerating)**: T < tiempo de respuesta ≤ 4T
- **Frustrado (Frustrated)**: tiempo de respuesta > 4T

### Configuración

Los umbrales APDEX se derivan de los targets SLO o pueden configurarse explícitamente:

```json
{
  "apdex": {
    "threshold": 500,
    "toleratingMultiplier": 4
  }
}
```

### Interpretación del Score

| Score APDEX | Calificación | Significado |
|-------------|-------------|-------------|
| 0.94 - 1.00 | Excelente | Los usuarios están muy satisfechos |
| 0.85 - 0.93 | Bueno | La mayoría de usuarios están satisfechos |
| 0.70 - 0.84 | Aceptable | Algunos usuarios están insatisfechos |
| 0.50 - 0.69 | Pobre | Muchos usuarios están insatisfechos |
| 0.00 - 0.49 | Inaceptable | La mayoría de usuarios están frustrados |

### Integración con Grafana

La puntuación APDEX se muestra como panel de gauge en el dashboard **Load Test Overview**, con umbrales de color que coinciden con la tabla de calificación anterior.

---

## Reportes mensuales

El comando `bin/slo-report.js` agrega los resultados de todas las ejecuciones del mes y genera un reporte de cumplimiento.

```bash
# Reporte de febrero 2026 para el cliente acme
bin/slo-report.js --client=acme --month=2026-02

# Salida en: reports/acme/slo-compliance/2026-02/
#   slo-compliance-2026-02.html
#   slo-compliance-2026-02.json
```

### Contenido del reporte mensual

- **Porcentaje de cumplimiento por SLO**: `(ejecuciones que cumplen / total) * 100`
- **Tendencia**: `mejorando`, `estable` o `degradandose` (basado en los ultimos 3 meses)
- **Periodos de incumplimiento**: fecha, hora y link al reporte individual de cada ejecucion
- **Recomendaciones automaticas**: sugerencias basadas en patrones observados

### Advertencia de datos insuficientes

Si hay menos de 5 ejecuciones en el mes, el reporte advierte que los datos son insuficientes para analisis estadistico.

---

## Ejemplo de Monitoreo de SLIs

El framework incluye un escenario dedicado de monitoreo de SLIs en `clients/examples/scenarios/integration/16-sli-monitoring.ts` que demuestra:

- **Metricas SLI custom**: `sli_availability` (Rate), `sli_latency_ms` (Trend), `sli_correctness` (Rate), `sli_throughput_total` (Counter), `sli_errors_total` (Counter), `sli_active_vus` (Gauge)
- **Thresholds alineados a SLO**: con circuit breaker `abortOnFail` para SLOs criticos
- **Observabilidad completa**: trazas (W3C), labels de profiling Pyroscope, logging estructurado

```bash
# Ejecutar el escenario de monitoreo SLI con observabilidad completa
./bin/run-test.sh --client=examples --scenario=integration/16-sli-monitoring \
  --profile=smoke --observability

# Las definiciones de SLO para este escenario estan en:
# clients/examples/config/slos.json
```

El escenario rastrea SLIs a traves de 4 tipos de operacion (lectura, escritura, validacion de estado, sensible a latencia) y produce metricas visibles tanto en el resumen de k6 como en los dashboards de Grafana.

---

## Mejores practicas

**Definir SLOs conservadores al inicio**: comenzar con targets mas relajados que el SLA contractual. Ajustar gradualmente segun la linea base observada.

**Usar `riskMargin` del 10%**: permite detectar degradaciones antes de incumplir el SLA. Un `riskMargin` de 0.05 es mas estricto; de 0.2 es mas permisivo.

**Ejecutar tests de carga periodicamente**: el evaluador SLO solo actua si hay ejecuciones. Automatizar tests con cron o pipeline CI/CD para obtener datos continuos.

**No definir SLOs solo para smoke tests**: los perfiles `smoke` y `quick` tienen menos VUs y pueden dar resultados optimistas. Definir SLOs basados en el perfil `load` o superior.

**Revisar el reporte mensual antes de cada reunion de SLA**: el reporte agrega automaticamente el cumplimiento y la tendencia, listos para presentar al cliente.
