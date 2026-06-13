---
title: Pipelines del Consumidor
sidebar_position: 3
description: Recetas listas para copiar y pegar de GitHub Actions y GitLab CI para equipos de producto que consumen la imagen Docker del framework k6
---

# Pipelines del Consumidor

Esta guía está dirigida a un equipo de producto que quiere ejecutar pruebas de carga contra **su propia aplicación** descargando la imagen Docker publicada del framework. Todos los ejemplos usan el placeholder `registry.example.com/k6-framework:VERSION` — sustitúyelo por tu registry, repositorio y tag. El código fuente de la imagen vive en `infrastructure/k8s/Dockerfile`.

Si lo que buscas son los patrones de **self-test** del framework (los workflows `perf-smoke.yml`, `perf-gate.yml`, `perf-regression.yml`, la tabla de exit codes de Quality Gates, y el patrón `include` de plantillas para probar el framework en sí), consulta [`./ci-cd-integration.md`](./ci-cd-integration.md) — este documento deliberadamente no duplica ese material.

> **Buckets de scenario**: cada argumento `--scenario=` **debe** comenzar con uno de los buckets canónicos — `api`, `flow`, `domain`, `chaos` o `perf`. El `bin/run-test.sh` del framework valida el prefijo y falla con buckets no canónicos. Consulta la sección **Client Scenarios Taxonomy** de `CLAUDE.md` para el canon completo.

---

## 1. Inicio rápido — ejecutar la imagen del framework (docker run local)

Descarga la imagen y ejecuta un smoke test contra tu aplicación desde cualquier host con Docker:

```bash
docker run --rm \
  -e K6_CLIENT=my-team \
  -e K6_ENV=staging \
  -e K6_PROFILE=smoke \
  -e K6_REPORTS_DIR=/scripts/reports \
  -e REDIS_HOST=redis.internal \
  -e REDIS_PORT=6379 \
  -e REDIS_PASSWORD=changeme \
  -v "$(pwd)/clients/my-team:/scripts/clients/my-team:ro" \
  -v "$(pwd)/reports:/scripts/reports:rw" \
  registry.example.com/k6-framework:VERSION \
  ./bin/run-test.sh \
    --client=my-team \
    --scenario=api/smoke-users \
    --profile=smoke
```

Convenciones de montaje:

- **Código fuente como read-only** (`:ro`) — el contenedor nunca debe mutar tus scenarios en disco.
- **Reports como read-write** (`:rw`) — k6 escribe aquí los artefactos JSON, JUnit y HTML.
- Las rutas dentro del contenedor anclan en `/scripts/`; las rutas del host anclan en `./reports`.

Exit codes de `./bin/run-test.sh`:

| Code | Significado          | Acción recomendada            |
|------|----------------------|-------------------------------|
| `0`  | Pass                 | Continuar pipeline            |
| `1`  | Error                | Investigar infra o config     |
| `99` | Thresholds fallaron  | Bloquear merge / notificar    |
| `107`| Error de build       | Corregir build, re-ejecutar   |

---

## 2. GitHub Actions — Ejecución manual parametrizada (workflow_dispatch)

Coloca este archivo en `.github/workflows/manual-load-test.yml` dentro del repositorio de tu **producto**. Expone un formulario en la UI de Actions para que un desarrollador elija client, scenario, profile, env, y opcionalmente sobreescriba VUs o duration:

```yaml
name: Manual Load Test

on:
  workflow_dispatch:
    inputs:
      client:
        description: Client name (matches clients/<name>/)
        type: string
        required: true
        default: my-team
      scenario:
        description: Scenario path (must start with api/|flow/|domain/|chaos/|perf/)
        type: string
        required: true
        default: api/smoke-users
      profile:
        description: Load profile
        type: choice
        required: true
        default: smoke
        options: [smoke, quick, load, capacity, stress, soak]
      env:
        description: Target environment
        type: choice
        required: true
        default: staging
        options: [default, staging, production]
      vus_override:
        description: Override VUs (optional integer)
        type: string
        required: false
        default: ""
      duration_override:
        description: Override duration (e.g. 5m, optional)
        type: string
        required: false
        default: ""

jobs:
  run:
    runs-on: ubuntu-latest
    container:
      image: registry.example.com/k6-framework:VERSION
    steps:
      - uses: actions/checkout@v4

      - name: Run k6
        env:
          K6_CLIENT: ${{ inputs.client }}
          K6_ENV: ${{ inputs.env }}
          K6_PROFILE: ${{ inputs.profile }}
          K6_REPORTS_DIR: ./reports
          K6_VUS_OVERRIDE: ${{ inputs.vus_override }}
          K6_DURATION_OVERRIDE: ${{ inputs.duration_override }}
        run: |
          ./bin/run-test.sh \
            --client=${{ inputs.client }} \
            --scenario=${{ inputs.scenario }} \
            --profile=${{ inputs.profile }} \
            --env=${{ inputs.env }}

      - name: Upload reports
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: k6-reports-${{ github.run_id }}
          path: ./reports
          retention-days: 14
```

Variante con matrix — barre varios scenarios y environments en una sola ejecución manual:

```yaml
jobs:
  matrix-run:
    runs-on: ubuntu-latest
    container:
      image: registry.example.com/k6-framework:VERSION
    strategy:
      fail-fast: false
      matrix:
        scenario: [api/smoke-users, flow/checkout, domain/orders/lifecycle]
        env: [staging, production]
    steps:
      - uses: actions/checkout@v4
      - name: Run k6
        env:
          K6_CLIENT: my-team
          K6_ENV: ${{ matrix.env }}
          K6_PROFILE: smoke
          K6_REPORTS_DIR: ./reports
        run: |
          ./bin/run-test.sh \
            --client=my-team \
            --scenario=${{ matrix.scenario }} \
            --profile=smoke \
            --env=${{ matrix.env }}
      - uses: actions/upload-artifact@v4
        with:
          name: k6-reports-${{ matrix.env }}-${{ strategy.job-index }}
          path: ./reports
```

---

## 3. GitHub Actions — Hook post-deploy (workflow_call)

Patrón: el `deploy.yml` de tu repositorio de producto invoca un workflow de load-test reutilizable que vive en un repositorio **compartido** de pruebas k6. El job de smoke siempre se ejecuta primero; solo si pasa, se ejecuta el scenario configurado del perf-gate.

Lado caller — en `.github/workflows/deploy.yml` de tu repositorio de producto:

```yaml
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Deploy app
        run: ./deploy.sh

  load-test:
    needs: deploy
    uses: org/k6-tests-repo/.github/workflows/post-deploy-load.yml@main
    with:
      deployed_version: ${{ github.sha }}
      target_env: staging
      base_url: https://staging.example.com
      scenario: flow/checkout
      profile: load
    secrets: inherit
```

Lado receiver — en `org/k6-tests-repo/.github/workflows/post-deploy-load.yml`:

```yaml
name: Post-Deploy Load Test

on:
  workflow_call:
    inputs:
      deployed_version:
        type: string
        required: true
      target_env:
        type: string
        required: true
      base_url:
        type: string
        required: true
      scenario:
        type: string
        required: true
      profile:
        type: string
        required: true

jobs:
  smoke:
    runs-on: ubuntu-latest
    container:
      image: registry.example.com/k6-framework:VERSION
    steps:
      - uses: actions/checkout@v4
      - name: Smoke against deployed version
        env:
          K6_CLIENT: my-team
          K6_ENV: ${{ inputs.target_env }}
          K6_PROFILE: smoke
          K6_REPORTS_DIR: ./reports
        run: |
          ./bin/run-test.sh \
            --client=my-team \
            --scenario=api/smoke-users \
            --profile=smoke \
            --env=${{ inputs.target_env }}
      - uses: actions/upload-artifact@v4
        with:
          name: smoke-${{ inputs.deployed_version }}
          path: ./reports

  perf-gate:
    needs: smoke
    runs-on: ubuntu-latest
    container:
      image: registry.example.com/k6-framework:VERSION
    steps:
      - uses: actions/checkout@v4
      - name: Perf gate
        env:
          K6_CLIENT: my-team
          K6_ENV: ${{ inputs.target_env }}
          K6_PROFILE: ${{ inputs.profile }}
          K6_REPORTS_DIR: ./reports
        run: |
          ./bin/run-test.sh \
            --client=my-team \
            --scenario=${{ inputs.scenario }} \
            --profile=${{ inputs.profile }} \
            --env=${{ inputs.target_env }}
      - uses: actions/upload-artifact@v4
        with:
          name: perf-${{ inputs.deployed_version }}
          path: ./reports
```

---

## 4. GitHub Actions — Programación con cron

Las expresiones cron de GitHub Actions se evalúan **siempre en UTC** (según la documentación de GitHub Actions sobre scheduled events). Convierte el horario local a UTC antes de codificar el schedule y documenta la interpretación legible en un comentario.

```yaml
name: Scheduled Load Tests

on:
  schedule:
    # Nightly load against staging — 02:00 UTC daily
    - cron: "0 2 * * *"
    # Weekly capacity test — Sundays at 03:00 UTC
    - cron: "0 3 * * 0"
    # Business-hours soak — Mon–Fri at 13:00 UTC ≈ 08:00 America/New_York
    - cron: "0 13 * * 1-5"

jobs:
  scheduled:
    runs-on: ubuntu-latest
    container:
      image: registry.example.com/k6-framework:VERSION
    env:
      TZ: America/New_York
      K6_CLIENT: my-team
      K6_ENV: staging
      K6_REPORTS_DIR: ./reports
    steps:
      - uses: actions/checkout@v4

      - name: Nightly load
        if: github.event.schedule == '0 2 * * *'
        env:
          K6_PROFILE: load
        run: |
          ./bin/run-test.sh \
            --client=my-team \
            --scenario=flow/checkout \
            --profile=load \
            --env=staging

      - name: Weekly capacity
        if: github.event.schedule == '0 3 * * 0'
        env:
          K6_PROFILE: capacity
        run: |
          ./bin/run-test.sh \
            --client=my-team \
            --scenario=perf/capacity \
            --profile=capacity \
            --env=staging

      - name: Business-hours soak
        if: github.event.schedule == '0 13 * * 1-5'
        env:
          K6_PROFILE: soak
        run: |
          ./bin/run-test.sh \
            --client=my-team \
            --scenario=perf/soak \
            --profile=soak \
            --env=staging

      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: scheduled-${{ github.run_id }}
          path: ./reports
```

---

## 5. GitLab CI — Job manual parametrizado

Agrega este snippet al `.gitlab-ci.yml` de tu repositorio de producto. El job permanece inactivo hasta que un desarrollador hace clic en **Run** desde la UI de Pipelines y completa las variables.

```yaml
load-test:manual:
  image: registry.example.com/k6-framework:VERSION
  when: manual
  variables:
    CLIENT: my-team
    SCENARIO: api/smoke-users
    PROFILE: smoke
    ENV: staging
    K6_REPORTS_DIR: reports
  script:
    - ./bin/run-test.sh --client=$CLIENT --scenario=$SCENARIO --profile=$PROFILE --env=$ENV
  artifacts:
    when: always
    expire_in: 30 days
    paths:
      - reports/
    reports:
      # If the framework emits JUnit XML, GitLab will surface it in the pipeline UI
      junit: reports/**/junit.xml
```

---

## 6. GitLab CI — Pipeline multi-proyecto (trigger post-deploy)

Lado caller — en el `.gitlab-ci.yml` de tu repositorio de producto:

```yaml
trigger-load-test:
  stage: post-deploy
  needs: [deploy]
  variables:
    DEPLOYED_VERSION: $CI_COMMIT_SHA
    TARGET_ENV: staging
    BASE_URL: https://staging.example.com
    SCENARIO: flow/checkout
    PROFILE: load
  trigger:
    project: org/k6-tests-repo
    branch: main
    strategy: depend
```

Lado receiver — en `org/k6-tests-repo/.gitlab-ci.yml`:

```yaml
post-deploy-load:
  image: registry.example.com/k6-framework:VERSION
  variables:
    K6_CLIENT: my-team
    K6_REPORTS_DIR: reports
  script:
    - echo "Testing version $DEPLOYED_VERSION against $BASE_URL"
    - ./bin/run-test.sh --client=$K6_CLIENT --scenario=$SCENARIO --profile=$PROFILE --env=$TARGET_ENV
  artifacts:
    when: always
    expire_in: 30 days
    paths:
      - reports/
```

---

## 7. GitLab CI — Pipelines programados

Los schedules cron de GitLab viven en la UI de Pipeline Schedules (proyecto → **Build** → **Pipeline Schedules**), **no** en YAML. Define una variable CI personalizada en cada schedule — por convención, `SCHEDULE_NAME` — y abre los jobs en abanico haciendo match en `rules:`.

```yaml
workflow:
  rules:
    - if: $CI_PIPELINE_SOURCE == "schedule"

.scheduled_base:
  image: registry.example.com/k6-framework:VERSION
  variables:
    K6_CLIENT: my-team
    K6_ENV: staging
    K6_REPORTS_DIR: reports
  artifacts:
    when: always
    expire_in: 30 days
    paths:
      - reports/

nightly-load:
  extends: .scheduled_base
  rules:
    - if: $SCHEDULE_NAME == "nightly"
  script:
    - ./bin/run-test.sh --client=$K6_CLIENT --scenario=flow/checkout --profile=load --env=$K6_ENV

weekly-capacity:
  extends: .scheduled_base
  rules:
    - if: $SCHEDULE_NAME == "weekly-capacity"
  script:
    - ./bin/run-test.sh --client=$K6_CLIENT --scenario=perf/capacity --profile=capacity --env=$K6_ENV

business-hours-soak:
  extends: .scheduled_base
  rules:
    - if: $SCHEDULE_NAME == "business-hours-soak"
  variables:
    TZ: America/New_York
  script:
    - ./bin/run-test.sh --client=$K6_CLIENT --scenario=perf/soak --profile=soak --env=$K6_ENV
```

> Las tres cadencias de cron (nightly, weekly, business-hours) se configuran desde la UI de GitLab, idénticas a las expresiones de schedule de GitHub en la sección 4.

---

## 8. Publicar resultados en un bucket

El contenedor escribe los artefactos en el directorio que apunta `K6_REPORTS_DIR` (por defecto `./reports`). Después del step de prueba, sincroniza ese directorio a S3, GCS o Azure Blob. Usa un prefijo por ejecución (`$GITHUB_RUN_ID` o `$CI_PIPELINE_ID`) para mantener separables las corridas históricas. `actions/upload-artifact@v4` con `retention-days:` sigue siendo útil para artefactos transitorios del pull request aun cuando archives en un bucket.

### GitHub Actions

```yaml
      - name: Publish reports to S3
        uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-region: us-east-1
          role-to-assume: ${{ secrets.AWS_ROLE_ARN }}
      - run: aws s3 sync ./reports s3://bucket-name/$GITHUB_RUN_ID/
```

```yaml
      - name: Publish reports to GCS
        uses: google-github-actions/auth@v2
        with:
          workload_identity_provider: ${{ secrets.GCP_WIP }}
          service_account: ${{ secrets.GCP_SA_EMAIL }}
      - run: gsutil -m rsync -r ./reports gs://bucket-name/$GITHUB_RUN_ID/
```

```yaml
      - name: Publish reports to Azure Blob
        uses: azure/login@v2
        with:
          creds: ${{ secrets.AZURE_CREDENTIALS }}
      - run: az storage blob upload-batch --source ./reports --destination bucket-name --destination-path $GITHUB_RUN_ID
```

### GitLab CI

Usa variables CI/CD enmascaradas (proyecto → **Settings** → **CI/CD** → **Variables**, marca **Masked** y **Protected**).

```yaml
publish-s3:
  image: registry.example.com/k6-framework:VERSION
  script:
    - aws s3 sync reports/ s3://bucket-name/$CI_PIPELINE_ID/
```

```yaml
publish-gcs:
  image: registry.example.com/k6-framework:VERSION
  script:
    - echo "$GCP_SA_KEY" | gcloud auth activate-service-account --key-file=-
    - gsutil -m rsync -r reports/ gs://bucket-name/$CI_PIPELINE_ID/
```

```yaml
publish-azure:
  image: registry.example.com/k6-framework:VERSION
  script:
    - az storage blob upload-batch --source reports --destination bucket-name --destination-path $CI_PIPELINE_ID --account-key $AZURE_STORAGE_KEY
```

---

## 9. Publicar resultados como comentarios en PR/MR

Ambas plataformas pueden publicar una tabla resumen en el pull request o merge request. Extrae `p(95)`, error rate y status del SLO desde el JSON summary del framework (el schema exacto está definido en `src/reporting/json-summary-generator.ts` — los JSON paths que se muestran abajo son ilustrativos).

Tabla renderizada que ambas plataformas producen (un ejemplo canónico):

```markdown
| Metric         | Value   | Threshold | Status |
|----------------|---------|-----------|--------|
| p95 latency    | 312 ms  | < 500 ms  | pass   |
| Error rate     | 0.42 %  | < 1.00 %  | pass   |
| SLO            | met     | —         | pass   |
```

### GitHub Actions

```yaml
      - name: Build summary
        id: summary
        run: |
          P95=$(jq -r '.metrics.http_req_duration.values["p(95)"] | tonumber | floor' reports/summary.json)
          ERR=$(jq -r '.metrics.http_req_failed.values.rate * 100 | tonumber | . * 100 | floor / 100' reports/summary.json)
          SLO=$(jq -r '.slo.status // "unknown"' reports/summary.json)
          {
            echo "| Metric | Value | Threshold | Status |"
            echo "|--------|-------|-----------|--------|"
            echo "| p95 latency | ${P95} ms | < 500 ms | $( [ "$P95" -lt 500 ] && echo pass || echo fail ) |"
            echo "| Error rate | ${ERR} % | < 1.00 % | $( awk "BEGIN{print ($ERR<1)?\"pass\":\"fail\"}" ) |"
            echo "| SLO | ${SLO} | — | ${SLO} |"
          } > pr-comment.md

      - name: Upsert sticky PR comment
        uses: marocchino/sticky-pull-request-comment@v2
        with:
          header: load-test
          path: pr-comment.md
```

### GitLab CI

```yaml
post-mr-note:
  image: registry.example.com/k6-framework:VERSION
  rules:
    - if: $CI_MERGE_REQUEST_IID
  script:
    - |
      P95=$(jq -r '.metrics.http_req_duration.values["p(95)"] | tonumber | floor' reports/summary.json)
      ERR=$(jq -r '.metrics.http_req_failed.values.rate * 100' reports/summary.json)
      SLO=$(jq -r '.slo.status // "unknown"' reports/summary.json)
      NOTE_BODY=$(printf '<!-- load-test -->\n| Metric | Value | Threshold | Status |\n|--------|-------|-----------|--------|\n| p95 latency | %s ms | < 500 ms | %s |\n| Error rate | %s %% | < 1.00 %% | %s |\n| SLO | %s | — | %s |' "$P95" "$( [ "$P95" -lt 500 ] && echo pass || echo fail )" "$ERR" "$( awk "BEGIN{print ($ERR<1)?\"pass\":\"fail\"}" )" "$SLO" "$SLO")
    - |
      curl --request POST \
        --header "PRIVATE-TOKEN: $GITLAB_TOKEN" \
        "$CI_API_V4_URL/projects/$CI_PROJECT_ID/merge_requests/$CI_MERGE_REQUEST_IID/notes" \
        --form "body=$NOTE_BODY"
```

Opcional — en lugar de agregar una nota nueva en cada corrida, busca la anterior por su marcador (`<!-- load-test -->`) y actualízala en su lugar:

```yaml
      - |
        EXISTING=$(curl --silent --header "PRIVATE-TOKEN: $GITLAB_TOKEN" \
          "$CI_API_V4_URL/projects/$CI_PROJECT_ID/merge_requests/$CI_MERGE_REQUEST_IID/notes?per_page=100" \
          | jq -r '.[] | select(.body | startswith("<!-- load-test -->")) | .id' | head -n 1)
        if [ -n "$EXISTING" ]; then
          curl --request PUT \
            --header "PRIVATE-TOKEN: $GITLAB_TOKEN" \
            "$CI_API_V4_URL/projects/$CI_PROJECT_ID/merge_requests/$CI_MERGE_REQUEST_IID/notes/$EXISTING" \
            --form "body=$NOTE_BODY"
        else
          curl --request POST \
            --header "PRIVATE-TOKEN: $GITLAB_TOKEN" \
            "$CI_API_V4_URL/projects/$CI_PROJECT_ID/merge_requests/$CI_MERGE_REQUEST_IID/notes" \
            --form "body=$NOTE_BODY"
        fi
```

Agregar una nota nueva en cada corrida es más simple; el patrón search-then-`PUT` solo vale la pena cuando los revisores se quejan del ruido de comentarios.

---

## 10. Notificaciones (Slack / Teams / Webhook)

Cuando termina una ejecución de prueba, normalmente quieres enviar un veredicto de una línea (pass/fail, p95, error rate) a Slack, Microsoft Teams o un webhook genérico. El framework expone dos puntos de entrada y un set acotado de variables de entorno canónicas — elige el que coincida con *dónde* debe dispararse la notificación.

### 10.1 Visión general de la arquitectura

Los dos puntos de entrada que provee el framework:

- **`bin/notify.js`** — CLI de Node.js para notificaciones **post-run**. Lee el JSON summary que escribe `bin/run-test.sh`, lo formatea para la plataforma destino y hace POST al webhook entrante de Slack / Teams / genérico. Úsalo desde CI como el **último step** del pipeline (después del step de prueba, con `if: always()` / `when: always`) para que el veredicto se envíe incluso cuando la prueba falla.
- **`src/integrations/notification-service.ts`** (clase `NotificationService`) — emisor multi-canal **en runtime**, dentro de k6. Soporta formato Block Kit, retries (1–3, exponential backoff), conditions (`always | on_failure | on_regression`), y está protegido contra SSRF vía `src/integrations/webhook-validator.ts` antes de cada envío. Úsalo desde el `teardown()` de un scenario cuando la notificación deba originarse desde el propio proceso de la prueba.

Ambos caminos comparten las mismas variables canónicas `NOTIFY_*` (ver 10.2), de modo que el mismo secret de CI puede alimentar cualquiera de los dos.

### 10.2 Variables de entorno canónicas

| Variable | Propósito |
|---|---|
| `NOTIFY_SLACK_WEBHOOK` | Slack incoming webhook URL |
| `NOTIFY_EMAIL_TO` | Recipient address for the email channel |
| `NOTIFY_EMAIL_ENDPOINT` | HTTP endpoint that delivers the email |
| `NOTIFY_WEBHOOK_URL` | Generic webhook URL |

> **Nota:** los nombres de los secrets en CI pueden ser cualquier cosa — el framework lee `NOTIFY_*` solo cuando se invoca directamente sin un override `--webhook`. En CI lo normal es pasar `--webhook=$NOMBRE_DEL_SECRET` a `bin/notify.js` (por ejemplo `--webhook=${{ secrets.NOTIFY_SLACK_WEBHOOK }}`) y la CLI nunca lee la variable de entorno.

### 10.3 Ejemplo GitHub Actions

Añade un step `notify` después de tu step de prueba existente. El step usa `if: always()` para que se ejecute incluso si el step anterior falla; la imagen del framework se invoca igual que en la sección 2, pero el entrypoint es `node bin/notify.js`:

```yaml
jobs:
  run:
    runs-on: ubuntu-latest
    container:
      image: registry.example.com/k6-framework:VERSION
    steps:
      - uses: actions/checkout@v4

      - name: Run k6
        env:
          K6_CLIENT: my-team
          K6_ENV: staging
          K6_PROFILE: smoke
          K6_REPORTS_DIR: ./reports
        run: |
          ./bin/run-test.sh \
            --client=my-team \
            --scenario=api/smoke-users \
            --profile=smoke \
            --env=staging

      - name: Notify Slack
        if: always()
        env:
          WEBHOOK: ${{ secrets.NOTIFY_SLACK_WEBHOOK }}
        run: |
          node bin/notify.js \
            --result=./reports/summary.json \
            --webhook=$WEBHOOK \
            --platform=slack
```

Si prefieres el patrón `docker run` standalone de la sección 1 (host-side, no `jobs.<id>.container`), la misma llamada se ve así:

```bash
docker run --rm \
  -v $PWD/reports:/work/reports \
  registry.example.com/k6-framework:VERSION \
  node bin/notify.js \
    --result=/work/reports/summary.json \
    --webhook=$WEBHOOK \
    --platform=slack
```

`bin/notify.js` termina con exit `0` en caso de éxito o `--dry-run`, y `1` en caso de error. Mantén el `if: always()` del step para que una prueba que falla igual dispare la notificación.

### 10.4 Ejemplo GitLab CI

Pon la llamada al notify en un job separado de un stage posterior con `when: always`, y trae los artifacts de la prueba vía `dependencies:` para que `reports/summary.json` esté disponible:

```yaml
stages:
  - test
  - notify

load-test:
  stage: test
  image: registry.example.com/k6-framework:VERSION
  variables:
    K6_CLIENT: my-team
    K6_REPORTS_DIR: reports
  script:
    - ./bin/run-test.sh --client=my-team --scenario=api/smoke-users --profile=smoke --env=staging
  artifacts:
    when: always
    expire_in: 30 days
    paths:
      - reports/

notify-slack:
  stage: notify
  image: registry.example.com/k6-framework:VERSION
  when: always
  dependencies:
    - load-test
  variables:
    # Configura NOTIFY_SLACK_WEBHOOK como variable CI/CD enmascarada y protegida
    # (Settings → CI/CD → Variables → Masked + Protected).
    PLATFORM: slack
  script:
    - node bin/notify.js --result=reports/summary.json --webhook=$NOTIFY_SLACK_WEBHOOK --platform=$PLATFORM
```

La variable enmascarada `NOTIFY_SLACK_WEBHOOK` se lee directamente desde la configuración CI/CD de GitLab — no hace falta pasarla por el script.

### 10.5 Condiciones

Hay dos capas que controlan "cuándo se dispara una notificación":

- **Capa de CI** — `if: failure()` / `if: success()` / `if: always()` (GitHub Actions) y `when: on_failure | on_success | always` (GitLab CI). Usa esta capa cuando llamas a `bin/notify.js` desde un step de CI. Es el camino más simple: el veredicto lo computa el exit code del step de prueba previo, y CI decide si corre el step de notify.
- **Capa del framework (runtime)** — `NotificationConfig.conditions = "always" | "on_failure" | "on_regression"`. Usa esta capa cuando invocas `NotificationService` desde el `teardown()` de un scenario. La condición se evalúa contra el campo `verdict` del payload, dentro del proceso de k6:

```typescript
import { NotificationService } from "../../src/integrations/notification-service";

export function teardown(data: { payload: NotificationPayload }): void {
  const svc = new NotificationService({ channels: ["slack"], conditions: "on_failure" });
  svc.notify(data.payload);
}
```

`on_regression` es el mismo predicado que `on_failure` desde la perspectiva del service — la decisión de regression se toma upstream y se refleja en `payload.verdict`.

### 10.6 Multi-canal (fan-out)

- **CLI** — encadena una invocación de `bin/notify.js` por canal:

  ```bash
  node bin/notify.js --result=reports/summary.json --webhook=$NOTIFY_SLACK_WEBHOOK   --platform=slack
  node bin/notify.js --result=reports/summary.json --webhook=$NOTIFY_TEAMS_WEBHOOK   --platform=teams
  node bin/notify.js --result=reports/summary.json --webhook=$NOTIFY_WEBHOOK_URL     --platform=generic
  ```

- **Runtime** — una sola llamada a `NotificationService` abre el abanico sobre todos los canales configurados de una sola vez:

  ```typescript
  const svc = new NotificationService({
    channels: ["slack", "email", "webhook"],
    conditions: "on_failure",
  });
  svc.notify(payload);
  ```

  La falla en un canal se loggea pero no bloquea a los demás canales.

### 10.7 Vista previa Block Kit

El mensaje de Slack que renderiza `bin/notify.js` (y `SlackFormatter` dentro de `NotificationService`) es un mensaje Block Kit. La vista previa renderizada se ve así:

```
┌─ k6 Load Test Result ────────────────────────────────┐
│ ❌  FAIL                                              │
├──────────────────────────────────────────────────────┤
│ verdict       fail                                   │
│ p95           812 ms       (threshold < 500 ms)      │
│ error rate    1.42 %       (threshold < 1.00 %)      │
├──────────────────────────────────────────────────────┤
│ run_id   42 · client my-team · scenario api/smoke-users · profile smoke │
└──────────────────────────────────────────────────────┘
```

El mockup es ilustrativo — el set de campos real proviene de `SlackFormatter` en `src/integrations/notification-service.ts`.

Ver también [ci-cd-integration.md § 5.1 Slack](./ci-cd-integration.md#51-slack) para el detalle a nivel de campo de Block Kit.

### 10.8 Seguridad

- **`webhook-validator.ts` bloquea destinos SSRF** — RFC1918 (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16), loopback (127.0.0.0/8, `::1`), link-local 169.254.0.0/16 (servicio de metadata de la nube), e IPv6 ULA `fc00::/7`. Un POST a cualquiera de esas direcciones falla en el check `assertWebhookAllowed` antes de que la request salga del proceso.
- **Enmascara las webhook URLs como secrets de CI** — GitHub: `Settings → Secrets and variables → Actions`; GitLab: marca cada variable `NOTIFY_*` como **Masked** y **Protected**. Nunca pongas una webhook URL inline en YAML ni la commitees a un `.env`.
- **Fija la imagen del framework por digest en producción** — misma regla que en el resto de esta guía (consulta § 11 Notas de seguridad para el comando de pinning por digest).

---

## 11. Notas de seguridad

- **Los secrets viven solo en variables CI/CD enmascaradas** — nunca pongas tokens inline, credenciales del registry, ni `REDIS_PASSWORD` dentro del YAML.
- **Fija la imagen por digest SHA256 en producción** — reemplaza el tag por `registry.example.com/k6-framework@sha256:<digest>`. Obtén el digest con:

  ```bash
  docker buildx imagetools inspect registry.example.com/k6-framework:VERSION
  ```

- **Estrategia de mounts**: código fuente como read-only (`:ro`), reports como writable (`:rw`); evita `--network=host` salvo que el servicio bajo prueba lo requiera.
- **Fija las Actions de terceros a un commit SHA en workflows protegidos** — p. ej. `marocchino/sticky-pull-request-comment@<sha>` en vez de `@v2`, y lo mismo para `aws-actions/configure-aws-credentials`, `google-github-actions/auth`, `azure/login`.
- **Los buckets canónicos de scenario son enforced por `bin/run-test.sh`** — los prefijos no canónicos (cualquier cosa fuera de `api/`, `flow/`, `domain/`, `chaos/`, `perf/`) hacen que el script termine con exit code `1`. Consulta la sección Quality Gates en [`./ci-cd-integration.md`](./ci-cd-integration.md) y **Client Scenarios Taxonomy** en `CLAUDE.md`.
- **Ejecuta como el UID non-root horneado en la imagen** — el Dockerfile baja a `USER 65534` (nobody/nogroup) por SEC-07. No sobrescribas `USER` en tu pipeline, y no añadas `--user 0` al `docker run`.

---

### Ver también

- [`./ci-cd-integration.md`](./ci-cd-integration.md) — patrones de self-test del framework (Quality Gates, `perf-smoke.yml`, `perf-gate.yml`, `perf-regression.yml`, plantilla `include` de GitLab).
- `CLAUDE.md` — Client Scenarios Taxonomy (buckets canónicos, canon completo).
- `infrastructure/k8s/Dockerfile` — código fuente de la imagen (SEC-07 USER 65534, SEC-08 pinning por digest, build arg `CLIENT`).
