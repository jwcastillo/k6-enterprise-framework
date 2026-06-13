import { describe, it, expect, vi, beforeEach, afterAll, beforeAll } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type { ClientContext } from "../../src/types/client.d";

// Mock audit-logger
vi.mock("../../src/core/audit-logger", () => ({
  logConfigChange: vi.fn(),
}));

import {
  detectAndLogConfigChanges,
  captureConfigSnapshot,
} from "../../src/core/config-tracker";
import { logConfigChange } from "../../src/core/audit-logger";

let tmpRoot: string;
let clientContext: ClientContext;

function setupClient(): void {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "k6-tracker-test-"));
  const clientDir = path.join(tmpRoot, "client-a");
  const reportsDir = path.join(tmpRoot, "reports", "client-a");
  fs.mkdirSync(path.join(clientDir, "config"), { recursive: true });
  fs.mkdirSync(reportsDir, { recursive: true });

  clientContext = {
    clientId: "client-a",
    rootDir: clientDir,
    configDir: path.join(clientDir, "config"),
    dataDir: path.join(clientDir, "data"),
    libDir: path.join(clientDir, "lib"),
    scenariosDir: path.join(clientDir, "scenarios"),
    reportsDir,
    envFile: path.join(clientDir, ".env"),
    mocksDir: path.join(clientDir, "mocks"),
    brandingDir: path.join(clientDir, "branding"),
    isSubmodule: false,
    isSymlink: false,
  };
}

describe("config-tracker", () => {
  beforeAll(() => {
    setupClient();
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
    // Clean up snapshot between tests
    const snapshotDir = path.join(clientContext.reportsDir, "audit");
    if (fs.existsSync(snapshotDir)) {
      fs.rmSync(snapshotDir, { recursive: true, force: true });
    }
  });

  describe("detectAndLogConfigChanges()", () => {
    it("should return empty array on first run (no previous snapshot)", () => {
      const changes = detectAndLogConfigChanges(clientContext);

      expect(changes).toEqual([]);
    });

    it("should save a snapshot on first run", () => {
      detectAndLogConfigChanges(clientContext);

      const snapshotPath = path.join(clientContext.reportsDir, "audit", ".config-snapshot.json");
      expect(fs.existsSync(snapshotPath)).toBe(true);
    });

    it("should detect no changes when configs are unchanged", () => {
      // Write a config file
      fs.writeFileSync(
        path.join(clientContext.configDir, "thresholds.json"),
        JSON.stringify({ http_req_duration: ["p(95)<1000"] }),
      );

      // First run - creates snapshot
      detectAndLogConfigChanges(clientContext);
      vi.clearAllMocks();

      // Second run - no changes
      const changes = detectAndLogConfigChanges(clientContext);

      expect(changes).toEqual([]);
      expect(logConfigChange).not.toHaveBeenCalled();
    });

    it("should detect changes when a config file is modified", () => {
      // Write initial config
      fs.writeFileSync(
        path.join(clientContext.configDir, "thresholds.json"),
        JSON.stringify({ http_req_duration: ["p(95)<1000"] }),
      );

      // First run - creates snapshot
      detectAndLogConfigChanges(clientContext);
      vi.clearAllMocks();

      // Modify config
      fs.writeFileSync(
        path.join(clientContext.configDir, "thresholds.json"),
        JSON.stringify({ http_req_duration: ["p(95)<500"] }),
      );

      // Second run - detect changes
      const changes = detectAndLogConfigChanges(clientContext);

      expect(changes.length).toBeGreaterThan(0);
      expect(logConfigChange).toHaveBeenCalledWith(clientContext, changes);
    });

    it("should detect when a new config file is added", () => {
      // First run - no slos.json
      detectAndLogConfigChanges(clientContext);
      vi.clearAllMocks();

      // Add slos.json
      fs.writeFileSync(
        path.join(clientContext.configDir, "slos.json"),
        JSON.stringify({ availability: "99.9%" }),
      );

      const changes = detectAndLogConfigChanges(clientContext);

      expect(changes.length).toBeGreaterThan(0);

      // cleanup
      fs.unlinkSync(path.join(clientContext.configDir, "slos.json"));
    });

    it("should include justification when provided", () => {
      // Write config and snapshot
      fs.writeFileSync(
        path.join(clientContext.configDir, "thresholds.json"),
        JSON.stringify({ limit: 100 }),
      );
      detectAndLogConfigChanges(clientContext);
      vi.clearAllMocks();

      // Modify config
      fs.writeFileSync(
        path.join(clientContext.configDir, "thresholds.json"),
        JSON.stringify({ limit: 200 }),
      );

      const changes = detectAndLogConfigChanges(clientContext, "Performance tuning JIRA-123");

      expect(changes.length).toBeGreaterThan(0);
      expect(changes[0].justification).toBe("Performance tuning JIRA-123");
    });
  });

  describe("captureConfigSnapshot()", () => {
    it("should create a snapshot file", () => {
      captureConfigSnapshot(clientContext);

      const snapshotPath = path.join(clientContext.reportsDir, "audit", ".config-snapshot.json");
      expect(fs.existsSync(snapshotPath)).toBe(true);

      const snapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf-8"));
      expect(snapshot.capturedAt).toBeDefined();
      expect(snapshot.files).toBeDefined();
    });

    it("should capture current config file contents", () => {
      fs.writeFileSync(
        path.join(clientContext.configDir, "thresholds.json"),
        JSON.stringify({ limit: 500 }),
      );

      captureConfigSnapshot(clientContext);

      const snapshotPath = path.join(clientContext.reportsDir, "audit", ".config-snapshot.json");
      const snapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf-8"));

      expect(snapshot.files["config/thresholds.json"]).toEqual({ limit: 500 });
    });
  });
});
