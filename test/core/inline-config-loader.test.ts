import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

import {
  processTestConfigEnv,
  downloadRemoteConfig,
  resolveInlineConfig,
  cleanupTempConfig,
  InlineConfigError,
} from "../../src/core/inline-config-loader";
import type { InlineConfigResult } from "../../src/core/inline-config-loader";

describe("inline-config-loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env["TEST_CONFIG"];
  });

  afterEach(() => {
    // Restore env
    delete process.env["TEST_CONFIG"];
  });

  describe("InlineConfigError", () => {
    it("should have the correct name", () => {
      const err = new InlineConfigError("test error");
      expect(err.name).toBe("InlineConfigError");
      expect(err.message).toBe("test error");
    });

    it("should store position if provided", () => {
      const err = new InlineConfigError("bad json", 42);
      expect(err.position).toBe(42);
    });

    it("should leave position undefined if not provided", () => {
      const err = new InlineConfigError("bad json");
      expect(err.position).toBeUndefined();
    });
  });

  describe("processTestConfigEnv()", () => {
    it("should return null when no TEST_CONFIG is set", () => {
      const result = processTestConfigEnv();
      expect(result).toBeNull();
    });

    it("should return null for empty string", () => {
      const result = processTestConfigEnv("");
      expect(result).toBeNull();
    });

    it("should return null for whitespace-only string", () => {
      const result = processTestConfigEnv("   ");
      expect(result).toBeNull();
    });

    it("should create a temp file from valid JSON config", () => {
      const config = JSON.stringify({ baseUrl: "https://api.test.com" });
      const result = processTestConfigEnv(config);

      expect(result).not.toBeNull();
      expect(result!.tempFile).toBe(true);
      expect(result!.source).toBe("env");
      expect(fs.existsSync(result!.configPath)).toBe(true);

      // Verify the content
      const content = JSON.parse(fs.readFileSync(result!.configPath, "utf-8"));
      expect(content.baseUrl).toBe("https://api.test.com");

      // Cleanup
      cleanupTempConfig(result);
    });

    it("should throw InlineConfigError for invalid JSON", () => {
      expect(() => processTestConfigEnv("{invalid}")).toThrow(InlineConfigError);
    });

    it("should include position info in JSON error when available", () => {
      try {
        processTestConfigEnv("{invalid json here}");
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(InlineConfigError);
        expect((err as InlineConfigError).message).toContain("invalid JSON");
      }
    });

    it("should throw for JSON array (not object)", () => {
      expect(() => processTestConfigEnv("[1, 2, 3]")).toThrow(InlineConfigError);
    });

    it("should throw for config without required content", () => {
      // Must have at least one of: test_cases, scenarios, baseUrl, thresholds
      expect(() => processTestConfigEnv('{"empty": true}')).toThrow(InlineConfigError);
    });

    it("should accept config with baseUrl", () => {
      const config = JSON.stringify({ baseUrl: "https://api.test.com" });
      const result = processTestConfigEnv(config);

      expect(result).not.toBeNull();
      cleanupTempConfig(result);
    });

    it("should accept config with scenarios", () => {
      const config = JSON.stringify({ scenarios: { default: { executor: "shared-iterations" } } });
      const result = processTestConfigEnv(config);

      expect(result).not.toBeNull();
      cleanupTempConfig(result);
    });

    it("should accept config with thresholds", () => {
      const config = JSON.stringify({ thresholds: { http_req_duration: ["p(95)<500"] } });
      const result = processTestConfigEnv(config);

      expect(result).not.toBeNull();
      cleanupTempConfig(result);
    });

    it("should accept config with test_cases", () => {
      const config = JSON.stringify({ test_cases: [{ name: "test1" }] });
      const result = processTestConfigEnv(config);

      expect(result).not.toBeNull();
      cleanupTempConfig(result);
    });

    it("should reject config with dangerous key names", () => {
      const config = '{"valid": true, "baseUrl": "https://test.com", "foo;bar": "value"}';
      expect(() => processTestConfigEnv(config)).toThrow(InlineConfigError);
    });

    it("should use process.env TEST_CONFIG when no argument provided", () => {
      process.env["TEST_CONFIG"] = JSON.stringify({ baseUrl: "https://from-env.com" });

      const result = processTestConfigEnv();

      expect(result).not.toBeNull();
      expect(result!.source).toBe("env");
      cleanupTempConfig(result);
    });
  });

  describe("downloadRemoteConfig()", () => {
    it("should throw for non-HTTPS URLs", () => {
      expect(() => downloadRemoteConfig("http://example.com/config.json")).toThrow(
        /must use HTTPS/
      );
    });

    // Note: actual HTTPS download tests are not practical in unit tests
    // without a real server or nock-style mocking. We test the validation logic.
  });

  describe("resolveInlineConfig()", () => {
    it("should return null when neither CLI flag nor env var is set", async () => {
      const result = await resolveInlineConfig();
      expect(result).toBeNull();
    });

    it("should use TEST_CONFIG env var when set and no CLI flag", async () => {
      process.env["TEST_CONFIG"] = JSON.stringify({ baseUrl: "https://env-test.com" });

      const result = await resolveInlineConfig();

      expect(result).not.toBeNull();
      expect(result!.source).toBe("env");
      cleanupTempConfig(result);
    });

    it("should use file path from CLI flag", async () => {
      const configFile = path.join(os.tmpdir(), "k6-inline-test-config.json");
      fs.writeFileSync(configFile, JSON.stringify({ baseUrl: "https://file.com" }));

      const result = await resolveInlineConfig(configFile);

      expect(result).not.toBeNull();
      expect(result!.source).toBe("file");
      expect(result!.tempFile).toBe(false);
      expect(result!.configPath).toBe(configFile);

      fs.unlinkSync(configFile);
    });

    it("should throw for non-existent CLI config file", async () => {
      await expect(resolveInlineConfig("/nonexistent/config.json")).rejects.toThrow(
        /Config file not found/
      );
    });

    it("should prefer CLI flag over TEST_CONFIG env var", async () => {
      process.env["TEST_CONFIG"] = JSON.stringify({ baseUrl: "https://env.com" });
      const configFile = path.join(os.tmpdir(), "k6-cli-priority-test.json");
      fs.writeFileSync(configFile, JSON.stringify({ baseUrl: "https://cli.com" }));

      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const result = await resolveInlineConfig(configFile);

      expect(result).not.toBeNull();
      expect(result!.source).toBe("file");
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("--config takes priority"));

      consoleSpy.mockRestore();
      fs.unlinkSync(configFile);
    });
  });

  describe("cleanupTempConfig()", () => {
    it("should delete temp file", () => {
      const tmpFile = path.join(os.tmpdir(), "k6-cleanup-test.json");
      fs.writeFileSync(tmpFile, "{}");

      const result: InlineConfigResult = {
        configPath: tmpFile,
        tempFile: true,
        source: "env",
      };

      cleanupTempConfig(result);

      expect(fs.existsSync(tmpFile)).toBe(false);
    });

    it("should not delete non-temp file", () => {
      const tmpFile = path.join(os.tmpdir(), "k6-nodelete-test.json");
      fs.writeFileSync(tmpFile, "{}");

      const result: InlineConfigResult = {
        configPath: tmpFile,
        tempFile: false,
        source: "file",
      };

      cleanupTempConfig(result);

      expect(fs.existsSync(tmpFile)).toBe(true);
      fs.unlinkSync(tmpFile);
    });

    it("should handle null result gracefully", () => {
      expect(() => cleanupTempConfig(null)).not.toThrow();
    });

    it("should handle already-deleted temp file gracefully", () => {
      const result: InlineConfigResult = {
        configPath: "/nonexistent/file.json",
        tempFile: true,
        source: "env",
      };

      expect(() => cleanupTempConfig(result)).not.toThrow();
    });
  });
});
