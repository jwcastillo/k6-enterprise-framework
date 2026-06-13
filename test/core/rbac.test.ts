import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import type { ClientContext } from "../../src/types/client.d";
import type { RbacConfig } from "../../src/types/rbac.d";

// Spy on fs and path before importing the module under test
const existsSyncSpy = vi.spyOn(fs, "existsSync");
const readFileSyncSpy = vi.spyOn(fs, "readFileSync");
vi.spyOn(path, "join").mockImplementation((...parts: string[]) => parts.join("/"));

// Mock audit-logger so tests don't actually write audit files
vi.mock("../../src/core/audit-logger", () => ({
  logAccessDenied: vi.fn(),
}));

import {
  resolveCurrentUser,
  loadRbacConfig,
  resolveUserRole,
  checkPermission,
  checkProfilePermission,
  checkCrossClientAccess,
  getRolePermissions,
} from "../../src/core/rbac";
import { logAccessDenied } from "../../src/core/audit-logger";

function makeClientContext(overrides: Partial<ClientContext> = {}): ClientContext {
  return {
    clientId: "test-client",
    rootDir: "/clients/test-client",
    configDir: "/clients/test-client/config",
    dataDir: "/clients/test-client/data",
    libDir: "/clients/test-client/lib",
    scenariosDir: "/clients/test-client/scenarios",
    reportsDir: "/clients/test-client/reports",
    envFile: "/clients/test-client/.env",
    mocksDir: "/clients/test-client/mocks",
    brandingDir: "/clients/test-client/branding",
    isSubmodule: false,
    isSymlink: false,
    ...overrides,
  };
}

function makeRbacConfig(users: RbacConfig["users"] = []): RbacConfig {
  return { users };
}

const sampleRbacConfig: RbacConfig = makeRbacConfig([
  { id: "admin-user", role: "admin", email: "admin@example.com" },
  { id: "lead-user", role: "lead", email: "lead@example.com" },
  { id: "dev-user", role: "developer" },
]);

describe("RBAC", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env["K6_USER"];
    delete process.env["K6_RBAC_PERMISSIVE"];
    // Do not delete process.env["USER"] as it's needed by the OS
  });

  afterEach(() => {
    delete process.env["K6_RBAC_PERMISSIVE"];
  });

  // ── resolveCurrentUser ────────────────────────────────────────────────────

  describe("resolveCurrentUser", () => {
    it("should use K6_USER when set", () => {
      process.env["K6_USER"] = "test-user";
      expect(resolveCurrentUser()).toBe("test-user");
    });

    it("should fall back to $USER when K6_USER is not set", () => {
      delete process.env["K6_USER"];
      // $USER is typically set on unix systems
      const user = resolveCurrentUser();
      expect(typeof user).toBe("string");
      expect(user.length).toBeGreaterThan(0);
    });

    it("should sanitize special characters from user identity", () => {
      process.env["K6_USER"] = "user;rm -rf /";
      const result = resolveCurrentUser();
      expect(result).toBe("userrm-rf");
    });

    it("should allow valid characters: alphanumeric, _, ., @, -", () => {
      process.env["K6_USER"] = "user.name@domain-test_123";
      expect(resolveCurrentUser()).toBe("user.name@domain-test_123");
    });

    it("should truncate to 128 characters", () => {
      process.env["K6_USER"] = "a".repeat(200);
      expect(resolveCurrentUser()).toHaveLength(128);
    });

    it("should return 'anonymous' when sanitization results in empty string", () => {
      process.env["K6_USER"] = "!!!###$$$";
      expect(resolveCurrentUser()).toBe("anonymous");
    });
  });

  // ── loadRbacConfig ────────────────────────────────────────────────────────

  describe("loadRbacConfig", () => {
    it("should return null when rbac.json does not exist", () => {
      existsSyncSpy.mockReturnValue(false);
      const result = loadRbacConfig(makeClientContext());
      expect(result).toBeNull();
    });

    it("should load and parse valid rbac.json", () => {
      existsSyncSpy.mockReturnValue(true);
      readFileSyncSpy.mockReturnValue(JSON.stringify(sampleRbacConfig));

      const result = loadRbacConfig(makeClientContext());
      expect(result).toEqual(sampleRbacConfig);
      expect(result!.users).toHaveLength(3);
    });

    it("should throw when rbac.json is invalid JSON", () => {
      existsSyncSpy.mockReturnValue(true);
      readFileSyncSpy.mockReturnValue("{bad json");

      expect(() => loadRbacConfig(makeClientContext())).toThrow(
        "RBAC: failed to parse"
      );
    });
  });

  // ── resolveUserRole ───────────────────────────────────────────────────────

  describe("resolveUserRole", () => {
    it("should return admin role for admin user", () => {
      const role = resolveUserRole("admin-user", sampleRbacConfig);
      expect(role).toBe("admin");
    });

    it("should return lead role for lead user", () => {
      const role = resolveUserRole("lead-user", sampleRbacConfig);
      expect(role).toBe("lead");
    });

    it("should return developer role for developer user", () => {
      const role = resolveUserRole("dev-user", sampleRbacConfig);
      expect(role).toBe("developer");
    });

    it("should return null for unknown user", () => {
      const role = resolveUserRole("unknown-user", sampleRbacConfig);
      expect(role).toBeNull();
    });

    it("should return null when rbacConfig is null", () => {
      const role = resolveUserRole("admin-user", null);
      expect(role).toBeNull();
    });

    it("should throw for invalid userId format", () => {
      expect(() => resolveUserRole("user;injection", sampleRbacConfig)).toThrow(
        "[rbac] Invalid userId format"
      );
    });

    it("should throw for empty userId", () => {
      expect(() => resolveUserRole("", sampleRbacConfig)).toThrow(
        "[rbac] Invalid userId format"
      );
    });

    it("should throw for userId exceeding 128 characters", () => {
      const longId = "a".repeat(129);
      expect(() => resolveUserRole(longId, sampleRbacConfig)).toThrow(
        "[rbac] Invalid userId format"
      );
    });

    it("should accept userId with valid special characters", () => {
      const config = makeRbacConfig([
        { id: "user.name@domain-test_123", role: "admin" },
      ]);
      const role = resolveUserRole("user.name@domain-test_123", config);
      expect(role).toBe("admin");
    });
  });

  // ── checkPermission ───────────────────────────────────────────────────────

  describe("checkPermission", () => {
    describe("fail-closed default (SEC-03)", () => {
      it("should deny all operations when rbac.json missing and K6_RBAC_PERMISSIVE not set", () => {
        existsSyncSpy.mockReturnValue(false);

        const result = checkPermission("anyone", "execute_test", makeClientContext());
        expect(result.allowed).toBe(false);
        expect(result.role).toBe("developer");
        expect(result.reason).toMatch(/fail-closed/i);
        expect(result.reason).toContain("K6_RBAC_PERMISSIVE");
      });

      it("should return allowed=false when rbac.json missing and env unset (execute_stress)", () => {
        existsSyncSpy.mockReturnValue(false);

        const result = checkPermission("alice", "execute_stress", makeClientContext());
        expect(result.allowed).toBe(false);
        expect(result.reason).toMatch(/fail-closed/i);
      });

      it("should allow when K6_RBAC_PERMISSIVE=true and rbac.json missing", () => {
        existsSyncSpy.mockReturnValue(false);
        process.env["K6_RBAC_PERMISSIVE"] = "true";
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

        const result = checkPermission("anyone", "execute_test", makeClientContext());
        expect(result.allowed).toBe(true);
        expect(result.role).toBe("admin");
        expect(result.reason).toMatch(/permissive|bypass/i);

        warnSpy.mockRestore();
      });

      it("should emit console.warn when K6_RBAC_PERMISSIVE=true", () => {
        existsSyncSpy.mockReturnValue(false);
        process.env["K6_RBAC_PERMISSIVE"] = "true";
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

        checkPermission("anyone", "execute_test", makeClientContext());
        expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/K6_RBAC_PERMISSIVE/i));

        warnSpy.mockRestore();
      });

      it("should call logAccessDenied with rbac_permissive_bypass when K6_RBAC_PERMISSIVE=true", () => {
        existsSyncSpy.mockReturnValue(false);
        process.env["K6_RBAC_PERMISSIVE"] = "true";
        vi.spyOn(console, "warn").mockImplementation(() => {});

        const ctx = makeClientContext();
        checkPermission("anyone", "execute_test", ctx);

        expect(logAccessDenied).toHaveBeenCalledTimes(1);
        expect(logAccessDenied).toHaveBeenCalledWith(
          ctx,
          "rbac_permissive_bypass",
          expect.stringMatching(/K6_RBAC_PERMISSIVE/)
        );
      });

      it("should NOT call logAccessDenied on plain fail-closed denial", () => {
        existsSyncSpy.mockReturnValue(false);
        // K6_RBAC_PERMISSIVE is NOT set

        checkPermission("anyone", "execute_test", makeClientContext());
        expect(logAccessDenied).not.toHaveBeenCalled();
      });
    });

    it("should deny unknown user", () => {
      existsSyncSpy.mockReturnValue(true);
      readFileSyncSpy.mockReturnValue(JSON.stringify(sampleRbacConfig));

      const result = checkPermission("unknown-user", "execute_test", makeClientContext());
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("not registered");
    });

    it("should allow admin to execute_test", () => {
      existsSyncSpy.mockReturnValue(true);
      readFileSyncSpy.mockReturnValue(JSON.stringify(sampleRbacConfig));

      const result = checkPermission("admin-user", "execute_test", makeClientContext());
      expect(result.allowed).toBe(true);
      expect(result.role).toBe("admin");
    });

    it("should allow admin to modify_roles", () => {
      existsSyncSpy.mockReturnValue(true);
      readFileSyncSpy.mockReturnValue(JSON.stringify(sampleRbacConfig));

      const result = checkPermission("admin-user", "modify_roles", makeClientContext());
      expect(result.allowed).toBe(true);
    });

    it("should allow admin to manage_clients", () => {
      existsSyncSpy.mockReturnValue(true);
      readFileSyncSpy.mockReturnValue(JSON.stringify(sampleRbacConfig));

      const result = checkPermission("admin-user", "manage_clients", makeClientContext());
      expect(result.allowed).toBe(true);
    });

    it("should allow lead to execute_stress", () => {
      existsSyncSpy.mockReturnValue(true);
      readFileSyncSpy.mockReturnValue(JSON.stringify(sampleRbacConfig));

      const result = checkPermission("lead-user", "execute_stress", makeClientContext());
      expect(result.allowed).toBe(true);
    });

    it("should deny lead from modify_roles", () => {
      existsSyncSpy.mockReturnValue(true);
      readFileSyncSpy.mockReturnValue(JSON.stringify(sampleRbacConfig));

      const result = checkPermission("lead-user", "modify_roles", makeClientContext());
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("requires a higher role");
    });

    it("should deny lead from manage_clients", () => {
      existsSyncSpy.mockReturnValue(true);
      readFileSyncSpy.mockReturnValue(JSON.stringify(sampleRbacConfig));

      const result = checkPermission("lead-user", "manage_clients", makeClientContext());
      expect(result.allowed).toBe(false);
    });

    it("should allow developer to execute_test", () => {
      existsSyncSpy.mockReturnValue(true);
      readFileSyncSpy.mockReturnValue(JSON.stringify(sampleRbacConfig));

      const result = checkPermission("dev-user", "execute_test", makeClientContext());
      expect(result.allowed).toBe(true);
    });

    it("should allow developer to view_reports", () => {
      existsSyncSpy.mockReturnValue(true);
      readFileSyncSpy.mockReturnValue(JSON.stringify(sampleRbacConfig));

      const result = checkPermission("dev-user", "view_reports", makeClientContext());
      expect(result.allowed).toBe(true);
    });

    it("should deny developer from execute_stress", () => {
      existsSyncSpy.mockReturnValue(true);
      readFileSyncSpy.mockReturnValue(JSON.stringify(sampleRbacConfig));

      const result = checkPermission("dev-user", "execute_stress", makeClientContext());
      expect(result.allowed).toBe(false);
    });

    it("should deny developer from modify_thresholds", () => {
      existsSyncSpy.mockReturnValue(true);
      readFileSyncSpy.mockReturnValue(JSON.stringify(sampleRbacConfig));

      const result = checkPermission("dev-user", "modify_thresholds", makeClientContext());
      expect(result.allowed).toBe(false);
    });

    it("should deny developer from export_reports", () => {
      existsSyncSpy.mockReturnValue(true);
      readFileSyncSpy.mockReturnValue(JSON.stringify(sampleRbacConfig));

      const result = checkPermission("dev-user", "export_reports", makeClientContext());
      expect(result.allowed).toBe(false);
    });
  });

  // ── checkProfilePermission ────────────────────────────────────────────────

  describe("checkProfilePermission", () => {
    describe("fail-closed default (SEC-03)", () => {
      it("should deny all profiles when rbac.json missing and K6_RBAC_PERMISSIVE not set", () => {
        existsSyncSpy.mockReturnValue(false);

        const result = checkProfilePermission("anyone", "smoke", makeClientContext());
        expect(result.allowed).toBe(false);
        expect(result.reason).toMatch(/fail-closed/i);
        expect(result.reason).toContain("K6_RBAC_PERMISSIVE");
      });

      it("should deny stress profile when rbac.json missing and env not set", () => {
        existsSyncSpy.mockReturnValue(false);

        const result = checkProfilePermission("alice", "stress", makeClientContext());
        expect(result.allowed).toBe(false);
      });

      it("should allow when K6_RBAC_PERMISSIVE=true and rbac.json missing", () => {
        existsSyncSpy.mockReturnValue(false);
        process.env["K6_RBAC_PERMISSIVE"] = "true";
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

        const result = checkProfilePermission("anyone", "smoke", makeClientContext());
        expect(result.allowed).toBe(true);
        expect(result.role).toBe("admin");
        expect(result.reason).toMatch(/permissive|bypass/i);

        warnSpy.mockRestore();
      });

      it("should emit console.warn when K6_RBAC_PERMISSIVE=true in checkProfilePermission", () => {
        existsSyncSpy.mockReturnValue(false);
        process.env["K6_RBAC_PERMISSIVE"] = "true";
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

        checkProfilePermission("anyone", "stress", makeClientContext());
        expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/K6_RBAC_PERMISSIVE/i));

        warnSpy.mockRestore();
      });

      it("should call logAccessDenied with rbac_permissive_bypass in checkProfilePermission", () => {
        existsSyncSpy.mockReturnValue(false);
        process.env["K6_RBAC_PERMISSIVE"] = "true";
        vi.spyOn(console, "warn").mockImplementation(() => {});

        const ctx = makeClientContext();
        checkProfilePermission("anyone", "stress", ctx);

        expect(logAccessDenied).toHaveBeenCalledTimes(1);
        expect(logAccessDenied).toHaveBeenCalledWith(
          ctx,
          "rbac_permissive_bypass",
          expect.stringMatching(/K6_RBAC_PERMISSIVE/)
        );
      });
    });

    it("should deny unknown user", () => {
      existsSyncSpy.mockReturnValue(true);
      readFileSyncSpy.mockReturnValue(JSON.stringify(sampleRbacConfig));

      const result = checkProfilePermission("unknown", "smoke", makeClientContext());
      expect(result.allowed).toBe(false);
    });

    it("should allow developer to run smoke profile", () => {
      existsSyncSpy.mockReturnValue(true);
      readFileSyncSpy.mockReturnValue(JSON.stringify(sampleRbacConfig));

      const result = checkProfilePermission("dev-user", "smoke", makeClientContext());
      expect(result.allowed).toBe(true);
    });

    it("should allow developer to run quick profile", () => {
      existsSyncSpy.mockReturnValue(true);
      readFileSyncSpy.mockReturnValue(JSON.stringify(sampleRbacConfig));

      const result = checkProfilePermission("dev-user", "quick", makeClientContext());
      expect(result.allowed).toBe(true);
    });

    it("should allow developer to run load profile", () => {
      existsSyncSpy.mockReturnValue(true);
      readFileSyncSpy.mockReturnValue(JSON.stringify(sampleRbacConfig));

      const result = checkProfilePermission("dev-user", "load", makeClientContext());
      expect(result.allowed).toBe(true);
    });

    it("should deny developer from running stress profile", () => {
      existsSyncSpy.mockReturnValue(true);
      readFileSyncSpy.mockReturnValue(JSON.stringify(sampleRbacConfig));

      const result = checkProfilePermission("dev-user", "stress", makeClientContext());
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("requires role");
    });

    it("should deny developer from running spike profile", () => {
      existsSyncSpy.mockReturnValue(true);
      readFileSyncSpy.mockReturnValue(JSON.stringify(sampleRbacConfig));

      const result = checkProfilePermission("dev-user", "spike", makeClientContext());
      expect(result.allowed).toBe(false);
    });

    it("should deny developer from running breakpoint profile", () => {
      existsSyncSpy.mockReturnValue(true);
      readFileSyncSpy.mockReturnValue(JSON.stringify(sampleRbacConfig));

      const result = checkProfilePermission("dev-user", "breakpoint", makeClientContext());
      expect(result.allowed).toBe(false);
    });

    it("should deny developer from running soak profile", () => {
      existsSyncSpy.mockReturnValue(true);
      readFileSyncSpy.mockReturnValue(JSON.stringify(sampleRbacConfig));

      const result = checkProfilePermission("dev-user", "soak", makeClientContext());
      expect(result.allowed).toBe(false);
    });

    it("should deny developer from running capacity profile", () => {
      existsSyncSpy.mockReturnValue(true);
      readFileSyncSpy.mockReturnValue(JSON.stringify(sampleRbacConfig));

      const result = checkProfilePermission("dev-user", "capacity", makeClientContext());
      expect(result.allowed).toBe(false);
    });

    it("should allow lead to run stress profile", () => {
      existsSyncSpy.mockReturnValue(true);
      readFileSyncSpy.mockReturnValue(JSON.stringify(sampleRbacConfig));

      const result = checkProfilePermission("lead-user", "stress", makeClientContext());
      expect(result.allowed).toBe(true);
    });

    it("should allow lead to run all profiles", () => {
      existsSyncSpy.mockReturnValue(true);
      readFileSyncSpy.mockReturnValue(JSON.stringify(sampleRbacConfig));

      const profiles = ["smoke", "quick", "load", "rampup", "capacity", "stress", "spike", "breakpoint", "soak"];
      for (const prof of profiles) {
        const result = checkProfilePermission("lead-user", prof, makeClientContext());
        expect(result.allowed).toBe(true);
      }
    });

    it("should allow admin to run all profiles", () => {
      existsSyncSpy.mockReturnValue(true);
      readFileSyncSpy.mockReturnValue(JSON.stringify(sampleRbacConfig));

      const profiles = ["smoke", "quick", "load", "rampup", "capacity", "stress", "spike", "breakpoint", "soak"];
      for (const prof of profiles) {
        const result = checkProfilePermission("admin-user", prof, makeClientContext());
        expect(result.allowed).toBe(true);
      }
    });

    it("should map stress profile to execute_stress operation", () => {
      existsSyncSpy.mockReturnValue(true);
      readFileSyncSpy.mockReturnValue(JSON.stringify(sampleRbacConfig));

      const result = checkProfilePermission("dev-user", "stress", makeClientContext());
      expect(result.operation).toBe("execute_stress");
    });

    it("should map breakpoint profile to execute_breakpoint operation", () => {
      existsSyncSpy.mockReturnValue(true);
      readFileSyncSpy.mockReturnValue(JSON.stringify(sampleRbacConfig));

      const result = checkProfilePermission("dev-user", "breakpoint", makeClientContext());
      expect(result.operation).toBe("execute_breakpoint");
    });

    it("should map soak profile to execute_soak operation", () => {
      existsSyncSpy.mockReturnValue(true);
      readFileSyncSpy.mockReturnValue(JSON.stringify(sampleRbacConfig));

      const result = checkProfilePermission("dev-user", "soak", makeClientContext());
      expect(result.operation).toBe("execute_soak");
    });
  });

  // ── checkCrossClientAccess ────────────────────────────────────────────────

  describe("checkCrossClientAccess", () => {
    it("should allow access to same client for any user", () => {
      const ctx = makeClientContext({ clientId: "my-client" });
      const result = checkCrossClientAccess("dev-user", ctx, "my-client");
      expect(result.allowed).toBe(true);
    });

    it("should allow admin to access other clients", () => {
      existsSyncSpy.mockReturnValue(true);
      readFileSyncSpy.mockReturnValue(JSON.stringify(sampleRbacConfig));

      const ctx = makeClientContext({ clientId: "client-a" });
      const result = checkCrossClientAccess("admin-user", ctx, "client-b");
      expect(result.allowed).toBe(true);
      expect(result.role).toBe("admin");
      expect(result.operation).toBe("manage_clients");
    });

    it("should deny lead from accessing other clients", () => {
      existsSyncSpy.mockReturnValue(true);
      readFileSyncSpy.mockReturnValue(JSON.stringify(sampleRbacConfig));

      const ctx = makeClientContext({ clientId: "client-a" });
      const result = checkCrossClientAccess("lead-user", ctx, "client-b");
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("Cross-client access requires 'admin' role");
    });

    it("should deny developer from accessing other clients", () => {
      existsSyncSpy.mockReturnValue(true);
      readFileSyncSpy.mockReturnValue(JSON.stringify(sampleRbacConfig));

      const ctx = makeClientContext({ clientId: "client-a" });
      const result = checkCrossClientAccess("dev-user", ctx, "client-b");
      expect(result.allowed).toBe(false);
    });

    it("should deny unknown user from accessing other clients", () => {
      existsSyncSpy.mockReturnValue(true);
      readFileSyncSpy.mockReturnValue(JSON.stringify(sampleRbacConfig));

      const ctx = makeClientContext({ clientId: "client-a" });
      const result = checkCrossClientAccess("unknown-user", ctx, "client-b");
      expect(result.allowed).toBe(false);
    });

    it("should deny cross-client access when no rbac config and user is not admin (lookup semantics preserved per D-08)", () => {
      existsSyncSpy.mockReturnValue(false);

      const ctx = makeClientContext({ clientId: "client-a" });
      const result = checkCrossClientAccess("anyone", ctx, "client-b");
      // No rbac config => role is null => not admin => denied
      // This verifies D-08: checkCrossClientAccess uses lookup semantics (null-returning loadRbacConfig),
      // NOT the fail-closed gate logic. The fail-closed only applies to checkPermission/checkProfilePermission.
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("Cross-client access requires 'admin' role");
    });
  });

  // ── getRolePermissions ────────────────────────────────────────────────────

  describe("getRolePermissions", () => {
    it("should return permissions for all three roles", () => {
      const perms = getRolePermissions();
      expect(perms.admin).toBeDefined();
      expect(perms.lead).toBeDefined();
      expect(perms.developer).toBeDefined();
    });

    it("should include all profiles for admin", () => {
      const perms = getRolePermissions();
      expect(perms.admin.allowedProfiles).toContain("smoke");
      expect(perms.admin.allowedProfiles).toContain("stress");
      expect(perms.admin.allowedProfiles).toContain("breakpoint");
      expect(perms.admin.allowedProfiles).toContain("soak");
    });

    it("should restrict developer to smoke, quick, load profiles", () => {
      const perms = getRolePermissions();
      expect(perms.developer.allowedProfiles).toEqual(["smoke", "quick", "load"]);
    });

    it("should give admin more operations than lead", () => {
      const perms = getRolePermissions();
      expect(perms.admin.allowedOperations.length).toBeGreaterThanOrEqual(
        perms.lead.allowedOperations.length
      );
    });

    it("should give lead more operations than developer", () => {
      const perms = getRolePermissions();
      expect(perms.lead.allowedOperations.length).toBeGreaterThan(
        perms.developer.allowedOperations.length
      );
    });

    it("should include manage_clients only for admin", () => {
      const perms = getRolePermissions();
      expect(perms.admin.allowedOperations).toContain("manage_clients");
      expect(perms.lead.allowedOperations).not.toContain("manage_clients");
      expect(perms.developer.allowedOperations).not.toContain("manage_clients");
    });

    it("should include modify_roles only for admin", () => {
      const perms = getRolePermissions();
      expect(perms.admin.allowedOperations).toContain("modify_roles");
      expect(perms.lead.allowedOperations).not.toContain("modify_roles");
      expect(perms.developer.allowedOperations).not.toContain("modify_roles");
    });

    it("should return a copy, not the original object", () => {
      const perms1 = getRolePermissions();
      const perms2 = getRolePermissions();
      expect(perms1).toEqual(perms2);
      expect(perms1).not.toBe(perms2);
    });
  });
});
