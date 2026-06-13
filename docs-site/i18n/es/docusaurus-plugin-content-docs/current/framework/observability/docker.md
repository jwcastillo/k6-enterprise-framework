---
title: "Guía de Uso de Docker"
sidebar_position: 2
---
# Guía de Uso de Docker

**T-179 (Fase 8)** · k6 Enterprise Framework

Ejecuta las pruebas del k6 Enterprise Framework dentro de Docker para obtener entornos consistentes y reproducibles — sin necesidad de instalar Node.js, TypeScript o k6 localmente.

---

## Beneficios

| Beneficio | Descripción |
|-----------|-------------|
| **Reproducible** | El mismo entorno en todas partes: desarrollo, CI, producción |
| **Aislado** | Sin conflictos con versiones locales de k6/Node |
| **Portable** | Funciona en cualquier máquina con Docker |
| **Listo para CI** | Se integra en cualquier pipeline con un solo `docker run` |

---

## Inicio Rápido (4 ejemplos)

### 1. Ejecución básica

```bash
docker run --rm \
  -v "$(pwd)/reports:/app/reports" \
  k6-enterprise:latest \
  --client=my-team \
  --scenario=api/smoke-users \
  --profile=smoke
```

### 2. Con variables de entorno

```bash
docker run --rm \
  -v "$(pwd)/reports:/app/reports" \
  -e BASE_URL=https://staging.api.example.com \
  -e API_TOKEN=eyJhbGc... \
  k6-enterprise:latest \
  --client=my-team \
  --scenario=api/smoke-users \
  --profile=load
```

### 3. Con un perfil de carga específico

```bash
docker run --rm \
  -v "$(pwd)/reports:/app/reports" \
  -e BASE_URL=https://api.example.com \
  k6-enterprise:latest \
  --client=my-team \
  --scenario=integration/checkout-flow \
  --profile=stress \
  --output=json
```

### 4. Archivo de escenario directo

```bash
docker run --rm \
  -v "$(pwd)/clients:/app/clients:ro" \
  -v "$(pwd)/reports:/app/reports" \
  -e BASE_URL=https://api.example.com \
  k6-enterprise:latest \
  --client=my-team \
  --scenario=api/smoke-users
```

---

## Construcción de la Imagen

```bash
# [1/3] Building k6-framework image...
docker build -t k6-enterprise:latest .

# Con un cliente específico incluido (para distribución en CI)
# [1/3] Building k6-framework image...
# [2/3] Including client config for 'my-team'...
# [3/3] Done: k6-enterprise:20260218
docker build \
  --build-arg CLIENT=my-team \
  -t k6-enterprise:$(date +%Y%m%d) \
  .
```

---

## Dockerfile (referencia)

```dockerfile
FROM node:20-slim AS builder

WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci

COPY src/ ./src/
COPY shared/ ./shared/
RUN npm run build

# ── Runtime stage ──────────────────────────────────────────────────────────
FROM grafana/k6:latest AS runtime

# Install Node.js for report generation scripts
USER root
RUN apk add --no-cache nodejs npm bash

WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY clients/ ./clients/
COPY bin/ ./bin/
COPY shared/ ./shared/

# Reports output directory (mount this as a volume)
RUN mkdir -p /app/reports
VOLUME ["/app/reports"]

ENTRYPOINT ["./bin/run-test.sh"]
```

---

## Persistencia de Reportes

Monta un directorio del host en `/app/reports` para acceder a los artefactos después de que el contenedor finalice:

```bash
mkdir -p ./reports

docker run --rm \
  -v "$(pwd)/reports:/app/reports" \
  -e BASE_URL=https://api.example.com \
  k6-enterprise:latest \
  --client=my-team --scenario=api/smoke-users

# Los reportes ahora están disponibles localmente:
ls ./reports/my-team/smoke-users/
# html-report-20260218-143052.html
# summary-20260218-143052.json
# k6-execution-20260218-143052.log
```

### Por qué los volúmenes son importantes

Sin un volumen montado, todos los reportes se pierden cuando el contenedor se detiene. Usa:
- **`-v`** para desarrollo: `$(pwd)/reports:/app/reports`
- **Artefactos de CI**: sube el directorio `/app/reports` después de la ejecución
- **Volúmenes nombrados**: `docker volume create k6-reports && -v k6-reports:/app/reports`

---

## Docker Compose (multi-test)

```yaml
# docker-compose.yml
version: "3.9"

services:
  smoke:
    image: k6-enterprise:latest
    volumes:
      - ./reports:/app/reports
    environment:
      BASE_URL: ${BASE_URL:-https://api.example.com}
      API_TOKEN: ${API_TOKEN}
    command: ["--client=my-team", "--scenario=api/smoke-users", "--profile=smoke"]

  load:
    image: k6-enterprise:latest
    volumes:
      - ./reports:/app/reports
    environment:
      BASE_URL: ${BASE_URL:-https://api.example.com}
      API_TOKEN: ${API_TOKEN}
    command: ["--client=my-team", "--scenario=api/smoke-users", "--profile=load"]
    profiles: ["load"]   # only runs with: docker compose --profile load up
```

```bash
# Ejecutar solo smoke
docker compose up smoke

# Ejecutar prueba de carga
docker compose --profile load up load
```

---

## Integración CI/CD

### GitHub Actions

```yaml
- name: Build k6 image
  run: docker build -t k6-enterprise:${{ github.sha }} .

- name: Validate config
  run: |
    docker run --rm k6-enterprise:${{ github.sha }} \
      node bin/validate-config.js --client=my-team

- name: Run smoke test
  run: |
    mkdir -p reports
    docker run --rm \
      -v ${{ github.workspace }}/reports:/app/reports \
      -e BASE_URL=${{ secrets.BASE_URL }} \
      -e API_TOKEN=${{ secrets.API_TOKEN }} \
      k6-enterprise:${{ github.sha }} \
      --client=my-team --scenario=api/smoke-users --profile=smoke

- name: Upload reports
  uses: actions/upload-artifact@v4
  if: always()
  with:
    name: k6-reports
    path: reports/
```

### GitLab CI

```yaml
k6-smoke:
  image: docker:24
  services:
    - docker:dind
  script:
    - docker build -t k6-enterprise:$CI_COMMIT_SHA .
    - mkdir -p reports
    - docker run --rm
        -v $CI_PROJECT_DIR/reports:/app/reports
        -e BASE_URL=$BASE_URL
        -e API_TOKEN=$API_TOKEN
        k6-enterprise:$CI_COMMIT_SHA
        --client=my-team --scenario=api/smoke-users --profile=smoke
  artifacts:
    paths:
      - reports/
    when: always
    expire_in: 7 days
```

---

## Solución de Problemas

| Problema | Solución |
|----------|----------|
| `Permission denied` en reports/ | `chmod 777 ./reports` o usa `--user $(id -u):$(id -g)` |
| Error `BASE_URL not set` | Pasa `-e BASE_URL=https://...` a `docker run` |
| `Client not found` | Monta el directorio de clientes: `-v $(pwd)/clients:/app/clients:ro` |
| Los reportes no aparecen | Verifica el volumen: `-v $(pwd)/reports:/app/reports` |
| La imagen es muy grande | Usa build multi-stage (ver Dockerfile arriba) |
| Binario de k6 no encontrado | Confirma que la imagen base sea `grafana/k6:latest` |

---

## Referencia de Variables de Entorno

| Variable | Requerida | Descripción |
|----------|-----------|-------------|
| `BASE_URL` | Sí | URL base del servicio objetivo |
| `API_TOKEN` | Si usa auth | Token Bearer para autenticación |
| `K6_PROMETHEUS_RW_SERVER_URL` | No | Endpoint de escritura remota de Prometheus |
| `K6_OUT` | No | Salida adicional (ej. `influxdb=http://...`) |
| `K6_DEBUG` | No | Habilitar logging detallado (`true`/`false`) |
| `K6_TRACING_ENABLED` | No | Habilitar propagación de trazas W3C |
| `K6_LOKI_URL` | No | Endpoint push de Loki (ej. `http://loki:3100/loki/api/v1/push`) |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | No | Endpoint OTLP gRPC para trazas en Tempo (ej. `http://tempo:4317`) |
| `K6_PYROSCOPE_ENABLED` | No | Habilitar etiquetas de profiling Pyroscope (`true`/`false`) |
| `K6_PYROSCOPE_ENDPOINT` | No | Endpoint de Pyroscope (ej. `http://pyroscope:4040`) |

---

## Flags de Observabilidad (run-test.sh)

El CLI `run-test.sh` soporta flags para enviar datos al stack de observabilidad:

| Flag | Descripción |
|------|-------------|
| `--prometheus [url]` | Enviar métricas via Prometheus remote-write |
| `--loki [url]` | Enviar logs de k6 a Loki (reemplaza salida a archivo) |
| `--tempo [endpoint]` | Enviar trazas a Tempo via OTLP gRPC |
| `--otel` | Enviar métricas via OpenTelemetry |
| `--observability` | Habilitar TODAS las salidas: Prometheus + Loki + Tempo + OTEL |

```bash
# Pipeline completo de observabilidad
./bin/run-test.sh --client=examples --scenario=integration/16-sli-monitoring \
  --profile=smoke --observability

# Selectivo: solo logs Loki + métricas Prometheus
./bin/run-test.sh --client=examples --scenario=api/01-auth-bearer \
  --profile=smoke --prometheus --loki
```

---

## Versiones del Stack

| Componente | Versión | Imagen |
|------------|---------|--------|
| Grafana | 12.4.0 | `grafana/grafana:12.4.0` |
| Prometheus | v3.10.0 | `prom/prometheus:v3.10.0` |
| Loki | 3.6.7 | `grafana/loki:3.6.7` |
| Tempo | 2.10.1 | `grafana/tempo:2.10.1` |
| Pyroscope | 1.18.1 | `grafana/pyroscope:1.18.1` |
| k6 | 1.6.1 | `grafana/k6:1.6.1` |
| Redis | 7.4-alpine | `redis:7.4-alpine` |

Las versiones son configurables via `infrastructure/.env` (ver `.env.example`).

---

## Stack de Observabilidad

El framework incluye una configuración Docker Compose completa para el stack de observabilidad, incluyendo Grafana, Prometheus, Loki, Tempo y Pyroscope.

```bash
# Levantar el stack de observabilidad
docker compose --profile observability up -d

# Levantar todo (observabilidad + Redis + AI)
docker compose --profile all up -d
```

### Puertos del Stack

| Servicio | Puerto | Descripción |
|----------|--------|-------------|
| Grafana | 3000 | Dashboards y visualización |
| Prometheus | 9090 | Base de datos de métricas |
| Loki | 3100 | Agregación de logs |
| Tempo | 3200 | Trazas distribuidas |
| Pyroscope | 4040 | Profiling continuo |
| Redis | 6379 | Cache y datos de test |
| ChromaDB | 8000 | Base de datos vectorial (AI) |

### Perfiles Docker Compose

| Perfil | Servicios |
|--------|-----------|
| `observability` | Grafana, Prometheus, Loki, Tempo, Pyroscope |
| `redis` | Redis |
| `ai` | ChromaDB |
| `all` | Todos los servicios |

### Configuración de Producción

```bash
# Usar configuración de producción
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

Ver [Seguridad](/es/docs/framework/security/#observabilidad-segura-t-135t-136) para detalles de hardening en producción.

---

*Ver también: [Testing Distribuido](/es/docs/framework/observability/distributed-testing) para despliegue con Kubernetes/k6-operator · [Grafana](/es/docs/framework/observability/grafana) · [Seguridad](/es/docs/framework/security/)*
