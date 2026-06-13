import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  validateConfigJson,
  escapeShellValue,
  looksLikeHardcodedSecret,
  isSecretEnvVar,
  auditConfigForSecrets,
  redactSensitiveFields,
} from "../../src/core/config-security";

describe("config-security", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("validateConfigJson()", () => {
    it("should parse valid JSON object", () => {
      const result = validateConfigJson('{"key": "value"}');

      expect(result).toEqual({ key: "value" });
    });

    it("should parse complex nested objects", () => {
      const raw = JSON.stringify({ a: { b: { c: 1 } }, arr: [1, 2] });
      const result = validateConfigJson(raw);

      expect(result).toEqual({ a: { b: { c: 1 } }, arr: [1, 2] });
    });

    it("should throw for JSON exceeding max size", () => {
      const largeJson = JSON.stringify({ data: "x".repeat(600000) });

      expect(() => validateConfigJson(largeJson)).toThrow(/exceeds maximum size limit/);
    });

    it("should accept JSON within custom max size", () => {
      const json = JSON.stringify({ key: "value" });

      expect(() => validateConfigJson(json, 1000)).not.toThrow();
    });

    it("should throw for JSON exceeding custom max size", () => {
      const json = JSON.stringify({ key: "value" });

      expect(() => validateConfigJson(json, 5)).toThrow(/exceeds maximum size limit/);
    });

    it("should throw for invalid JSON syntax", () => {
      expect(() => validateConfigJson("{invalid}")).toThrow(/Invalid JSON config/);
    });

    it("should throw for JSON array (not object)", () => {
      expect(() => validateConfigJson("[1, 2, 3]")).toThrow(/Invalid JSON config/);
    });

    it("should throw for JSON primitive", () => {
      expect(() => validateConfigJson('"hello"')).toThrow(/Invalid JSON config/);
    });

    it("should throw for JSON null", () => {
      expect(() => validateConfigJson("null")).toThrow(/Invalid JSON config/);
    });
  });

  describe("escapeShellValue()", () => {
    it("should return the value unchanged if no single quotes", () => {
      expect(escapeShellValue("hello world")).toBe("hello world");
    });

    it("should escape single quotes", () => {
      expect(escapeShellValue("it's")).toBe("it'\\''s");
    });

    it("should escape multiple single quotes", () => {
      expect(escapeShellValue("a'b'c")).toBe("a'\\''b'\\''c");
    });

    it("should handle empty string", () => {
      expect(escapeShellValue("")).toBe("");
    });

    it("should not affect double quotes", () => {
      expect(escapeShellValue('say "hello"')).toBe('say "hello"');
    });
  });

  describe("looksLikeHardcodedSecret()", () => {
    it("should return false for short strings", () => {
      expect(looksLikeHardcodedSecret("short")).toBe(false);
    });

    it("should return false for non-string values", () => {
      expect(looksLikeHardcodedSecret(42 as unknown as string)).toBe(false);
    });

    it("should return false for placeholder values", () => {
      expect(looksLikeHardcodedSecret("${MY_SECRET_VALUE_HERE}")).toBe(false);
      expect(looksLikeHardcodedSecret("{{your-token-here-placeholder}}")).toBe(false);
      expect(looksLikeHardcodedSecret("<your-api-key-placeholder>")).toBe(false);
      expect(looksLikeHardcodedSecret("replace-with-your-token")).toBe(false);
      expect(looksLikeHardcodedSecret("example-token-placeholder")).toBe(false);
    });

    it("should detect JWT tokens", () => {
      const jwt =
        "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
      expect(looksLikeHardcodedSecret(jwt)).toBe(true);
    });

    it("should detect AWS access keys", () => {
      // Pattern: /^AKIA[0-9A-Z]{16}$/ — exactly 4 + 16 = 20 chars
      expect(looksLikeHardcodedSecret("AKIAIOSFODNN7EXA0001")).toBe(true);
    });

    it("should detect GitHub PATs", () => {
      // Pattern: /^ghp_[A-Za-z0-9]{36}$/ — exactly 4 + 36 = 40 chars
      expect(looksLikeHardcodedSecret("ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef0123")).toBe(true);
    });

    it("should detect OpenAI/Stripe keys", () => {
      expect(looksLikeHardcodedSecret("sk-ABCDEFGHIJKLMNOPQRSTtest")).toBe(true);
    });

    it("should detect Slack tokens", () => {
      expect(looksLikeHardcodedSecret("xoxb-1234567890-abcdefghij")).toBe(true);
    });

    it("should return false for normal long strings", () => {
      expect(looksLikeHardcodedSecret("this is a normal long sentence that is not a secret")).toBe(
        false
      );
    });
  });

  describe("isSecretEnvVar()", () => {
    it("should detect token-related variable names", () => {
      expect(isSecretEnvVar("API_TOKEN")).toBe(true);
      expect(isSecretEnvVar("ACCESS_TOKEN")).toBe(true);
    });

    it("should detect password-related variable names", () => {
      expect(isSecretEnvVar("DB_PASSWORD")).toBe(true);
      expect(isSecretEnvVar("ADMIN_PASSWD")).toBe(true);
    });

    it("should detect secret-related variable names", () => {
      expect(isSecretEnvVar("CLIENT_SECRET")).toBe(true);
      expect(isSecretEnvVar("APP_SECRET_KEY")).toBe(true);
    });

    it("should detect API key variable names", () => {
      expect(isSecretEnvVar("API_KEY")).toBe(true);
      expect(isSecretEnvVar("APIKEY")).toBe(true);
    });

    it("should detect auth-related variable names", () => {
      expect(isSecretEnvVar("AUTH_HEADER")).toBe(true);
      expect(isSecretEnvVar("OAUTH_TOKEN")).toBe(true);
    });

    it("should detect credential variable names", () => {
      expect(isSecretEnvVar("DB_CREDENTIALS")).toBe(true);
      expect(isSecretEnvVar("CREDENTIAL")).toBe(true);
    });

    it("should detect private key variable names", () => {
      expect(isSecretEnvVar("PRIVATE_KEY")).toBe(true);
    });

    it("should return false for non-sensitive names", () => {
      expect(isSecretEnvVar("BASE_URL")).toBe(false);
      expect(isSecretEnvVar("TIMEOUT")).toBe(false);
      expect(isSecretEnvVar("LOG_LEVEL")).toBe(false);
      expect(isSecretEnvVar("PORT")).toBe(false);
    });
  });

  describe("auditConfigForSecrets()", () => {
    it("should return empty array for config with no secrets", () => {
      const config = { baseUrl: "https://api.example.com", timeout: 5000 };

      const findings = auditConfigForSecrets(config);

      expect(findings).toHaveLength(0);
    });

    it("should flag sensitive key with literal value", () => {
      const config = {
        api_token: "A1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6",
      };

      const findings = auditConfigForSecrets(config);

      expect(findings.length).toBeGreaterThanOrEqual(1);
      expect(findings[0].path).toBe("api_token");
      expect(findings[0].reason).toContain("sensitive data");
    });

    it("should skip sensitive key with variable reference", () => {
      const config = {
        api_token: "${API_TOKEN}",
      };

      const findings = auditConfigForSecrets(config);

      expect(findings).toHaveLength(0);
    });

    it("should flag known secret value patterns regardless of key name", () => {
      // JWT token matches SECRET_VALUE_PATTERNS and looksLikeHardcodedSecret
      const config = {
        someField:
          "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
      };

      const findings = auditConfigForSecrets(config);

      expect(findings.length).toBeGreaterThanOrEqual(1);
      expect(findings[0].reason).toContain("known secret pattern");
    });

    it("should recurse into nested objects", () => {
      const config = {
        services: {
          api: {
            password: "A1B2C3D4E5F6G7H8I9J0K1L2",
          },
        },
      };

      const findings = auditConfigForSecrets(config);

      expect(findings.length).toBeGreaterThanOrEqual(1);
      expect(findings[0].path).toBe("services.api.password");
    });

    it("should not recurse into arrays", () => {
      const config = {
        items: [1, 2, 3],
      };

      const findings = auditConfigForSecrets(config);

      expect(findings).toHaveLength(0);
    });

    it("should use basePath prefix in findings", () => {
      const config = { secret: "A1B2C3D4E5F6G7H8I9J0K1L2" };

      const findings = auditConfigForSecrets(config, "root.config");

      expect(findings[0].path).toBe("root.config.secret");
    });
  });

  describe("redactSensitiveFields()", () => {
    it("should redact fields with sensitive names", () => {
      const obj = {
        baseUrl: "https://api.example.com",
        api_token: "secret-value",
        password: "my-password",
      };

      const redacted = redactSensitiveFields(obj);

      expect(redacted.baseUrl).toBe("https://api.example.com");
      expect(redacted.api_token).toBe("****");
      expect(redacted.password).toBe("****");
    });

    it("should not mutate the original object", () => {
      const obj = { password: "secret" };
      const originalPassword = obj.password;

      redactSensitiveFields(obj);

      expect(obj.password).toBe(originalPassword);
    });

    it("should recurse into nested objects", () => {
      const obj = {
        config: {
          api: {
            token: "abc123",
            url: "https://api.test.com",
          },
        },
      };

      const redacted = redactSensitiveFields(obj);

      expect((redacted.config as Record<string, Record<string, unknown>>).api.token).toBe("****");
      expect((redacted.config as Record<string, Record<string, unknown>>).api.url).toBe(
        "https://api.test.com"
      );
    });

    it("should not recurse into arrays", () => {
      const obj = {
        items: [1, 2, 3],
        name: "test",
      };

      const redacted = redactSensitiveFields(obj);

      expect(redacted.items).toEqual([1, 2, 3]);
    });

    it("should handle empty objects", () => {
      expect(redactSensitiveFields({})).toEqual({});
    });

    it("should handle objects with only non-sensitive fields", () => {
      const obj = { url: "https://api.example.com", port: 8080 };

      const redacted = redactSensitiveFields(obj);

      expect(redacted).toEqual(obj);
    });
  });
});
