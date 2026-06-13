---
title: "Security"
sidebar_position: 1
---
# Security

Framework security reference: RBAC, audit log, client isolation, binary protection, shell hardening, secrets, Kubernetes, reports, and observability.

---

## Table of Contents

1. [Access Control (RBAC)](#access-control-rbac)
2. [Immutable Audit Log](#immutable-audit-log)
3. [Client Isolation](#client-isolation)
4. [Shell Hardening](#shell-hardening-t-126t-127t-129)
5. [CLI Input Validation](#cli-input-validation-t-126)
6. [Secure YAML Parsing](#secure-yaml-parsing-t-128)
7. [Secrets Management](#secrets-management-t-130)
8. [Kubernetes Security](#kubernetes-security-t-131t-132)
9. [HTML Report Security](#html-report-security-t-133)
10. [Secure Observability](#secure-observability-t-135t-136)
11. [Binary and Profile Validation](#binary-and-profile-validation-t-137t-138)
12. [CI/CD Pipeline](#cicd-pipeline-t-140)
13. [Compiled Binary Protection](#compiled-binary-protection)
14. [Security Checklist](#security-checklist)

---

## Access Control (RBAC)

The framework implements a three-role system defined in `clients/{name}/config/rbac.json`.

### Roles and Permissions

| Operation                        | developer | lead | admin |
|----------------------------------|:---------:|:----:|:-----:|
| Run smoke / quick / load         | yes       | yes  | yes   |
| Run stress / spike               | no        | yes  | yes   |
| Run breakpoint / soak            | no        | yes  | yes   |
| Modify thresholds                | no        | yes  | yes   |
| Modify SLOs                      | no        | yes  | yes   |
| Assign roles                     | no        | no   | yes   |
| Manage clients                   | no        | no   | yes   |
| View reports (own client)        | yes       | yes  | yes   |
| View reports (other clients)     | no        | no   | yes   |
| Query audit log                  | yes       | yes  | yes   |
| Compile binaries                 | no        | yes  | yes   |
| Configure mock / chaos           | no        | yes  | yes   |

### Identity Sanitization (T-134/T-138)

User identity is sanitized before being used in paths or tags:

```typescript
// Only allowed characters: a-z A-Z 0-9 _ . @ -
// Maximum 128 characters. If invalid -> "anonymous"
const userId = raw.replace(/[^a-zA-Z0-9_.@-]/g, "").slice(0, 128) || "anonymous";
```

Identity resolution follows this priority order:

1. Environment variable `K6_USER`
2. Environment variable `$USER`
3. `"anonymous"` (permissive mode, without rbac.json)

```bash
# Run as specific user
K6_USER=alice ./bin/run-test.sh --client=acme --service=users --test=stress
```

---

## Immutable Audit Log

Every critical operation generates an immutable entry in `reports/{client}/audit/audit-{YYYY-MM}.jsonl`.

### Entry Structure

```json
{
  "timestamp": "2026-02-17T15:30:00.000Z",
  "eventType": "execution_start",
  "user": "alice",
  "client": "acme",
  "service": "users",
  "environment": "staging",
  "profile": "load",
  "previousHash": "a1b2c3...",
  "hash": "d4e5f6..."
}
```

### Hash Chain (SHA-256)

Each entry includes the `hash` of its content chained with the `previousHash`. Any modification breaks the chain and is detectable.

```bash
bin/audit-query.js --client=acme --verify-chain
```

### Event Types

| Type                 | Description                                  |
|----------------------|----------------------------------------------|
| `execution_start`    | Execution start                              |
| `execution_end`      | Execution end (pass/fail)                    |
| `config_change`      | Threshold, SLO, or config change             |
| `role_change`        | Role assignment or modification              |
| `access_denied`      | Unauthorized access attempt                  |
| `secret_validation`  | Secrets validation before execution          |

---

## Client Isolation

### Path Traversal (T-127)

`bin/run-test.sh` uses `realpath` to verify that `CLIENT_DIR` stays contained within `${ROOT_DIR}/clients/`:

```bash
CLIENT_REAL=$(realpath "${CLIENT_DIR}" 2>/dev/null || echo "")
CLIENTS_BASE=$(realpath "${ROOT_DIR}/clients")
if [[ "${CLIENT_REAL}" != "${CLIENTS_BASE}"/* ]]; then
  echo "ERROR: path traversal detected in --client" >&2
  exit 1
fi
```

`src/core/execution-isolation.ts` exposes `validateReportPath()` applying the same logic for report paths:

```typescript
import { validateReportPath } from "./execution-isolation";
validateReportPath("reports/acme/../beta/report.html"); // throws Error
```

### Environment Variable Isolation

Each execution injects only the active client's variables. No variables from other clients are visible.

### Opaque Error Messages

```
# Correct:
ERROR: ClientResolver: client 'acme' not found.

# Incorrect (never):
ERROR: client 'acme' not found; available: [beta, gamma, delta]
```

---

## Shell Hardening (T-126/T-127/T-129)

### Secure Input Patterns

`bin/run-test.sh` validates CLI parameters before using them in shell commands:

```bash
SAFE_NAME_RE='^[a-zA-Z0-9_-]{1,64}$'
SAFE_PATH_RE='^[a-zA-Z0-9_./-]{1,256}$'

validate_input() {
  local name="$1" value="$2" pattern="$3"
  if [[ ! "${value}" =~ ${pattern} ]]; then
    echo "ERROR: invalid parameter '${name}': '${value}'" >&2
    exit 1
  fi
  if [[ "${value}" == *".."* ]] || [[ "${value}" == *$'\0'* ]]; then
    echo "ERROR: '${name}' contains prohibited sequence" >&2
    exit 1
  fi
}
```

Validated parameters: `--client`, `--profile`, `--env`, `--scenario`.

### Secrets Backend Whitelist (T-129)

Only `K6_SECRETS_BACKENDS` values within the allowed list are accepted:

```bash
VALID_BACKENDS="env vault aws-sm azure-kv"
for backend in $(echo "${K6_SECRETS_BACKENDS}" | tr ',' ' '); do
  if [[ ! " ${VALID_BACKENDS} " =~ " ${backend} " ]]; then
    echo "ERROR: invalid secret backend: '${backend}'" >&2
    exit 1
  fi
done
```

---

## CLI Input Validation (T-126)

`src/core/input-validator.ts` centralizes validation for the Node.js context (`bin/`):

```typescript
import { validateRunTestInputs, assertNoPathTraversal } from "../src/core/input-validator";

// Validate all run-test parameters at once
validateRunTestInputs({
  client: "acme",
  profile: "load",
  env: "staging",
  scenario: "smoke-users",
});

// Individual path validation
assertNoPathTraversal("reports/acme/2026-02/report.html");
```

### Allowed Patterns

| Field    | Pattern                        | Max chars |
|----------|--------------------------------|-----------|
| client   | `[a-zA-Z0-9_-]`               | 64        |
| profile  | `[a-zA-Z0-9_-]`               | 64        |
| env      | `[a-zA-Z0-9_-]`               | 64        |
| scenario | `[a-zA-Z0-9_./-]`             | 256       |

Any value containing `..` or null bytes (`\0`) is rejected regardless of the pattern.

---

## Secure YAML Parsing (T-128)

`src/core/yaml-parser.ts` replaces direct usage of `js-yaml` with a safe wrapper:

```typescript
import { parseYamlSafe, parseYamlFileSafe } from "../src/core/yaml-parser";

// Parse YAML string
const config = parseYamlSafe(yamlString, "config.yaml");

// Parse YAML file
const slo = parseYamlFileSafe("clients/acme/config/slo.yaml");
```

### Applied Protections

| Protection                  | Limit                                        |
|-----------------------------|----------------------------------------------|
| Schema                      | `CORE_SCHEMA` (no arbitrary JS types)        |
| Maximum input size          | 1 MB                                         |
| Maximum object depth        | 10 levels                                    |
| Billion laughs (YAML bomb)  | >5 anchors AND >50 aliases -> rejected       |

```
ERROR: YAML too large (1.5 MB > limit of 1 MB)
ERROR: Possible YAML bomb: 6 anchors and 51 aliases detected
```

---

## Secrets Management (T-130)

### Key Validation (T-130)

`src/core/secrets-manager.ts` validates that secret keys match the required pattern before resolving:

```typescript
// Only: [A-Z0-9_], maximum 128 characters
resolveSecret("APP_API_KEY");     // ok
resolveSecret("app-api-key");     // Error: invalid format
resolveSecret("../../etc/passwd"); // Error: invalid format
```

### Hardcoded Secret Detection (T-130)

`src/core/config-security.ts` detects embedded secret patterns in configuration:

```typescript
import { auditConfigForSecrets } from "../src/core/config-security";

const findings = auditConfigForSecrets(configObject);
// findings: [{ path: "auth.token", pattern: "Bearer JWT", severity: "high" }]
```

Detected patterns:

| Pattern            | Example                        |
|--------------------|--------------------------------|
| JWT Bearer         | `eyJhbGciOi...`               |
| AWS Access Key     | `AKIA...`                     |
| GitHub Token       | `ghp_...`                     |
| RSA private key    | `-----BEGIN RSA PRIVATE KEY`  |
| Literal password   | `password: "mysecret123"`     |

### Detection Script (T-130)

```bash
# Scan the repository before a commit
./bin/detect-secrets.sh

# Output on finding:
# [SECRETS] Possible secret in src/core/config.ts:42
# ✖ Found 1 possible hardcoded secrets
```

The script automatically excludes lines containing `${`, `__ENV`, `placeholder`, `example`, or `secret-allow`.

### URL Sanitization in Logs (T-130)

`src/helpers/structured-logger.ts` redacts sensitive parameters in URLs before emitting logs:

```
# Input:  https://api.example.com/v1/data?token=abc123&user=alice
# Output: https://api.example.com/v1/data?token=****&user=alice
```

Redacted parameters: `token`, `password`, `passwd`, `secret`, `key`, `api_key`, `access_token`, `auth`.

Redacted headers: `authorization`, `x-api-key`, `x-amz-security-token`, `x-goog-signature`.

---

## Kubernetes Security (T-131/T-132)

### Least-Privilege RBAC (T-131)

`infrastructure/k8s/rbac.yaml` defines the `k6-runner` ServiceAccount with minimal permissions:

```yaml
# Can only:
# - get secrets (only necessary ones, by name)
# - get/list configmaps
# - CRUD on k6.io/testruns
# - get/list/watch pods
```

Deploy with:

```bash
kubectl apply -f infrastructure/k8s/rbac.yaml
```

### Pod Security Context (T-131)

The template `infrastructure/k8s/k6-testrun.yaml` enforces:

```yaml
securityContext:
  runAsNonRoot: true
  runAsUser: 65534          # nobody
  allowPrivilegeEscalation: false
  readOnlyRootFilesystem: true
  capabilities:
    drop: [ALL]
```

Secrets are injected exclusively via `secretKeyRef`, never with literal `value:` in the manifest.

### NetworkPolicy (T-132)

`infrastructure/k8s/network-policy.yaml` applies three policies in the `k6-tests` namespace:

| Policy                      | Effect                                              |
|-----------------------------|-----------------------------------------------------|
| `default-deny-all`          | Blocks all traffic by default                       |
| `k6-runner-egress`          | Allows DNS (53), HTTP/S (80/443), Prometheus (9090), Loki (3100) |
| `k6-runner-ingress-operator`| Only ingress on port 6565 from the k6-operator pod  |

```bash
kubectl apply -f infrastructure/k8s/network-policy.yaml
```

---

## HTML Report Security (T-133)

### PII Redaction in Tags (T-133)

The HTML generator (`src/reporting/html-report-generator.ts`) automatically redacts tag values that may contain PII:

```typescript
// Tags matching these patterns have their value replaced by "****"
const PII_TAG_PATTERNS = [/email/i, /phone/i, /ssn/i, /user_id/i, /ip_addr/i, ...];
```

Generated HTML includes the comment `<!-- Tags (PII fields redacted — T-133) -->`.

### SVG Sanitization in Branding (T-133)

If a custom SVG logo is provided via `branding.svgLogo`, it is validated before embedding:

```typescript
generateHtmlReport(data, context, "./report.html", {
  orgName: "Acme Corp",
  svgLogo: fs.readFileSync("logo.svg", "utf8"),
});
```

SVGs containing `<script>`, `javascript:`, `on*` handlers, `<foreignObject>`, `<iframe>`, or `data:text/html` are rejected with a warning and the logo is omitted from the report.

### Allowed Report Extensions (T-133)

`src/core/report-isolation.ts` only accepts these extensions when writing artifacts:

`.html` `.json` `.jsonl` `.csv` `.txt` `.md`

Any other extension throws an error before writing to disk.

---

## Secure Observability (T-135/T-136)

### Prometheus Label Sanitization (T-135)

`src/core/prometheus-sanitizer.ts` ensures exported labels comply with the Prometheus specification and do not leak sensitive data:

```typescript
import { sanitizeTagsForPrometheus } from "../src/core/prometheus-sanitizer";

const safeTags = sanitizeTagsForPrometheus({
  client: "acme",
  user_email: "alice@example.com",  // redacted: sensitive pattern
  env: "staging",
});
// { client: "acme", user_email: "****", env: "staging" }
```

Applied rules:

- Invalid characters -> `_`
- Label starting with digit -> `_` prefix
- Maximum length: 128 characters (label), 256 (value)
- Tag values with sensitive keys (token, password, key, secret...) -> `****`

This module is compatible with k6's goja runtime (no Node.js APIs).

### Production Grafana Hardening (T-136)

`infrastructure/docker-compose.prod.yml` overrides the development configuration:

```bash
# Start the full stack in production mode
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

Changes from development mode:

| Parameter                     | Development | Production           |
|-------------------------------|-------------|----------------------|
| `GF_AUTH_ANONYMOUS_ENABLED`   | true        | **false**            |
| `GF_AUTH_DISABLE_LOGIN_FORM`  | true        | **false**            |
| `GF_ADMIN_PASSWORD`           | admin       | **required via env** |
| `GF_SECRET_KEY`               | ---         | **required via env** |
| Prometheus/Loki/Tempo ports   | exposed     | **internal only**    |

```bash
# Required variables in production
export GF_ADMIN_PASSWORD="<secure-password>"
export GF_SECRET_KEY="<random-32-byte-key>"
```

If any of these variables are not defined, `docker compose` fails on startup.

---

## Binary and Profile Validation (T-137/T-138)

### k6 Binary Whitelist (T-137)

`src/core/binary-validator.ts` validates that `K6_BINARY_PATH` points to a trusted directory:

```bash
# Default allowed directories
/usr/local/bin
/usr/bin
/opt/k6
/opt/homebrew/bin
~/.local/bin

# Add additional directories
export K6_BINARY_ALLOWED_PATHS="/custom/bin:/another/dir"
```

It also verifies that the binary is executable and responds to `k6 version`.

`bin/run-test.sh` applies this validation if `K6_BINARY_PATH` is defined:

```bash
export K6_BINARY_PATH=/opt/k6/k6
./bin/run-test.sh --client=acme --service=users --test=load
```

### jslib Import Whitelist (T-137)

Only imports from trusted domains are allowed:

```typescript
validateJslibImport("https://jslib.k6.io/k6-utils/1.4.0/index.js");   // ok
validateJslibImport("https://cdn.jsdelivr.net/npm/k6-crypto@1.0.0");  // ok
validateJslibImport("https://evil.com/k6-hack.js");                    // Error
```

### Custom Profile Validation (T-138)

`src/core/profile-validator.ts` validates profile structure before execution:

```typescript
import { validateCustomProfile } from "../src/core/profile-validator";
validateCustomProfile(profileConfig);
```

Applied restrictions:

| Field                  | Restriction                                              |
|------------------------|----------------------------------------------------------|
| Prohibited fields      | `executor`, `env`, `systemTags`, `exec`, `disableSecretMasking`, `disableRbac` |
| Maximum total duration | 240 minutes                                              |
| VUs per role           | developer: 50 max, lead: 500 max                        |
| Stage format           | `^\d+(\.\d+)?(ms\|s\|m\|h)$`                           |
| Threshold condition    | `^[a-zA-Z_()\d]+[<>=!]{1,2}[\d.]+$`                    |

---

## CI/CD Pipeline (T-140)

### GitHub Actions

`.github/workflows/k6-test.yml` implements security best practices:

```yaml
permissions:
  contents: read   # least privilege

jobs:
  detect-secrets:
    steps:
      - run: ./bin/detect-secrets.sh   # blocks the pipeline if secrets found
  run-tests:
    needs: detect-secrets
    steps:
      - uses: grafana/k6-action@<SHA>  # actions pinned by SHA, not mutable tag
```

`workflow_dispatch` inputs are validated with regex before passing to shell commands:

```yaml
inputs:
  client:
    description: "Client name (a-z, 0-9, _, -)"
  # Validated in step: [[ "${{ inputs.client }}" =~ ^[a-zA-Z0-9_-]+$ ]]
```

Secrets are injected exclusively as environment variables:

```yaml
env:
  API_KEY: ${{ secrets.API_KEY }}
  # Never: run: ./run-test.sh --key=${{ secrets.API_KEY }}
```

### GitLab CI

`.gitlab-ci.yml` applies the same restrictions. Secrets are defined as **masked + protected** variables in the GitLab UI — never in the `.gitlab-ci.yml` file.

---

## Compiled Binary Protection

Binaries compiled with `xk6` protect the source code of scenarios.

```bash
# Compile
bin/build-binary.sh --client=acme --platform=linux/amd64

# Verify source is not exposed
bin/verify-binary.sh --binary=dist/binaries/acme/linux-amd64/k6-acme
```

### Checksums and Integrity

```bash
sha256sum -c dist/binaries/acme/linux-amd64/k6-acme.sha256
```

If `K6_GPG_KEY_ID` is configured, a `.sig` signature file is also generated.

---

## Security Checklist

### Before Running in Production

- [ ] `rbac.json` configured with correct users and roles
- [ ] Client `.env` is in `.gitignore` — never commit secrets
- [ ] `./bin/detect-secrets.sh` passes with no findings
- [ ] Audit log is generated in `reports/{client}/audit/`
- [ ] `verify-binary.sh` passes if compiled binaries are used
- [ ] CI/CD tokens have minimum scope (`read` for the client repository)
- [ ] Error messages do not reveal information about other clients

### Kubernetes

- [ ] `kubectl apply -f infrastructure/k8s/rbac.yaml`
- [ ] `kubectl apply -f infrastructure/k8s/network-policy.yaml`
- [ ] Secrets in `k6-testrun.yaml` referenced with `secretKeyRef`
- [ ] Pod runs as `runAsNonRoot: true` with `readOnlyRootFilesystem: true`

### Observability

- [ ] Production stack deployed with `-f docker-compose.prod.yml`
- [ ] `GF_ADMIN_PASSWORD` and `GF_SECRET_KEY` defined as env vars
- [ ] Grafana does not expose anonymous login or disabled form
- [ ] Prometheus/Loki/Tempo ports not exposed to host

### CI/CD

- [ ] GitHub actions pinned by SHA (not mutable tags)
- [ ] `detect-secrets` job blocks the pipeline before running tests
- [ ] Secrets injected as env vars, never interpolated in shell commands
- [ ] `workflow_dispatch` inputs validated with regex
