import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  ConfigValidator,
  detectFormat,
  jsonToYaml,
  yamlToJson,
  generateExampleConfig,
  CONFIG_SCHEMA,
} from "../../src/core/config-validator";

describe("ConfigValidator", () => {
  let validator: ConfigValidator;

  beforeEach(() => {
    vi.clearAllMocks();
    validator = new ConfigValidator();
  });

  // ── CONFIG_SCHEMA ──────────────────────────────────────────────────────

  describe("CONFIG_SCHEMA", () => {
    it("should export the JSON Schema", () => {
      expect(CONFIG_SCHEMA).toBeDefined();
      expect(CONFIG_SCHEMA.type).toBe("object");
      expect(CONFIG_SCHEMA.required).toContain("client");
    });
  });

  // ── validate() ──────────────────────────────────────────────────────────

  describe("validate()", () => {
    it("should validate a minimal valid config", () => {
      const result = validator.validate({ client: "my-team" });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should validate a full valid config", () => {
      const result = validator.validate({
        client: "my-team",
        version: "1.0.0",
        environment: "staging",
        baseUrl: "https://api.example.com",
        endpoints: {
          api: { baseUrl: "https://api.example.com", timeout: "30s" },
        },
        auth: { type: "bearer", tokenEnvVar: "TOKEN" },
        thresholds: {
          http_req_duration: ["p(95)<500"],
        },
        scenarios: {
          default: {
            executor: "ramping-vus",
            stages: [{ duration: "1m", target: 10 }],
          },
        },
        retries: { enabled: true, maxRetries: 3, retryOn: [429, 503], backoffMs: 500 },
        tags: { team: "platform" },
      });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should reject config without required 'client' field", () => {
      const result = validator.validate({});
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].path).toContain("client");
    });

    it("should reject invalid client pattern", () => {
      const result = validator.validate({ client: "has spaces" });
      expect(result.valid).toBe(false);
      expect(result.errors[0].message).toContain("pattern");
    });

    it("should reject invalid environment value", () => {
      const result = validator.validate({
        client: "team",
        environment: "invalid-env",
      });
      expect(result.valid).toBe(false);
      expect(result.errors[0].message).toContain("expected one of");
    });

    it("should reject invalid version format", () => {
      const result = validator.validate({
        client: "team",
        version: "not-semver",
      });
      expect(result.valid).toBe(false);
      expect(result.errors[0].message).toContain("pattern");
    });

    it("should reject invalid executor in scenarios", () => {
      const result = validator.validate({
        client: "team",
        scenarios: {
          default: { executor: "invalid-executor" },
        },
      });
      expect(result.valid).toBe(false);
      expect(result.errors[0].message).toContain("expected one of");
    });

    it("should reject invalid auth type", () => {
      const result = validator.validate({
        client: "team",
        auth: { type: "oauth2" },
      });
      expect(result.valid).toBe(false);
    });

    it("should reject invalid duration format in scenarios", () => {
      const result = validator.validate({
        client: "team",
        scenarios: {
          default: {
            executor: "constant-vus",
            duration: "invalid",
          },
        },
      });
      expect(result.valid).toBe(false);
    });

    it("should reject additional properties at root level", () => {
      const result = validator.validate({
        client: "team",
        unknownField: "value",
      });
      expect(result.valid).toBe(false);
      expect(result.errors[0].message).toContain("unexpected additional property");
    });

    it("should reject retries with maxRetries > 10", () => {
      const result = validator.validate({
        client: "team",
        retries: { maxRetries: 11 },
      });
      expect(result.valid).toBe(false);
    });

    it("should reject retries with additional properties", () => {
      const result = validator.validate({
        client: "team",
        retries: { enabled: true, unknownProp: true },
      });
      expect(result.valid).toBe(false);
    });

    it("should accept valid baseUrl format", () => {
      const result = validator.validate({
        client: "team",
        baseUrl: "https://api.example.com",
      });
      expect(result.valid).toBe(true);
    });

    it("should reject invalid baseUrl format", () => {
      const result = validator.validate({
        client: "team",
        baseUrl: "not-a-url",
      });
      expect(result.valid).toBe(false);
      expect(result.errors[0].message).toContain("format");
    });

    // ── Environment variable resolution ────────────────────────────────

    it("should resolve ${VAR} references from process.env", () => {
      const originalEnv = process.env.TEST_BASE_URL;
      process.env.TEST_BASE_URL = "https://resolved.example.com";

      try {
        const result = validator.validate({
          client: "team",
          baseUrl: "${TEST_BASE_URL}",
        });
        expect(result.valid).toBe(true);
      } finally {
        if (originalEnv === undefined) {
          delete process.env.TEST_BASE_URL;
        } else {
          process.env.TEST_BASE_URL = originalEnv;
        }
      }
    });

    it("should report missing environment variables", () => {
      delete process.env.NONEXISTENT_VAR;

      const result = validator.validate({
        client: "team",
        baseUrl: "${NONEXISTENT_VAR}",
      });
      expect(result.valid).toBe(false);
      expect(result.missingVars).toContain("NONEXISTENT_VAR");
      expect(result.errors[0].message).toContain("Missing environment variables");
    });

    it("should report multiple missing variables", () => {
      delete process.env.MISSING_A;
      delete process.env.MISSING_B;

      const result = validator.validate({
        client: "${MISSING_A}",
        baseUrl: "${MISSING_B}",
      });
      expect(result.valid).toBe(false);
      expect(result.missingVars).toContain("MISSING_A");
      expect(result.missingVars).toContain("MISSING_B");
    });

    it("should handle nested env var resolution in arrays", () => {
      const originalEnv = process.env.THRESHOLD_VAL;
      process.env.THRESHOLD_VAL = "p(95)<500";

      try {
        const result = validator.validate({
          client: "team",
          thresholds: {
            http_req_duration: ["${THRESHOLD_VAL}"],
          },
        });
        expect(result.valid).toBe(true);
      } finally {
        if (originalEnv === undefined) {
          delete process.env.THRESHOLD_VAL;
        } else {
          process.env.THRESHOLD_VAL = originalEnv;
        }
      }
    });
  });

  // ── validateString() ──────────────────────────────────────────────────

  describe("validateString()", () => {
    it("should validate a valid JSON string", () => {
      const json = JSON.stringify({ client: "my-team" });
      const result = validator.validateString(json);
      expect(result.valid).toBe(true);
    });

    it("should validate a valid YAML string", () => {
      const yaml = "client: my-team\n";
      const result = validator.validateString(yaml);
      expect(result.valid).toBe(true);
    });

    it("should auto-detect JSON format", () => {
      const json = '{"client": "team"}';
      const result = validator.validateString(json);
      expect(result.valid).toBe(true);
    });

    it("should auto-detect YAML format", () => {
      const yaml = "client: team\nversion: '1.0.0'\n";
      const result = validator.validateString(yaml);
      expect(result.valid).toBe(true);
    });

    it("should return parse error for invalid JSON", () => {
      const result = validator.validateString("{invalid json}", "json");
      expect(result.valid).toBe(false);
      expect(result.errors[0].message).toContain("Parse error");
    });

    it("should return parse error for invalid YAML", () => {
      const invalidYaml = ":\n  :\n    : invalid\n  bad: \t\t[unclosed";
      const result = validator.validateString(invalidYaml, "yaml");
      expect(result.valid).toBe(false);
      expect(result.errors[0].message).toContain("Parse error");
    });

    it("should accept hint to force format detection", () => {
      const yaml = "client: team\n";
      const result = validator.validateString(yaml, "yaml");
      expect(result.valid).toBe(true);
    });

    it("should reject invalid config from parsed string", () => {
      const json = JSON.stringify({ client: "has spaces in name" });
      const result = validator.validateString(json);
      expect(result.valid).toBe(false);
    });
  });

  // ── validateFile() ────────────────────────────────────────────────────

  describe("validateFile()", () => {
    it("should return error when file does not exist", () => {
      const result = validator.validateFile("/nonexistent/config.json");
      expect(result.valid).toBe(false);
      expect(result.errors[0].message).toContain("Cannot read file");
    });

    it("should validate a valid JSON file", () => {
      const fs = require("fs");
      const originalReadFileSync = fs.readFileSync;

      const content = JSON.stringify({ client: "my-team" });
      fs.readFileSync = vi.fn(() => content);

      try {
        const result = validator.validateFile("/some/config.json");
        expect(result.valid).toBe(true);
      } finally {
        fs.readFileSync = originalReadFileSync;
      }
    });

    it("should validate a valid YAML file", () => {
      const fs = require("fs");
      const originalReadFileSync = fs.readFileSync;

      fs.readFileSync = vi.fn(() => "client: my-team\n");

      try {
        const result = validator.validateFile("/some/config.yaml");
        expect(result.valid).toBe(true);
      } finally {
        fs.readFileSync = originalReadFileSync;
      }
    });
  });

  // ── detectFormat() ────────────────────────────────────────────────────

  describe("detectFormat()", () => {
    it("should detect JSON starting with {", () => {
      expect(detectFormat('{"key": "value"}')).toBe("json");
    });

    it("should detect JSON starting with [", () => {
      expect(detectFormat("[1, 2, 3]")).toBe("json");
    });

    it("should detect YAML for non-JSON content", () => {
      expect(detectFormat("key: value")).toBe("yaml");
    });

    it("should handle leading whitespace before JSON", () => {
      expect(detectFormat('  \n  {"key": "value"}')).toBe("json");
    });

    it("should handle leading whitespace before YAML", () => {
      expect(detectFormat("  \n  key: value")).toBe("yaml");
    });

    it("should detect YAML for comment-prefixed content", () => {
      expect(detectFormat("# Comment\nkey: value")).toBe("yaml");
    });
  });

  // ── jsonToYaml() ──────────────────────────────────────────────────────

  describe("jsonToYaml()", () => {
    it("should convert JSON to YAML", () => {
      const json = JSON.stringify({ client: "team", version: "1.0.0" });
      const yaml = jsonToYaml(json);
      expect(yaml).toContain("client: team");
      expect(yaml).toContain("version:");
      expect(yaml).toContain("1.0.0");
    });

    it("should handle nested objects", () => {
      const json = JSON.stringify({
        endpoints: { api: { baseUrl: "https://api.example.com" } },
      });
      const yaml = jsonToYaml(json);
      expect(yaml).toContain("endpoints:");
      expect(yaml).toContain("api:");
      expect(yaml).toContain("baseUrl:");
    });

    it("should throw for invalid JSON input", () => {
      expect(() => jsonToYaml("not json")).toThrow();
    });
  });

  // ── yamlToJson() ──────────────────────────────────────────────────────

  describe("yamlToJson()", () => {
    it("should convert YAML to JSON", () => {
      const yaml = "client: team\nversion: '1.0.0'\n";
      const json = yamlToJson(yaml);
      const parsed = JSON.parse(json);
      expect(parsed.client).toBe("team");
      expect(parsed.version).toBe("1.0.0");
    });

    it("should produce pretty JSON by default", () => {
      const json = yamlToJson("key: value\n");
      expect(json).toContain("\n"); // Pretty-printed has newlines
    });

    it("should produce compact JSON when pretty=false", () => {
      const json = yamlToJson("key: value\n", false);
      expect(json).toBe('{"key":"value"}');
    });

    it("should handle nested YAML", () => {
      const yaml = "parent:\n  child: value\n";
      const json = yamlToJson(yaml);
      const parsed = JSON.parse(json);
      expect(parsed.parent.child).toBe("value");
    });
  });

  // ── generateExampleConfig() ───────────────────────────────────────────

  describe("generateExampleConfig()", () => {
    it("should generate YAML format by default", () => {
      const config = generateExampleConfig();
      expect(config).toContain("client: my-team");
      expect(config).toContain("# k6 Enterprise Framework");
    });

    it("should generate JSON format when requested", () => {
      const config = generateExampleConfig("json");
      const parsed = JSON.parse(config);
      expect(parsed.client).toBe("my-team");
      expect(parsed.version).toBe("1.0.0");
    });

    it("should generate a valid config (JSON format)", () => {
      const config = generateExampleConfig("json");
      const parsed = JSON.parse(config);
      const result = validator.validate(parsed);
      expect(result.valid).toBe(true);
    });

    it("should generate a valid config (YAML format)", () => {
      const config = generateExampleConfig("yaml");
      // Strip comment lines for validation
      const result = validator.validateString(config, "yaml");
      expect(result.valid).toBe(true);
    });

    it("should include example scenarios", () => {
      const config = generateExampleConfig("json");
      const parsed = JSON.parse(config);
      expect(parsed.scenarios).toBeDefined();
      expect(parsed.scenarios.default).toBeDefined();
      expect(parsed.scenarios.default.executor).toBe("ramping-vus");
    });

    it("should include example thresholds", () => {
      const config = generateExampleConfig("json");
      const parsed = JSON.parse(config);
      expect(parsed.thresholds).toBeDefined();
      expect(parsed.thresholds.http_req_duration).toBeDefined();
    });

    it("should include example auth config", () => {
      const config = generateExampleConfig("json");
      const parsed = JSON.parse(config);
      expect(parsed.auth).toBeDefined();
      expect(parsed.auth.type).toBe("bearer");
    });

    it("should include YAML header comments", () => {
      const config = generateExampleConfig("yaml");
      expect(config).toContain("# Run:");
      expect(config).toContain("# Docs:");
      expect(config).toContain("# Environment variables");
    });
  });
});
