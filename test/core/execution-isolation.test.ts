import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type { ClientContext } from "../../src/types/client.d";

// Mock client-resolver (used by buildIsolatedContext)
vi.mock("../../src/core/client-resolver", () => ({
  resolveClient: vi.fn(),
}));

import {
  buildIsolatedEnv,
  createIsolatedTempDir,
  cleanupIsolatedTempDir,
  buildIsolatedTags,
  sanitizeErrorForClient,
  validateReportPath,
} from "../../src/core/execution-isolation";

function makeClientContext(overrides: Partial<ClientContext> = {}): ClientContext {
  return {
    clientId: "test-client",
    rootDir: "/framework/clients/test-client",
    configDir: "/framework/clients/test-client/config",
    dataDir: "/framework/clients/test-client/data",
    libDir: "/framework/clients/test-client/lib",
    scenariosDir: "/framework/clients/test-client/scenarios",
    reportsDir: "/framework/reports/test-client",
    envFile: path.join(os.tmpdir(), "k6-exec-iso-test-env"),
    mocksDir: "/framework/clients/test-client/mocks",
    brandingDir: "/framework/clients/test-client/branding",
    isSubmodule: false,
    isSymlink: false,
    ...overrides,
  };
}

describe("execution-isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("buildIsolatedEnv()", () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
      // Reset env
      for (const key of Object.keys(process.env)) {
        if (key.startsWith("K6_")) {
          delete process.env[key];
        }
      }
    });

    afterAll(() => {
      process.env = originalEnv;
    });

    it("should include system essential vars from process.env", () => {
      process.env["PATH"] = "/usr/bin";
      process.env["HOME"] = "/home/user";

      const ctx = makeClientContext();
      const env = buildIsolatedEnv(ctx);

      expect(env["PATH"]).toBe("/usr/bin");
      expect(env["HOME"]).toBe("/home/user");
    });

    it("should include K6 framework vars from process.env", () => {
      process.env["K6_PROFILE"] = "load";
      process.env["K6_DEBUG"] = "true";

      const ctx = makeClientContext();
      const env = buildIsolatedEnv(ctx);

      expect(env["K6_PROFILE"]).toBe("load");
      expect(env["K6_DEBUG"]).toBe("true");
    });

    it("should set client-specific identifiers", () => {
      const ctx = makeClientContext({ clientId: "acme" });
      const env = buildIsolatedEnv(ctx);

      expect(env["K6_CLIENT"]).toBe("acme");
      expect(env["K6_CLIENT_ROOT"]).toBe(ctx.rootDir);
      expect(env["K6_CLIENT_CONFIG_DIR"]).toBe(ctx.configDir);
      expect(env["K6_CLIENT_DATA_DIR"]).toBe(ctx.dataDir);
      expect(env["K6_CLIENT_REPORTS_DIR"]).toBe(ctx.reportsDir);
    });

    it("should merge additional env vars with highest priority", () => {
      const ctx = makeClientContext();
      const env = buildIsolatedEnv(ctx, { CUSTOM_VAR: "custom_value" });

      expect(env["CUSTOM_VAR"]).toBe("custom_value");
    });

    it("should allow additional env to override framework vars", () => {
      process.env["K6_PROFILE"] = "smoke";
      const ctx = makeClientContext();
      const env = buildIsolatedEnv(ctx, { K6_PROFILE: "stress" });

      expect(env["K6_PROFILE"]).toBe("stress");
    });

    it("should include K6_SECRET_ prefixed vars", () => {
      process.env["K6_SECRET_API_KEY"] = "secret123";

      const ctx = makeClientContext();
      const env = buildIsolatedEnv(ctx);

      expect(env["K6_SECRET_API_KEY"]).toBe("secret123");

      delete process.env["K6_SECRET_API_KEY"];
    });

    it("should load client .env file when it exists", () => {
      const envFilePath = path.join(os.tmpdir(), "k6-exec-iso-env-test");
      fs.writeFileSync(envFilePath, "MY_VAR=hello\nANOTHER=world\n");

      const ctx = makeClientContext({ envFile: envFilePath });
      const env = buildIsolatedEnv(ctx);

      expect(env["MY_VAR"]).toBe("hello");
      expect(env["ANOTHER"]).toBe("world");

      fs.unlinkSync(envFilePath);
    });

    it("should handle .env file with comments and empty lines", () => {
      const envFilePath = path.join(os.tmpdir(), "k6-exec-iso-env-comments");
      fs.writeFileSync(envFilePath, "# Comment\n\nKEY1=value1\n# Another comment\nKEY2=value2\n");

      const ctx = makeClientContext({ envFile: envFilePath });
      const env = buildIsolatedEnv(ctx);

      expect(env["KEY1"]).toBe("value1");
      expect(env["KEY2"]).toBe("value2");

      fs.unlinkSync(envFilePath);
    });

    it("should strip surrounding quotes from .env values", () => {
      const envFilePath = path.join(os.tmpdir(), "k6-exec-iso-env-quotes");
      fs.writeFileSync(envFilePath, "QUOTED=\"hello world\"\nSINGLE='test value'\n");

      const ctx = makeClientContext({ envFile: envFilePath });
      const env = buildIsolatedEnv(ctx);

      expect(env["QUOTED"]).toBe("hello world");
      expect(env["SINGLE"]).toBe("test value");

      fs.unlinkSync(envFilePath);
    });

    it("should handle missing .env file gracefully", () => {
      const ctx = makeClientContext({ envFile: "/nonexistent/.env" });

      expect(() => buildIsolatedEnv(ctx)).not.toThrow();
    });

    it("should not include arbitrary process.env vars", () => {
      process.env["RANDOM_VAR_NOT_ALLOWED"] = "should_not_appear";

      const ctx = makeClientContext();
      const env = buildIsolatedEnv(ctx);

      expect(env["RANDOM_VAR_NOT_ALLOWED"]).toBeUndefined();

      delete process.env["RANDOM_VAR_NOT_ALLOWED"];
    });
  });

  describe("createIsolatedTempDir()", () => {
    it("should create a temp directory with client prefix", () => {
      const ctx = makeClientContext({ clientId: "myapp" });
      const tmpDir = createIsolatedTempDir(ctx);

      expect(fs.existsSync(tmpDir)).toBe(true);
      expect(path.basename(tmpDir)).toContain("k6-myapp-");

      fs.rmSync(tmpDir, { recursive: true, force: true });
    });
  });

  describe("cleanupIsolatedTempDir()", () => {
    it("should remove the temp directory", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "k6-cleanup-test-"));
      fs.writeFileSync(path.join(tmpDir, "test.txt"), "data");

      cleanupIsolatedTempDir(tmpDir);

      expect(fs.existsSync(tmpDir)).toBe(false);
    });

    it("should not throw for non-existent directory", () => {
      expect(() => cleanupIsolatedTempDir("/nonexistent/dir")).not.toThrow();
    });
  });

  describe("buildIsolatedTags()", () => {
    it("should return standard metric tags", () => {
      const ctx = makeClientContext({ clientId: "acme" });
      const tags = buildIsolatedTags(ctx, "staging", "load", "login-test");

      expect(tags.client).toBe("acme");
      expect(tags.environment).toBe("staging");
      expect(tags.profile).toBe("load");
      expect(tags.test_name).toBe("login-test");
      expect(tags.test_timestamp).toBeDefined();
    });

    it("should include an ISO timestamp", () => {
      const ctx = makeClientContext();
      const tags = buildIsolatedTags(ctx, "prod", "smoke", "health");

      // Verify it's a valid ISO date
      expect(new Date(tags.test_timestamp).toISOString()).toBe(tags.test_timestamp);
    });
  });

  describe("sanitizeErrorForClient()", () => {
    it("should keep references to the active client", () => {
      const msg = "Error in clients/my-client/config/file.json";
      const sanitized = sanitizeErrorForClient(msg, "my-client");

      expect(sanitized).toContain("clients/my-client");
    });

    it("should redact references to other clients", () => {
      const msg = "Error loading clients/other-client/secrets.json";
      const sanitized = sanitizeErrorForClient(msg, "my-client");

      expect(sanitized).toContain("clients/[REDACTED]");
      expect(sanitized).not.toContain("other-client");
    });

    it("should strip absolute framework paths", () => {
      const msg = "Error at /home/user/k6-framework/src/core/module.ts";
      const sanitized = sanitizeErrorForClient(msg, "my-client");

      expect(sanitized).toContain("k6-framework/");
      expect(sanitized).not.toContain("/home/user");
    });

    it("should handle Error objects", () => {
      const err = new Error("Failed at clients/secret-client/data");
      const sanitized = sanitizeErrorForClient(err, "my-client");

      expect(sanitized).toContain("[REDACTED]");
    });

    it("should handle string errors", () => {
      const sanitized = sanitizeErrorForClient("plain error message", "my-client");

      expect(sanitized).toBe("plain error message");
    });
  });

  describe("validateReportPath()", () => {
    it("should not throw for valid report paths within client namespace", () => {
      const ctx = makeClientContext({ clientId: "acme" });
      const frameworkRoot = "/framework";
      const reportPath = path.join(frameworkRoot, "reports", "acme", "test", "report.html");

      expect(() => validateReportPath(reportPath, ctx, frameworkRoot)).not.toThrow();
    });

    it("should throw for paths outside client report namespace", () => {
      const ctx = makeClientContext({ clientId: "acme" });
      const frameworkRoot = "/framework";
      const reportPath = path.join(frameworkRoot, "reports", "other-client", "report.html");

      expect(() => validateReportPath(reportPath, ctx, frameworkRoot)).toThrow(
        /resolves outside the namespace/
      );
    });

    it("should throw for path traversal attempts", () => {
      const ctx = makeClientContext({ clientId: "acme" });
      const frameworkRoot = "/framework";
      const reportPath = path.join(frameworkRoot, "reports", "acme", "..", "other", "file.txt");

      expect(() => validateReportPath(reportPath, ctx, frameworkRoot)).toThrow(
        /resolves outside the namespace/
      );
    });
  });
});
