---
title: "Herramientas de Calidad de Código — US23"
sidebar_position: 1
---
# Herramientas de Calidad de Código — US23

Garantizar un estilo de código consistente, convenciones de commits, detección de secretos e higiene de dependencias en todo el framework.

**Tareas:** T-069, T-070, T-071, T-072, T-073, T-074
**Archivos de configuración:** `.commitlintrc.json`, `.czrc`, `.lintstagedrc.json`, `.husky/`, `renovate.json`, `.github/dependabot.yml`

---

## Resumen

```
git commit
    │
    ├─ pre-commit hook (Husky)
    │       ├─ lint-staged
    │       │       ├─ check-esm.js       (pureza ESM de k6 en archivos .ts en src/)
    │       │       ├─ tsc --noEmit        (verificación de tipos TypeScript)
    │       │       └─ detect-secrets.js   (detección de patrones de secretos en todos los archivos staged)
    │       └─ (exit 1 ante cualquier fallo → commit bloqueado)
    │
    └─ commit-msg hook (Husky)
            └─ commitlint              (cumplimiento de Conventional Commits)
```

---

## Conventional Commits — T-069

Todos los commits deben seguir [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <subject>

[cuerpo opcional]

[pie opcional]
```

### Tipos permitidos

| Tipo | Uso |
|------|-----|
| `feat` | Nueva funcionalidad |
| `fix` | Corrección de errores |
| `chore` | Mantenimiento, dependencias, configuración |
| `docs` | Solo documentación |
| `style` | Formato, sin cambio de lógica |
| `refactor` | Reestructuración de código |
| `test` | Solo tests |
| `perf` | Mejora de rendimiento |
| `ci` | Configuración CI/CD |
| `build` | Cambios en el sistema de build |
| `revert` | Revertir un commit anterior |

### Ejemplos

```bash
git commit -m "feat(request-helper): add retry-after header support"
git commit -m "fix(audit): correct JSONL hash chain on rotation"
git commit -m "chore(deps): update @modelcontextprotocol/sdk to 1.12.0"
git commit -m "docs(batch): add CI/CD integration example"
```

### Commitizen (asistente interactivo de commits)

```bash
# Commit guiado interactivo (reemplaza git commit)
npx cz
# o
npm run commit
```

### Omitir hooks (solo emergencias)

```bash
git commit --no-verify -m "chore: emergency fix"
```

Esto omite tanto los hooks `pre-commit` como `commit-msg`. Documente la razón en el cuerpo del commit.

---

## Verificador de Pureza ESM — T-074 (check-esm.js)

Los escenarios de k6 se ejecutan en el runtime Goja y requieren ES Modules — no se permite `require()` ni `module.exports`.

`bin/testing/check-esm.js` escanea los archivos `.ts` staged en `src/` y falla si encuentra:
- `require(`
- `module.exports`

### Lista de permitidos

Los siguientes archivos usan legítimamente `require()` para compatibilidad dual de runtime y están exentos:

```
src/core/config-loader.ts       ← carga JSON en runtime via require()
src/core/secrets-manager.ts     ← lee .env via require()
src/core/audit-logger.ts        ← operaciones fs de Node.js
src/core/rbac.ts                ← lee rbac.json via require()
src/core/mock-server.ts         ← usa módulo http
src/node/mock-server.ts          ← reubicado desde src/patterns/ en Phase 4 (ARC-06)
src/node/generator-health.ts     ← reubicado desde src/observability/ en Phase 4 (ARC-06)
src/node/pyroscope-node.ts       ← split Node de pyroscope-instrumentation (ARC-06)
src/node/chaos-injection-node.ts ← split Node de chaos-injection (ARC-06)
src/observability/index.ts
... (20 archivos en total)
```

Para agregar un archivo a la lista de permitidos, edite el array `ALLOWLIST` al inicio de `bin/testing/check-esm.js`.

### Ejecución independiente

```bash
# Verificar todos los archivos staged
node bin/testing/check-esm.js

# Verificar archivos específicos
node bin/testing/check-esm.js src/helpers/request-helper.ts src/core/config-loader.ts
```

---

## Detección de Secretos — T-070 (detect-secrets.js)

`bin/testing/detect-secrets.js` escanea todos los archivos staged en busca de patrones de secretos:

| Patrón | Ejemplo |
|--------|---------|
| Tokens JWT | `eyJ...` (encabezado base64) |
| Claves de acceso AWS | `AKIA...` |
| Claves privadas PEM | `-----BEGIN PRIVATE KEY-----` |
| Contraseñas codificadas | `password="secret"` |
| Cadenas de conexión | `mongodb://user:pass@host` |
| Claves API genéricas | `api_key=abc123xyz` |

### Supresión

**Supresión por línea:**

```typescript
const testToken = "eyJhbGciOiJIUzI1NiJ9.test"; // secret-allow
```

**Supresión de archivo completo** — agregar la ruta a `.secretsignore`:

```
# .secretsignore
clients/_reference/data/test-tokens.json
shared/mocks/responses/auth-fixture.json
```

### Ejecución independiente

```bash
node bin/testing/detect-secrets.js
```

---

## Configuración de lint-staged

`.lintstagedrc.json` ejecuta verificaciones solo en archivos staged para retroalimentación rápida:

```json
{
  "src/**/*.ts": [
    "node bin/testing/check-esm.js",
    "tsc --noEmit --project tsconfig.json"
  ],
  "**/*": [
    "node bin/testing/detect-secrets.js"
  ]
}
```

---

## Higiene de dependencias — T-071

### Dependabot (GitHub)

`.github/dependabot.yml` escanea las dependencias npm semanalmente:
- `k6-framework/` — framework principal
- `k6-framework/mcp-server/` — servidor MCP

Los parches de seguridad se abren como PRs inmediatamente. Las actualizaciones minor/patch se agrupan semanalmente.

### Renovate

`k6-framework/renovate.json` proporciona cobertura equivalente para GitLab / auto-alojado:
- Parches de seguridad: `automerge: true` para actualizaciones a nivel de patch con CI verde
- Actualizaciones major: revisión manual requerida
- Programación: semanal los lunes

---

## Suite de tests de helpers — T-072 (test-helpers.ts)

`clients/_reference/scenarios/test-helpers.ts` es un script de test k6 que valida los 10 helpers del framework:

```
DateHelper      StructuredLogger
DataHelper      GraphQLHelper
ValidationHelper  WebSocketHelper
HeaderHelper    UploadHelper
PerformanceHelper  RequestHelper
```

### Ejecución

```bash
# Compilar primero
npm run build

# Ejecutar la suite de helpers (1 VU, 1 iteración — validación unitaria pura)
k6 run dist/test-helpers.js

# Modo CI (salida explícita ante fallo de umbral)
k6 run --vus 1 --iterations 1 dist/test-helpers.js
```

### Salida esperada

```
── Helper Test Summary ─────────────────────────────────
  ✓ DateHelper:          16/16
  ✓ DataHelper:          12/12
  ✓ ValidationHelper:    14/14
  ✓ HeaderHelper:         8/8
  ✓ PerformanceHelper:   10/10
  ✓ StructuredLogger:     5/5
  ✓ GraphQLHelper:        7/7
  ✓ WebSocketHelper:      3/3
  ✓ UploadHelper:         5/5
  ✓ RequestHelper:        7/7
  ─────────────────────────────────────────────────────
  Total: 87/87 checks passed
```

### Salida de fallo (CHK-UX-200)

```
[FAIL] ValidationHelper: isValidUUID invalid — expected false, got true
       ↳ Helper: ValidationHelper | Method: isValidUUID | Input: "not-a-uuid"
```

### Umbral

```yaml
thresholds:
  checks: ["rate==1.0"]   # SC-114: 100% de aprobación requerido
```

Si alguna verificación falla el umbral, `k6` sale con código `99` — detectado por CI como fallo del pipeline.

### Detección de regresiones (EC-QUAL-005)

Si la API pública de un helper cambia (método renombrado, firma modificada), la verificación correspondiente
falla con un error de compilación TypeScript (detectado en tiempo de build) **o** un fallo de verificación en runtime
(detectado en tiempo de test). De cualquier forma, la regresión se detecta antes del merge.

---

## Integración CI/CD

### Etapas de pipeline recomendadas

```yaml
stages:
  - lint          # commitlint en título de PR / último commit
  - typecheck     # tsc --noEmit
  - secrets       # detect-secrets.js en todos los archivos modificados
  - build         # npm run build (webpack + tsc)
  - test-helpers  # k6 run dist/test-helpers.js
  - load-test     # bin/testing/run-all-tests.sh (perfil smoke)
```

### Ejemplo de job en GitHub Actions

```yaml
test-helpers:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: grafana/setup-k6-action@v1
    - run: npm ci
    - run: npm run build
    - run: k6 run --vus 1 --iterations 1 dist/test-helpers.js
```
