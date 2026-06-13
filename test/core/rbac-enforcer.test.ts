import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ClientContext } from "../../src/types/client.d";
import type { PermissionResult } from "../../src/types/rbac.d";

// Mock rbac module
vi.mock("../../src/core/rbac", () => ({
  resolveCurrentUser: vi.fn(() => "testuser"),
  checkPermission: vi.fn((): PermissionResult => ({
    allowed: true,
    role: "admin",
    operation: "execute_test",
  })),
  checkProfilePermission: vi.fn((): PermissionResult => ({
    allowed: true,
    role: "admin",
    operation: "execute_test",
  })),
  checkCrossClientAccess: vi.fn((): PermissionResult => ({
    allowed: true,
    role: "admin",
    operation: "execute_test",
  })),
}));

// Mock audit-logger
vi.mock("../../src/core/audit-logger", () => ({
  logAccessDenied: vi.fn(),
}));

import {
  enforcePermission,
  enforceProfileExecution,
  enforceCrossClientAccess,
  enforceConfigModification,
  enforceExecutionPermissions,
} from "../../src/core/rbac-enforcer";
import {
  resolveCurrentUser,
  checkPermission,
  checkProfilePermission,
  checkCrossClientAccess,
} from "../../src/core/rbac";
import { logAccessDenied } from "../../src/core/audit-logger";

const mockCheckPermission = checkPermission as ReturnType<typeof vi.fn>;
const mockCheckProfilePermission = checkProfilePermission as ReturnType<typeof vi.fn>;
const mockCheckCrossClientAccess = checkCrossClientAccess as ReturnType<typeof vi.fn>;
const mockResolveCurrentUser = resolveCurrentUser as ReturnType<typeof vi.fn>;
const mockLogAccessDenied = logAccessDenied as ReturnType<typeof vi.fn>;

function makeContext(clientId = "test-client"): ClientContext {
  return {
    clientId,
    rootDir: `/framework/clients/${clientId}`,
    configDir: `/framework/clients/${clientId}/config`,
    dataDir: `/framework/clients/${clientId}/data`,
    libDir: `/framework/clients/${clientId}/lib`,
    scenariosDir: `/framework/clients/${clientId}/scenarios`,
    reportsDir: `/framework/reports/${clientId}`,
    envFile: `/framework/clients/${clientId}/.env`,
    mocksDir: `/framework/clients/${clientId}/mocks`,
    brandingDir: `/framework/clients/${clientId}/branding`,
    isSubmodule: false,
    isSymlink: false,
  };
}

describe("rbac-enforcer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveCurrentUser.mockReturnValue("testuser");
    mockCheckPermission.mockReturnValue({
      allowed: true,
      role: "admin",
      operation: "execute_test",
    });
    mockCheckProfilePermission.mockReturnValue({
      allowed: true,
      role: "admin",
      operation: "execute_test",
    });
    mockCheckCrossClientAccess.mockReturnValue({
      allowed: true,
      role: "admin",
      operation: "execute_test",
    });
  });

  describe("enforcePermission()", () => {
    it("should not throw when permission is allowed", () => {
      const ctx = makeContext();

      expect(() => enforcePermission("execute_test", ctx)).not.toThrow();
    });

    it("should throw when permission is denied", () => {
      mockCheckPermission.mockReturnValue({
        allowed: false,
        role: "developer",
        operation: "modify_thresholds",
        reason: "Developers cannot modify thresholds",
      });

      const ctx = makeContext();

      expect(() => enforcePermission("modify_thresholds", ctx)).toThrow(
        /Access denied.*Developers cannot modify thresholds/,
      );
    });

    it("should log denied access to audit trail", () => {
      mockCheckPermission.mockReturnValue({
        allowed: false,
        role: "developer",
        operation: "modify_thresholds",
        reason: "Not allowed",
      });

      const ctx = makeContext();

      try {
        enforcePermission("modify_thresholds", ctx);
      } catch {
        // expected
      }

      expect(mockLogAccessDenied).toHaveBeenCalledWith(
        ctx,
        "modify_thresholds",
        "Not allowed",
      );
    });

    it("should use resolveCurrentUser when no userId provided", () => {
      const ctx = makeContext();
      enforcePermission("execute_test", ctx);

      expect(mockResolveCurrentUser).toHaveBeenCalled();
      expect(mockCheckPermission).toHaveBeenCalledWith("testuser", "execute_test", ctx);
    });

    it("should use provided userId when specified", () => {
      const ctx = makeContext();
      enforcePermission("execute_test", ctx, "custom-user");

      expect(mockCheckPermission).toHaveBeenCalledWith("custom-user", "execute_test", ctx);
    });

    it("should provide default reason when none in result", () => {
      mockCheckPermission.mockReturnValue({
        allowed: false,
        role: "developer",
        operation: "modify_roles",
      });

      const ctx = makeContext();

      expect(() => enforcePermission("modify_roles", ctx)).toThrow(
        /Access denied/,
      );
    });
  });

  describe("enforceProfileExecution()", () => {
    it("should not throw when profile execution is allowed", () => {
      const ctx = makeContext();

      expect(() => enforceProfileExecution("smoke", ctx)).not.toThrow();
    });

    it("should throw when profile is not allowed", () => {
      mockCheckProfilePermission.mockReturnValue({
        allowed: false,
        role: "developer",
        operation: "execute_test",
        reason: "Developers cannot run stress profiles",
      });

      const ctx = makeContext();

      expect(() => enforceProfileExecution("stress", ctx)).toThrow(
        /Access denied.*Developers cannot run stress profiles/,
      );
    });

    it("should log denied profile access with profile name", () => {
      mockCheckProfilePermission.mockReturnValue({
        allowed: false,
        role: "developer",
        operation: "execute_test",
        reason: "Profile not allowed",
      });

      const ctx = makeContext();

      try {
        enforceProfileExecution("breakpoint", ctx);
      } catch {
        // expected
      }

      expect(mockLogAccessDenied).toHaveBeenCalledWith(
        ctx,
        "execute_profile:breakpoint",
        "Profile not allowed",
      );
    });
  });

  describe("enforceCrossClientAccess()", () => {
    it("should not throw when cross-client access is allowed", () => {
      const ctx = makeContext("source-client");

      expect(() => enforceCrossClientAccess(ctx, "target-client")).not.toThrow();
    });

    it("should throw when cross-client access is denied", () => {
      mockCheckCrossClientAccess.mockReturnValue({
        allowed: false,
        role: "developer",
        operation: "execute_test",
        reason: "Cross-client access denied",
      });

      const ctx = makeContext("source-client");

      expect(() => enforceCrossClientAccess(ctx, "target-client")).toThrow(
        /Access denied.*Cross-client access requires 'admin' role/,
      );
    });

    it("should log denied cross-client access", () => {
      mockCheckCrossClientAccess.mockReturnValue({
        allowed: false,
        role: "developer",
        operation: "execute_test",
      });

      const ctx = makeContext("source");

      try {
        enforceCrossClientAccess(ctx, "target");
      } catch {
        // expected
      }

      expect(mockLogAccessDenied).toHaveBeenCalledWith(
        ctx,
        "cross_client_access:target",
        expect.any(String),
      );
    });
  });

  describe("enforceConfigModification()", () => {
    it("should check permission with mapped operation for thresholds", () => {
      const ctx = makeContext();
      enforceConfigModification("thresholds", ctx);

      expect(mockCheckPermission).toHaveBeenCalledWith("testuser", "modify_thresholds", ctx);
    });

    it("should check permission with mapped operation for slos", () => {
      const ctx = makeContext();
      enforceConfigModification("slos", ctx);

      expect(mockCheckPermission).toHaveBeenCalledWith("testuser", "modify_slos", ctx);
    });

    it("should check permission with mapped operation for roles", () => {
      const ctx = makeContext();
      enforceConfigModification("roles", ctx);

      expect(mockCheckPermission).toHaveBeenCalledWith("testuser", "modify_roles", ctx);
    });

    it("should check permission for chaos config", () => {
      const ctx = makeContext();
      enforceConfigModification("chaos", ctx);

      expect(mockCheckPermission).toHaveBeenCalledWith("testuser", "configure_chaos", ctx);
    });

    it("should check permission for mocks config", () => {
      const ctx = makeContext();
      enforceConfigModification("mocks", ctx);

      expect(mockCheckPermission).toHaveBeenCalledWith("testuser", "configure_mocks", ctx);
    });

    it("should throw when modification is denied", () => {
      mockCheckPermission.mockReturnValue({
        allowed: false,
        role: "developer",
        operation: "modify_thresholds",
        reason: "Not allowed",
      });

      const ctx = makeContext();

      expect(() => enforceConfigModification("thresholds", ctx)).toThrow(
        /Access denied/,
      );
    });
  });

  describe("enforceExecutionPermissions()", () => {
    it("should check both execution and profile permissions", () => {
      const ctx = makeContext();
      enforceExecutionPermissions(ctx, "smoke");

      expect(mockCheckPermission).toHaveBeenCalledWith("testuser", "execute_test", ctx);
      expect(mockCheckProfilePermission).toHaveBeenCalled();
    });

    it("should throw when basic execution permission is denied", () => {
      mockCheckPermission.mockReturnValue({
        allowed: false,
        role: "developer",
        operation: "execute_test",
        reason: "No execution permission",
      });

      const ctx = makeContext();

      expect(() => enforceExecutionPermissions(ctx, "smoke")).toThrow(
        /Access denied.*No execution permission/,
      );
    });

    it("should throw when profile permission is denied after execution passes", () => {
      mockCheckPermission.mockReturnValue({
        allowed: true,
        role: "developer",
        operation: "execute_test",
      });
      mockCheckProfilePermission.mockReturnValue({
        allowed: false,
        role: "developer",
        operation: "execute_test",
        reason: "Cannot run stress",
      });

      const ctx = makeContext();

      expect(() => enforceExecutionPermissions(ctx, "stress")).toThrow(
        /Access denied.*Cannot run stress/,
      );
    });

    it("should use provided userId", () => {
      const ctx = makeContext();
      enforceExecutionPermissions(ctx, "smoke", "admin-user");

      expect(mockCheckPermission).toHaveBeenCalledWith("admin-user", "execute_test", ctx);
    });
  });
});
