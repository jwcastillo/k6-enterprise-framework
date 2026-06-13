/** RBAC (Role-Based Access Control) types for k6 Enterprise Framework (Phase 2) */

/**
 * Three-tier role system:
 * - admin: Platform administrator — full access to all clients and operations
 * - lead: Team lead — full access within assigned client(s)
 * - developer: Developer — restricted to safe operations within assigned client
 */
export type Role = "admin" | "lead" | "developer";

/** Operations that require permission checks */
export type ProtectedOperation =
  | "execute_test"
  | "execute_stress"
  | "execute_breakpoint"
  | "execute_soak"
  | "modify_thresholds"
  | "modify_slos"
  | "modify_roles"
  | "manage_clients"
  | "view_reports"
  | "export_reports"
  | "query_audit"
  | "compile_binary"
  | "configure_chaos"
  | "configure_mocks";

/** User entry in the RBAC configuration */
export interface RbacUser {
  /** Unique user identifier (matches $USER or K6_USER) */
  id: string;
  /** Assigned role */
  role: Role;
  /** Optional email for notifications */
  email?: string;
}

/**
 * RBAC configuration for a client.
 * Stored in clients/{name}/config/rbac.json
 *
 * @example
 * {
 *   "users": [
 *     { "id": "john", "role": "lead", "email": "john@example.com" },
 *     { "id": "jane", "role": "developer" }
 *   ]
 * }
 */
export interface RbacConfig {
  /** Users and their role assignments */
  users: RbacUser[];
}

/** Result of a permission check */
export interface PermissionResult {
  /** Whether the operation is allowed */
  allowed: boolean;
  /** The user's resolved role */
  role: Role;
  /** The operation that was checked */
  operation: ProtectedOperation;
  /** Human-readable reason if denied */
  reason?: string;
}

/** Role-to-permission mapping (built-in, not configurable) */
export interface RolePermissions {
  /** Profiles this role can execute */
  allowedProfiles: string[];
  /** Operations this role can perform */
  allowedOperations: ProtectedOperation[];
}
