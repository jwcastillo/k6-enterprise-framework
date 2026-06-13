---
title: "Security"
sidebar_position: 1
---
# Security

Referencia de seguridad del framework: RBAC, audit log, aislamiento de clientes, proteccion de binarios, hardening de shell, secretos, Kubernetes, reportes y observabilidad.

---

## Tabla de contenidos

1. [Control de acceso (RBAC)](#control-de-acceso-rbac)
2. [Audit log inmutable](#audit-log-inmutable)
3. [Aislamiento de clientes](#aislamiento-de-clientes)
4. [Hardening de shell](#hardening-de-shell-t-126t-127t-129)
5. [Validacion de entrada CLI](#validacion-de-entrada-cli-t-126)
6. [Parseo seguro de YAML](#parseo-seguro-de-yaml-t-128)
7. [Gestion de secretos](#gestion-de-secretos-t-130)
8. [Seguridad en Kubernetes](#seguridad-en-kubernetes-t-131t-132)
9. [Seguridad en reportes HTML](#seguridad-en-reportes-html-t-133)
10. [Observabilidad segura](#observabilidad-segura-t-135t-136)
11. [Validacion de binarios y perfiles](#validacion-de-binarios-y-perfiles-t-137t-138)
12. [Pipeline CI/CD](#pipeline-cicd-t-140)
13. [Proteccion de binarios compilados](#proteccion-de-binarios-compilados)
14. [Checklist de seguridad](#checklist-de-seguridad)

---

## Control de acceso (RBAC)

El framework implementa un sistema de tres roles definidos en `clients/{nombre}/config/rbac.json`.

### Roles y permisos

| Operacion                        | developer | lead | admin |
|----------------------------------|:---------:|:----:|:-----:|
| Ejecutar smoke / quick / load    | si        | si   | si    |
| Ejecutar stress / spike          | no        | si   | si    |
| Ejecutar breakpoint / soak       | no        | si   | si    |
| Modificar thresholds             | no        | si   | si    |
| Modificar SLOs                   | no        | si   | si    |
| Asignar roles                    | no        | no   | si    |
| Gestionar clientes               | no        | no   | si    |
| Ver reportes (propio cliente)    | si        | si   | si    |
| Ver reportes (otros clientes)    | no        | no   | si    |
| Consultar audit log              | si        | si   | si    |
| Compilar binarios                | no        | si   | si    |
| Configurar mock / chaos          | no        | si   | si    |

### Sanitizacion de identidad (T-134/T-138)

La identidad del usuario se sanitiza antes de ser usada en rutas o tags:

```typescript
// Solo se permiten caracteres: a-z A-Z 0-9 _ . @ -
// Maximo 128 caracteres. Si no es valido → "anonymous"
const userId = raw.replace(/[^a-zA-Z0-9_.@-]/g, "").slice(0, 128) || "anonymous";
```

La resolucion de identidad sigue este orden de prioridad:

1. Variable de entorno `K6_USER`
2. Variable de entorno `$USER`
3. `"anonymous"` (modo permisivo, sin rbac.json)

```bash
# Ejecutar como usuario especifico
K6_USER=alice ./bin/run-test.sh --client=acme --service=users --test=stress
```

---

## Audit log inmutable

Cada operacion critica genera una entrada inmutable en `reports/{cliente}/audit/audit-{YYYY-MM}.jsonl`.

### Estructura de una entrada

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

### Cadena de hashes (SHA-256)

Cada entrada incluye el `hash` de su contenido encadenado con el `previousHash`. Cualquier modificacion rompe la cadena y es detectable.

```bash
bin/audit-query.js --client=acme --verify-chain
```

### Tipos de evento

| Tipo                 | Descripcion                                  |
|----------------------|----------------------------------------------|
| `execution_start`    | Inicio de ejecucion                          |
| `execution_end`      | Fin de ejecucion (pass/fail)                 |
| `config_change`      | Cambio de threshold, SLO o config            |
| `role_change`        | Asignacion o modificacion de rol             |
| `access_denied`      | Intento sin permisos                         |
| `secret_validation`  | Validacion de secretos antes de ejecucion    |

---

## Aislamiento de clientes

### Path traversal (T-127)

`bin/run-test.sh` usa `realpath` para verificar que `CLIENT_DIR` quede contenido dentro de `${ROOT_DIR}/clients/`:

```bash
CLIENT_REAL=$(realpath "${CLIENT_DIR}" 2>/dev/null || echo "")
CLIENTS_BASE=$(realpath "${ROOT_DIR}/clients")
if [[ "${CLIENT_REAL}" != "${CLIENTS_BASE}"/* ]]; then
  echo "ERROR: path traversal detectado en --client" >&2
  exit 1
fi
```

`src/core/execution-isolation.ts` expone `validateReportPath()` que aplica la misma logica para rutas de reporte:

```typescript
import { validateReportPath } from "./execution-isolation";
validateReportPath("reports/acme/../beta/report.html"); // lanza Error
```

### Aislamiento de variables de entorno

Cada ejecucion inyecta solo las variables del cliente activo. Ninguna variable de otro cliente es visible.

### Mensajes de error opacos

```
# Correcto:
ERROR: ClientResolver: client 'acme' not found.

# Incorrecto (nunca):
ERROR: client 'acme' not found; available: [beta, gamma, delta]
```

---

## Hardening de shell (T-126/T-127/T-129)

### Patrones seguros de entrada

`bin/run-test.sh` valida los parametros CLI antes de usarlos en comandos shell:

```bash
SAFE_NAME_RE='^[a-zA-Z0-9_-]{1,64}$'
SAFE_PATH_RE='^[a-zA-Z0-9_./-]{1,256}$'

validate_input() {
  local name="$1" value="$2" pattern="$3"
  if [[ ! "${value}" =~ ${pattern} ]]; then
    echo "ERROR: parametro '${name}' invalido: '${value}'" >&2
    exit 1
  fi
  if [[ "${value}" == *".."* ]] || [[ "${value}" == *$'\0'* ]]; then
    echo "ERROR: '${name}' contiene secuencia prohibida" >&2
    exit 1
  fi
}
```

Los parametros validados son: `--client`, `--profile`, `--env`, `--scenario`.

### Whitelist de backends de secretos (T-129)

Solo se aceptan valores de `K6_SECRETS_BACKENDS` dentro de la lista permitida:

```bash
VALID_BACKENDS="env vault aws-sm azure-kv"
for backend in $(echo "${K6_SECRETS_BACKENDS}" | tr ',' ' '); do
  if [[ ! " ${VALID_BACKENDS} " =~ " ${backend} " ]]; then
    echo "ERROR: backend de secreto invalido: '${backend}'" >&2
    exit 1
  fi
done
```

---

## Validacion de entrada CLI (T-126)

`src/core/input-validator.ts` centraliza la validacion para el contexto Node.js (`bin/`):

```typescript
import { validateRunTestInputs, assertNoPathTraversal } from "../src/core/input-validator";

// Valida todos los parametros de run-test de una vez
validateRunTestInputs({
  client: "acme",
  profile: "load",
  env: "staging",
  scenario: "smoke-users",
});

// Validacion individual de rutas
assertNoPathTraversal("reports/acme/2026-02/report.html");
```

### Patrones permitidos

| Campo    | Patron                         | Max chars |
|----------|--------------------------------|-----------|
| client   | `[a-zA-Z0-9_-]`               | 64        |
| profile  | `[a-zA-Z0-9_-]`               | 64        |
| env      | `[a-zA-Z0-9_-]`               | 64        |
| scenario | `[a-zA-Z0-9_./-]`             | 256       |

Cualquier valor que contenga `..` o bytes nulos (`\0`) es rechazado independientemente del patron.

---

## Parseo seguro de YAML (T-128)

`src/core/yaml-parser.ts` reemplaza el uso directo de `js-yaml` con un wrapper seguro:

```typescript
import { parseYamlSafe, parseYamlFileSafe } from "../src/core/yaml-parser";

// Parsear string YAML
const config = parseYamlSafe(yamlString, "config.yaml");

// Parsear archivo YAML
const slo = parseYamlFileSafe("clients/acme/config/slo.yaml");
```

### Protecciones aplicadas

| Proteccion                  | Valor limite                                 |
|-----------------------------|----------------------------------------------|
| Schema                      | `CORE_SCHEMA` (sin tipos JS arbitrarios)     |
| Tamano maximo del input      | 1 MB                                         |
| Profundidad maxima de objeto | 10 niveles                                   |
| Billion laughs (YAML bomb)  | >5 anchors AND >50 aliases → rechazado       |

```
ERROR: YAML demasiado grande (1.5 MB > limite de 1 MB)
ERROR: Posible YAML bomb: 6 anchors y 51 aliases detectados
```

---

## Gestion de secretos (T-130)

### Validacion de claves (T-130)

`src/core/secrets-manager.ts` valida que las claves de secreto cumplan el patron antes de resolver:

```typescript
// Solo: [A-Z0-9_], maximo 128 caracteres
resolveSecret("APP_API_KEY");    // ok
resolveSecret("app-api-key");    // Error: formato invalido
resolveSecret("../../etc/passwd"); // Error: formato invalido
```

### Deteccion de secretos hardcodeados (T-130)

`src/core/config-security.ts` detecta patrones de secretos embebidos en la configuracion:

```typescript
import { auditConfigForSecrets } from "../src/core/config-security";

const findings = auditConfigForSecrets(configObject);
// findings: [{ path: "auth.token", pattern: "Bearer JWT", severity: "high" }]
```

Patrones detectados:

| Patron             | Ejemplo                        |
|--------------------|--------------------------------|
| JWT Bearer         | `eyJhbGciOi...`               |
| AWS Access Key     | `AKIA...`                     |
| GitHub Token       | `ghp_...`                     |
| RSA private key    | `-----BEGIN RSA PRIVATE KEY`  |
| Contrasena literal | `password: "mysecret123"`     |

### Script de deteccion (T-130)

```bash
# Escanear el repositorio antes de un commit
./bin/detect-secrets.sh

# Salida en caso de hallazgo:
# [SECRETS] Posible secreto en src/core/config.ts:42
# ✖ Se encontraron 1 posibles secretos hardcodeados
```

El script excluye automaticamente lineas que contienen `${`, `__ENV`, `placeholder`, `example` o `secret-allow`.

### Sanitizacion de URLs en logs (T-130)

`src/helpers/structured-logger.ts` redacta parametros sensibles en URLs antes de emitir logs:

```
# Input:  https://api.example.com/v1/data?token=abc123&user=alice
# Output: https://api.example.com/v1/data?token=****&user=alice
```

Parametros redactados: `token`, `password`, `passwd`, `secret`, `key`, `api_key`, `access_token`, `auth`.

Headers redactados: `authorization`, `x-api-key`, `x-amz-security-token`, `x-goog-signature`.

---

## Seguridad en Kubernetes (T-131/T-132)

### RBAC de minimo privilegio (T-131)

`infrastructure/k8s/rbac.yaml` define el `ServiceAccount` `k6-runner` con permisos minimos:

```yaml
# Solo puede:
# - get secrets (solo los necesarios, por nombre)
# - get/list configmaps
# - CRUD en k6.io/testruns
# - get/list/watch pods
```

Desplegar con:

```bash
kubectl apply -f infrastructure/k8s/rbac.yaml
```

### Contexto de seguridad del pod (T-131)

El template `infrastructure/k8s/k6-testrun.yaml` impone:

```yaml
securityContext:
  runAsNonRoot: true
  runAsUser: 65534          # nobody
  allowPrivilegeEscalation: false
  readOnlyRootFilesystem: true
  capabilities:
    drop: [ALL]
```

Los secretos se inyectan exclusivamente via `secretKeyRef`, nunca con `value:` literal en el manifiesto.

### NetworkPolicy (T-132)

`infrastructure/k8s/network-policy.yaml` aplica tres politicas en el namespace `k6-tests`:

| Politica                    | Efecto                                              |
|-----------------------------|-----------------------------------------------------|
| `default-deny-all`          | Bloquea todo el trafico por defecto                 |
| `k6-runner-egress`          | Permite DNS (53), HTTP/S (80/443), Prometheus (9090), Loki (3100) |
| `k6-runner-ingress-operator`| Solo ingress en puerto 6565 desde el pod k6-operator|

```bash
kubectl apply -f infrastructure/k8s/network-policy.yaml
```

---

## Seguridad en reportes HTML (T-133)

### Redaccion de PII en tags (T-133)

El generador HTML (`src/reporting/html-report-generator.ts`) redacta automaticamente valores de tags que puedan contener PII:

```typescript
// Tags con estos patrones tienen su valor reemplazado por "****"
const PII_TAG_PATTERNS = [/email/i, /phone/i, /ssn/i, /user_id/i, /ip_addr/i, ...];
```

El HTML generado incluye el comentario `<!-- Tags (PII fields redacted — T-133) -->`.

### Sanitizacion de SVG en branding (T-133)

Si se proporciona un logo SVG personalizado via `branding.svgLogo`, se valida antes de embeber:

```typescript
generateHtmlReport(data, context, "./report.html", {
  orgName: "Acme Corp",
  svgLogo: fs.readFileSync("logo.svg", "utf8"),
});
```

SVGs que contengan `<script>`, `javascript:`, handlers `on*`, `<foreignObject>`, `<iframe>` o `data:text/html` son rechazados con un warning y el logo se omite del reporte.

### Extensiones de reporte permitidas (T-133)

`src/core/report-isolation.ts` solo acepta estas extensiones al escribir artefactos:

`.html` `.json` `.jsonl` `.csv` `.txt` `.md`

Cualquier otra extension lanza un error antes de escribir al disco.

---

## Observabilidad segura (T-135/T-136)

### Sanitizacion de labels Prometheus (T-135)

`src/core/prometheus-sanitizer.ts` garantiza que los labels exportados cumplan la especificacion de Prometheus y no filtren datos sensibles:

```typescript
import { sanitizeTagsForPrometheus } from "../src/core/prometheus-sanitizer";

const safeTags = sanitizeTagsForPrometheus({
  client: "acme",
  user_email: "alice@example.com",  // redactado: patron sensible
  env: "staging",
});
// { client: "acme", user_email: "****", env: "staging" }
```

Reglas aplicadas:

- Caracteres invalidos → `_`
- Label que empieza con digito → prefijo `_`
- Longitud maxima: 128 caracteres (label), 256 (valor)
- Valores de tags con claves sensibles (token, password, key, secret...) → `****`

Este modulo es compatible con el runtime goja de k6 (sin APIs de Node.js).

### Hardening de Grafana en produccion (T-136)

`infrastructure/docker-compose.prod.yml` sobreescribe la configuracion de desarrollo:

```bash
# Levantar el stack completo en modo produccion
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

Cambios respecto al modo desarrollo:

| Parametro                     | Desarrollo  | Produccion           |
|-------------------------------|-------------|----------------------|
| `GF_AUTH_ANONYMOUS_ENABLED`   | true        | **false**            |
| `GF_AUTH_DISABLE_LOGIN_FORM`  | true        | **false**            |
| `GF_ADMIN_PASSWORD`           | admin       | **requerido via env**|
| `GF_SECRET_KEY`               | —           | **requerido via env**|
| Puertos Prometheus/Loki/Tempo | expuestos   | **solo internos**    |

```bash
# Variables requeridas en produccion
export GF_ADMIN_PASSWORD="<contrasena-segura>"
export GF_SECRET_KEY="<clave-aleatoria-32-bytes>"
```

Si alguna de estas variables no esta definida, `docker compose` falla al arrancar.

---

## Validacion de binarios y perfiles (T-137/T-138)

### Whitelist de binarios k6 (T-137)

`src/core/binary-validator.ts` valida que `K6_BINARY_PATH` apunte a un directorio de confianza:

```bash
# Directorios permitidos por defecto
/usr/local/bin
/usr/bin
/opt/k6
/opt/homebrew/bin
~/.local/bin

# Agregar directorios adicionales
export K6_BINARY_ALLOWED_PATHS="/custom/bin:/another/dir"
```

Tambien verifica que el binario sea ejecutable y responda a `k6 version`.

`bin/run-test.sh` aplica esta validacion si `K6_BINARY_PATH` esta definido:

```bash
export K6_BINARY_PATH=/opt/k6/k6
./bin/run-test.sh --client=acme --service=users --test=load
```

### Whitelist de imports jslib (T-137)

Solo se permiten imports desde dominios de confianza:

```typescript
validateJslibImport("https://jslib.k6.io/k6-utils/1.4.0/index.js");   // ok
validateJslibImport("https://cdn.jsdelivr.net/npm/k6-crypto@1.0.0");  // ok
validateJslibImport("https://evil.com/k6-hack.js");                    // Error
```

### Validacion de perfiles personalizados (T-138)

`src/core/profile-validator.ts` valida la estructura de perfiles antes de ejecutarlos:

```typescript
import { validateCustomProfile } from "../src/core/profile-validator";
validateCustomProfile(profileConfig);
```

Restricciones aplicadas:

| Campo                  | Restriccion                                              |
|------------------------|----------------------------------------------------------|
| Campos prohibidos      | `executor`, `env`, `systemTags`, `exec`, `disableSecretMasking`, `disableRbac` |
| Duracion total maxima  | 240 minutos                                              |
| VUs por rol            | developer: 50 max, lead: 500 max                         |
| Formato de stage       | `^\d+(\.\d+)?(ms\|s\|m\|h)$`                           |
| Condicion de threshold | `^[a-zA-Z_()\d]+[<>=!]{1,2}[\d.]+$`                    |

---

## Pipeline CI/CD (T-140)

### GitHub Actions

`.github/workflows/k6-test.yml` implementa buenas practicas de seguridad:

```yaml
permissions:
  contents: read   # minimo privilegio

jobs:
  detect-secrets:
    steps:
      - run: ./bin/detect-secrets.sh   # bloquea el pipeline si hay secretos
  run-tests:
    needs: detect-secrets
    steps:
      - uses: grafana/k6-action@<SHA>  # acciones fijadas por SHA, no tag mutable
```

Los inputs de `workflow_dispatch` se validan con regex antes de pasarse a comandos shell:

```yaml
inputs:
  client:
    description: "Client name (a-z, 0-9, _, -)"
  # Validado en el step: [[ "${{ inputs.client }}" =~ ^[a-zA-Z0-9_-]+$ ]]
```

Los secretos se inyectan exclusivamente como variables de entorno:

```yaml
env:
  API_KEY: ${{ secrets.API_KEY }}
  # Nunca: run: ./run-test.sh --key=${{ secrets.API_KEY }}
```

### GitLab CI

`.gitlab-ci.yml` aplica las mismas restricciones. Los secretos se definen como variables **masked + protected** en la UI de GitLab — nunca en el archivo `.gitlab-ci.yml`.

---

## Proteccion de binarios compilados

Los binarios compilados con `xk6` protegen el codigo fuente de los escenarios.

```bash
# Compilar
bin/build-binary.sh --client=acme --platform=linux/amd64

# Verificar que no expone fuente
bin/verify-binary.sh --binary=dist/binaries/acme/linux-amd64/k6-acme
```

### Checksums e integridad

```bash
sha256sum -c dist/binaries/acme/linux-amd64/k6-acme.sha256
```

Si `K6_GPG_KEY_ID` esta configurado, tambien se genera firma `.sig`.

---

## Checklist de seguridad

### Antes de ejecutar en produccion

- [ ] `rbac.json` configurado con usuarios y roles correctos
- [ ] `.env` del cliente esta en `.gitignore` — nunca commitear secretos
- [ ] `./bin/detect-secrets.sh` pasa sin hallazgos
- [ ] El audit log se genera en `reports/{cliente}/audit/`
- [ ] `verify-binary.sh` pasa si se usan binarios compilados
- [ ] Tokens de CI/CD tienen scope minimo (`read` del repositorio del cliente)
- [ ] Los mensajes de error no revelan informacion de otros clientes

### Kubernetes

- [ ] `kubectl apply -f infrastructure/k8s/rbac.yaml`
- [ ] `kubectl apply -f infrastructure/k8s/network-policy.yaml`
- [ ] Secrets en `k6-testrun.yaml` referenciados con `secretKeyRef`
- [ ] Pod corre como `runAsNonRoot: true` con `readOnlyRootFilesystem: true`

### Observabilidad

- [ ] Stack de produccion levantado con `-f docker-compose.prod.yml`
- [ ] `GF_ADMIN_PASSWORD` y `GF_SECRET_KEY` definidos como env vars
- [ ] Grafana no expone login anonimo ni formulario deshabilitado
- [ ] Puertos de Prometheus/Loki/Tempo no expuestos al host

### CI/CD

- [ ] Acciones de GitHub fijadas por SHA (no tags mutables)
- [ ] `detect-secrets` job bloquea el pipeline antes de ejecutar tests
- [ ] Secretos inyectados como env vars, nunca interpolados en comandos shell
- [ ] Inputs de `workflow_dispatch` validados con regex
