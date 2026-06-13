---
title: "Security Permissions Guide"
sidebar_position: 3
---
# Security Permissions Guide

**T-138**: Directory and file permission requirements for the k6 Enterprise Framework.

---

## Directory Permissions

Framework source directories must be **read-only for the product layer** (clients, generated code, CI runners). Only the framework maintainer should have write access.

| Directory | Required Mode | Rationale |
|-----------|--------------|-----------|
| `src/core/` | `755` (dirs), `644` (files) | Contains security-critical modules (RBAC, secrets, audit). Client code must not modify these. |
| `shared/` | `755` (dirs), `644` (files) | Shared profiles and schemas. Prevents clients overriding framework security defaults. |
| `src/helpers/` | `755` (dirs), `644` (files) | Helpers are framework-owned. Client customization via extension, not modification. |
| `src/types/` | `755` (dirs), `644` (files) | Type definitions. Modification could bypass TypeScript safety checks. |
| `bin/` | `755` (dirs), `755` (scripts) | Scripts need execute permission; must not be writable by CI runner. |
| `clients/` | `755` (dirs), `644` (files) | Each `clients/{name}/` is writable by the owning client team only. |
| `reports/` | `755` (dirs), `644` (files) | Written by k6 runner at test time; never executable. |

## Applying Correct Permissions

Run after cloning or deploying the framework:

```bash
# Framework source — read-only for all but owner
find src/core src/helpers src/types shared -type d -exec chmod 755 {} \;
find src/core src/helpers src/types shared -type f -exec chmod 644 {} \;

# Executable scripts
chmod 755 bin/*.sh

# Reports directory (created at runtime)
mkdir -p reports && chmod 755 reports
```

## Custom Profile Security (CHK-SEC-091)

Custom profiles in `shared/profiles/` are validated by `profile-validator.ts` before use:

- Only `name`, `description`, `stages`, and `thresholds` fields are accepted.
- Fields like `exec`, `env`, `disableSecretMasking`, `disableRbac` are **explicitly blocked**.
- The schema enforces `additionalProperties: false` equivalent via the allowlist in `validateCustomProfile()`.

If a client attempts to include a blocked field, the framework logs the attempt to the audit trail and rejects the profile with an explicit error:

```
[profile-validator] Field 'disableSecretMasking' is not allowed in custom profiles.
```

## RBAC Identity Validation (CHK-SEC-095)

`resolveCurrentUser()` in `rbac.ts` sanitizes the resolved identity:

```typescript
const sanitized = raw.replace(/[^a-zA-Z0-9_.@-]/g, "").slice(0, 128);
```

- Characters outside `[a-zA-Z0-9_.@-]` are stripped — prevents injection via `K6_USER`.
- Empty result falls back to `"anonymous"`.
- `resolveUserRole()` validates userId against `^[a-zA-Z0-9_.@-]{1,128}$` before RBAC lookup.

## Security Override Protection (CHK-SEC-093)

The following security configurations **cannot be overridden** by client configs or custom profiles:

| Setting | Location | Effect |
|---------|----------|--------|
| Secret masking | `secrets-manager.ts` | Always active; no override flag exists |
| RBAC enforcement | `rbac-enforcer.ts` | Permissive mode only when `rbac.json` absent — never disabled by flag |
| Audit logging | `audit-logger.ts` | Writes to append-only file; cannot be silenced via config |
| YAML safe parsing | `yaml-parser.ts` | `CORE_SCHEMA` hardcoded — no override path |
| Path traversal checks | `report-isolation.ts` | `assertPathInClientScope()` called unconditionally |

## Dependency Security (CHK-SEC-094)

Run `npm audit` as part of the release process:

```bash
npm audit --audit-level=moderate
```

For Go binaries:

```bash
go mod tidy
go list -m all | govulncheck ./...
```

## File Permission Verification Script

```bash
#!/usr/bin/env bash
# Verify framework directory permissions
ERRORS=0
check() {
  local dir="$1" expected_mode="$2"
  local actual_mode
  actual_mode=$(stat -c "%a" "$dir" 2>/dev/null || stat -f "%A" "$dir" 2>/dev/null)
  if [[ "$actual_mode" != "$expected_mode" ]]; then
    echo "[WARN] $dir: expected $expected_mode, got $actual_mode"
    ERRORS=$((ERRORS + 1))
  fi
}
for dir in src/core src/helpers src/types shared; do
  check "$dir" "755"
done
[[ $ERRORS -eq 0 ]] && echo "[OK] All permissions correct" || echo "[WARN] $ERRORS permission issue(s)"
```
