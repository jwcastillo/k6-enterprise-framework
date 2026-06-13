---
title: "Code Quality Toolchain — US23"
sidebar_position: 1
---
# Code Quality Toolchain — US23

Enforce consistent code style, commit conventions, secret detection, and dependency hygiene across the framework.

**Tasks:** T-069, T-070, T-071, T-072, T-073, T-074  
**Config files:** `.commitlintrc.json`, `.czrc`, `.lintstagedrc.json`, `.husky/`, `renovate.json`, `.github/dependabot.yml`

---

## Overview

```
git commit
    │
    ├─ pre-commit hook (Husky)
    │       ├─ lint-staged
    │       │       ├─ check-esm.js       (k6 ESM purity on .ts files in src/)
    │       │       ├─ tsc --noEmit        (TypeScript type check)
    │       │       └─ detect-secrets.js   (secret pattern detection on all staged files)
    │       └─ (exit 1 on any failure → commit blocked)
    │
    └─ commit-msg hook (Husky)
            └─ commitlint              (Conventional Commits enforcement)
```

---

## Conventional Commits — T-069

All commits must follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <subject>

[optional body]

[optional footer]
```

### Allowed types

| Type | Use for |
|------|---------|
| `feat` | New feature |
| `fix` | Bug fix |
| `chore` | Maintenance, deps, config |
| `docs` | Documentation only |
| `style` | Formatting, no logic change |
| `refactor` | Code restructuring |
| `test` | Tests only |
| `perf` | Performance improvement |
| `ci` | CI/CD configuration |
| `build` | Build system changes |
| `revert` | Revert a previous commit |

### Examples

```bash
git commit -m "feat(request-helper): add retry-after header support"
git commit -m "fix(audit): correct JSONL hash chain on rotation"
git commit -m "chore(deps): update @modelcontextprotocol/sdk to 1.12.0"
git commit -m "docs(batch): add CI/CD integration example"
```

### Commitizen (interactive commit helper)

```bash
# Interactive guided commit (replaces git commit)
npx cz
# or
npm run commit
```

### Bypassing hooks (emergency only)

```bash
git commit --no-verify -m "chore: emergency fix"
```

This bypasses both `pre-commit` and `commit-msg` hooks. Document the reason in the commit body.

---

## ESM Purity Checker — T-074 (check-esm.js)

k6 scenarios run in the Goja runtime and require ES Modules — no `require()` or `module.exports`.

`bin/testing/check-esm.js` scans staged `.ts` files in `src/` and fails if it finds:
- `require(`
- `module.exports`

### Allowlist

The following files legitimately use `require()` for dual-runtime compatibility and are exempted:

```
src/core/config-loader.ts       ← loads JSON at runtime via require()
src/core/secrets-manager.ts     ← reads .env via require()
src/core/audit-logger.ts        ← Node.js fs operations
src/core/rbac.ts                ← reads rbac.json via require()
src/core/mock-server.ts         ← uses http module
src/node/mock-server.ts          ← relocated from src/patterns/ in Phase 4 (ARC-06)
src/node/generator-health.ts     ← relocated from src/observability/ in Phase 4 (ARC-06)
src/node/pyroscope-node.ts       ← Node split of pyroscope-instrumentation (ARC-06)
src/node/chaos-injection-node.ts ← Node split of chaos-injection (ARC-06)
src/observability/index.ts
... (20 files total)
```

To add a file to the allowlist, edit the `ALLOWLIST` array at the top of `bin/testing/check-esm.js`.

### Running standalone

```bash
# Check all staged files
node bin/testing/check-esm.js

# Check specific files
node bin/testing/check-esm.js src/helpers/request-helper.ts src/core/config-loader.ts
```

---

## Secret Detection — T-070 (detect-secrets.js)

`bin/testing/detect-secrets.js` scans all staged files for secret patterns:

| Pattern | Example |
|---------|---------|
| JWT tokens | `eyJ...` (base64 header) |
| AWS access keys | `AKIA...` |
| PEM private keys | `-----BEGIN PRIVATE KEY-----` |
| Hard-coded passwords | `password="secret"` |
| Connection strings | `mongodb://user:pass@host` |
| Generic API keys | `api_key=abc123xyz` |

### Suppression

**Per-line suppression:**

```typescript
const testToken = "eyJhbGciOiJIUzI1NiJ9.test"; // secret-allow
```

**Whole-file suppression** — add path to `.secretsignore`:

```
# .secretsignore
clients/_reference/data/test-tokens.json
shared/mocks/responses/auth-fixture.json
```

### Running standalone

```bash
node bin/testing/detect-secrets.js
```

---

## lint-staged configuration

`.lintstagedrc.json` runs checks only on staged files for fast feedback:

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

## Dependency hygiene — T-071

### Dependabot (GitHub)

`.github/dependabot.yml` scans npm dependencies weekly:
- `k6-framework/` — main framework
- `k6-framework/mcp-server/` — MCP server

Security patches are opened as PRs immediately. Minor/patch updates are grouped weekly.

### Renovate

`k6-framework/renovate.json` provides equivalent coverage for GitLab / self-hosted:
- Security patches: `automerge: true` for patch-level updates with green CI
- Major updates: manual review required
- Schedule: weekly on Mondays

---

## Helper test suite — T-072 (test-helpers.ts)

`clients/_reference/scenarios/test-helpers.ts` is a k6 test script that validates all 10 framework helpers:

```
DateHelper      StructuredLogger
DataHelper      GraphQLHelper
ValidationHelper  WebSocketHelper
HeaderHelper    UploadHelper
PerformanceHelper  RequestHelper
```

### Running

```bash
# Build first
npm run build

# Run the helper suite (1 VU, 1 iteration — pure unit validation)
k6 run dist/test-helpers.js

# CI mode (explicit exit on threshold failure)
k6 run --vus 1 --iterations 1 dist/test-helpers.js
```

### Expected output

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

### Failure output (CHK-UX-200)

```
[FAIL] ValidationHelper: isValidUUID invalid — expected false, got true
       ↳ Helper: ValidationHelper | Method: isValidUUID | Input: "not-a-uuid"
```

### Threshold

```yaml
thresholds:
  checks: ["rate==1.0"]   # SC-114: 100% pass required
```

If any check fails the threshold, `k6` exits with code `99` — detected by CI as a pipeline failure.

### Regression detection (EC-QUAL-005)

If a helper's public API changes (method renamed, signature modified), the corresponding check  
fails with a TypeScript compile error (caught at build time) **or** a runtime check failure  
(caught at test time). Either way, the regression is surfaced before merge.

---

## CI/CD integration

### Recommended pipeline stages

```yaml
stages:
  - lint          # commitlint on PR title / last commit
  - typecheck     # tsc --noEmit
  - secrets       # detect-secrets.js on all changed files
  - build         # npm run build (webpack + tsc)
  - test-helpers  # k6 run dist/test-helpers.js
  - load-test     # bin/testing/run-all-tests.sh (smoke profile)
```

### Example GitHub Actions job

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
