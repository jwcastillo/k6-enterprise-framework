---
title: "k6 Enterprise Framework — Flujo de Trabajo de Desarrollo"
sidebar_position: 4
---
# k6 Enterprise Framework — Flujo de Trabajo de Desarrollo

T-178 (Fase 8): Flujo de trabajo de desarrollo paso a paso con diagrama visual,
comandos copiables, guía de prerrequisitos, estructura de directorios y referencia de perfiles.

---

## Flujo de Trabajo en 5 Pasos

```
  ┌──────────────────────────────────────────────────────────────────┐
  │                                                                  │
  │  1. CREAR CLIENTE  →  2. CONFIGURAR  →  3. COMPILAR  →  4. EJECUTAR  →  5. ANALIZAR  │
  │                                                                  │
  └──────────────────────────────────────────────────────────────────┘
```

### Paso 1 — Crear Cliente

Crea una nueva capa de producto para tu equipo o servicio.

```bash
./bin/create-client.sh my-team
```

Esto crea:
```
clients/my-team/
  config/
    default.json     ← configuración base
  scenarios/
    api/             ← coloca tus escenarios de prueba aquí
  data/              ← archivos de datos de prueba (CSV, JSON)
  lib/               ← helpers compartidos para tu equipo
```

### Paso 2 — Configurar

Edita `clients/my-team/config/default.json` con la configuración de tu servicio.

```bash
# Valida tu configuración antes de ejecutar
node bin/validate-config.js --client=my-team
# Esperado: ✓ Validated: default.json (JSON) — 1 scenario, 3 thresholds. All OK.

# Genera un ejemplo completo de configuración como punto de partida
node bin/validate-config.js --example > clients/my-team/config/default.yml
```

> **Prerrequisito para el Paso 3**: El Paso 2 debe completarse exitosamente (configuración válida).
> Si la validación falla, corrige los errores antes de continuar.

### Paso 3 — Compilar

Compila los escenarios TypeScript a JavaScript.

```bash
npm run build
# Salida esperada: compilación webpack exitosa, dist/ actualizado
```

> **Prerrequisito para el Paso 3**: `npm install` debe haberse ejecutado primero.
> Si obtienes "command not found", ejecuta `npm install` desde la raíz del proyecto.

```bash
# Verificar la salida de compilación
ls dist/my-team/
```

### Paso 4 — Ejecutar

Ejecuta tu prueba con el perfil deseado.

```bash
# Test de humo (el más rápido — ~1 min, verifica que el servicio esté activo)
./bin/run-test.sh --client=my-team --scenario=api/my-scenario --profile=smoke

# Test rápido de CI (rápido — ~3 min, para validación en pipelines)
./bin/run-test.sh --client=my-team --scenario=api/my-scenario --profile=quick

# Test de carga (carga normal — ~14 min)
./bin/run-test.sh --client=my-team --scenario=api/my-scenario --profile=load --env=staging

# Omitir compilación para iteración más rápida (cuando el código no ha cambiado)
./bin/run-test.sh --client=my-team --scenario=api/my-scenario --profile=smoke --skip-build

# Con observabilidad completa (Prometheus + Loki + Tempo + OTEL)
./bin/run-test.sh --client=my-team --scenario=api/my-scenario --profile=smoke --observability
```

> **Prerrequisito para el Paso 4**: El Paso 3 (compilación) debe completarse exitosamente.
> Si la prueba falla con "bundle not found", ejecuta `npm run build` primero.

### Paso 5 — Analizar

Revisa los resultados y compara con ejecuciones anteriores.

```bash
# Ver análisis de tendencias (sparklines de las últimas N ejecuciones)
node bin/trend-analysis.js --client=my-team --test=my-scenario --limit=10

# Exportar métricas a CSV para análisis en hoja de cálculo
node bin/export-data.js --client=my-team --format=csv --out=reports/my-team.csv

# Abrir reporte HTML
open reports/my-team/api_my-scenario/html-report-*.html
```

---

## Estructura de Directorios

```
k6-framework/
│
├── src/                        ← Capa genérica (código del framework — no modificar)
│   ├── core/                   ← Carga de configuración, sistema de perfiles, motor de ejecución
│   ├── helpers/                ← Helpers de datos, patrones de solicitud, autenticación
│   ├── patterns/               ← Reintentos, correlación, paginación, caos
│   ├── observability/          ← Salud del generador, trazabilidad, Pyroscope
│   └── reporting/              ← Generadores de reportes HTML y JSON
│
├── clients/                    ← Capa de producto (el código de tu equipo va aquí)
│   ├── _reference/             ← Implementación de referencia (plantilla de solo lectura)
│   ├── examples/               ← Escenarios de ejemplo para aprendizaje
│   └── <your-team>/            ← El directorio de tu cliente
│       ├── config/             ← Configuraciones JSON específicas por entorno
│       ├── scenarios/          ← Escenarios de prueba k6 en TypeScript
│       ├── data/               ← Datos de prueba (CSV, JSON)
│       └── lib/                ← Helpers y servicios específicos del equipo
│
├── shared/                     ← Recursos compartidos (esquemas, perfiles, plantillas)
│   ├── profiles/               ← Definiciones de perfiles de carga (smoke.json, load.json, etc.)
│   ├── schemas/                ← Archivos JSON Schema para validación
│   └── templates/              ← Plantillas scaffold para generate.js
│
├── bin/                        ← Herramientas CLI
│   ├── run-test.sh             ← Ejecutor principal de pruebas (pipeline de 6 pasos)
│   ├── validate-config.js      ← CLI de validación de configuración
│   ├── generate.js             ← Generador de scaffolding
│   ├── compare-results.js      ← Comparador manual de línea base
│   ├── trend-analysis.js       ← Generador de reportes de tendencias
│   ├── export-data.js          ← Exportador masivo de datos
│   ├── mock-server.js          ← Servidor HTTP mock local
│   └── notify.js               ← Emisor de notificaciones webhook
│
├── infrastructure/             ← Stack de observabilidad con Docker Compose
│   ├── docker-compose.yml      ← Servicios base (Grafana, Prometheus, Redis)
│   └── docker-compose.prod.yml ← Sobrecargas de endurecimiento para producción
│
├── reports/                    ← Artefactos generados (ignorados por git)
│   └── <client>/<scenario>/    ← html-report-*, summary-*, metrics-*.csv
│
└── docs/                       ← Documentación
    ├── WORKFLOW.md             ← Este archivo
    ├── LOAD_PROFILES.md        ← Referencia de perfiles
    ├── EXTENSION_POINTS.md     ← Cómo extender el framework
    └── DISTRIBUTED_TESTING.md  ← Guía de k6 Operator / Kubernetes
```

---

## Referencia de Perfiles de Carga

| Perfil | VUs | Duración | Categoría | Caso de Uso |
|--------|-----|----------|-----------|-------------|
| `smoke` | 1–2 | 1m | Sanidad | Verificar que el servicio está operativo |
| `quick` | 5 | 3m | CI | Retroalimentación rápida en pipelines de CI |
| `load` | 20 | 14m | Normal | Tráfico sostenido normal |
| `rampup` | 50 | 13m | Gradiente | Prueba de incremento gradual |
| `capacity` | 200 | 20m | Límite | Encontrar el rendimiento máximo |
| `stress` | 400 | 25m | Estrés | Encontrar el punto de quiebre |
| `spike` | 300↑ | 5m | Pico | Elasticidad y recuperación |
| `breakpoint` | 1000 | 1h | Extremo | Encontrar el límite absoluto del sistema |
| `soak` | 20 | 4h+ | Resistencia | Fugas de memoria, degradación lenta |

```bash
# Listar todos los perfiles con detalles
./bin/run-test.sh --list-profiles

# Usar un perfil específico
./bin/run-test.sh --client=my-team --scenario=api/test --profile=load
```

### ¿Perfil no encontrado?

```
Error: Invalid profile 'myprofile'.
```

Perfiles disponibles: `smoke quick load rampup capacity stress spike breakpoint soak`

---

## Jerarquía de Thresholds

Los thresholds se aplican en orden de precedencia (el superior sobrescribe al inferior):

```
1. Valores por defecto del perfil  (shared/profiles/<name>.json)     ← menor precedencia
2. Configuración base del cliente  (clients/<name>/config/default.json)
3. Sobrecargas de entorno          (clients/<name>/config/staging.json)
4. Sobrecargas del escenario       (export const options en scenario.ts)
5. Flag --env del CLI              (K6_ENV=production)                ← mayor precedencia
```

---

## Integración CI/CD (T-173)

### GitHub Actions

```yaml
# .github/workflows/k6-load-test.yml
name: Load Tests

on:
  push:
    branches: [main]
  schedule:
    - cron: '0 6 * * *'  # nocturno

jobs:
  validate-and-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Validate config
        run: node bin/validate-config.js --client=my-team

      - name: Build
        run: npm run build

      - name: Run smoke test
        run: ./bin/run-test.sh --client=my-team --scenario=api/smoke --profile=smoke
        env:
          K6_ENV: staging

      - name: Upload reports
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: k6-reports
          path: reports/
```

### GitLab CI

```yaml
# .gitlab-ci.yml
k6-smoke:
  stage: test
  script:
    - npm ci
    - node bin/validate-config.js --client=my-team
    - npm run build
    - ./bin/run-test.sh --client=my-team --scenario=api/smoke --profile=smoke
  artifacts:
    when: always
    paths:
      - reports/
    expire_in: 7 days
  variables:
    K6_ENV: staging
```

---

## Referencia de Comandos Comunes

```bash
# Incorporación de nuevos usuarios (< 10 min)
npm install
./bin/run-test.sh --client=_reference --scenario=api/smoke-users --profile=smoke

# Validar y luego ejecutar (patrón recomendado para CI)
node bin/validate-config.js --client=my-team && \
  npm run build && \
  ./bin/run-test.sh --client=my-team --scenario=api/test --profile=smoke

# Ejecutar todas las pruebas de un cliente
./bin/run-all-tests.sh --client=my-team --profile=smoke

# Comparar dos ejecuciones específicas manualmente
node bin/compare-results.js \
  --baseline=reports/my-team/api_test/summary-20260217-143000.json \
  --current=reports/my-team/api_test/summary-20260218-090000.json

# Generar reporte de tendencias
node bin/trend-analysis.js --client=my-team --test=api_test --limit=10

# Iniciar stack de observabilidad local
docker compose --profile observability up -d

# Ejecutar con pipeline completo de observabilidad
./bin/run-test.sh --client=examples --scenario=integration/16-sli-monitoring \
  --profile=smoke --observability
```
