---
title: Almacenamiento de Ejecuciones
sidebar_position: 8
---

# Almacenamiento de Ejecuciones

k6-report incluye un sistema de almacenamiento ligero basado en sistema de archivos para rastrear ejecuciones de test historicas. Esto permite analisis de tendencias, comparacion de ejecuciones y registros de auditoria sin requerir bases de datos externas.

---

## Como Funciona

Cuando pasas `--store` a `k6-report generate`, la ejecucion se guarda localmente:

```bash
npx k6-report generate summary.json --store
```

### Estructura del Directorio

```
.k6-report/
  index.jsonl        -- Una linea JSON por ejecucion (solo append)
  runs/
    a1b2c3d4.json    -- K6Summary completo para cada ejecucion almacenada
    e5f6g7h8.json
```

- **`index.jsonl`** — Archivo JSONL de solo-append para listado rapido sin cargar resumenes completos
- **`runs/<id>.json`** — K6Summary con formato pretty-printed para cada ejecucion (usado por comandos de comparacion y tendencias)

### Generacion de ID de Ejecucion

Cada ejecucion obtiene un ID deterministico basado en un hash SHA-256 del contenido del resumen. Esto significa:
- Resultados de test identicos producen el mismo ID (deduplicacion)
- Ejecuciones diferentes siempre obtienen IDs unicos

---

## Uso por CLI

### Almacenar una Ejecucion

```bash
# Almacenar durante generacion de reporte
npx k6-report generate summary.json --store

# Directorio de almacenamiento personalizado
npx k6-report generate summary.json --store --dir /data/k6-runs
```

### Listar Ejecuciones Almacenadas

```bash
# Listar ejecuciones recientes (default: 20)
npx k6-report list

# Limitar a las ultimas 5
npx k6-report list --limit 5

# Salida JSON para scripting
npx k6-report list --json

# Directorio personalizado
npx k6-report list --dir /data/k6-runs
```

### Usar Ejecuciones Almacenadas para Analisis

```bash
# Tendencia desde ejecuciones almacenadas (usar archivos JSON almacenados directamente)
npx k6-report trend .k6-report/runs/*.json --window 30

# Comparar dos ejecuciones almacenadas
npx k6-report compare .k6-report/runs/a1b2c3d4.json .k6-report/runs/e5f6g7h8.json
```

---

## API Programatica

### `RunStore`

```typescript
import { RunStore, generateRunId, parseK6Summary } from "k6-report";

// Inicializar store (default: .k6-report/ en cwd)
const store = new RunStore();

// O con directorio personalizado
const store = new RunStore({ dir: "/data/k6-runs" });
```

### Almacenar una Ejecucion

```typescript
const raw = JSON.parse(readFileSync("summary.json", "utf8"));
const summary = parseK6Summary(raw);
const id = generateRunId(summary);

store.append(
  {
    id,
    timestamp: new Date().toISOString(),
    verdict: summary.state?.isStdErrTainted ? "fail" : "pass",
  },
  summary,
);
```

### Listar Ejecuciones

```typescript
// Mas reciente primero, limitado a 10
const runs = store.list(10);

for (const run of runs) {
  console.log(`${run.id} | ${run.timestamp} | ${run.verdict}`);
}
```

### Schema de Entrada del Indice

```typescript
interface RunIndexEntry {
  /** ID de ejecucion deterministico basado en hash */
  id: string;
  /** Timestamp ISO 8601 */
  timestamp: string;
  /** Veredicto del test: "pass" o "fail" */
  verdict: string;
}
```

---

## Variable de Entorno

Establece `K6_REPORT_DIR` para override del directorio de almacenamiento default globalmente:

```bash
export K6_REPORT_DIR=/data/k6-runs
npx k6-report generate summary.json --store
npx k6-report list
```

Orden de prioridad:
1. Flag CLI `--dir` (mayor prioridad)
2. Variable de entorno `K6_REPORT_DIR`
3. `.k6-report/` en el directorio de trabajo actual (default)

---

## Recuperacion de Corrupcion

El archivo de indice JSONL usa escrituras de solo-append. Si una linea esta malformada (ej., debido a escritura interrumpida), `RunStore.list()` salta la linea mala y continua leyendo. No se necesita intervencion manual.

---

## Integracion CI/CD

Almacena ejecuciones en CI para construir datos historicos:

```yaml
# Ejemplo GitHub Actions
- name: Ejecutar test k6
  run: k6 run script.js --summary-export=summary.json

- name: Generar reporte y almacenar
  run: npx k6-report generate summary.json --store -o report.html

- name: Subir reporte
  uses: actions/upload-artifact@v4
  with:
    name: k6-report
    path: report.html

- name: Persistir almacenamiento de ejecuciones
  uses: actions/cache/save@v4
  with:
    path: .k6-report
    key: k6-runs-${{ github.sha }}
```
