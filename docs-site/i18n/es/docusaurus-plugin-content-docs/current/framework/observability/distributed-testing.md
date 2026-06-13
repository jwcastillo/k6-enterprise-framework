---
title: "Testing Distribuido con Kubernetes (T-156 / T-174)"
sidebar_position: 3
---
# Testing Distribuido con Kubernetes (T-156 / T-174)

Ejecuta pruebas de carga k6 distribuidas en múltiples pods de Kubernetes usando
[k6-operator](https://github.com/grafana/k6-operator).

## Arquitectura

```
┌──────────────────────────────────────────────┐
│              Kubernetes Cluster               │
│                                               │
│  ┌─────────────┐     ┌───────────────────┐   │
│  │ k6-operator │────▶│  TestRun CRD      │   │
│  │ (controller)│     │  parallelism: 5   │   │
│  └─────────────┘     └────────┬──────────┘   │
│                               │               │
│              ┌────────────────┼───────┐       │
│              ▼       ▼        ▼       ▼       │
│           Pod-1   Pod-2    Pod-3   Pod-N      │
│           k6 runner (same script, diff VUs)   │
│              │       │        │       │       │
│              └───────┴────────┴───────┘       │
│                       │ metrics                │
│                       ▼                       │
│              Prometheus remote write          │
└──────────────────────────────────────────────┘
```

## Prerrequisitos

1. Clúster de Kubernetes (1.25+)
2. k6-operator instalado:
   ```bash
   kubectl apply -f https://raw.githubusercontent.com/grafana/k6-operator/main/bundle.yaml
   ```
3. Acceso a un registro de contenedores (para subir tu imagen de k6)
4. kubectl configurado para tu clúster

## Inicio Rápido — `run-distributed.sh`

El wrapper `bin/run-distributed.sh` maneja el flujo completo en un solo comando:

```bash
# Básico: 2 pods, imagen pre-construida
./bin/run-distributed.sh \
  --client=myapp \
  --scenario=api/checkout \
  --profile=load \
  --image=registry.example.com/k6-myapp:latest

# Alta carga: 8 pods, construir imagen en línea
./bin/run-distributed.sh \
  --client=myapp \
  --scenario=api/checkout \
  --profile=stress \
  --parallelism=8 \
  --build \
  --registry=registry.example.com/myapp

# Ver todas las opciones
./bin/run-distributed.sh --help
```

El script ejecuta los 6 pasos automáticamente con estado en tiempo real por pod:

```
[STEP]  Step 5/6 — Monitoring test execution

  Test run:    k6-load-test
  Namespace:   k6-tests
  Parallelism: 4 pods
  Profile:     load

  Pod    Name                           Status       Elapsed    Message
  ────────────────────────────────────────────────────────────────────────
  1/4    k6-load-test-1-runner-abcde    ✓ Succeeded  4m 12s     exit=0
  2/4    k6-load-test-2-runner-fghij    ● Running    4m 05s     running
  3/4    k6-load-test-3-runner-klmno    ● Running    4m 03s     running
  4/4    k6-load-test-4-runner-pqrst    ○ Pending    —          ContainerCreating
```

El JSON del reporte incluye metadatos de ejecución distribuida automáticamente:

```json
{
  "distributedExecution": {
    "executionMode": "distributed",
    "parallelism": 4,
    "runnerPods": 4,
    "podsSucceeded": 4,
    "podsFailed": 0,
    "namespace": "k6-tests",
    "testRunName": "k6-load-test",
    "image": "registry.example.com/k6-myapp:latest",
    "kubernetesContext": "prod-cluster"
  }
}
```

---

## Flujo de Trabajo Manual

### 1. Construir y subir la imagen Docker de k6

```bash
# Construir imagen con tus scripts de prueba compilados
docker build -f infrastructure/k8s/Dockerfile \
  --build-arg CLIENT=my-team \
  -t registry.example.com/k6-my-team:latest .

docker push registry.example.com/k6-my-team:latest
```

### 2. Crear secretos de Kubernetes

```bash
kubectl create namespace k6-tests

kubectl create secret generic k6-secrets \
  --from-literal=APP_API_KEY="${APP_API_KEY}" \
  --from-literal=APP_PASSWORD="${APP_PASSWORD}" \
  -n k6-tests
```

### 3. Crear ConfigMap del script

```bash
# Después de compilar: npm run build
kubectl create configmap k6-scripts \
  --from-file=scenario.js=dist/my-team/api/smoke-users.js \
  -n k6-tests
```

### 4. Aplicar RBAC y ejecutar la prueba

```bash
kubectl apply -f infrastructure/k8s/rbac.yaml
kubectl apply -f infrastructure/k8s/k6-testrun.yaml
```

### 5. Monitorear

```bash
# Observar pods
kubectl get pods -n k6-tests -w

# Transmitir logs de todos los runners
kubectl logs -n k6-tests -l app=k6-runner -f

# Verificar estado de la prueba
kubectl get testrun -n k6-tests
```

## Referencia del CRD — `infrastructure/k8s/k6-testrun.yaml`

| Campo | Descripción | Ejemplo |
|-------|-------------|---------|
| `spec.parallelism` | Número de pods runner en paralelo | `5` |
| `spec.script.configMap.name` | ConfigMap con el script de prueba | `k6-scripts` |
| `spec.script.configMap.file` | Nombre del archivo dentro del ConfigMap | `scenario.js` |
| `spec.runner.image` | Imagen Docker de k6 | `registry.example.com/k6:latest` |
| `spec.runner.env` | Variables de entorno | ver abajo |
| `spec.runner.resources` | Límites de CPU/memoria | ver abajo |
| `spec.runner.serviceAccountName` | Cuenta de servicio de K8s | `k6-runner` |

## Chart de Helm

```bash
# Desplegar via Helm
helm upgrade --install k6-enterprise infrastructure/k8s/helm/k6-enterprise \
  --namespace k6-tests \
  --set image.repository=registry.example.com/k6-my-team \
  --set image.tag=latest \
  --set parallelism=5 \
  --set env.K6_PROFILE=load \
  --set env.K6_CLIENT=my-team

# Validar manifiestos sin desplegar
helm template k6-enterprise infrastructure/k8s/helm/k6-enterprise | kubeval
```

## Recomendaciones para pruebas distribuidas

- **Distribución de VUs**: cada pod recibe `totalVUs / parallelism` VUs
- **Agregación de métricas**: usa Prometheus remote write — todos los pods escriben al mismo endpoint
- **Umbrales**: se evalúan por pod; usa `--set thresholds=false` si ejecutas breakpoints distribuidos
- **Archivos de datos**: monta vía ConfigMap o PVC; evita archivos grandes en las capas de la imagen
- **Ramp-up**: usa `ramping-vus` o `ramping-arrival-rate` — no `constant-vus` para pruebas distribuidas

## Cuándo usar testing distribuido

| Escenario | Recomendación |
|-----------|---------------|
| VUs < 500 | Máquina única o Docker Compose |
| VUs 500–5000 | Considerar distribuido (K8s) |
| VUs > 5000 | Distribuido requerido |
| Carga geodistribuida | Nodos K8s multi-región |
| Testing de breakpoint | Distribuido con auto-escalado |
