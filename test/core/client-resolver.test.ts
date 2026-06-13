import { describe, it, expect, vi, beforeEach, afterAll, beforeAll } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// Mock client-validator before importing the module
vi.mock("../../src/core/client-validator", () => ({
  CLIENT_REQUIRED_DIRS: ["config", "scenarios"],
  CLIENT_REQUIRED_FILES: ["config/default.json"],
}));

import {
  resolveFrameworkRoot,
  resolveClient,
  assertPathInClientScope,
  ensureReportsDir,
  listClients,
} from "../../src/core/client-resolver";

// ── Test fixture helpers ───────────────────────────────────────────────────────

let tmpRoot: string;

function setupFrameworkDir(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "k6-resolver-test-"));
  // Create the two dirs resolveFrameworkRoot looks for
  fs.mkdirSync(path.join(root, "clients"), { recursive: true });
  fs.mkdirSync(path.join(root, "shared"), { recursive: true });
  return root;
}

function createClientDir(root: string, name: string): void {
  const clientDir = path.join(root, "clients", name);
  fs.mkdirSync(path.join(clientDir, "config"), { recursive: true });
  fs.mkdirSync(path.join(clientDir, "scenarios"), { recursive: true });
  fs.writeFileSync(path.join(clientDir, "config", "default.json"), "{}");
}

function cleanup(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

describe("client-resolver", () => {
  beforeAll(() => {
    tmpRoot = setupFrameworkDir();
  });

  afterAll(() => {
    cleanup(tmpRoot);
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("resolveFrameworkRoot()", () => {
    it("should return the directory that has both clients/ and shared/", () => {
      const root = resolveFrameworkRoot(tmpRoot);
      // On macOS /var -> /private/var, so compare real paths
      expect(fs.realpathSync(root)).toBe(fs.realpathSync(tmpRoot));
    });

    it("should walk up directories from a subdirectory", () => {
      const subDir = path.join(tmpRoot, "clients");
      const root = resolveFrameworkRoot(subDir);
      expect(fs.realpathSync(root)).toBe(fs.realpathSync(tmpRoot));
    });

    it("should throw if root cannot be found", () => {
      const isolated = fs.mkdtempSync(path.join(os.tmpdir(), "k6-no-root-"));
      try {
        expect(() => resolveFrameworkRoot(isolated)).toThrow(/cannot locate framework root/);
      } finally {
        cleanup(isolated);
      }
    });
  });

  describe("resolveClient()", () => {
    it("should resolve a valid client and return ClientContext", () => {
      createClientDir(tmpRoot, "valid-client");

      const ctx = resolveClient("valid-client", tmpRoot);

      expect(ctx.clientId).toBe("valid-client");
      expect(ctx.rootDir).toContain("valid-client");
      expect(ctx.configDir).toContain("config");
      expect(ctx.scenariosDir).toContain("scenarios");
      expect(ctx.isSymlink).toBe(false);
      expect(ctx.isSubmodule).toBe(false);
    });

    it("should throw for empty client name", () => {
      expect(() => resolveClient("", tmpRoot)).toThrow(/client name is required/);
    });

    it("should throw for client name with path traversal (..)", () => {
      expect(() => resolveClient("..", tmpRoot)).toThrow(/invalid client name/);
    });

    it("should throw for client name with forward slash", () => {
      expect(() => resolveClient("../etc/passwd", tmpRoot)).toThrow(/invalid client name/);
    });

    it("should throw for client name with backslash", () => {
      expect(() => resolveClient("my\\client", tmpRoot)).toThrow(/invalid client name/);
    });

    it("should throw for client name with special characters", () => {
      expect(() => resolveClient("my client!", tmpRoot)).toThrow(/invalid client name/);
    });

    it("should accept client names with hyphens and underscores", () => {
      createClientDir(tmpRoot, "my-client_v2");
      expect(() => resolveClient("my-client_v2", tmpRoot)).not.toThrow();
    });

    it("should throw if client directory does not exist", () => {
      expect(() => resolveClient("nonexistent-client", tmpRoot)).toThrow(/not found/);
    });

    it("should throw for dot as client name", () => {
      expect(() => resolveClient(".", tmpRoot)).toThrow(/invalid client name/);
    });

    it("should throw when client directory lacks required structure", () => {
      const clientName = "incomplete-client";
      const clientDir = path.join(tmpRoot, "clients", clientName);
      fs.mkdirSync(clientDir, { recursive: true });
      // No config/ or scenarios/ subdirs

      expect(() => resolveClient(clientName, tmpRoot)).toThrow(/invalid structure/);

      // cleanup
      fs.rmSync(clientDir, { recursive: true, force: true });
    });
  });

  describe("assertPathInClientScope()", () => {
    it("should not throw for paths inside client root", () => {
      createClientDir(tmpRoot, "scope-client");
      const ctx = resolveClient("scope-client", tmpRoot);

      expect(() =>
        assertPathInClientScope(path.join(ctx.rootDir, "config", "file.json"), ctx)
      ).not.toThrow();
    });

    it("should throw for paths outside client scope", () => {
      createClientDir(tmpRoot, "scope-client2");
      const ctx = resolveClient("scope-client2", tmpRoot);

      expect(() => assertPathInClientScope("/tmp/outside-path", ctx)).toThrow(/outside the scope/);
    });

    it("should allow reports directory when allowReportsDir is true", () => {
      createClientDir(tmpRoot, "scope-client3");
      const ctx = resolveClient("scope-client3", tmpRoot);
      // Ensure reports dir exists
      fs.mkdirSync(ctx.reportsDir, { recursive: true });

      expect(() =>
        assertPathInClientScope(path.join(ctx.reportsDir, "report.html"), ctx, true)
      ).not.toThrow();

      // cleanup
      fs.rmSync(ctx.reportsDir, { recursive: true, force: true });
    });
  });

  describe("ensureReportsDir()", () => {
    it("should create the reports directory if it does not exist", () => {
      createClientDir(tmpRoot, "reports-client");
      const ctx = resolveClient("reports-client", tmpRoot);

      // Remove reports dir if it exists
      if (fs.existsSync(ctx.reportsDir)) {
        fs.rmSync(ctx.reportsDir, { recursive: true, force: true });
      }

      const result = ensureReportsDir(ctx);

      expect(fs.existsSync(ctx.reportsDir)).toBe(true);
      expect(result).toBe(ctx.reportsDir);

      // cleanup
      fs.rmSync(ctx.reportsDir, { recursive: true, force: true });
    });

    it("should return the reports directory path when already exists", () => {
      createClientDir(tmpRoot, "reports-client2");
      const ctx = resolveClient("reports-client2", tmpRoot);
      fs.mkdirSync(ctx.reportsDir, { recursive: true });

      const result = ensureReportsDir(ctx);

      expect(result).toBe(ctx.reportsDir);

      // cleanup
      fs.rmSync(ctx.reportsDir, { recursive: true, force: true });
    });
  });

  describe("listClients()", () => {
    it("should return empty array when clients directory does not exist", () => {
      const emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), "k6-empty-"));
      fs.mkdirSync(path.join(emptyRoot, "shared"), { recursive: true });

      const result = listClients(emptyRoot);

      expect(result).toEqual([]);
      cleanup(emptyRoot);
    });

    it("should return sorted list of valid client directories", () => {
      const listRoot = setupFrameworkDir();
      createClientDir(listRoot, "beta");
      createClientDir(listRoot, "alpha");
      createClientDir(listRoot, "gamma");

      const result = listClients(listRoot);

      expect(result).toEqual(["alpha", "beta", "gamma"]);
      cleanup(listRoot);
    });

    it("should filter out non-directory entries", () => {
      const listRoot = setupFrameworkDir();
      createClientDir(listRoot, "real-client");
      // Create a file (not directory) in clients/
      fs.writeFileSync(path.join(listRoot, "clients", "readme.md"), "test");

      const result = listClients(listRoot);

      expect(result).toEqual(["real-client"]);
      cleanup(listRoot);
    });

    it("should filter out names with invalid characters", () => {
      const listRoot = setupFrameworkDir();
      createClientDir(listRoot, "valid-client");
      fs.mkdirSync(path.join(listRoot, "clients", ".hidden"), { recursive: true });

      const result = listClients(listRoot);

      expect(result).toEqual(["valid-client"]);
      cleanup(listRoot);
    });
  });
});
