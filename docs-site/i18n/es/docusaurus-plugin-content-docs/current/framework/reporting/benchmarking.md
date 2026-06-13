---
title: "Benchmarking del Framework"
sidebar_position: 2
---
# Benchmarking del Framework

Medicion del overhead del framework, interpretacion de resultados, monitoreo de salud del generador de carga y guia de escalamiento.

---

## Tabla de contenidos

1. [Por que hacer benchmarking](#por-que-hacer-benchmarking)
2. [Suite de benchmark interno](#suite-de-benchmark-interno)
3. [Monitoreo de salud del generador](#monitoreo-de-salud-del-generador)
4. [Advertencias de overhead](#advertencias-de-overhead)
5. [Interpretacion de resultados](#interpretacion-de-resultados)
6. [Guia de escalamiento](#guia-de-escalamiento)

---

## Por que hacer benchmarking

El framework añade overhead medible sobre k6 base: carga de configuracion, validacion de schemas, logging, evaluacion de SLOs, etc. Si este overhead es significativo respecto al tiempo de respuesta del servicio bajo prueba, los resultados del test podrian estar distorsionados.

El cliente `_benchmark` mide este overhead en tu entorno especifico para que puedas:

- Conocer la linea base de overhead antes de ejecutar tests formales
- Detectar si una nueva version del framework aumenta el overhead
- Tomar decisiones de escalamiento basadas en datos reales

---

## Suite de benchmark interno

El cliente `_benchmark` (`clients/_benchmark/`) contiene escenarios de medicion del framework.

### Ejecutar el benchmark

```bash
# Benchmark completo (5-10 minutos)
./bin/run-test.sh --client=_benchmark --service=baseline --test=load

# Smoke rapido para verificar que todo funciona (~1 minuto)
./bin/run-test.sh --client=_benchmark --service=baseline --test=smoke
```

### Que mide el benchmark

El escenario `baseline.ts` mide:

| Metrica                          | Descripcion                                              |
|----------------------------------|----------------------------------------------------------|
| Framework initialization time    | Tiempo de carga de config, schemas y validacion inicial  |
| Per-request overhead             | Overhead por cada iteracion del VU (ms)                  |
| Memory per VU                    | Memoria adicional consumida por VU por el framework      |
| Logging throughput               | Entradas de log por segundo sin degradar el test         |
| SLO evaluation time              | Tiempo de evaluacion de SLOs al finalizar el test        |

### Salida esperada

```
Framework Benchmark — Baseline Results
────────────────────────────────────────
Init time:           45ms      (target: < 500ms)  ✓
Per-request overhead: 0.8ms    (target: < 2ms)    ✓
Memory per VU:        2.1 MB   (target: < 5 MB)   ✓
Logging throughput:  12,000/s  (target: > 5,000/s) ✓
SLO eval time:        12ms     (100 executions)   ✓
```

### Comparar contra una linea base anterior

```bash
# Guardar resultado actual
./bin/run-test.sh --client=_benchmark --service=baseline --test=load
# El reporte JSON se guarda en reports/_benchmark/

# Comparar con la ejecucion anterior (auto-compare integrado)
./bin/run-test.sh --client=_benchmark --service=baseline --test=load --compare
```

---

## Monitoreo de salud del generador

El `GeneratorHealthMonitor` (`src/node/generator-health.ts` — Node-only; reubicado desde `src/observability/` en Phase 4 / ARC-06) muestrea CPU y memoria del generador de carga cada 5 segundos durante la ejecucion del test.

### Activacion automatica

El monitoreo se activa automaticamente en perfiles formales (`load`, `stress`, `soak`, `breakpoint`). En `smoke` y `quick` esta desactivado por defecto.

```bash
# Forzar monitoreo en cualquier perfil
./bin/run-test.sh --client=acme --service=users --test=smoke --monitor-health
```

### Metricas muestreadas

| Metrica          | Descripcion                                              | Umbral de warning |
|------------------|----------------------------------------------------------|-------------------|
| CPU usage        | Porcentaje de CPU usada por el proceso k6               | > 80%             |
| Memory RSS       | Memoria residente del proceso (MB)                       | > 85% de RAM      |
| Memory heap used | Heap de Node.js usado (para el contexto de bin/)         | > 90% de heap max |

### Compatibilidad con Docker

El monitor detecta automaticamente si corre dentro de un contenedor Docker y lee las metricas desde cgroups (`/sys/fs/cgroup/`) en lugar de `os.cpus()`.

### Seccion en el reporte HTML

Al finalizar el test, el reporte HTML incluye una seccion **"Generator Health"** con:

- Grafico de CPU a lo largo del tiempo (series temporales de cada muestra)
- Grafico de memoria RSS
- Indicadores de si algun umbral fue superado durante el test
- Numero total de muestras tomadas y duracion del monitoreo

---

## Advertencias de overhead

El `OverheadDetector` (`src/observability/overhead-detector.ts`) detecta condiciones que pueden distorsionar los resultados antes de iniciar la ejecucion.

### Advertencias emitidas

| Codigo            | Condicion                                              | Severidad |
|-------------------|--------------------------------------------------------|-----------|
| `DEBUG_IN_FORMAL` | Debug logging activo en un perfil formal               | warning   |
| `CHAOS_IN_FORMAL` | Chaos injection activo sin `--no-chaos` explicito      | warning   |
| `HIGH_VU_COUNT`   | VUs > 5,000 en un solo generador                       | warning   |
| `HIGH_OVERHEAD`   | Overhead medido > 2ms por iteracion                    | warning   |

### Ejemplo de advertencia en consola

```
⚠ OVERHEAD WARNING [DEBUG_IN_FORMAL]
  Debug logging is active during a formal test profile (load).
  This may add 3-8ms per iteration and distort latency results.
  Remediation: Set LOG_LEVEL=warn or use --no-debug flag.

⚠ OVERHEAD WARNING [HIGH_VU_COUNT]
  VU count (6,000) exceeds the recommended limit for a single generator (5,000).
  Results may show artificial latency spikes due to generator saturation.
  Remediation: Use distributed execution (see docs/BENCHMARKING.md#escalamiento).
```

### Suprimir advertencias conocidas

```bash
# Suprimir advertencias especificas (no recomendado en produccion)
./bin/run-test.sh --client=acme --service=users --test=load --suppress-warnings=DEBUG_IN_FORMAL
```

---

## Interpretacion de resultados

### Overhead aceptable

El overhead del framework es aceptable si el **per-request overhead es menor al 1% del P95 de latencia del servicio bajo prueba**.

Ejemplos:

| P95 del servicio | Overhead del framework | Impacto   | Aceptable |
|------------------|------------------------|-----------|-----------|
| 500ms            | 0.8ms                  | 0.16%     | Si        |
| 50ms             | 0.8ms                  | 1.6%      | Borderline|
| 10ms             | 0.8ms                  | 8%        | No        |

Si el servicio tiene P95 < 20ms, considerar ejecutar el benchmark sin helpers de logging para minimizar overhead.

### CPU del generador > 80%

Si el monitor reporta CPU > 80% durante mas del 20% del tiempo del test, los resultados de latencia son poco confiables. El generador no puede enviar requests a la tasa esperada, artificialmente limitando el throughput medido.

**Accion**: reducir VUs o escalar horizontalmente (ver guia de escalamiento).

### Diferencia entre overhead medido y overhead reportado

El overhead reportado en el benchmark es el overhead en un escenario idealizado (requests a localhost). En un escenario real con requests a servicios remotos, el overhead del framework representa una fraccion aun menor del tiempo total.

---

## Guia de escalamiento

### Cuando escalar

- VUs necesarios > 5,000 en un solo generador
- CPU del generador supera 80% durante el test
- Se necesitan mas de 50,000 RPS sostenidos
- El test dura mas de 4 horas (riesgo de saturacion de memoria)

### Opciones de escalamiento

**Opcion 1: Aumentar recursos del generador** (mas simple)

```bash
# En Docker: aumentar CPUs y memoria del contenedor k6
docker run --cpus=8 --memory=16g grafana/k6 run ...
```

**Opcion 2: Ejecucion distribuida con k6 cloud o k6 OSS distributed**

```bash
# k6 OSS distribuido (experimental)
k6 run --execution-segment="0:1/3" --execution-segment-sequence="0,1/3,2/3,1" script.js
# Ejecutar en paralelo en 3 maquinas con los segmentos correspondientes
```

**Opcion 3: Reducir overhead del framework**

```bash
# Desactivar logging estructurado en tests formales de alta carga
LOG_LEVEL=warn ./bin/run-test.sh --client=acme --service=users --test=stress

# Desactivar chaos durante el baseline
./bin/run-test.sh --client=acme --service=users --test=stress --no-chaos
```

### Regla de thumb: VUs por CPU

Basado en el benchmark interno del framework:

| Tipo de test       | VUs por vCPU (recomendado) |
|--------------------|---------------------------|
| HTTP REST simple   | 500 - 1,000               |
| GraphQL complejo   | 200 - 400                 |
| WebSocket          | 300 - 600                 |
| Upload de archivos | 50 - 100                  |

Ejemplo: para 3,000 VUs en un test REST, se recomiendan al menos 4 vCPUs en el generador.
