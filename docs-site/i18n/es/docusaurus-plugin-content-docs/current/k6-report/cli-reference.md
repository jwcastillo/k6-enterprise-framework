---
title: Referencia CLI
sidebar_position: 2
---

# Referencia CLI

k6-report proporciona 6 comandos para generacion de reportes, analisis y gestion de ejecuciones.

---

## `generate <input>`

Genera un reporte a partir de un archivo JSON de resumen k6.

```bash
npx k6-report generate summary.json -o report.html
```

| Flag | Descripcion | Default |
|------|-------------|---------|
| `-o, --output <path>` | Ruta del archivo de salida | auto-nombrado |
| `-f, --format <type>` | Formato de salida: `html`, `csv` o `markdown` | `html` |
| `--store` | Guardar ejecucion en historial despues de generar | -- |
| `--branding-org <name>` | Nombre de la organizacion para branding | -- |
| `--branding-color <hex>` | Color hex primario para branding | -- |
| `--branding-logo <path>` | Ruta al archivo de logo (codificado en base64 en el reporte) | -- |
| `--compare <baseline>` | Archivo JSON de k6 baseline para comparacion | -- |
| `--quiet` | Suprimir salida no-error | -- |
| `--no-color` | Deshabilitar salida con color | -- |

### Ejemplos

```bash
# Reporte HTML basico
npx k6-report generate summary.json

# Exportacion CSV
npx k6-report generate summary.json -f csv -o metrics.csv

# Reporte Markdown
npx k6-report generate summary.json -f markdown -o report.md

# Reporte con branding y comparacion
npx k6-report generate summary.json \
  --branding-org "Acme Corp" \
  --branding-color "#e11d48" \
  --branding-logo ./logo.png \
  --compare baseline.json \
  -o report.html

# Generar y almacenar para seguimiento de tendencias
npx k6-report generate summary.json --store
```

---

## `compare <run-a> <run-b>`

Compara dos ejecuciones de test k6 lado a lado.

```bash
npx k6-report compare baseline.json current.json -o compare.html
```

| Flag | Descripcion | Default |
|------|-------------|---------|
| `-o, --output <path>` | Ruta del archivo de salida | auto-nombrado |
| `-f, --format <type>` | Formato de salida: `html`, `markdown` o `json` | `html` |
| `--quiet` | Suprimir salida no-error | -- |
| `--no-color` | Deshabilitar salida con color | -- |

### Ejemplos

```bash
# Reporte de comparacion HTML
npx k6-report compare before.json after.json -o comparison.html

# Diff JSON para pipeline CI
npx k6-report compare before.json after.json -f json -o diff.json

# Markdown para comentario de PR
npx k6-report compare before.json after.json -f markdown
```

---

## `capacity <inputs...>`

Genera un reporte de analisis de capacidad a partir de multiples ejecuciones k6 con niveles de carga crecientes.

```bash
npx k6-report capacity run-50vus.json run-100vus.json run-200vus.json -o capacity.html
```

| Flag | Descripcion | Default |
|------|-------------|---------|
| `-o, --output <path>` | Ruta del archivo de salida | auto-nombrado |
| `--threshold <ms>` | Threshold de latencia p95 en ms | `2000` |
| `--growth-rate <decimal>` | Tasa de crecimiento mensual para proyeccion | `0.1` |
| `--quiet` | Suprimir salida no-error | -- |

### Ejemplos

```bash
# Analisis de capacidad basico
npx k6-report capacity 50vus.json 100vus.json 200vus.json 400vus.json

# Threshold personalizado y proyeccion de crecimiento
npx k6-report capacity *.json --threshold 1500 --growth-rate 0.15 -o capacity.html
```

---

## `trend <inputs...>`

Genera un reporte de analisis de tendencias a partir de ejecuciones k6 historicas.

```bash
npx k6-report trend run-jan.json run-feb.json run-mar.json -o trend.html
```

| Flag | Descripcion | Default |
|------|-------------|---------|
| `-o, --output <path>` | Ruta del archivo de salida | auto-nombrado |
| `--window <days>` | Ventana de tendencia: `30`, `60` o `90` dias | `30` |
| `--baseline-p95 <ms>` | p95 baseline en ms (opcional) | -- |
| `--quiet` | Suprimir salida no-error | -- |

### Ejemplos

```bash
# Tendencia de 30 dias
npx k6-report trend results/*.json -o trend.html

# Tendencia de 90 dias con referencia baseline
npx k6-report trend results/*.json --window 90 --baseline-p95 500
```

---

## `ticket <input>`

Genera contenido de ticket Jira o GitHub a partir de resultados k6.

```bash
npx k6-report ticket summary.json --format jira --service-name "Payment API"
```

| Flag | Descripcion | Default |
|------|-------------|---------|
| `-f, --format <type>` | Formato de ticket: `jira` o `github` | requerido |
| `-o, --output <path>` | Ruta del archivo de salida | stdout |
| `--service-name <name>` | Nombre del servicio para el ticket | -- |
| `--environment <env>` | Ambiente de prueba | -- |
| `--profile <name>` | Nombre del perfil de prueba de carga | -- |
| `--quiet` | Suprimir salida no-error | -- |

### Ejemplos

```bash
# Ticket Jira a stdout
npx k6-report ticket summary.json -f jira --service-name "Auth API" --environment staging

# Issue GitHub a archivo
npx k6-report ticket summary.json -f github \
  --service-name "Payment API" \
  --profile load \
  -o issue.md
```

---

## `list`

Lista ejecuciones de test historicas del almacenamiento.

```bash
npx k6-report list --limit 10
```

| Flag | Descripcion | Default |
|------|-------------|---------|
| `--dir <path>` | Override del directorio de almacenamiento | `.k6-report/` |
| `--json` | Salida JSONL raw para procesamiento automatico | -- |
| `--limit <n>` | Numero de entradas a mostrar | `20` |
| `--no-color` | Deshabilitar salida con color | -- |

### Ejemplos

```bash
# Listar ultimas 10 ejecuciones
npx k6-report list --limit 10

# Salida JSON para scripting
npx k6-report list --json | jq '.verdict'

# Directorio de almacenamiento personalizado
npx k6-report list --dir /data/k6-runs
```
