import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  maskSecret,
  isSecretEnvVar,
  resolveSecret,
  resolveSecretWithMetadata,
  resolveSecretOr,
} from "../../src/core/secrets-manager";

// Access the global __ENV mock provided by setup.ts
declare const __ENV: Record<string, string>;

describe("SecretsManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset __ENV to a clean state
    for (const key of Object.keys(__ENV)) {
      delete __ENV[key];
    }
  });

  // ── maskSecret ──────────────────────────────────────────────────────────

  describe("maskSecret()", () => {
    it("should return '****' for empty string", () => {
      expect(maskSecret("")).toBe("****");
    });

    it("should return '****' for short strings (length <= 4)", () => {
      expect(maskSecret("abc")).toBe("****");
      expect(maskSecret("abcd")).toBe("****");
    });

    it("should mask most of a longer string", () => {
      const result = maskSecret("my-secret-token-value");
      // Should start with visible chars, have asterisks, and end with visible chars
      expect(result).toContain("*");
      expect(result.length).toBeGreaterThan(0);
      expect(result).not.toBe("my-secret-token-value");
    });

    it("should preserve at most 2 characters at each end", () => {
      const result = maskSecret("abcdefghijklmnop");
      // visible = min(2, floor(16 * 0.1)) = min(2, 1) = 1
      expect(result.startsWith("a")).toBe(true);
      expect(result.endsWith("p")).toBe(true);
    });

    it("should handle 5-character strings", () => {
      const result = maskSecret("12345");
      expect(result).toContain("*");
      expect(result).not.toBe("12345");
    });
  });

  // ── isSecretEnvVar ──────────────────────────────────────────────────────

  describe("isSecretEnvVar()", () => {
    it("should return true for vars containing 'token'", () => {
      expect(isSecretEnvVar("AUTH_TOKEN")).toBe(true);
      expect(isSecretEnvVar("api_token")).toBe(true);
    });

    it("should return true for vars containing 'password'", () => {
      expect(isSecretEnvVar("DB_PASSWORD")).toBe(true);
    });

    it("should return true for vars containing 'secret'", () => {
      expect(isSecretEnvVar("CLIENT_SECRET")).toBe(true);
    });

    it("should return true for vars containing 'api_key'", () => {
      expect(isSecretEnvVar("MY_API_KEY")).toBe(true);
    });

    it("should return true for vars containing 'apikey'", () => {
      expect(isSecretEnvVar("APIKEY")).toBe(true);
    });

    it("should return true for vars containing 'credentials'", () => {
      expect(isSecretEnvVar("SERVICE_CREDENTIALS")).toBe(true);
    });

    it("should return true for vars containing 'private_key'", () => {
      expect(isSecretEnvVar("SSL_PRIVATE_KEY")).toBe(true);
    });

    it("should return true for vars containing 'passwd'", () => {
      expect(isSecretEnvVar("LDAP_PASSWD")).toBe(true);
    });

    it("should return false for non-sensitive var names", () => {
      expect(isSecretEnvVar("K6_CLIENT")).toBe(false);
      expect(isSecretEnvVar("BASE_URL")).toBe(false);
      expect(isSecretEnvVar("ENVIRONMENT")).toBe(false);
    });

    it("should be case-insensitive", () => {
      expect(isSecretEnvVar("Token")).toBe(true);
      expect(isSecretEnvVar("PASSWORD")).toBe(true);
    });
  });

  // ── resolveSecret ──────────────────────────────────────────────────────

  describe("resolveSecret()", () => {
    it("should resolve a secret from env backend", () => {
      __ENV["MY_API_KEY"] = "secret-value-123";
      const result = resolveSecret("MY_API_KEY", { backends: ["env"] });
      expect(result).toBe("secret-value-123");
    });

    it("should resolve from vault backend using K6_SECRET_ prefix", () => {
      __ENV["K6_SECRET_VAULT_KEY"] = "vault-secret";
      const result = resolveSecret("VAULT_KEY", { backends: ["vault"] });
      expect(result).toBe("vault-secret");
    });

    it("should resolve from aws-sm backend using K6_SECRET_ prefix", () => {
      __ENV["K6_SECRET_AWS_KEY"] = "aws-secret";
      const result = resolveSecret("AWS_KEY", { backends: ["aws-sm"] });
      expect(result).toBe("aws-secret");
    });

    it("should resolve from azure-kv backend using K6_SECRET_ prefix", () => {
      __ENV["K6_SECRET_AZURE_KEY"] = "azure-secret";
      const result = resolveSecret("AZURE_KEY", { backends: ["azure-kv"] });
      expect(result).toBe("azure-secret");
    });

    it("should try backends in order and return first resolved value", () => {
      __ENV["K6_SECRET_MY_KEY"] = "from-vault";
      const result = resolveSecret("MY_KEY", { backends: ["env", "vault"] });
      // env backend would look for MY_KEY (not set), vault looks for K6_SECRET_MY_KEY
      expect(result).toBe("from-vault");
    });

    it("should throw when key is not found in any backend", () => {
      expect(() =>
        resolveSecret("NONEXISTENT_KEY", { backends: ["env"] }),
      ).toThrow("not found in any backend");
    });

    it("should throw for invalid key format (lowercase)", () => {
      expect(() =>
        resolveSecret("invalid_key", { backends: ["env"] }),
      ).toThrow("invalid key format");
    });

    it("should throw for invalid key format (spaces)", () => {
      expect(() =>
        resolveSecret("MY KEY", { backends: ["env"] }),
      ).toThrow("invalid key format");
    });

    it("should throw for key exceeding 128 characters", () => {
      const longKey = "A".repeat(129);
      expect(() =>
        resolveSecret(longKey, { backends: ["env"] }),
      ).toThrow("invalid key format");
    });

    it("should accept key of exactly 128 characters", () => {
      const key = "A".repeat(128);
      __ENV[key] = "value";
      expect(resolveSecret(key, { backends: ["env"] })).toBe("value");
    });

    it("should default to env backend if K6_SECRETS_BACKENDS is not set", () => {
      __ENV["TEST_KEY"] = "env-value";
      const result = resolveSecret("TEST_KEY");
      expect(result).toBe("env-value");
    });

    it("should parse K6_SECRETS_BACKENDS from env", () => {
      __ENV["K6_SECRETS_BACKENDS"] = "vault,env";
      __ENV["MY_SECRET"] = "direct-env-value";
      const result = resolveSecret("MY_SECRET");
      // vault will look for K6_SECRET_MY_SECRET (not set), then env finds MY_SECRET
      expect(result).toBe("direct-env-value");
    });

    it("should skip empty env values", () => {
      __ENV["EMPTY_KEY"] = "";
      expect(() =>
        resolveSecret("EMPTY_KEY", { backends: ["env"] }),
      ).toThrow("not found in any backend");
    });
  });

  // ── resolveSecretWithMetadata ──────────────────────────────────────────

  describe("resolveSecretWithMetadata()", () => {
    it("should return full metadata including masked value", () => {
      __ENV["DB_PASSWORD"] = "super-secret-password";
      const result = resolveSecretWithMetadata("DB_PASSWORD", { backends: ["env"] });

      expect(result.key).toBe("DB_PASSWORD");
      expect(result.value).toBe("super-secret-password");
      expect(result.backend).toBe("env");
      expect(result.masked).toContain("*");
      expect(result.masked).not.toBe("super-secret-password");
    });

    it("should throw when key is not found", () => {
      expect(() =>
        resolveSecretWithMetadata("NONEXISTENT", { backends: ["env"] }),
      ).toThrow("not found in any backend");
    });

    it("should throw for invalid key format", () => {
      expect(() =>
        resolveSecretWithMetadata("bad-key", { backends: ["env"] }),
      ).toThrow("invalid key format");
    });

    it("should return vault as backend when resolved from vault", () => {
      __ENV["K6_SECRET_VAULT_TOKEN"] = "vault-token-value";
      const result = resolveSecretWithMetadata("VAULT_TOKEN", { backends: ["vault"] });
      expect(result.backend).toBe("vault");
    });
  });

  // ── resolveSecretOr ────────────────────────────────────────────────────

  describe("resolveSecretOr()", () => {
    it("should return the resolved secret when available", () => {
      __ENV["OPTIONAL_KEY"] = "resolved-value";
      const result = resolveSecretOr("OPTIONAL_KEY", "fallback");
      expect(result).toBe("resolved-value");
    });

    it("should return fallback when secret is not found", () => {
      const result = resolveSecretOr("MISSING_KEY", "fallback-value");
      expect(result).toBe("fallback-value");
    });

    it("should return fallback for invalid key format (does not throw)", () => {
      const result = resolveSecretOr("invalid_key" as string, "default");
      expect(result).toBe("default");
    });

    it("should return empty string fallback when provided", () => {
      const result = resolveSecretOr("MISSING", "");
      expect(result).toBe("");
    });
  });
});
