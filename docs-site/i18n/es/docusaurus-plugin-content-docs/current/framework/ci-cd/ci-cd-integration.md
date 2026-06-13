---
title: "Guía de Integración CI/CD"
sidebar_position: 1
---
# Guía de Integración CI/CD

<!-- T-102: Documentacion de integracion CI/CD -->

Esta guía cubre la integración del k6 Enterprise Framework en tus pipelines de CI/CD utilizando quality gates, suites de regresión nocturnas y notificaciones multicanal.

---

## Tabla de Contenidos

1. [Quality Gates — Conceptos y Códigos de Salida](#1-quality-gates)
2. [Integración con GitHub Actions](#2-github-actions)
3. [Integración con GitLab CI](#3-gitlab-ci)
4. [Patrones Avanzados](#4-patrones-avanzados)
5. [Notificaciones](#5-notificaciones)
6. [Resolución de Problemas](#6-resolución-de-problemas)
7. [Árbol de Decisión: ¿Qué Modo Usar?](#7-árbol-de-decisión)

---

## 1. Quality Gates

Un **quality gate** es un conjunto de umbrales de rendimiento que deben cumplirse antes de que un build pueda continuar. El framework finaliza con un código estándar sobre el cual los sistemas de CI/CD pueden actuar.

### Códigos de Salida

| Código | Significado | Acción Recomendada |
|--------|-------------|-------------------|
| `0`  | Todos los umbrales pasaron | Permitir merge / continuar pipeline |
| `1`  | Uno o más umbrales fallaron | Bloquear merge / notificar al equipo |
| `2`  | Error de ejecución (servicio no disponible, configuración inválida) | Investigar infraestructura / corregir configuración |
| `99` | Fallo de umbral con datos parciales | Revisar resultados parciales, decidir manualmente |

### Configuración de Umbrales

Los umbrales se definen en la configuración de tu cliente:

```json
// clients/my-service/config/staging.json
{
  "thresholds": {
    "http_req_duration": ["p(95)<500", "p(99)<1000"],
    "http_req_failed": ["rate<0.01"],
    "http_reqs": ["rate>100"]
  }
}
```

### Sobreescritura en Tiempo de Ejecución (por pipeline)

Sobreescribe umbrales sin modificar el código fuente:

```yaml
# En las variables de entorno de tu pipeline
QG_THRESHOLDS_OVERRIDE: '{"http_req_duration[p95]": 800}'
```

Esto es útil para diferentes entornos con diferentes SLAs (por ejemplo, producción es más estricto que staging).

---

## 2. GitHub Actions

### 2.1 Smoke Test Manual (workflow_dispatch)

Usa el workflow de referencia para ejecución manual ad-hoc desde la interfaz de GitHub Actions:

```yaml
# Referencia: .github/workflows/perf-smoke.yml
# Ya incluido en este repositorio
```

**Activar desde la interfaz de GitHub:**
1. Ve a `Actions → Performance Smoke Test`
2. Haz clic en `Run workflow`
3. Completa: Client, Environment, Profile, Notify channels

**Activar vía API (curl):**

```bash
curl -X POST \
  -H "Authorization: token $GITHUB_PAT" \
  -H "Accept: application/vnd.github.v3+json" \
  "https://api.github.com/repos/<owner>/<repo>/actions/workflows/perf-smoke.yml/dispatches" \
  -d '{
    "ref": "main",
    "inputs": {
      "client": "my-service",
      "env": "staging",
      "profile": "smoke",
      "notify": "slack"
    }
  }'
```

### 2.2 Quality Gate en Pull Request (perf-gate.yml)

Bloquea automáticamente los merges de PR cuando los umbrales de rendimiento fallan.

```yaml
# Referencia: .github/workflows/perf-gate.yml
```

**Configuración como status check requerido:**
1. `Settings → Branches → Branch protection rules`
2. Marca `Require status checks to pass before merging`
3. Agrega: `Quality Gate`

El workflow publica automáticamente un comentario en el PR con los resultados y bloquea el merge en caso de fallo (código de salida 1).

### 2.3 Regresión Nocturna (perf-regression.yml)

```yaml
# Referencia: .github/workflows/perf-regression.yml
# Se ejecuta automáticamente a las 02:00 UTC diariamente (configurable)
```

**Llamada entre workflows** (invocar desde otro workflow):

```yaml
# En el .github/workflows/deploy.yml del repositorio consumidor
jobs:
  perf-check:
    uses: your-org/k6-framework/.github/workflows/perf-regression.yml@main
    with:
      client: my-service
      suite: nightly
      env: staging
    secrets:
      PERF_SLACK_WEBHOOK: ${{ secrets.PERF_SLACK_WEBHOOK }}
```

### 2.4 Secretos Requeridos

Configurar en `Settings → Secrets and variables → Actions`:

| Secreto | Descripción |
|---------|-------------|
| `PERF_SLACK_WEBHOOK` | URL del webhook entrante de Slack |
| `PERF_EMAIL_TO` | Destinatario de notificaciones por email |
| `PERF_NOTIFY_WEBHOOK` | URL de webhook genérico |

---

## 3. GitLab CI

### 3.1 Incluir la Plantilla de Referencia

```yaml
# En el .gitlab-ci.yml de tu proyecto
include:
  - project: 'your-org/k6-framework'
    ref: main
    file: 'ci-templates/.gitlab-ci-perf.yml'
```

### 3.2 Smoke Test Manual

```yaml
# Activar desde GitLab CI/CD → Pipelines → Run pipeline
# Configurar variables: CLIENT, ENV, PROFILE, NOTIFY
perf:smoke:
  extends: .perf-base
  when: manual
  variables:
    CLIENT: "my-service"
    ENV: "staging"
    PROFILE: "smoke"
```

**Activar vía API (curl con GitLab PAT):**

```bash
curl -X POST \
  -F "token=<trigger_token>" \
  -F "ref=main" \
  -F "variables[CLIENT]=my-service" \
  -F "variables[ENV]=staging" \
  -F "variables[PROFILE]=smoke" \
  "https://gitlab.com/api/v4/projects/<project_id>/trigger/pipeline"
```

Para obtener un token de activación: `Settings → CI/CD → Pipeline triggers → Add new token`.

### 3.3 Quality Gate en Merge Request

El job `perf:gate` en la plantilla se ejecuta automáticamente en pipelines de MR y bloquea el merge en caso de fallo. Los resultados se integran con el widget de tests del MR de GitLab mediante artefactos JUnit XML.

### 3.4 Programación Nocturna

1. Ve a `CI/CD → Schedules → New schedule`
2. Configura el cron: `0 2 * * *` (02:00 UTC)
3. Configura la variable: `PERF_SUITE=nightly`

El job `perf:regression:nightly` se ejecuta automáticamente en pipelines programados.

### 3.5 Activación entre Pipelines

Activar tests de rendimiento desde un repositorio consumidor:

```yaml
# En el .gitlab-ci.yml del repositorio consumidor
trigger-perf:
  stage: test
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
  variables:
    DOWNSTREAM_CLIENT: "my-service"
  trigger:
    project: "your-org/k6-framework"
    branch: main
    strategy: depend  # espera el resultado del pipeline downstream
```

### 3.6 Variables de CI/CD

Configurar en `Settings → CI/CD → Variables` como **Protected** y **Masked**:

| Variable | Descripción |
|----------|-------------|
| `PERF_SLACK_WEBHOOK` | Webhook de Slack (enmascarado) |
| `PERF_EMAIL_TO` | Destinatario de email |
| `PERF_QG_THRESHOLDS_OVERRIDE` | Sobreescrituras de umbrales en JSON |
| `REDIS_URL` | URL de conexión a Redis (enmascarado) |

---

## 4. Patrones Avanzados

### 4.1 Configuración Inline vía `TEST_CONFIG`

Pasa la configuración completa del test como una variable de entorno JSON, sin necesidad de archivo:

```bash
# GitHub Actions / GitLab CI
TEST_CONFIG='{"baseUrl":"https://api.example.com","thresholds":{"http_req_duration":["p(95)<500"]}}'
```

```yaml
# GitHub Actions
- name: Run with inline config
  env:
    TEST_CONFIG: '{"baseUrl":"https://api.example.com","thresholds":{"http_req_duration":["p(95)<500"]}}'
  run: bash bin/run-test.sh --quality-gate
```

La configuración se escribe en un archivo temporal seguro (permisos 0600) y se limpia después de la ejecución.

**Errores de validación** (JSON mal formado) reportan la posición exacta:
```
Error: TEST_CONFIG contains invalid JSON: Unexpected token at position 42
```

### 4.2 Configuración Remota vía `--config=<URL>`

```bash
bash bin/run-test.sh --config=https://config.example.com/perf-config.json
```

Solo se admiten URLs HTTPS. La configuración se descarga, se valida y se limpia después del uso.

### 4.3 Quality Gateway entre Repositorios

Usa el framework como quality gate desde un repositorio completamente separado, sin necesidad de configurar un cliente:

```dockerfile
# En el Dockerfile o CI de cualquier repositorio
docker run --rm \
  -v $(pwd)/perf-config.json:/config/perf-config.json \
  your-registry/k6-framework:latest \
  --config=/config/perf-config.json \
  --quality-gate
# Código de salida: 0 = aprobado, 1 = fallido
```

No se requiere `--client` — utiliza un cliente virtual `local`.

### 4.4 Script de Regresión Nocturna (cron directo)

```bash
# crontab -e
0 2 * * * /path/to/k6-framework/bin/run-regression.sh \
  --suite=nightly \
  --client=my-service \
  --env=staging \
  --notify=slack \
  >> /var/log/perf-regression.log 2>&1
```

Códigos de salida: `0` = sin regresiones, `1` = significativa, `99` = crítica.

---

## 5. Notificaciones

### 5.1 Slack

```json
// En clients/my-service/config/staging.json
{
  "notifications": {
    "channels": ["slack"],
    "conditions": "on_failure",
    "slack": { "webhook": "${NOTIFY_SLACK_WEBHOOK}" }
  }
}
```

O mediante variable de entorno: `NOTIFY_SLACK_WEBHOOK=https://hooks.slack.com/services/...`

Los mensajes de Slack utilizan formato Block Kit con:
- Insignia de aprobado/fallido
- Tabla de métricas clave (p95, tasa de error, throughput)
- Enlace directo al reporte HTML

### 5.2 Email

```bash
NOTIFY_EMAIL_TO=team@example.com bash bin/run-test.sh --client=my-service --notify=email
```

El email incluye: asunto con veredicto, cuerpo HTML con tabla de métricas y enlace al reporte.

### 5.3 Webhook Genérico

```bash
NOTIFY_WEBHOOK_URL=https://hooks.example.com/perf bash bin/run-test.sh --notify=webhook
```

Payload POST (JSON versionado):
```json
{
  "version": "1.0",
  "verdict": "pass",
  "client": "my-service",
  "environment": "staging",
  "metrics": { "p95Ms": 245, "errorRatePct": 0.3, "throughputRps": 1240 },
  "reportUrl": "https://...",
  "timestamp": "2026-02-18T02:00:00Z"
}
```

### 5.4 Deshabilitar Notificaciones

```bash
bash bin/run-test.sh --notify=none
```

### 5.5 Condiciones de Notificación

| Condición | Cuándo se envía |
|-----------|----------------|
| `always` | En cada ejecución |
| `on_failure` | Solo cuando los umbrales fallan (por defecto) |
| `on_regression` | Solo cuando se detecta regresión respecto a la línea base |

---

## 6. Resolución de Problemas

### Problema: "Docker image not found"

```
Error: manifest for your-registry/k6-framework:latest not found
```

**Solución:** Construye y publica la imagen primero, o usa build local:
```bash
docker build -t k6-framework:local -f infrastructure/k8s/Dockerfile .
```

### Problema: "Permission denied on GITHUB_TOKEN"

```
Error: Resource not accessible by integration
```

**Solución:** Agrega `permissions` a tu workflow:
```yaml
permissions:
  contents: read
  issues: write
  pull-requests: write
```

### Problema: El pipeline se cuelga indefinidamente

El quality gate tiene un timeout por defecto de 30 minutos (`CHK-API-017`). Para tests de larga duración, auméntalo:
```yaml
jobs:
  perf-gate:
    timeout-minutes: 60  # Aumentar para tests de soak/stress
```

### Problema: "TEST_CONFIG: Unexpected token at position N"

El string JSON está mal formado. Causas comunes:
- Comillas simples sin escapar en YAML: usa comillas dobles o bloques escalares
- Expansión de variables del shell: envuelve en `'comillas simples'` en el shell, usa bloques env de YAML en GitHub Actions

### Problema: Código de salida 2 (error de ejecución)

```
k6: Error loading script
```

**Solución:** Verifica la ruta del cliente/test y que TypeScript esté compilado:
```bash
npm run build   # compilar TypeScript antes de ejecutar
node bin/validate-config.js --client=my-service --env=staging
```

### Problema: Las notificaciones de Slack no se entregan

1. Prueba el webhook directamente: `curl -X POST -d '{"text":"test"}' $NOTIFY_SLACK_WEBHOOK`
2. Verifica que la URL del webhook esté configurada como secreto (no como variable de texto plano)
3. Comprueba que las reglas de egreso de red permitan HTTPS saliente

### Problema: "REDIS_URL not configured" al usar patrones de Redis

```
[RedisHelper] Failed to connect to redis://localhost:6379
```

**Opciones de solución:**
- Local: `export REDIS_URL=redis://localhost:6379` e inicia Redis
- Docker: `docker compose --profile redis up -d`
- CI: configura `REDIS_URL` como variable de pipeline

---

## 7. Árbol de Decisión

```
¿Qué tipo de pruebas de rendimiento necesito?
│
├── "Quiero ejecutar un test rápido manualmente"
│   └── Usa: workflow_dispatch (perf-smoke.yml) o run-test.sh directamente
│
├── "Quiero bloquear PRs por regresiones de rendimiento"
│   └── Usa: perf-gate.yml (GitHub Actions) o job perf:gate (GitLab CI)
│       └── Configúralo como status check requerido
│
├── "Quiero detección automatizada de regresiones nocturnas"
│   └── Usa: perf-regression.yml (schedule) o crontab + run-regression.sh
│       └── Configura canales de notificación para alertas
│
├── "Quiero hacer tests desde un repositorio diferente/consumidor"
│   └── Usa: Activación entre pipelines o docker run --rm con --config
│       └── No se requiere configuración de cliente en el repositorio del framework
│
├── "Quiero pasar configuración sin archivos (entornos dinámicos)"
│   └── Usa: Variable de entorno TEST_CONFIG (JSON inline) o --config=https://...
│
└── "Quiero hacer tests a escala en Kubernetes"
    └── Usa: k8s/k6-testrun.yaml con Grafana k6 Operator
```
