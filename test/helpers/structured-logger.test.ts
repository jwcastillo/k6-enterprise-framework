import { describe, it, expect, vi, beforeEach } from "vitest";
import { StructuredLogger } from "../../src/helpers/structured-logger";

// Mock the secrets-manager module
vi.mock("../../src/core/secrets-manager", () => ({
  maskSecret: vi.fn((value: string) => {
    if (!value || value.length <= 4) return "****";
    return value.slice(0, 2) + "****" + value.slice(-2);
  }),
}));

describe("StructuredLogger", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let _warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    _warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    // Enable structured logs by default for tests
    (globalThis as Record<string, unknown>).__ENV = {
      K6_STRUCTURED_LOGS: "true",
      K6_DEBUG: "false",
    };
  });

  // ── logRequest ────────────────────────────────────────────────────────────

  describe("logRequest", () => {
    it("logs an HTTP request as JSON", () => {
      const logger = new StructuredLogger();
      logger.logRequest("GET", "https://api.example.com/users", 200, 150);
      expect(logSpy).toHaveBeenCalledTimes(1);
      const entry = JSON.parse(logSpy.mock.calls[0][0]);
      expect(entry.level).toBe("info");
      expect(entry.method).toBe("GET");
      expect(entry.status).toBe(200);
      expect(entry.duration).toBe(150);
      expect(entry.url).toContain("api.example.com");
    });

    it("sanitizes sensitive query parameters in URL", () => {
      const logger = new StructuredLogger();
      logger.logRequest("GET", "https://api.example.com/auth?token=secret123&page=1", 200, 100);
      const entry = JSON.parse(logSpy.mock.calls[0][0]);
      expect(entry.url).not.toContain("secret123");
      expect(entry.url).toContain("token=****");
      expect(entry.url).toContain("page=1");
    });

    it("masks sensitive fields in extra data", () => {
      const logger = new StructuredLogger();
      logger.logRequest("POST", "https://api.example.com/login", 200, 100, {
        authorization: "Bearer supersecret",
        userId: "user123",
      });
      const entry = JSON.parse(logSpy.mock.calls[0][0]);
      expect(entry.authorization).not.toBe("Bearer supersecret");
      expect(entry.authorization).toContain("****");
      expect(entry.userId).toBe("user123");
    });

    it("does not log when K6_STRUCTURED_LOGS is not true", () => {
      (globalThis as Record<string, unknown>).__ENV = { K6_STRUCTURED_LOGS: "false" };
      const logger = new StructuredLogger();
      logger.logRequest("GET", "https://api.example.com", 200, 50);
      expect(logSpy).not.toHaveBeenCalled();
    });

    it("includes context from constructor", () => {
      const logger = new StructuredLogger({ service: "auth", env: "staging" });
      logger.logRequest("GET", "https://api.example.com", 200, 50);
      const entry = JSON.parse(logSpy.mock.calls[0][0]);
      expect(entry.service).toBe("auth");
      expect(entry.env).toBe("staging");
    });

    it("includes timestamp in ISO format", () => {
      const logger = new StructuredLogger();
      logger.logRequest("GET", "https://api.example.com", 200, 50);
      const entry = JSON.parse(logSpy.mock.calls[0][0]);
      expect(entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  // ── logEvent ──────────────────────────────────────────────────────────────

  describe("logEvent", () => {
    it("logs a named event with data", () => {
      const logger = new StructuredLogger();
      logger.logEvent("user_login", { userId: "u123" });
      expect(logSpy).toHaveBeenCalledTimes(1);
      const entry = JSON.parse(logSpy.mock.calls[0][0]);
      expect(entry.event).toBe("user_login");
      expect(entry.message).toBe("user_login");
      expect(entry.userId).toBe("u123");
    });

    it("masks sensitive data fields", () => {
      const logger = new StructuredLogger();
      logger.logEvent("auth_attempt", {
        password: "mysecretpass",
        username: "admin",
      });
      const entry = JSON.parse(logSpy.mock.calls[0][0]);
      expect(entry.password).toContain("****");
      expect(entry.username).toBe("admin");
    });

    it("does not log when structured logs disabled", () => {
      (globalThis as Record<string, unknown>).__ENV = { K6_STRUCTURED_LOGS: "false" };
      const logger = new StructuredLogger();
      logger.logEvent("test");
      expect(logSpy).not.toHaveBeenCalled();
    });
  });

  // ── logError ──────────────────────────────────────────────────────────────

  describe("logError", () => {
    it("logs error message to console.error", () => {
      const logger = new StructuredLogger();
      logger.logError("Connection failed", new Error("timeout"));
      expect(errorSpy).toHaveBeenCalledTimes(1);
      const entry = JSON.parse(errorSpy.mock.calls[0][0]);
      expect(entry.level).toBe("error");
      expect(entry.message).toBe("Connection failed");
      expect(entry.error).toBe("timeout");
    });

    it("handles non-Error objects", () => {
      const logger = new StructuredLogger();
      logger.logError("Failed", "string error");
      const entry = JSON.parse(errorSpy.mock.calls[0][0]);
      expect(entry.error).toBe("string error");
    });

    it("handles undefined error", () => {
      const logger = new StructuredLogger();
      logger.logError("Failed");
      const entry = JSON.parse(errorSpy.mock.calls[0][0]);
      expect(entry.error).toBe("");
    });

    it("masks sensitive extra fields", () => {
      const logger = new StructuredLogger();
      logger.logError("Auth failed", new Error("bad token"), {
        token: "my-secret-token",
      });
      const entry = JSON.parse(errorSpy.mock.calls[0][0]);
      expect(entry.token).toContain("****");
    });
  });

  // ── logDebug ──────────────────────────────────────────────────────────────

  describe("logDebug", () => {
    it("logs when both K6_STRUCTURED_LOGS and K6_DEBUG are true", () => {
      (globalThis as Record<string, unknown>).__ENV = {
        K6_STRUCTURED_LOGS: "true",
        K6_DEBUG: "true",
      };
      const logger = new StructuredLogger();
      logger.logDebug("Debug info", { detail: "test" });
      expect(logSpy).toHaveBeenCalledTimes(1);
      const entry = JSON.parse(logSpy.mock.calls[0][0]);
      expect(entry.level).toBe("debug");
      expect(entry.message).toBe("Debug info");
    });

    it("does not log when K6_DEBUG is false", () => {
      (globalThis as Record<string, unknown>).__ENV = {
        K6_STRUCTURED_LOGS: "true",
        K6_DEBUG: "false",
      };
      const logger = new StructuredLogger();
      logger.logDebug("Should not appear");
      expect(logSpy).not.toHaveBeenCalled();
    });

    it("does not log when K6_STRUCTURED_LOGS is false", () => {
      (globalThis as Record<string, unknown>).__ENV = {
        K6_STRUCTURED_LOGS: "false",
        K6_DEBUG: "true",
      };
      const logger = new StructuredLogger();
      logger.logDebug("Should not appear");
      expect(logSpy).not.toHaveBeenCalled();
    });
  });

  // ── logConfig ─────────────────────────────────────────────────────────────

  describe("logConfig", () => {
    it("logs configuration with label", () => {
      const logger = new StructuredLogger();
      logger.logConfig("database", { host: "localhost", port: 5432 });
      expect(logSpy).toHaveBeenCalledTimes(1);
      const entry = JSON.parse(logSpy.mock.calls[0][0]);
      expect(entry.message).toBe("Config: database");
      expect(entry.config).toEqual({ host: "localhost", port: 5432 });
    });

    it("masks sensitive configuration values", () => {
      const logger = new StructuredLogger();
      logger.logConfig("auth", {
        password: "db_password_value",
        host: "db.example.com",
      });
      const entry = JSON.parse(logSpy.mock.calls[0][0]);
      expect(entry.config.password).toContain("****");
      expect(entry.config.host).toBe("db.example.com");
    });

    it("masks nested sensitive values", () => {
      const logger = new StructuredLogger();
      logger.logConfig("service", {
        api: {
          token: "my-api-token",
          endpoint: "https://api.example.com",
        },
      });
      const entry = JSON.parse(logSpy.mock.calls[0][0]);
      expect(entry.config.api.token).toContain("****");
      expect(entry.config.api.endpoint).toBe("https://api.example.com");
    });
  });

  // ── child ─────────────────────────────────────────────────────────────────

  describe("child", () => {
    it("creates child logger with merged context", () => {
      const parent = new StructuredLogger({ service: "api" });
      const child = parent.child({ endpoint: "/users" });
      child.logEvent("test");
      const entry = JSON.parse(logSpy.mock.calls[0][0]);
      expect(entry.service).toBe("api");
      expect(entry.endpoint).toBe("/users");
    });

    it("child context overrides parent context", () => {
      const parent = new StructuredLogger({ env: "dev" });
      const child = parent.child({ env: "prod" });
      child.logEvent("test");
      const entry = JSON.parse(logSpy.mock.calls[0][0]);
      expect(entry.env).toBe("prod");
    });
  });

  // ── URL sanitization edge cases ───────────────────────────────────────────

  describe("URL sanitization", () => {
    it("handles malformed URLs gracefully", () => {
      const logger = new StructuredLogger();
      logger.logRequest("GET", "not-a-url", 200, 50);
      const entry = JSON.parse(logSpy.mock.calls[0][0]);
      expect(entry.url).toBe("not-a-url");
    });

    it("does not modify URLs without sensitive params", () => {
      const logger = new StructuredLogger();
      const url = "https://api.example.com/search?q=hello&page=1";
      logger.logRequest("GET", url, 200, 50);
      const entry = JSON.parse(logSpy.mock.calls[0][0]);
      expect(entry.url).toBe(url);
    });

    it("masks authorization and api-key query params", () => {
      const logger = new StructuredLogger();
      logger.logRequest("GET", "https://api.example.com/data?x-api-key=secret&limit=10", 200, 50);
      const entry = JSON.parse(logSpy.mock.calls[0][0]);
      expect(entry.url).not.toContain("secret");
      expect(entry.url).toContain("x-api-key=****");
    });
  });
});
