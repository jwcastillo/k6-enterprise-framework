---
name: k6-distributed-runs
description: Run this framework's k6 scenarios distributed on Kubernetes with the k6-operator — the k6-enterprise Helm chart (TestRun, parallelism, testid tag, script ConfigMap, data via Secret or init-container download from a short-lived URL, secrets via envFrom, Prometheus remote-write), the run-distributed.sh wrapper, collecting results, and stopping a TestRun. Use when asked to "run <scenario> on the cluster with N pods", "render the TestRun for <scenario>", "how do I pass a large data file to the runners", or "stop the distributed test". Not for local runs (run-operations) or cluster provisioning.
---

# Distributed runs (k6-operator)

`<repo>` means the repository root. Chart: `<repo>/infrastructure/k8s/helm/k6-enterprise`
(TestRun and RBAC templates; defaults in its values file). A plain manifest
example lives at `<repo>/infrastructure/k8s/k6-testrun.yaml`.

## Preconditions (check, do not assume)

- The human confirmed: cluster/context, namespace, target environment, profile,
  parallelism and time window. Distributed load is never "just a smoke" for approval
  purposes when parallelism > 1.
- The same scenario passed a local smoke via run-operations.
- k6-operator is installed in the cluster (`kubectl get crd testruns.k6.io`).
- Secrets exist in the namespace (`kubectl get secret <name> -n <ns>`); never print
  their values.

## Key chart values

| Value (section → key) | Meaning |
|-------|---------|
| `test → parallelism` | Runner pods. Total load = per-pod load x parallelism; divide VUs / rate accordingly. |
| `test → testid` | Added as `--tag testid=<value>`; empty = `<name>-<MMDD-HHMM>`. Use it to filter metrics per run. |
| `test → arguments` | Extra k6 args, e.g. `-o experimental-prometheus-rw`. |
| `test → script → configMap` | ConfigMap holding the compiled bundle (build first with `pnpm build`). |
| `test → dataSecret` | Secret mounted read-only for small data files with secrets/PII (1 MiB limit). |
| `test → dataUrl` | Init container downloads a larger file from a presigned, short-lived URL into the data mount. Takes precedence over the data Secret. |
| `runner → envFromSecret → name` | Secret whose keys become env vars (tokens, passwords). Never put secrets in the `runner → env` block. |
| `runner → resources` | CPU/memory per pod. Browser tests need far more (see k6-browser). |
| `prometheus → remoteWrite` | Remote-write target for live metrics. |
| `persistence` | PVC for reports across runs. |
| `image` | k6 image; browser scenarios need a `-with-browser` tag. |

## Workflow

1. Render and review before applying:
   `helm template k6 <repo>/infrastructure/k8s/helm/k6-enterprise -f <values.yaml>`.
2. Show the rendered TestRun (parallelism, image, env names, testid) to the human.
3. Install only after confirmation: `helm install` (or `helm upgrade --install`) with the
   reviewed values file. Or use the wrapper
   `<repo>/bin/run-distributed.sh --client=<c> --scenario=<s> --profile=<p> --parallelism=<n> --image=<img>`
   (see its `--help`).
4. Watch: `kubectl get testrun -n <ns> -w`, `kubectl logs -n <ns> -l k6_cr=<name> --tail=50`.
5. Collect: per-pod summaries from logs or the PVC; aggregate metrics come from
   Prometheus filtered by `testid`. Record testid, namespace and paths in the hand-off.

## Data rules

- Presigned URLs: shortest practical expiry, never committed, never logged in full.
- Uniqueness across pods: see test-data-management (`iterationInTest`, per-instance
  slices).

## Stop / abort

Stopping a TestRun ends the test for every pod. Ask the human before deleting any
resource you did not create in this session. To stop your own run:
`kubectl delete testrun <name> -n <ns>` (or `helm uninstall <release> -n <ns>`), then
confirm pods are gone with `kubectl get pods -n <ns>`. Report the run as aborted.
