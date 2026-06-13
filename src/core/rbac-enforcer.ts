/**
 * T-045: RBAC permission enforcement
 *
 * Integrates RBAC checks into all protected framework operations.
 * Every entry point (CLI, run-test.sh, batch execution) calls these
 * guards before proceeding.
 *
 * Access denied events are automatically logged to the audit trail.
 *
 * Runs in Node.js context (bin/), NOT in k6 goja runtime.
 */

import { ClientContext } from "../types/client.d";
import { ProtectedOperation } from "../types/rbac.d";
import {
  resolveCurrentUser,
  checkPermission,
  checkProfilePermission,
  checkCrossClientAccess,
} from "./rbac";
import { logAccessDenied } from "./audit-logger";

// ── Guard functions ───────────────────────────────────────────────────────────

/**
 * Enforce that the current user can perform an operation.
 * Throws with a descriptive error if access is denied.
 * Automatically logs denied attempts to the audit trail.
 *
 * @param operation - The operation being attempted
 * @param clientContext - The active client context
 * @param userId - Optional user override (defaults to resolveCurrentUser())
 */
export function enforcePermission(
  operation: ProtectedOperation,
  clientContext: ClientContext,
  userId?: string,
): void {
  const user = userId ?? resolveCurrentUser();
  const result = checkPermission(user, operation, clientContext);

  if (!result.allowed) {
    logAccessDenied(clientContext, operation, result.reason ?? "Permission denied");
    throw new Error(
      `Access denied: ${result.reason ?? `Operation '${operation}' is not permitted for your role.`}`,
    );
  }
}

/**
 * Enforce that the current user can execute a specific load profile.
 * Developers cannot run stress/breakpoint/soak profiles.
 */
export function enforceProfileExecution(
  profileName: string,
  clientContext: ClientContext,
  userId?: string,
): void {
  const user = userId ?? resolveCurrentUser();
  const result = checkProfilePermission(user, profileName, clientContext);

  if (!result.allowed) {
    logAccessDenied(
      clientContext,
      `execute_profile:${profileName}`,
      result.reason ?? "Profile not allowed",
    );
    throw new Error(
      `Access denied: ${result.reason ?? `Profile '${profileName}' requires a higher role.`}`,
    );
  }
}

/**
 * Enforce that the current user can access another client's data.
 * Only admins can cross client boundaries.
 */
export function enforceCrossClientAccess(
  sourceClientContext: ClientContext,
  targetClientId: string,
  userId?: string,
): void {
  const user = userId ?? resolveCurrentUser();
  const result = checkCrossClientAccess(user, sourceClientContext, targetClientId);

  if (!result.allowed) {
    logAccessDenied(
      sourceClientContext,
      `cross_client_access:${targetClientId}`,
      result.reason ?? "Cross-client access denied",
    );
    throw new Error(
      "Access denied. Cross-client access requires 'admin' role.",
    );
  }
}

/**
 * Enforce that the current user can modify configuration.
 * Only leads and admins can modify thresholds, SLOs, and other configs.
 */
export function enforceConfigModification(
  configType: "thresholds" | "slos" | "roles" | "chaos" | "mocks",
  clientContext: ClientContext,
  userId?: string,
): void {
  const operationMap: Record<string, ProtectedOperation> = {
    thresholds: "modify_thresholds",
    slos: "modify_slos",
    roles: "modify_roles",
    chaos: "configure_chaos",
    mocks: "configure_mocks",
  };

  enforcePermission(operationMap[configType], clientContext, userId);
}

// ── Pre-execution guard ───────────────────────────────────────────────────────

/**
 * Run all RBAC checks before a test execution.
 * Combines profile permission + operation permission in one call.
 *
 * @param clientContext - Active client context
 * @param profileName - Load profile being used
 * @param userId - Optional user override
 */
export function enforceExecutionPermissions(
  clientContext: ClientContext,
  profileName: string,
  userId?: string,
): void {
  const user = userId ?? resolveCurrentUser();

  // Check basic execution permission
  const execResult = checkPermission(user, "execute_test", clientContext);
  if (!execResult.allowed) {
    logAccessDenied(clientContext, "execute_test", execResult.reason ?? "Permission denied");
    throw new Error(
      `Access denied: ${execResult.reason ?? "You do not have permission to execute tests for this client."}`,
    );
  }

  // Check profile-specific permission
  enforceProfileExecution(profileName, clientContext, user);
}
