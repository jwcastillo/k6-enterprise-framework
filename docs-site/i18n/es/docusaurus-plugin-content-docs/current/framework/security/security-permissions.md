---
title: "Guía de Permisos de Seguridad"
sidebar_position: 3
---
# Guía de Permisos de Seguridad

**T-138**: Requisitos de permisos de directorio y archivo para el k6 Enterprise Framework.

---

## Permisos de Directorio

Los directorios fuente del framework deben ser **de solo lectura para la capa de producto** (clientes, código generado, runners de CI). Solo el mantenedor del framework debe tener acceso de escritura.

| Directorio | Modo Requerido | Justificación |
|------------|---------------|---------------|
| `src/core/` | `755` (dirs), `644` (archivos) | Contiene módulos críticos de seguridad (RBAC, secretos, auditoría). El código de cliente no debe modificarlos. |
| `shared/` | `755` (dirs), `644` (archivos) | Perfiles y esquemas compartidos. Evita que los clientes sobreescriban los valores de seguridad por defecto del framework. |
| `src/helpers/` | `755` (dirs), `644` (archivos) | Los helpers pertenecen al framework. La personalización del cliente es por extensión, no por modificación. |
| `src/types/` | `755` (dirs), `644` (archivos) | Definiciones de tipos. Su modificación podría eludir las verificaciones de seguridad de TypeScript. |
| `bin/` | `755` (dirs), `755` (scripts) | Los scripts necesitan permiso de ejecución; no deben ser escribibles por el runner de CI. |
| `clients/` | `755` (dirs), `644` (archivos) | Cada `clients/{name}/` es escribible únicamente por el equipo cliente propietario. |
| `reports/` | `755` (dirs), `644` (archivos) | Escritos por el runner de k6 en tiempo de test; nunca ejecutables. |

## Aplicar los Permisos Correctos

Ejecutar después de clonar o desplegar el framework:

```bash
# Código fuente del framework — solo lectura para todos excepto el propietario
find src/core src/helpers src/types shared -type d -exec chmod 755 {} \;
find src/core src/helpers src/types shared -type f -exec chmod 644 {} \;

# Scripts ejecutables
chmod 755 bin/*.sh

# Directorio de reportes (creado en tiempo de ejecución)
mkdir -p reports && chmod 755 reports
```

## Seguridad de Perfiles Personalizados (CHK-SEC-091)

Los perfiles personalizados en `shared/profiles/` son validados por `profile-validator.ts` antes de su uso:

- Solo se aceptan los campos `name`, `description`, `stages` y `thresholds`.
- Campos como `exec`, `env`, `disableSecretMasking`, `disableRbac` están **explícitamente bloqueados**.
- El esquema aplica el equivalente a `additionalProperties: false` mediante la lista de permitidos en `validateCustomProfile()`.

Si un cliente intenta incluir un campo bloqueado, el framework registra el intento en la pista de auditoría y rechaza el perfil con un error explícito:

```
[profile-validator] Field 'disableSecretMasking' is not allowed in custom profiles.
```

## Validación de Identidad RBAC (CHK-SEC-095)

`resolveCurrentUser()` en `rbac.ts` sanea la identidad resuelta:

```typescript
const sanitized = raw.replace(/[^a-zA-Z0-9_.@-]/g, "").slice(0, 128);
```

- Los caracteres fuera de `[a-zA-Z0-9_.@-]` se eliminan — previene inyección a través de `K6_USER`.
- Un resultado vacío recurre al valor por defecto `"anonymous"`.
- `resolveUserRole()` valida el userId contra `^[a-zA-Z0-9_.@-]{1,128}$` antes de la consulta RBAC.

## Protección contra Sobreescritura de Seguridad (CHK-SEC-093)

Las siguientes configuraciones de seguridad **no pueden ser sobreescritas** por configuraciones de cliente ni por perfiles personalizados:

| Configuración | Ubicación | Efecto |
|---------------|-----------|--------|
| Enmascaramiento de secretos | `secrets-manager.ts` | Siempre activo; no existe flag de sobreescritura |
| Aplicación de RBAC | `rbac-enforcer.ts` | Modo permisivo solo cuando `rbac.json` está ausente — nunca desactivado por flag |
| Registro de auditoría | `audit-logger.ts` | Escribe en archivo de solo adición; no puede ser silenciado vía configuración |
| Parseo seguro de YAML | `yaml-parser.ts` | `CORE_SCHEMA` fijo en el código — sin ruta de sobreescritura |
| Verificaciones de traversal de ruta | `report-isolation.ts` | `assertPathInClientScope()` se invoca incondicionalmente |

## Seguridad de Dependencias (CHK-SEC-094)

Ejecutar `npm audit` como parte del proceso de release:

```bash
npm audit --audit-level=moderate
```

Para binarios de Go:

```bash
go mod tidy
go list -m all | govulncheck ./...
```

## Script de Verificación de Permisos de Archivo

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
