/**
 * T-044: Role-Based Access Control (RBAC)
 *
 * Three-tier permission system:
 * - admin: Full platform access (all clients, all operations)
 * - lead: Full access within assigned client (all profiles, config changes)
 * - developer: Restricted (smoke/quick/load only, read-only config, own client)
 *
 * Identity resolution: K6_USER > $USER
 * Config: clients/{name}/config/rbac.json
 *
 * SEC-03: When no rbac.json exists, fails closed (deny) by default.
 * Set K6_RBAC_PERMISSIVE=true to allow with audit log entry (transitional override).
 *
 * Note: Runs in Node.js context (bin/), NOT in k6 goja runtime.
 */

import {
  Role,
  ProtectedOperation,
  RbacConfig,
  RbacUser,
  PermissionResult,
  RolePermissions,
} from "../types/rbac.d";
import { ClientContext } from "../types/client.d";
import { logAccessDenied } from "./audit-logger";

const path = require("path") as typeof import("path");
const fs = require("fs") as typeof import("fs");

// ── Role permission definitions (built-in, not configurable) ──────────────────

const ROLE_PERMISSIONS: Record<Role, RolePermissions> = {
  admin: {
    allowedProfiles: [
      "smoke",
      "quick",
      "load",
      "rampup",
      "capacity",
      "stress",
      "spike",
      "breakpoint",
      "soak",
    ],
    allowedOperations: [
      "execute_test",
      "execute_stress",
      "execute_breakpoint",
      "execute_soak",
      "modify_thresholds",
      "modify_slos",
      "modify_roles",
      "manage_clients",
      "view_reports",
      "export_reports",
      "query_audit",
      "compile_binary",
      "configure_chaos",
      "configure_mocks",
    ],
  },
  lead: {
    allowedProfiles: [
      "smoke",
      "quick",
      "load",
      "rampup",
      "capacity",
      "stress",
      "spike",
      "breakpoint",
      "soak",
    ],
    allowedOperations: [
      "execute_test",
      "execute_stress",
      "execute_breakpoint",
      "execute_soak",
      "modify_thresholds",
      "modify_slos",
      "view_reports",
      "export_reports",
      "query_audit",
      "compile_binary",
      "configure_chaos",
      "configure_mocks",
    ],
  },
  developer: {
    allowedProfiles: ["smoke", "quick", "load"],
    allowedOperations: ["execute_test", "view_reports", "query_audit"],
  },
};

// Profiles that require elevated roles
const ELEVATED_PROFILES: Record<string, ProtectedOperation> = {
  stress: "execute_stress",
  spike: "execute_stress",
  breakpoint: "execute_breakpoint",
  soak: "execute_soak",
  capacity: "execute_stress",
};

// ── Identity resolution ───────────────────────────────────────────────────────

/**
 * Resolve the current user identity.
 * Priority: K6_USER > $USER > "anonymous"
 *
 * T-134: Sanitize the resolved identity to prevent injection via K6_USER.
 * Only alphanumeric, underscore, dot, at-sign, and hyphen are allowed.
 * This covers formats like "user@domain.com" and "user_name".
 */
export function resolveCurrentUser(): string {
  const raw = process.env["K6_USER"] ?? process.env["USER"] ?? "anonymous";
  // Strip any characters outside the allowed set, then truncate to 128 chars
  const sanitized = raw.replace(/[^a-zA-Z0-9_.@-]/g, "").slice(0, 128);
  return sanitized || "anonymous";
}

// ── Config loading ────────────────────────────────────────────────────────────

/**
 * Load RBAC configuration for a client.
 * Returns null if no rbac.json exists (permissive mode).
 */
export function loadRbacConfig(clientContext: ClientContext): RbacConfig | null {
  const rbacPath = path.join(clientContext.configDir, "rbac.json");

  if (!fs.existsSync(rbacPath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(rbacPath, "utf-8");
    return JSON.parse(content) as RbacConfig;
  } catch (err) {
    throw new Error(`RBAC: failed to parse ${rbacPath}: ${(err as Error).message}`);
  }
}

/**
 * Resolve a user's role for a given client.
 * Returns null if the user is not found in the RBAC config.
 */
/** Allowed format for userId: alphanumeric + underscore + dot + at + hyphen (T-138) */
const USER_ID_PATTERN = /^[a-zA-Z0-9_.@-]{1,128}$/;

/**
 * Resolve a user's role for a given client.
 * Returns null if the user is not found in the RBAC config.
 *
 * T-138: Validates userId format before lookup to prevent injection.
 */
export function resolveUserRole(userId: string, rbacConfig: RbacConfig | null): Role | null {
  if (!USER_ID_PATTERN.test(userId)) {
    throw new Error(
      `[rbac] Invalid userId format: '${userId.slice(0, 32)}'. ` +
        `Allowed: a-z, A-Z, 0-9, _, ., @, - (max 128 characters)`
    );
  }

  if (!rbacConfig) return null;

  const user = rbacConfig.users.find((u: RbacUser) => u.id === userId);
  return user?.role ?? null;
}

// ── Permission checking ───────────────────────────────────────────────────────

/**
 * Check if a user has permission to perform an operation.
 *
 * @param userId - User identifier
 * @param operation - The operation being attempted
 * @param clientContext - The client context
 * @returns PermissionResult with allowed/denied and reason
 */
export function checkPermission(
  userId: string,
  operation: ProtectedOperation,
  clientContext: ClientContext
): PermissionResult {
  const rbacConfig = loadRbacConfig(clientContext);

  // SEC-03: Fail-closed when rbac.json is not configured
  if (!rbacConfig) {
    const permissiveOverride = process.env["K6_RBAC_PERMISSIVE"] === "true";
    if (permissiveOverride) {
      console.warn(
        `[rbac] WARNING: K6_RBAC_PERMISSIVE=true override active for client '${clientContext.clientId}'. ` +
          `RBAC bypass logged to audit trail.`
      );
      logAccessDenied(
        clientContext,
        "rbac_permissive_bypass",
        "K6_RBAC_PERMISSIVE=true override (rbac.json missing)"
      );
      return {
        allowed: true,
        role: "admin" as Role,
        operation,
        reason: "Permissive bypass via K6_RBAC_PERMISSIVE (audit logged)",
      };
    }
    return {
      allowed: false,
      role: "developer" as Role,
      operation,
      reason:
        `RBAC fail-closed: no rbac.json configured for client '${clientContext.clientId}'. ` +
        `Set K6_RBAC_PERMISSIVE=true to bypass (audit logged).`,
    };
  }

  const role = resolveUserRole(userId, rbacConfig);

  // User not found in rbac.json
  if (!role) {
    return {
      allowed: false,
      role: "developer" as Role,
      operation,
      reason: `User '${userId}' is not registered in the RBAC configuration for this client.`,
    };
  }

  // Check if the role allows this operation
  const permissions = ROLE_PERMISSIONS[role];
  const allowed = permissions.allowedOperations.includes(operation);

  return {
    allowed,
    role,
    operation,
    reason: allowed ? undefined : `Operation '${operation}' requires a higher role than '${role}'.`,
  };
}

/**
 * Check if a user can execute a specific load profile.
 */
export function checkProfilePermission(
  userId: string,
  profileName: string,
  clientContext: ClientContext
): PermissionResult {
  const rbacConfig = loadRbacConfig(clientContext);

  // SEC-03: Fail-closed when rbac.json is not configured
  if (!rbacConfig) {
    const permissiveOverride = process.env["K6_RBAC_PERMISSIVE"] === "true";
    if (permissiveOverride) {
      console.warn(
        `[rbac] WARNING: K6_RBAC_PERMISSIVE=true override active for client '${clientContext.clientId}'. ` +
          `RBAC bypass logged to audit trail.`
      );
      logAccessDenied(
        clientContext,
        "rbac_permissive_bypass",
        "K6_RBAC_PERMISSIVE=true override (rbac.json missing)"
      );
      return {
        allowed: true,
        role: "admin" as Role,
        operation: "execute_test",
        reason: "Permissive bypass via K6_RBAC_PERMISSIVE (audit logged)",
      };
    }
    return {
      allowed: false,
      role: "developer" as Role,
      operation: "execute_test",
      reason:
        `RBAC fail-closed: no rbac.json configured for client '${clientContext.clientId}'. ` +
        `Set K6_RBAC_PERMISSIVE=true to bypass (audit logged).`,
    };
  }

  const role = resolveUserRole(userId, rbacConfig);

  if (!role) {
    return {
      allowed: false,
      role: "developer" as Role,
      operation: "execute_test",
      reason: `User '${userId}' is not registered in the RBAC configuration for this client.`,
    };
  }

  const permissions = ROLE_PERMISSIONS[role];
  const allowed = permissions.allowedProfiles.includes(profileName);

  // Map profile to the specific protected operation for the error message
  const requiredOp = ELEVATED_PROFILES[profileName];
  const minRole = requiredOp
    ? (Object.entries(ROLE_PERMISSIONS)
        .filter(([, perms]) => perms.allowedOperations.includes(requiredOp))
        .map(([r]) => r)[0] ?? "lead")
    : "developer";

  return {
    allowed,
    role,
    operation: requiredOp ?? "execute_test",
    reason: allowed ? undefined : `Profile '${profileName}' requires role '${minRole}' or higher.`,
  };
}

/**
 * Check if a user from one client can access another client.
 * Only admins can cross client boundaries.
 */
export function checkCrossClientAccess(
  userId: string,
  sourceClient: ClientContext,
  targetClientId: string
): PermissionResult {
  if (sourceClient.clientId === targetClientId) {
    return {
      allowed: true,
      role: "developer" as Role,
      operation: "view_reports",
    };
  }

  const rbacConfig = loadRbacConfig(sourceClient);

  // WR-03: resolveUserRole throws Error when userId fails USER_ID_PATTERN.
  // checkCrossClientAccess may be called with user IDs sourced from external
  // inputs (e.g., Slack bot webhook payloads). Wrap to honour the structured
  // PermissionResult contract rather than propagating an unhandled exception.
  let role: Role | null = null;
  if (rbacConfig) {
    try {
      role = resolveUserRole(userId, rbacConfig);
    } catch {
      // Invalid userId format — treat as unknown user (not admin, denied)
      return {
        allowed: false,
        role: "developer" as Role,
        operation: "manage_clients",
        reason: "Access denied. Invalid user identity format.",
      };
    }
  }

  if (role === "admin") {
    return { allowed: true, role, operation: "manage_clients" };
  }

  return {
    allowed: false,
    role: role ?? "developer",
    operation: "manage_clients",
    reason: "Access denied. Cross-client access requires 'admin' role.",
  };
}

/**
 * Get the role permission definitions (for documentation/introspection).
 *
 * WR-02: Returns a deep clone so callers cannot mutate the module-level
 * ROLE_PERMISSIONS constant through the returned value. A shallow spread
 * ({ ...ROLE_PERMISSIONS }) copies only the outer object — the allowedProfiles
 * and allowedOperations arrays inside each role entry remain shared references,
 * meaning a push() on a returned array would silently corrupt the constant for
 * the entire process lifetime.
 */
export function getRolePermissions(): Record<Role, RolePermissions> {
  const copy = {} as Record<Role, RolePermissions>;
  for (const [role, perms] of Object.entries(ROLE_PERMISSIONS) as [Role, RolePermissions][]) {
    copy[role as Role] = {
      allowedProfiles: [...perms.allowedProfiles],
      allowedOperations: [...perms.allowedOperations],
    };
  }
  return copy;
}
