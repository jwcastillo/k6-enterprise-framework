import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  CLIENT_REQUIRED_DIRS,
  CLIENT_REQUIRED_FILES,
  validateClientManifest,
  resolveRequiredPaths,
  assertSecurityBoundary,
} from "../../src/core/client-validator";
import type { ClientManifest } from "../../src/core/client-validator";

describe("client-validator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("CLIENT_REQUIRED_DIRS", () => {
    it("should include all required directories", () => {
      expect(CLIENT_REQUIRED_DIRS).toContain("config");
      expect(CLIENT_REQUIRED_DIRS).toContain("data");
      expect(CLIENT_REQUIRED_DIRS).toContain("lib/services");
      expect(CLIENT_REQUIRED_DIRS).toContain("lib/factories");
      expect(CLIENT_REQUIRED_DIRS).toContain("scenarios");
    });
  });

  describe("CLIENT_REQUIRED_FILES", () => {
    it("should include default config file", () => {
      expect(CLIENT_REQUIRED_FILES).toContain("config/default.json");
    });
  });

  describe("validateClientManifest()", () => {
    it("should validate a correct manifest", () => {
      const manifest = {
        clientId: "acme",
        version: "1.0.0",
        description: "ACME Corp load tests",
        environments: ["staging", "production"],
      };

      const result = validateClientManifest(manifest);

      expect(result.valid).toBe(true);
      expect(result.clientId).toBe("acme");
      expect(result.errors).toHaveLength(0);
    });

    it("should reject null manifest", () => {
      const result = validateClientManifest(null);

      expect(result.valid).toBe(false);
      expect(result.clientId).toBe("unknown");
      expect(result.errors).toContain("Manifest must be a JSON object");
    });

    it("should reject non-object manifest", () => {
      const result = validateClientManifest("string");

      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Manifest must be a JSON object");
    });

    it("should reject manifest without clientId", () => {
      const result = validateClientManifest({ version: "1.0.0" });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain("clientId is required and must be a string");
    });

    it("should reject manifest without version", () => {
      const result = validateClientManifest({ clientId: "acme" });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain("version is required and must be a semver string");
    });

    it("should reject invalid semver version", () => {
      const result = validateClientManifest({ clientId: "acme", version: "abc" });

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain("does not follow semver");
    });

    it("should accept valid semver version with prerelease", () => {
      const result = validateClientManifest({ clientId: "acme", version: "1.2.3-beta.1" });

      expect(result.valid).toBe(true);
    });

    it("should reject invalid customChecks type", () => {
      const result = validateClientManifest({
        clientId: "acme",
        version: "1.0.0",
        customChecks: "invalid",
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain("customChecks must be an object mapping check names to descriptions");
    });

    it("should accept valid customChecks object", () => {
      const result = validateClientManifest({
        clientId: "acme",
        version: "1.0.0",
        customChecks: { "check-auth": "Validate auth token" },
      });

      expect(result.valid).toBe(true);
    });

    it("should warn when no environments specified", () => {
      const result = validateClientManifest({
        clientId: "acme",
        version: "1.0.0",
      });

      expect(result.warnings).toContain("No environments specified — defaulting to ['default']");
    });

    it("should not warn when environments is specified", () => {
      const result = validateClientManifest({
        clientId: "acme",
        version: "1.0.0",
        environments: ["staging"],
      });

      expect(result.warnings).toHaveLength(0);
    });

    it("should return clientId as 'unknown' when clientId is missing", () => {
      const result = validateClientManifest({});

      expect(result.clientId).toBe("unknown");
    });

    it("should collect multiple errors", () => {
      const result = validateClientManifest({ customChecks: 42 });

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe("resolveRequiredPaths()", () => {
    it("should return base paths when no additional paths", () => {
      const manifest: ClientManifest = {
        clientId: "acme",
        version: "1.0.0",
      };

      const paths = resolveRequiredPaths(manifest);

      expect(paths).toContain("config");
      expect(paths).toContain("data");
      expect(paths).toContain("scenarios");
      expect(paths).toContain("config/default.json");
    });

    it("should merge additional required paths", () => {
      const manifest: ClientManifest = {
        clientId: "acme",
        version: "1.0.0",
        additionalRequiredPaths: ["custom/path", "extra/dir"],
      };

      const paths = resolveRequiredPaths(manifest);

      expect(paths).toContain("custom/path");
      expect(paths).toContain("extra/dir");
    });

    it("should deduplicate paths", () => {
      const manifest: ClientManifest = {
        clientId: "acme",
        version: "1.0.0",
        additionalRequiredPaths: ["config", "data", "new-dir"],
      };

      const paths = resolveRequiredPaths(manifest);
      const configCount = paths.filter((p) => p === "config").length;

      expect(configCount).toBe(1);
      expect(paths).toContain("new-dir");
    });

    it("should handle empty additionalRequiredPaths array", () => {
      const manifest: ClientManifest = {
        clientId: "acme",
        version: "1.0.0",
        additionalRequiredPaths: [],
      };

      const paths = resolveRequiredPaths(manifest);
      const basePaths = [...CLIENT_REQUIRED_DIRS, ...CLIENT_REQUIRED_FILES];

      expect(paths).toEqual(basePaths);
    });
  });

  describe("assertSecurityBoundary()", () => {
    it("should not throw for allowed operations", () => {
      expect(() => assertSecurityBoundary("acme", "execute-test")).not.toThrow();
      expect(() => assertSecurityBoundary("acme", "read-config")).not.toThrow();
      expect(() => assertSecurityBoundary("acme", "generate-report")).not.toThrow();
    });

    it("should throw for blocked operation: override-secrets-manager", () => {
      expect(() => assertSecurityBoundary("acme", "override-secrets-manager")).toThrow(
        /Security boundary violation.*acme.*override-secrets-manager/,
      );
    });

    it("should throw for blocked operation: bypass-masking", () => {
      expect(() => assertSecurityBoundary("acme", "bypass-masking")).toThrow(
        /Security boundary violation/,
      );
    });

    it("should throw for blocked operation: modify-core-thresholds", () => {
      expect(() => assertSecurityBoundary("acme", "modify-core-thresholds")).toThrow(
        /Security boundary violation/,
      );
    });

    it("should throw for blocked operation: disable-structured-logs", () => {
      expect(() => assertSecurityBoundary("acme", "disable-structured-logs")).toThrow(
        /Security boundary violation/,
      );
    });

    it("should include client and operation in error message", () => {
      expect(() => assertSecurityBoundary("my-client", "bypass-masking")).toThrow(
        "Security boundary violation: client 'my-client' attempted blocked operation 'bypass-masking'",
      );
    });
  });
});
