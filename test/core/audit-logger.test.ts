import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ClientContext } from "../../src/types/client.d";
import fs from "fs";
import path from "path";
import crypto from "crypto";

// ── Helpers ────────────────────────────────────────────────────────────────

function createClientContext(overrides: Partial<ClientContext> = {}): ClientContext {
  return {
    clientId: "test-client",
    rootDir: "/clients/test-client",
    configDir: "/clients/test-client/config",
    dataDir: "/clients/test-client/data",
    libDir: "/clients/test-client/lib",
    scenariosDir: "/clients/test-client/scenarios",
    reportsDir: "/reports/test-client",
    envFile: "/clients/test-client/.env",
    mocksDir: "/clients/test-client/mocks",
    brandingDir: "/clients/test-client/branding",
    isSubmodule: false,
    isSymlink: false,
    ...overrides,
  };
}

describe("AuditLogger", () => {
  const ctx = createClientContext();

  // Spies for fs, path, crypto
  let existsSyncSpy: ReturnType<typeof vi.spyOn>;
  let mkdirSyncSpy: ReturnType<typeof vi.spyOn>;
  let readFileSyncSpy: ReturnType<typeof vi.spyOn>;
  let appendFileSyncSpy: ReturnType<typeof vi.spyOn>;
  let readdirSyncSpy: ReturnType<typeof vi.spyOn>;
  let _pathJoinSpy: ReturnType<typeof vi.spyOn>;
  let _createHashSpy: ReturnType<typeof vi.spyOn>;

  // We need to import the module fresh each test. For now, we'll import once
  // and use resetAuditLogger to reset state.
  let auditModule: typeof import("../../src/core/audit-logger");

  beforeEach(async () => {
    // Setup spies on the real modules (which the source code captures via require)
    existsSyncSpy = vi.spyOn(fs, "existsSync").mockReturnValue(false);
    mkdirSyncSpy = vi.spyOn(fs, "mkdirSync").mockReturnValue(undefined);
    readFileSyncSpy = vi.spyOn(fs, "readFileSync").mockReturnValue("");
    appendFileSyncSpy = vi.spyOn(fs, "appendFileSync").mockReturnValue(undefined);
    readdirSyncSpy = vi.spyOn(fs, "readdirSync").mockReturnValue([] as unknown as fs.Dirent[]);
    _pathJoinSpy = vi.spyOn(path, "join").mockImplementation((...args: string[]) => args.join("/"));

    const mockDigest = vi.fn(
      () => "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890"
    );
    const mockUpdate = vi.fn().mockReturnValue({ digest: mockDigest });
    _createHashSpy = vi.spyOn(crypto, "createHash").mockReturnValue({
      update: mockUpdate,
      digest: mockDigest,
    } as unknown as crypto.Hash);

    // Import module (cached after first import; resetAuditLogger handles state)
    auditModule = await import("../../src/core/audit-logger");
    auditModule.resetAuditLogger();

    // Reset process.env for actor resolution
    delete process.env.K6_AUDIT_USER;
    delete process.env.K6_USER;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── resolveActor ────────────────────────────────────────────────────────

  describe("resolveActor()", () => {
    it("should prioritize K6_AUDIT_USER", () => {
      process.env.K6_AUDIT_USER = "audit-user";
      process.env.K6_USER = "k6-user";
      expect(auditModule.resolveActor()).toBe("audit-user");
    });

    it("should fall back to K6_USER", () => {
      delete process.env.K6_AUDIT_USER;
      process.env.K6_USER = "k6-user";
      expect(auditModule.resolveActor()).toBe("k6-user");
    });

    it("should fall back to $USER", () => {
      delete process.env.K6_AUDIT_USER;
      delete process.env.K6_USER;
      if (process.env.USER) {
        expect(auditModule.resolveActor()).toBe(process.env.USER);
      }
    });

    it("should return 'unknown' when no user env vars are set", () => {
      const savedUser = process.env.USER;
      delete process.env.K6_AUDIT_USER;
      delete process.env.K6_USER;
      delete process.env.USER;
      expect(auditModule.resolveActor()).toBe("unknown");
      if (savedUser !== undefined) {
        process.env.USER = savedUser;
      }
    });

    it("sanitizes invalid characters in K6_AUDIT_USER", () => {
      process.env.K6_AUDIT_USER = "evil$user;DROP\nTABLE";
      const result = auditModule.resolveActor();
      expect(result).toMatch(/^[a-zA-Z0-9_.@-]+$/);
      expect(result).not.toContain("$");
      expect(result).not.toContain(";");
      expect(result).not.toContain("\n");
    });

    it("emits console.warn when sanitization alters input", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      process.env.K6_AUDIT_USER = "evil$user;DROP\nTABLE";
      auditModule.resolveActor();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/sanitized/i));
      warnSpy.mockRestore();
    });

    it("does not warn on clean input", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      process.env.K6_AUDIT_USER = "alice.smith@example.com";
      auditModule.resolveActor();
      expect(warnSpy).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it("truncates to 256 characters", () => {
      process.env.K6_AUDIT_USER = "x".repeat(300);
      const result = auditModule.resolveActor();
      expect(result.length).toBe(256);
    });

    it("returns 'unknown' when sanitization strips all characters", () => {
      process.env.K6_AUDIT_USER = "!!!";
      expect(auditModule.resolveActor()).toBe("unknown");
    });

    it("preserves dots, underscores, hyphens, at-signs", () => {
      process.env.K6_AUDIT_USER = "a.b_c-d@e";
      expect(auditModule.resolveActor()).toBe("a.b_c-d@e");
    });
  });

  // ── initAuditLogger ─────────────────────────────────────────────────────

  describe("initAuditLogger()", () => {
    it("should create audit directory if it does not exist", () => {
      existsSyncSpy.mockReturnValue(false);

      auditModule.initAuditLogger(ctx);

      expect(mkdirSyncSpy).toHaveBeenCalledWith(
        expect.stringContaining("audit"),
        expect.objectContaining({ recursive: true })
      );
    });

    it("should not create directory if it already exists", () => {
      existsSyncSpy.mockImplementation((p: unknown) => {
        const pathStr = p as string;
        if (pathStr.endsWith("audit")) return true;
        return false;
      });

      auditModule.initAuditLogger(ctx);

      expect(mkdirSyncSpy).not.toHaveBeenCalled();
    });

    it("should read last hash from existing audit file", () => {
      const existingEntry = {
        timestamp: "2026-01-01T00:00:00.000Z",
        event: "execution_start",
        actor: "user",
        client: "test-client",
        result: "success",
        hash: "existing_hash_value",
        previousHash: "0".repeat(64),
      };

      existsSyncSpy.mockReturnValue(true);
      readFileSyncSpy.mockReturnValue(JSON.stringify(existingEntry));

      auditModule.initAuditLogger(ctx);

      expect(readFileSyncSpy).toHaveBeenCalled();
    });

    it("should handle corrupted last line gracefully", () => {
      existsSyncSpy.mockReturnValue(true);
      readFileSyncSpy.mockReturnValue("not valid json");

      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      auditModule.initAuditLogger(ctx);

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("corrupted"));
      warnSpy.mockRestore();
    });

    it("should use genesis hash for empty existing file", () => {
      existsSyncSpy.mockReturnValue(true);
      readFileSyncSpy.mockReturnValue("");

      expect(() => auditModule.initAuditLogger(ctx)).not.toThrow();
    });
  });

  // ── writeAuditEntry ─────────────────────────────────────────────────────

  describe("writeAuditEntry()", () => {
    it("should write an entry to the audit file", () => {
      existsSyncSpy.mockReturnValue(false);

      const entry = auditModule.writeAuditEntry(ctx, "execution_start", "success", { test: true });

      expect(appendFileSyncSpy).toHaveBeenCalled();
      expect(entry.event).toBe("execution_start");
      expect(entry.result).toBe("success");
      expect(entry.client).toBe("test-client");
      expect(entry.hash).toBeDefined();
      expect(entry.previousHash).toBeDefined();
      expect(entry.timestamp).toBeDefined();
    });

    it("should initialize logger if not already initialized", () => {
      existsSyncSpy.mockReturnValue(false);

      auditModule.writeAuditEntry(ctx, "execution_start", "success");

      expect(mkdirSyncSpy).toHaveBeenCalled();
    });

    it("should include extras in the entry", () => {
      existsSyncSpy.mockReturnValue(false);

      const entry = auditModule.writeAuditEntry(
        ctx,
        "execution_end",
        "success",
        { testName: "my-test" },
        {
          service: "api",
          environment: "staging",
          profile: "smoke",
          message: "Test passed",
          durationMs: 5000,
        }
      );

      expect(entry.service).toBe("api");
      expect(entry.environment).toBe("staging");
      expect(entry.profile).toBe("smoke");
      expect(entry.message).toBe("Test passed");
      expect(entry.durationMs).toBe(5000);
    });

    it("should include params in the entry", () => {
      existsSyncSpy.mockReturnValue(false);

      const entry = auditModule.writeAuditEntry(ctx, "config_change", "success", {
        field: "thresholds",
        oldValue: "500",
        newValue: "1000",
      });

      expect(entry.params).toEqual({
        field: "thresholds",
        oldValue: "500",
        newValue: "1000",
      });
    });

    it("should continue gracefully when appendFileSync fails", () => {
      existsSyncSpy.mockReturnValue(false);
      appendFileSyncSpy.mockImplementation(() => {
        throw new Error("disk full");
      });

      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const entry = auditModule.writeAuditEntry(ctx, "execution_start", "success");

      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Failed to write audit entry"));
      expect(entry).toBeDefined();
      errorSpy.mockRestore();
    });

    it("should write JSON line terminated with newline", () => {
      existsSyncSpy.mockReturnValue(false);

      auditModule.writeAuditEntry(ctx, "execution_start", "success");

      const writtenData = appendFileSyncSpy.mock.calls[0]?.[1] as string;
      expect(writtenData).toBeDefined();
      expect(writtenData.endsWith("\n")).toBe(true);
      expect(() => JSON.parse(writtenData.trim())).not.toThrow();
    });
  });

  // ── Convenience loggers ─────────────────────────────────────────────────

  describe("logExecutionStart()", () => {
    it("should log an execution_start event", () => {
      existsSyncSpy.mockReturnValue(false);

      const entry = auditModule.logExecutionStart(
        ctx,
        "api-service",
        "staging",
        "smoke",
        "login-test"
      );

      expect(entry.event).toBe("execution_start");
      expect(entry.result).toBe("success");
      expect(entry.service).toBe("api-service");
      expect(entry.environment).toBe("staging");
      expect(entry.profile).toBe("smoke");
      expect(entry.message).toContain("login-test");
    });
  });

  describe("logExecutionEnd()", () => {
    it("should log a successful execution_end event", () => {
      existsSyncSpy.mockReturnValue(false);

      const entry = auditModule.logExecutionEnd(
        ctx,
        "api",
        "staging",
        "load",
        "test-1",
        true,
        30000
      );

      expect(entry.event).toBe("execution_end");
      expect(entry.result).toBe("success");
      expect(entry.durationMs).toBe(30000);
      expect(entry.message).toContain("passed");
    });

    it("should log a failed execution_end event", () => {
      existsSyncSpy.mockReturnValue(false);

      const entry = auditModule.logExecutionEnd(
        ctx,
        "api",
        "staging",
        "load",
        "test-1",
        false,
        15000
      );

      expect(entry.event).toBe("execution_end");
      expect(entry.result).toBe("failure");
      expect(entry.message).toContain("failed");
    });

    it("should include reportLink when provided", () => {
      existsSyncSpy.mockReturnValue(false);

      const entry = auditModule.logExecutionEnd(
        ctx,
        "api",
        "staging",
        "load",
        "test-1",
        true,
        5000,
        "/reports/test-client/report.html"
      );

      expect(entry.reportLink).toBe("/reports/test-client/report.html");
    });
  });

  describe("logConfigChange()", () => {
    it("should log config changes with field details", () => {
      existsSyncSpy.mockReturnValue(false);

      const entry = auditModule.logConfigChange(ctx, [
        { field: "thresholds.http_req_duration", oldValue: "p(95)<500", newValue: "p(95)<1000" },
      ]);

      expect(entry.event).toBe("config_change");
      expect(entry.result).toBe("success");
      expect(entry.message).toContain("thresholds.http_req_duration");
    });

    it("should list multiple changed fields in message", () => {
      existsSyncSpy.mockReturnValue(false);

      const entry = auditModule.logConfigChange(ctx, [
        { field: "baseUrl", oldValue: "http://old", newValue: "http://new" },
        { field: "version", oldValue: "1.0.0", newValue: "2.0.0" },
      ]);

      expect(entry.message).toContain("baseUrl");
      expect(entry.message).toContain("version");
    });
  });

  describe("logAccessDenied()", () => {
    it("should log access denied events", () => {
      existsSyncSpy.mockReturnValue(false);

      const entry = auditModule.logAccessDenied(ctx, "delete-report", "Insufficient permissions");

      expect(entry.event).toBe("access_denied");
      expect(entry.result).toBe("denied");
      expect(entry.message).toContain("delete-report");
      expect(entry.message).toContain("Insufficient permissions");
    });
  });

  describe("logRoleChange()", () => {
    it("should log role changes", () => {
      existsSyncSpy.mockReturnValue(false);

      const entry = auditModule.logRoleChange(
        ctx,
        "user@example.com",
        "viewer",
        "admin",
        "Promotion"
      );

      expect(entry.event).toBe("role_change");
      expect(entry.result).toBe("success");
      expect(entry.message).toContain("user@example.com");
      expect(entry.message).toContain("viewer");
      expect(entry.message).toContain("admin");
    });

    it("should handle role change without justification", () => {
      existsSyncSpy.mockReturnValue(false);

      const entry = auditModule.logRoleChange(ctx, "user@example.com", "viewer", "editor");

      expect(entry.event).toBe("role_change");
      expect(entry.params?.justification).toBeUndefined();
    });
  });

  // ── queryAuditLog ───────────────────────────────────────────────────────

  describe("queryAuditLog()", () => {
    const sampleEntry = (overrides: Record<string, unknown> = {}) =>
      JSON.stringify({
        timestamp: "2026-03-01T10:00:00.000Z",
        event: "execution_start",
        actor: "test-user",
        client: "test-client",
        service: "api",
        result: "success",
        hash: "abc123",
        previousHash: "000",
        ...overrides,
      });

    it("should return empty array when audit directory does not exist", () => {
      existsSyncSpy.mockReturnValue(false);

      const entries = auditModule.queryAuditLog(ctx, { client: "test-client" });
      expect(entries).toEqual([]);
    });

    it("should read and parse audit entries from files", () => {
      existsSyncSpy.mockReturnValue(true);
      readdirSyncSpy.mockReturnValue(["audit-2026-03.jsonl"] as unknown as fs.Dirent[]);
      readFileSyncSpy.mockReturnValue(
        sampleEntry() + "\n" + sampleEntry({ timestamp: "2026-03-02T10:00:00.000Z" })
      );

      const entries = auditModule.queryAuditLog(ctx, { client: "test-client" });
      expect(entries).toHaveLength(2);
    });

    it("should filter by eventType", () => {
      existsSyncSpy.mockReturnValue(true);
      readdirSyncSpy.mockReturnValue(["audit-2026-03.jsonl"] as unknown as fs.Dirent[]);
      readFileSyncSpy.mockReturnValue(
        sampleEntry({ event: "execution_start" }) + "\n" + sampleEntry({ event: "execution_end" })
      );

      const entries = auditModule.queryAuditLog(ctx, {
        client: "test-client",
        eventType: "execution_start",
      });
      expect(entries).toHaveLength(1);
      expect(entries[0].event).toBe("execution_start");
    });

    it("should filter by actor", () => {
      existsSyncSpy.mockReturnValue(true);
      readdirSyncSpy.mockReturnValue(["audit-2026-03.jsonl"] as unknown as fs.Dirent[]);
      readFileSyncSpy.mockReturnValue(
        sampleEntry({ actor: "alice" }) + "\n" + sampleEntry({ actor: "bob" })
      );

      const entries = auditModule.queryAuditLog(ctx, { client: "test-client", actor: "alice" });
      expect(entries).toHaveLength(1);
      expect(entries[0].actor).toBe("alice");
    });

    it("should filter by service", () => {
      existsSyncSpy.mockReturnValue(true);
      readdirSyncSpy.mockReturnValue(["audit-2026-03.jsonl"] as unknown as fs.Dirent[]);
      readFileSyncSpy.mockReturnValue(
        sampleEntry({ service: "api" }) + "\n" + sampleEntry({ service: "auth" })
      );

      const entries = auditModule.queryAuditLog(ctx, { client: "test-client", service: "api" });
      expect(entries).toHaveLength(1);
      expect(entries[0].service).toBe("api");
    });

    it("should filter by result", () => {
      existsSyncSpy.mockReturnValue(true);
      readdirSyncSpy.mockReturnValue(["audit-2026-03.jsonl"] as unknown as fs.Dirent[]);
      readFileSyncSpy.mockReturnValue(
        sampleEntry({ result: "success" }) + "\n" + sampleEntry({ result: "failure" })
      );

      const entries = auditModule.queryAuditLog(ctx, { client: "test-client", result: "failure" });
      expect(entries).toHaveLength(1);
      expect(entries[0].result).toBe("failure");
    });

    it("should filter by date range (from)", () => {
      existsSyncSpy.mockReturnValue(true);
      readdirSyncSpy.mockReturnValue(["audit-2026-03.jsonl"] as unknown as fs.Dirent[]);
      readFileSyncSpy.mockReturnValue(
        sampleEntry({ timestamp: "2026-03-01T10:00:00.000Z" }) +
          "\n" +
          sampleEntry({ timestamp: "2026-03-15T10:00:00.000Z" })
      );

      const entries = auditModule.queryAuditLog(ctx, {
        client: "test-client",
        from: "2026-03-10T00:00:00.000Z",
      });
      expect(entries).toHaveLength(1);
      expect(entries[0].timestamp).toBe("2026-03-15T10:00:00.000Z");
    });

    it("should filter by date range (to)", () => {
      existsSyncSpy.mockReturnValue(true);
      readdirSyncSpy.mockReturnValue(["audit-2026-03.jsonl"] as unknown as fs.Dirent[]);
      readFileSyncSpy.mockReturnValue(
        sampleEntry({ timestamp: "2026-03-01T10:00:00.000Z" }) +
          "\n" +
          sampleEntry({ timestamp: "2026-03-15T10:00:00.000Z" })
      );

      const entries = auditModule.queryAuditLog(ctx, {
        client: "test-client",
        to: "2026-03-10T00:00:00.000Z",
      });
      expect(entries).toHaveLength(1);
      expect(entries[0].timestamp).toBe("2026-03-01T10:00:00.000Z");
    });

    it("should respect limit", () => {
      existsSyncSpy.mockReturnValue(true);
      readdirSyncSpy.mockReturnValue(["audit-2026-03.jsonl"] as unknown as fs.Dirent[]);
      readFileSyncSpy.mockReturnValue(sampleEntry() + "\n" + sampleEntry() + "\n" + sampleEntry());

      const entries = auditModule.queryAuditLog(ctx, { client: "test-client", limit: 2 });
      expect(entries).toHaveLength(2);
    });

    it("should skip corrupted lines", () => {
      existsSyncSpy.mockReturnValue(true);
      readdirSyncSpy.mockReturnValue(["audit-2026-03.jsonl"] as unknown as fs.Dirent[]);
      readFileSyncSpy.mockReturnValue(sampleEntry() + "\nNOT_VALID_JSON\n" + sampleEntry());

      const entries = auditModule.queryAuditLog(ctx, { client: "test-client" });
      expect(entries).toHaveLength(2);
    });

    it("should skip files outside date range by filename", () => {
      existsSyncSpy.mockReturnValue(true);
      readdirSyncSpy.mockReturnValue([
        "audit-2026-01.jsonl",
        "audit-2026-03.jsonl",
        "audit-2026-06.jsonl",
      ] as unknown as fs.Dirent[]);
      readFileSyncSpy.mockReturnValue(sampleEntry());

      auditModule.queryAuditLog(ctx, {
        client: "test-client",
        from: "2026-03-01T00:00:00.000Z",
        to: "2026-04-01T00:00:00.000Z",
      });
      // Should only read audit-2026-03.jsonl (skipping 01 and 06)
      // readFileSync is called once for the file content
      expect(readFileSyncSpy).toHaveBeenCalledTimes(1);
    });

    it("should handle empty audit files", () => {
      existsSyncSpy.mockReturnValue(true);
      readdirSyncSpy.mockReturnValue(["audit-2026-03.jsonl"] as unknown as fs.Dirent[]);
      readFileSyncSpy.mockReturnValue("");

      const entries = auditModule.queryAuditLog(ctx, { client: "test-client" });
      expect(entries).toEqual([]);
    });
  });

  // ── verifyAuditChain ────────────────────────────────────────────────────

  describe("verifyAuditChain()", () => {
    it("should return valid for non-existent file", () => {
      existsSyncSpy.mockReturnValue(false);

      const result = auditModule.verifyAuditChain(ctx, "2026-03");
      expect(result.valid).toBe(true);
      expect(result.brokenAt).toBe(-1);
      expect(result.totalEntries).toBe(0);
    });

    it("should return valid for empty file", () => {
      existsSyncSpy.mockReturnValue(true);
      readFileSyncSpy.mockReturnValue("");

      const result = auditModule.verifyAuditChain(ctx, "2026-03");
      expect(result.valid).toBe(true);
      expect(result.brokenAt).toBe(-1);
      expect(result.totalEntries).toBe(0);
    });

    it("should detect broken chain at corrupted entries", () => {
      existsSyncSpy.mockReturnValue(true);
      readFileSyncSpy.mockReturnValue("NOT_JSON\n");

      const result = auditModule.verifyAuditChain(ctx, "2026-03");
      expect(result.valid).toBe(false);
      expect(result.brokenAt).toBe(0);
    });

    it("should report valid=true with brokenAt=-1 for whitespace-only content", () => {
      existsSyncSpy.mockReturnValue(true);
      readFileSyncSpy.mockReturnValue("   ");

      const result = auditModule.verifyAuditChain(ctx, "2026-03");
      expect(result.valid).toBe(true);
      expect(result.brokenAt).toBe(-1);
    });
  });

  // ── resetAuditLogger ────────────────────────────────────────────────────

  describe("resetAuditLogger()", () => {
    it("should reset internal state without throwing", () => {
      expect(() => auditModule.resetAuditLogger()).not.toThrow();
    });

    it("should allow re-initialization after reset", () => {
      existsSyncSpy.mockReturnValue(false);

      auditModule.resetAuditLogger();
      auditModule.initAuditLogger(ctx);

      expect(mkdirSyncSpy).toHaveBeenCalled();
    });
  });
});
