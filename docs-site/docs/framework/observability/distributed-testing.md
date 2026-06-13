---
title: "Distributed Testing with Kubernetes (T-156 / T-174)"
sidebar_position: 3
---
# Distributed Testing with Kubernetes (T-156 / T-174)

Run k6 load tests distributed across multiple Kubernetes pods using
[k6-operator](https://github.com/grafana/k6-operator).

## Architecture

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

## Prerequisites

1. Kubernetes cluster (1.25+)
2. k6-operator installed:
   ```bash
   kubectl apply -f https://raw.githubusercontent.com/grafana/k6-operator/main/bundle.yaml
   ```
3. Container registry access (to push your k6 image)
4. kubectl configured for your cluster

## Quick Start — `run-distributed.sh`

The `bin/run-distributed.sh` wrapper handles the full workflow in one command:

```bash
# Basic: 2 pods, pre-built image
./bin/run-distributed.sh \
  --client=myapp \
  --scenario=api/checkout \
  --profile=load \
  --image=registry.example.com/k6-myapp:latest

# High load: 8 pods, build image inline
./bin/run-distributed.sh \
  --client=myapp \
  --scenario=api/checkout \
  --profile=stress \
  --parallelism=8 \
  --build \
  --registry=registry.example.com/myapp

# View all options
./bin/run-distributed.sh --help
```

The script performs all 6 steps automatically with real-time per-pod status:

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

Report JSON includes distributed metadata automatically:

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

## Manual Workflow

### 1. Build and push the k6 Docker image

```bash
# Build image with your compiled test scripts
docker build -f infrastructure/k8s/Dockerfile \
  --build-arg CLIENT=my-team \
  -t registry.example.com/k6-my-team:latest .

docker push registry.example.com/k6-my-team:latest
```

### 2. Create Kubernetes secrets

```bash
kubectl create namespace k6-tests

kubectl create secret generic k6-secrets \
  --from-literal=APP_API_KEY="${APP_API_KEY}" \
  --from-literal=APP_PASSWORD="${APP_PASSWORD}" \
  -n k6-tests
```

### 3. Create script ConfigMap

```bash
# After building: npm run build
kubectl create configmap k6-scripts \
  --from-file=scenario.js=dist/my-team/api/smoke-users.js \
  -n k6-tests
```

### 4. Apply RBAC and run the test

```bash
kubectl apply -f infrastructure/k8s/rbac.yaml
kubectl apply -f infrastructure/k8s/k6-testrun.yaml
```

### 5. Monitor

```bash
# Watch pods
kubectl get pods -n k6-tests -w

# Stream logs from all runners
kubectl logs -n k6-tests -l app=k6-runner -f

# Check test status
kubectl get testrun -n k6-tests
```

## CRD Reference — `infrastructure/k8s/k6-testrun.yaml`

| Field | Description | Example |
|-------|-------------|---------|
| `spec.parallelism` | Number of parallel runner pods | `5` |
| `spec.script.configMap.name` | ConfigMap with test script | `k6-scripts` |
| `spec.script.configMap.file` | Filename inside ConfigMap | `scenario.js` |
| `spec.runner.image` | k6 Docker image | `registry.example.com/k6:latest` |
| `spec.runner.env` | Environment variables | see below |
| `spec.runner.resources` | CPU/memory limits | see below |
| `spec.runner.serviceAccountName` | K8s service account | `k6-runner` |

## Helm Chart

```bash
# Deploy via Helm
helm upgrade --install k6-enterprise infrastructure/k8s/helm/k6-enterprise \
  --namespace k6-tests \
  --set image.repository=registry.example.com/k6-my-team \
  --set image.tag=latest \
  --set parallelism=5 \
  --set env.K6_PROFILE=load \
  --set env.K6_CLIENT=my-team

# Validate manifests without deploying
helm template k6-enterprise infrastructure/k8s/helm/k6-enterprise | kubeval
```

## Recommendations for distributed tests

- **VU distribution**: each pod gets `totalVUs / parallelism` VUs
- **Metrics aggregation**: use Prometheus remote write — all pods write to the same endpoint
- **Thresholds**: evaluated per-pod; use `--set thresholds=false` if running distributed breakpoints
- **Data files**: mount via ConfigMap or PVC; avoid large files in image layers
- **Ramp-up**: use `ramping-vus` or `ramping-arrival-rate` — not `constant-vus` for distributed

## When to use distributed testing

| Scenario | Recommendation |
|----------|---------------|
| VUs < 500 | Single machine or Docker Compose |
| VUs 500–5000 | Consider distributed (K8s) |
| VUs > 5000 | Distributed required |
| Geo-distributed load | K8s multi-region nodes |
| Breakpoint testing | Distributed with auto-scaling |
