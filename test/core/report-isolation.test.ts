import { describe, it, expect, vi, beforeEach, afterAll, beforeAll } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type { ClientContext } from "../../src/types/client.d";

// Mock client-resolver for the functions report-isolation imports
vi.mock("../../src/core/client-resolver", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    // Keep the real assertPathInClientScope and ensureReportsDir
    // since report-isolation imports them
  };
});

import {
  buildReportDir,
  listClientReports,
  findLatestReport,
  findRecentReports,
  writeReportArtifact,
  readReportArtifact,
} from "../../src/core/report-isolation";

let tmpRoot: string;

function makeContext(clientId: string): ClientContext {
  const reportsDir = path.join(tmpRoot, "reports", clientId);
  return {
    clientId,
    rootDir: path.join(tmpRoot, "clients", clientId),
    configDir: path.join(tmpRoot, "clients", clientId, "config"),
    dataDir: path.join(tmpRoot, "clients", clientId, "data"),
    libDir: path.join(tmpRoot, "clients", clientId, "lib"),
    scenariosDir: path.join(tmpRoot, "clients", clientId, "scenarios"),
    reportsDir,
    envFile: path.join(tmpRoot, "clients", clientId, ".env"),
    mocksDir: path.join(tmpRoot, "clients", clientId, "mocks"),
    brandingDir: path.join(tmpRoot, "clients", clientId, "branding"),
    isSubmodule: false,
    isSymlink: false,
  };
}

describe("report-isolation", () => {
  beforeAll(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "k6-report-iso-"));
    fs.mkdirSync(path.join(tmpRoot, "clients", "acme"), { recursive: true });
    fs.mkdirSync(path.join(tmpRoot, "reports"), { recursive: true });
  });

  afterAll(() => {
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("buildReportDir()", () => {
    it("should create a report directory with test name and timestamp", () => {
      const ctx = makeContext("acme");
      const ts = new Date("2025-06-15T10:30:00.000Z");

      const dir = buildReportDir(ctx, "login-test", ts);

      expect(dir).toContain("login-test");
      expect(dir).toContain("2025-06-15_10-30-00");
      expect(fs.existsSync(dir)).toBe(true);
    });

    it("should sanitize test name for directory use", () => {
      const ctx = makeContext("acme");
      const ts = new Date("2025-01-01T00:00:00.000Z");

      const dir = buildReportDir(ctx, "My Test Scenario!", ts);

      // Should be lowercased and special chars replaced with hyphens
      expect(dir).toContain("my-test-scenario");
    });

    it("should use current date when no timestamp provided", () => {
      const ctx = makeContext("acme");
      const dir = buildReportDir(ctx, "auto-ts-test");

      expect(fs.existsSync(dir)).toBe(true);
    });
  });

  describe("listClientReports()", () => {
    it("should return empty array when reports dir does not exist", () => {
      const ctx = makeContext("nonexistent");

      const result = listClientReports(ctx);

      expect(result).toEqual([]);
    });

    it("should list report directories for a specific test", () => {
      const ctx = makeContext("acme");
      // Create some report dirs
      const testDir = path.join(ctx.reportsDir, "api-test");
      fs.mkdirSync(path.join(testDir, "2025-01-01_10-00-00"), { recursive: true });
      fs.mkdirSync(path.join(testDir, "2025-01-02_10-00-00"), { recursive: true });

      const result = listClientReports(ctx, "api-test");

      expect(result).toHaveLength(2);
      // Should be sorted newest first
      expect(result[0]).toContain("2025-01-02");
      expect(result[1]).toContain("2025-01-01");
    });

    it("should list all reports across all tests when no test name provided", () => {
      const ctx = makeContext("acme");

      const result = listClientReports(ctx);

      expect(result.length).toBeGreaterThan(0);
    });

    it("should skip audit and slo-compliance directories", () => {
      const ctx = makeContext("acme");
      fs.mkdirSync(path.join(ctx.reportsDir, "audit", "2025-01-01"), { recursive: true });
      fs.mkdirSync(path.join(ctx.reportsDir, "slo-compliance", "2025-01-01"), { recursive: true });

      const result = listClientReports(ctx);

      const paths = result.map((r: string) => r);
      expect(paths.some((p: string) => p.includes("audit"))).toBe(false);
      expect(paths.some((p: string) => p.includes("slo-compliance"))).toBe(false);
    });
  });

  describe("findLatestReport()", () => {
    it("should return the most recent report", () => {
      const ctx = makeContext("acme");

      const result = findLatestReport(ctx, "api-test");

      expect(result).not.toBeNull();
      expect(result).toContain("2025-01-02");
    });

    it("should return null when no reports exist", () => {
      const ctx = makeContext("acme");

      const result = findLatestReport(ctx, "nonexistent-test");

      expect(result).toBeNull();
    });
  });

  describe("findRecentReports()", () => {
    it("should return up to N most recent reports", () => {
      const ctx = makeContext("acme");

      const result = findRecentReports(ctx, "api-test", 1);

      expect(result).toHaveLength(1);
      expect(result[0]).toContain("2025-01-02");
    });

    it("should return all reports when count exceeds available", () => {
      const ctx = makeContext("acme");

      const result = findRecentReports(ctx, "api-test", 100);

      expect(result).toHaveLength(2);
    });
  });

  describe("writeReportArtifact()", () => {
    it("should write content to a file in the report directory", () => {
      const ctx = makeContext("acme");
      const reportDir = buildReportDir(ctx, "write-test", new Date("2025-03-01T00:00:00.000Z"));

      const filePath = writeReportArtifact(ctx, reportDir, "report.html", "<h1>Report</h1>");

      expect(fs.existsSync(filePath)).toBe(true);
      expect(fs.readFileSync(filePath, "utf-8")).toBe("<h1>Report</h1>");
    });

    it("should accept JSON file extension", () => {
      const ctx = makeContext("acme");
      const reportDir = buildReportDir(
        ctx,
        "write-json-test",
        new Date("2025-03-02T00:00:00.000Z")
      );

      const filePath = writeReportArtifact(ctx, reportDir, "summary.json", "{}");

      expect(fs.existsSync(filePath)).toBe(true);
    });

    it("should reject disallowed file extensions", () => {
      const ctx = makeContext("acme");
      const reportDir = buildReportDir(ctx, "write-bad-ext", new Date("2025-03-03T00:00:00.000Z"));

      expect(() => writeReportArtifact(ctx, reportDir, "malware.exe", "data")).toThrow(
        /not allowed/
      );
    });

    it("should reject .sh extension", () => {
      const ctx = makeContext("acme");
      const reportDir = buildReportDir(ctx, "write-sh", new Date("2025-03-04T00:00:00.000Z"));

      expect(() => writeReportArtifact(ctx, reportDir, "script.sh", "#!/bin/bash")).toThrow(
        /not allowed/
      );
    });
  });

  describe("readReportArtifact()", () => {
    it("should read content from a report file", () => {
      const ctx = makeContext("acme");
      const reportDir = buildReportDir(ctx, "read-test", new Date("2025-04-01T00:00:00.000Z"));
      const filePath = path.join(reportDir, "data.json");
      fs.writeFileSync(filePath, '{"key":"value"}');

      const content = readReportArtifact(ctx, filePath);

      expect(content).toBe('{"key":"value"}');
    });

    it("should throw for non-existent file", () => {
      const ctx = makeContext("acme");

      expect(() => readReportArtifact(ctx, path.join(ctx.reportsDir, "missing.json"))).toThrow(
        /not found/
      );
    });
  });
});
